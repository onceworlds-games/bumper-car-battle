// Every figure in the plaza, revellers and maskers alike, drawn the same way: one instanced mesh per troupe (so a
// masker is never drawn differently from a reveller), arms and fans as their own instances, soft blob shadows, and
// the private ghost of your slot. The shader bows, turns heads, slips and drops masks, and fades figures near the
// camera with a dither (no sorting).
import * as THREE from 'three';
import { troupeGeometries, armGeometry, fanGeometry, WAIST_Y, NECK_Y, HEAD_Y, SHOULDER } from './costumes.js';
import { TROUPES } from '../sim/const.js';

const CAP = 40; // figures per troupe: slots, plus decoys and stragglers
const PATTERN = { arlecchino: 1, jolly: 2 };

const shared = { uTime: { value: 0 }, uMaskGlow: { value: 0.1 } };

function figureMaterial(tr) {
  const t = TROUPES[tr];
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const colA = new THREE.Color(t.robe);
  const colB = new THREE.Color(t.trim);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uMaskGlow = shared.uMaskGlow;
    sh.uniforms.uPattern = { value: PATTERN[t.id] || 0 };
    sh.uniforms.uColA = { value: colA };
    sh.uniforms.uColB = { value: colB };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aPart;
attribute vec4 aPose;
attribute vec4 aFx;
varying vec3 vObj;
varying float vPart;
varying vec4 vFx;
vec3 rx(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
vec3 ry(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }
vec3 rz(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
vObj = position;
vPart = aPart;
vFx = aFx;
if (aPart > 2.5 && aPart < 3.5) {
  // The mask: askew when it slips, gone when it falls.
  vec3 q = transformed - vec3(0.0, ${HEAD_Y.toFixed(3)}, 0.0);
  q = rz(q, aPose.w * 0.55);
  q.y -= aPose.w * 0.05;
  q.z += aPose.w * 0.03;
  transformed = q + vec3(0.0, ${HEAD_Y.toFixed(3)}, 0.0);
  transformed = mix(transformed, vec3(0.0, ${HEAD_Y.toFixed(3)}, -0.02), step(0.5, aFx.z));
}
if (aPart > 1.5) {
  vec3 q = transformed - vec3(0.0, ${NECK_Y.toFixed(3)}, 0.0);
  q = rx(ry(q, aPose.y), -aPose.z);
  transformed = q + vec3(0.0, ${NECK_Y.toFixed(3)}, 0.0);
}
if (aPart > 0.5) {
  vec3 q = transformed - vec3(0.0, ${WAIST_Y.toFixed(3)}, 0.0);
  transformed = rx(q, aPose.x) + vec3(0.0, ${WAIST_Y.toFixed(3)}, 0.0);
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uMaskGlow;
uniform int uPattern;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec3 vObj;
varying float vPart;
varying vec4 vFx;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }`,
      )
      .replace(
        'void main() {',
        `void main() {
  if (vFx.w < 0.995 && vFx.w < bayer4(gl_FragCoord.xy)) discard;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if (vPart < 1.5 && uPattern > 0) {
  float isRobe = 1.0 - step(0.035, distance(diffuseColor.rgb, uColA));
  float pat = 0.0;
  if (uPattern == 1) {
    float u = atan(vObj.x, vObj.z) / 6.2831853 * 8.0;
    float v = vObj.y * 3.6;
    pat = mod(floor(u + v) + floor(u - v), 2.0);
  } else {
    pat = step(0.0, vObj.x);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, uColB, pat * isRobe);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  // Flustered: the mask shimmers like oil on water. A faux pas: a hot rim round the whole figure.
  float isMask = step(2.5, vPart) * step(vPart, 3.5);
  float sh = vFx.x * isMask * (0.55 + 0.45 * sin(uTime * 11.0 + vObj.y * 60.0 + vObj.x * 40.0));
  vec3 iri = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + uTime * 0.9 + vObj.y * 4.0));
  totalEmissiveRadiance += iri * sh * 1.4;
  // Masks catch the lantern light: the faces stay readable as night falls.
  totalEmissiveRadiance += diffuseColor.rgb * isMask * uMaskGlow;
  vec3 fdx = dFdx(vViewPosition);
  vec3 fdy = dFdy(vViewPosition);
  vec3 nrm = normalize(cross(fdx, fdy));
  float rim = pow(1.0 - abs(dot(nrm, normalize(vViewPosition))), 2.0);
  totalEmissiveRadiance += vec3(1.0, 0.25, 0.12) * rim * vFx.y * (0.8 + 0.2 * sin(uTime * 8.0));
}`,
      );
  };
  mat.customProgramCacheKey = () => `fig-${PATTERN[t.id] || 0}`;
  return mat;
}

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, 'rgba(8,20,24,0.55)');
  r.addColorStop(0.6, 'rgba(8,20,24,0.25)');
  r.addColorStop(1, 'rgba(8,20,24,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createFigures(scene) {
  const geos = troupeGeometries();
  const meshes = geos.map((g, tr) => {
    const pose = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const fx = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPose', pose);
    g.setAttribute('aFx', fx);
    const m = new THREE.InstancedMesh(g, figureMaterial(tr), CAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  });
  const armMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const arms = new THREE.InstancedMesh(armGeometry(), armMat, CAP * 8 * 2);
  arms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  arms.setColorAt(0, new THREE.Color(1, 1, 1));
  arms.count = 0;
  arms.frustumCulled = false;
  scene.add(arms);
  const fanMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x401010 });
  const fans = new THREE.InstancedMesh(fanGeometry(), fanMat, 24);
  fans.count = 0;
  fans.frustumCulled = false;
  scene.add(fans);
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, CAP * 8);
  shadows.count = 0;
  shadows.frustumCulled = false;
  shadows.renderOrder = -1;
  scene.add(shadows);
  // The ghost of your slot: only you see it.
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending });
  const ghosts = geos.map((g) => {
    const m = new THREE.Mesh(g, ghostMat);
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  });

  const M = new THREE.Matrix4();
  const A = new THREE.Matrix4();
  const B = new THREE.Matrix4();
  const P = new THREE.Vector3();
  const Q = new THREE.Quaternion();
  const S = new THREE.Vector3();
  const E = new THREE.Euler();
  const C = new THREE.Color();
  const robe = TROUPES.map((t) => new THREE.Color(t.robe));
  let armN = 0;
  let fanN = 0;
  let shN = 0;

  const api = {
    meshes,
    begin() {
      for (const m of meshes) m.count = 0;
      armN = 0;
      fanN = 0;
      shN = 0;
      for (const g of ghosts) g.visible = false;
    },
    /** Adds a figure; `pose` from anim.js, `fx` { shimmer, slip, off, fade, slipAmt }. Returns false when full. */
    add(tr, x, y, z, h, pose, fx, scale = 1) {
      const m = meshes[tr];
      if (!m || m.count >= CAP) return false;
      const i = m.count++;
      E.set(0, h, pose.roll, 'YXZ');
      Q.setFromEuler(E);
      const sq = pose.squash;
      P.set(x, y + pose.bob, z);
      S.set(scale * (1 + sq * 0.5), scale * (1 - sq), scale * (1 + sq * 0.5));
      M.compose(P, Q, S);
      m.setMatrixAt(i, M);
      const pa = m.geometry.attributes.aPose.array;
      pa[i * 4] = pose.bend;
      pa[i * 4 + 1] = pose.yaw;
      pa[i * 4 + 2] = pose.pitch;
      pa[i * 4 + 3] = fx ? fx.slipAmt || 0 : 0;
      const fa = m.geometry.attributes.aFx.array;
      fa[i * 4] = fx ? fx.shimmer || 0 : 0;
      fa[i * 4 + 1] = fx ? fx.slip || 0 : 0;
      fa[i * 4 + 2] = fx && fx.off ? 1 : 0;
      fa[i * 4 + 3] = fx && fx.fade !== undefined ? fx.fade : 1;
      // Arms: from the shoulder (moved by the bend), swung and raised.
      const cb = Math.cos(pose.bend);
      const sb = Math.sin(pose.bend);
      const dy = SHOULDER.y - WAIST_Y;
      for (const side of [-1, 1]) {
        if (armN >= arms.instanceMatrix.count) break;
        const pitch = side < 0 ? pose.lp : pose.rp;
        const roll = side < 0 ? pose.lr : pose.rr;
        E.set(pose.bend - pitch, 0, side * roll, 'XYZ');
        Q.setFromEuler(E);
        P.set(side * SHOULDER.x, WAIST_Y + dy * cb, dy * sb);
        A.compose(P, Q, S.set(1, 1, 1));
        B.multiplyMatrices(M, A);
        if (fx && fx.fade !== undefined && fx.fade < 0.2) continue;
        arms.setMatrixAt(armN, B);
        C.copy(robe[tr]);
        arms.setColorAt(armN, C);
        armN++;
        if (side > 0 && pose.fan > 0.05 && fanN < fans.instanceMatrix.count) {
          A.makeTranslation(0, -0.5, 0.05);
          B.multiply(A);
          E.set(-0.4, 0, 0.6);
          Q.setFromEuler(E);
          A.compose(P.set(0, 0, 0), Q, S.set(pose.fan, pose.fan, pose.fan));
          B.multiply(A);
          fans.setMatrixAt(fanN++, B);
        }
      }
      if (shN < shadows.instanceMatrix.count) {
        M.compose(P.set(x, y + 0.02, z), Q.identity(), S.set(1.15 * scale, 1, 1.15 * scale));
        shadows.setMatrixAt(shN++, M);
      }
      return true;
    },
    /** The ghost of your slot, at its place now (only you see it). */
    ghost(tr, x, y, z, h, alpha) {
      const g = ghosts[tr];
      if (!g) return;
      g.visible = alpha > 0.01;
      g.position.set(x, y, z);
      g.rotation.set(0, h, 0);
      ghostMat.opacity = 0.34 * alpha;
    },
    /** How much the masks glow (0..1, rises with the night). */
    setNight(u) {
      shared.uMaskGlow.value = 0.08 + u * 0.3;
    },
    end(time) {
      shared.uTime.value = time;
      for (const m of meshes) {
        m.instanceMatrix.needsUpdate = true;
        m.geometry.attributes.aPose.needsUpdate = true;
        m.geometry.attributes.aFx.needsUpdate = true;
      }
      arms.count = armN;
      arms.instanceMatrix.needsUpdate = true;
      if (arms.instanceColor) arms.instanceColor.needsUpdate = true;
      fans.count = fanN;
      fans.instanceMatrix.needsUpdate = true;
      shadows.count = shN;
      shadows.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const m of [...meshes, arms, fans, shadows, ...ghosts]) {
        scene.remove(m);
        m.geometry.dispose?.();
      }
    },
  };
  return api;
}
