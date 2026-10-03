// Effects, all pooled: sprint dust, puffs, confetti, smoke clouds, the Hush's fireworks (computed on the GPU from a
// seed, so every page sees the same show), thrown lanterns, masks that fly off, rings on the stones, and faces.
import * as THREE from 'three';
import { puffTexture, glowTexture } from './textures.js';
import { hash32, rng } from '../sim/rng.js';

const MAX_P = 900;
const RINGS = 48;

export function createFx(scene) {
  // ---- CPU particles (one Points draw call) ----
  const pos = new Float32Array(MAX_P * 3);
  const col = new Float32Array(MAX_P * 3);
  const size = new Float32Array(MAX_P);
  const alpha = new Float32Array(MAX_P);
  const vel = new Float32Array(MAX_P * 3);
  const life = new Float32Array(MAX_P);
  const max = new Float32Array(MAX_P);
  const grav = new Float32Array(MAX_P);
  const grow = new Float32Array(MAX_P);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const pmat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: puffTexture() }, uScale: { value: 420 } },
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    vertexShader: `attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale;
void main() { vC = color; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; varying vec3 vC; varying float vA;
void main() { vec4 t = texture2D(uMap, gl_PointCoord); if (t.a * vA < 0.01) discard; gl_FragColor = vec4(vC, t.a * vA); }`,
  });
  const points = new THREE.Points(geo, pmat);
  points.frustumCulled = false;
  scene.add(points);
  let cursor = 0;
  let budget = 1;
  const C = new THREE.Color();

  function spawn(x, y, z, vx, vy, vz, hex, s, l, g = 0, gr = 0) {
    const i = cursor;
    cursor = (cursor + 1) % MAX_P;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    vel[i * 3] = vx;
    vel[i * 3 + 1] = vy;
    vel[i * 3 + 2] = vz;
    C.setHex(hex);
    col[i * 3] = C.r;
    col[i * 3 + 1] = C.g;
    col[i * 3 + 2] = C.b;
    size[i] = s;
    life[i] = l;
    max[i] = l;
    grav[i] = g;
    grow[i] = gr;
    alpha[i] = 1;
  }

  // ---- Rings on the stones (target, marks, a slipped mask's spotlight, lantern reach) ----
  const ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: false });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, RINGS);
  rings.setColorAt(0, new THREE.Color(1, 1, 1));
  rings.count = 0;
  rings.frustumCulled = false;
  rings.renderOrder = 2;
  scene.add(rings);

  // ---- Thrown lanterns ----
  const lanternGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.42, 8);
  const lanternMat = new THREE.MeshBasicMaterial({ color: 0xffc46a });
  const lanterns = Array.from({ length: 6 }, () => {
    const m = new THREE.Mesh(lanternGeo, lanternMat);
    m.visible = false;
    scene.add(m);
    return m;
  });
  const lanternGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb35a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const glowPool = Array.from({ length: 6 }, () => {
    const s = lanternGlow.clone();
    s.material = lanternGlow.material.clone();
    s.visible = false;
    s.scale.set(3, 3, 1);
    scene.add(s);
    return s;
  });

  // ---- Masks that fly off an unmasked face ----
  const maskGeo = new THREE.SphereGeometry(0.18, 10, 6, Math.PI / 2 - 1.2, 2.4, 0.5, 1.6);
  const flying = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(maskGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    m.visible = false;
    scene.add(m);
    flying.push({ m, t: 0, vx: 0, vy: 0, vz: 0, spin: 0, life: 0 });
  }

  // ---- Faces revealed when a mask falls ----
  const faces = Array.from({ length: 8 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    s.visible = false;
    s.scale.set(0.4, 0.4, 1);
    scene.add(s);
    return { s, until: 0 };
  });

  // ---- Fireworks: shells on the GPU, all from one seed ----
  const FW_SHELLS = 46;
  const FW_PER = 72;
  const TRAIL = 3; // each spark drawn three times along its path: a short streak
  const FW_N = FW_SHELLS * FW_PER * TRAIL;
  const fwGeo = new THREE.BufferGeometry();
  const fwShell = new Float32Array(FW_N * 4);
  const fwDir = new Float32Array(FW_N * 4);
  const fwCol = new Float32Array(FW_N * 3);
  const fwTrail = new Float32Array(FW_N);
  for (let i = 0; i < FW_N; i++) fwTrail[i] = i % TRAIL;
  fwGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FW_N * 3), 3));
  fwGeo.setAttribute('aShell', new THREE.BufferAttribute(fwShell, 4));
  fwGeo.setAttribute('aDir', new THREE.BufferAttribute(fwDir, 4));
  fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol, 3));
  fwGeo.setAttribute('aTrail', new THREE.BufferAttribute(fwTrail, 1));
  const fwUniforms = { uTime: { value: -999 }, uMap: { value: glowTexture() }, uScale: { value: 380 } };
  const fwMat = new THREE.ShaderMaterial({
    uniforms: fwUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    vertexShader: `attribute vec4 aShell; attribute vec4 aDir; attribute float aTrail; varying vec3 vC; varying float vA;
uniform float uTime; uniform float uScale;
void main() {
  // aShell: launch x, z, launch time, burst height. aDir: direction xyz, speed. Particle 0 of each shell is the rocket.
  // aTrail: 0 the spark itself, 1 and 2 where it was a moment ago (fainter): a streak.
  float t = uTime - aShell.z - aTrail * 0.055;
  float rise = 1.3;
  vec3 base = vec3(aShell.x, 0.0, aShell.y);
  vec3 p;
  float a;
  if (t < 0.0) { p = base; a = 0.0; }
  else if (t < rise) {
    float u = t / rise;
    p = base + vec3(0.0, aShell.w * (1.0 - (1.0 - u) * (1.0 - u)), 0.0);
    a = aDir.w > 0.0 ? 0.0 : 1.0;
  } else {
    float b = t - rise;
    p = base + vec3(0.0, aShell.w, 0.0) + aDir.xyz * aDir.w * (1.0 - exp(-b * 1.6)) / 1.6 + vec3(0.0, -1.2 * b * b, 0.0);
    a = aDir.w > 0.0 ? max(0.0, 1.0 - b / 2.4) : 0.0;
    a *= 0.75 + 0.25 * sin(b * 30.0 + aDir.x * 40.0);
  }
  vC = color;
  vA = a * (1.0 - aTrail * 0.33);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (aDir.w > 0.0 ? 1.25 - aTrail * 0.25 : 1.6) * uScale / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform sampler2D uMap; varying vec3 vC; varying float vA;
void main() { vec4 t = texture2D(uMap, gl_PointCoord); if (vA < 0.01) discard; gl_FragColor = vec4(vC * t.rgb * 2.2, t.a * vA); }`,
  });
  const fireworks = new THREE.Points(fwGeo, fwMat);
  fireworks.frustumCulled = false;
  fireworks.visible = false;
  scene.add(fireworks);
  const FW_COLORS = [0xffd27a, 0xff7a5a, 0x7ae0d0, 0xfff3d6, 0xf2b544, 0xff9ac0, 0x9ad8ff];

  let last = 0;
  let shellList = [];
  const M = new THREE.Matrix4();
  const api = {
    points,
    setLevel(l) {
      budget = l === 'low' ? 0.4 : l === 'medium' ? 0.7 : 1;
    },
    /** The current show's shells: [{ t (launch), x, z }], for the booms. */
    shells: () => shellList,
    clear() {
      life.fill(0);
      alpha.fill(0);
      rings.count = 0;
      for (const f of flying) f.m.visible = false;
      for (const f of faces) f.s.visible = false;
      fireworks.visible = false;
    },
    dust(x, y, z, hex = 0xd8c6a6) {
      if (Math.random() > budget) return;
      spawn(x + (Math.random() - 0.5) * 0.4, y + 0.08, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6, hex, 0.5 + Math.random() * 0.3, 0.7, -0.3, 1.2);
    },
    puff(x, y, z, hex = 0xf1e3c8, n = 14, r = 0.6) {
      const k = Math.ceil(n * budget);
      for (let i = 0; i < k; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 0.6 + Math.random() * 1.2;
        spawn(x, y + 0.6 + Math.random() * 0.8, z, Math.cos(a) * v * r, Math.random() * 1.2, Math.sin(a) * v * r, hex, 0.6 + Math.random() * 0.5, 0.9 + Math.random() * 0.5, -0.4, 0.8);
      }
    },
    confetti(x, y, z, palette = [0xf2b544, 0xb3263a, 0x1f7a80, 0xf1e3c8, 0xe58c8a], n = 70) {
      const k = Math.ceil(n * budget);
      for (let i = 0; i < k; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 1.5 + Math.random() * 3.2;
        spawn(x, y, z, Math.cos(a) * v * 0.7, 2.2 + Math.random() * 3.2, Math.sin(a) * v * 0.7, palette[i % palette.length], 0.13 + Math.random() * 0.1, 1.8 + Math.random() * 1.2, 4.2, 0);
      }
    },
    smoke(x, z, r = 4) {
      const k = Math.ceil(46 * budget);
      for (let i = 0; i < k; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * r * 0.8;
        spawn(x + Math.cos(a) * d * 0.3, 0.4 + Math.random() * 1.6, z + Math.sin(a) * d * 0.3, Math.cos(a) * d * 0.6, 0.15 + Math.random() * 0.25, Math.sin(a) * d * 0.6, i % 3 ? 0xe8e1d6 : 0xcdc6bd, 2.2 + Math.random() * 1.4, 4.5 + Math.random() * 1, 0, 0.45);
      }
    },
    /** A mask flies off a face (colour of the troupe's mask). */
    dropMask(x, y, z, heading, hex) {
      const f = flying.find((q) => !q.m.visible) ?? flying[0];
      f.m.visible = true;
      f.m.material.color.setHex(hex);
      f.m.position.set(x, y, z);
      f.vx = Math.sin(heading) * 1.6 + (Math.random() - 0.5);
      f.vz = Math.cos(heading) * 1.6 + (Math.random() - 0.5);
      f.vy = 3.6;
      f.spin = (Math.random() - 0.5) * 14;
      f.life = 2.6;
      f.m.rotation.set(0, heading, 0);
    },
    /** Shows a face (a canvas or image texture) at a head for a few seconds. */
    face(x, y, z, texture, seconds = 3) {
      const f = faces.find((q) => !q.s.visible) ?? faces[0];
      f.s.material.map = texture;
      f.s.material.needsUpdate = true;
      f.base = [x, y, z];
      f.s.position.set(x, y, z);
      f.s.visible = true;
      f.until = last + seconds;
      return f;
    },
    /** Rings this frame: [{x, y, z, r, hex, a}] */
    rings(list) {
      const n = Math.min(RINGS, list.length);
      for (let i = 0; i < n; i++) {
        const r = list[i];
        M.makeScale(r.r, 1, r.r);
        M.setPosition(r.x, r.y + 0.04, r.z);
        rings.setMatrixAt(i, M);
        rings.setColorAt(i, C.setHex(r.hex).multiplyScalar(r.a ?? 1));
      }
      rings.count = n;
      rings.instanceMatrix.needsUpdate = true;
      if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    },
    /** Lanterns this frame: thrown ones fly from (fx, fz) and glow where they land: [{fx, fz, x, z, age}] */
    lanterns(list, floor) {
      lanterns.forEach((m, i) => {
        const l = list[i];
        const g = glowPool[i];
        if (!l) {
          m.visible = false;
          g.visible = false;
          return;
        }
        const u = Math.min(1, l.age / 0.7);
        const x = l.fx + (l.x - l.fx) * u;
        const z = l.fz + (l.z - l.fz) * u;
        const y = (floor?.(x, z) ?? 0) + 0.25 + Math.sin(u * Math.PI) * 2.2 + (u >= 1 ? 0 : 0.4);
        m.visible = true;
        m.position.set(x, y, z);
        m.rotation.z = u < 1 ? l.age * 9 : 0;
        g.visible = true;
        g.position.set(x, y + 0.1, z);
        const pulse = 1 + Math.sin(l.age * 9) * 0.08;
        g.scale.set(3.2 * pulse, 3.2 * pulse, 1);
        g.material.opacity = u >= 1 ? Math.max(0, Math.min(1, (3.0 - l.age) * 2)) : 0.8;
      });
    },
    /**
     * The Hush's fireworks for a round: a seeded show from `start` (seconds) over `span` seconds. `burstAt` (posters):
     * the first few shells all burst just before that moment.
     */
    setFireworks(seed, start, span, center, radius, burstAt = null, placed = null) {
      const R = rng(hash32('fireworks', seed));
      shellList = [];
      for (let s = 0; s < FW_SHELLS; s++) {
        let t0 = start + 0.6 + (s / FW_SHELLS) * (span - 2.5) + R.range(-0.4, 0.4);
        if (burstAt !== null && s < 6) t0 = burstAt - 1.3 - 0.35 - s * 0.2;
        const a = R.range(0, Math.PI * 2);
        const d = R.range(radius * 0.6, radius * 1.25);
        let x = center.x + Math.cos(a) * d;
        let z = center.z + Math.sin(a) * d;
        let h = R.range(18, 30);
        if (placed && placed[s]) [x, h, z] = placed[s];
        const c1 = FW_COLORS[R.int(FW_COLORS.length)];
        const c2 = FW_COLORS[R.int(FW_COLORS.length)];
        const speed = R.range(7, 12);
        shellList.push({ t: t0, x, z });
        for (let p = 0; p < FW_PER; p++) {
          // Fibonacci sphere: an even burst.
          const k = p + 0.5;
          const phi = Math.acos(1 - (2 * k) / FW_PER);
          const th = Math.PI * (1 + Math.sqrt(5)) * k;
          C.setHex(p % 3 === 0 ? c2 : c1);
          for (let tr = 0; tr < TRAIL; tr++) {
            const i = (s * FW_PER + p) * TRAIL + tr;
            fwShell.set([x, z, t0, h], i * 4);
            fwDir.set([Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi), p === 0 ? 0 : speed * (0.85 + (0.3 * ((p * 37) % 11)) / 11)], i * 4);
            fwCol.set([C.r, C.g, C.b], i * 3);
          }
        }
      }
      fwGeo.attributes.aShell.needsUpdate = true;
      fwGeo.attributes.aDir.needsUpdate = true;
      fwGeo.attributes.color.needsUpdate = true;
      shellList.sort((a, b) => a.t - b.t);
      fireworks.visible = true;
    },
    fireworksOff() {
      fireworks.visible = false;
    },
    /** The round clock for the fireworks (seconds, the same clock setFireworks used). */
    fireworksTime(t) {
      fwUniforms.uTime.value = t;
    },
    /** time: seconds; cam: the camera's position (faces sit just in front of their heads, toward it). */
    update(time, cam) {
      let dt = time - last;
      last = time;
      if (!(dt > 0) || dt > 0.25) dt = 0.016;
      for (let i = 0; i < MAX_P; i++) {
        if (life[i] <= 0) {
          if (alpha[i] !== 0) alpha[i] = 0;
          continue;
        }
        life[i] -= dt;
        vel[i * 3 + 1] -= grav[i] * dt;
        const drag = grav[i] > 1 ? 0.985 : 0.96;
        vel[i * 3] *= drag;
        vel[i * 3 + 2] *= drag;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] = Math.max(0.02, pos[i * 3 + 1] + vel[i * 3 + 1] * dt);
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        size[i] += grow[i] * dt;
        const k = life[i] / max[i];
        alpha[i] = Math.min(1, k * 2.2) * (grav[i] > 1 ? 1 : 0.85);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      for (const f of flying) {
        if (!f.m.visible) continue;
        f.life -= dt;
        f.vy -= 9 * dt;
        f.m.position.x += f.vx * dt;
        f.m.position.y = Math.max(0.05, f.m.position.y + f.vy * dt);
        f.m.position.z += f.vz * dt;
        if (f.m.position.y <= 0.05) {
          f.vx *= 0.8;
          f.vz *= 0.8;
          f.vy = Math.abs(f.vy) * 0.3;
          f.spin *= 0.6;
        }
        f.m.rotation.x += f.spin * dt;
        if (f.life <= 0) f.m.visible = false;
      }
      for (const f of faces) {
        if (!f.s.visible) continue;
        if (last > f.until) {
          f.s.visible = false;
          continue;
        }
        if (cam && f.base) {
          const dx = cam.x - f.base[0];
          const dy = cam.y - f.base[1];
          const dz = cam.z - f.base[2];
          const l = Math.hypot(dx, dy, dz) || 1;
          f.s.position.set(f.base[0] + (dx / l) * 0.3, f.base[1] + (dy / l) * 0.3, f.base[2] + (dz / l) * 0.3);
        }
      }
    },
  };
  return api;
}
