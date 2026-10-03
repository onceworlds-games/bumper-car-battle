// A small builder for architecture: shapes are placed, coloured and dropped into a bucket per material, then each
// bucket is merged into one mesh. A whole plaza costs a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bayTexture, bayLightTexture, bayMaskTexture, roofTexture, curtainTexture, stripeTexture } from './textures.js';

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();

/** Shared materials (night state is driven through `night`). */
export function kitMaterials() {
  const plain = new THREE.MeshLambertMaterial({ vertexColors: true });
  const facade = new THREE.MeshLambertMaterial({ vertexColors: true, map: bayTexture(), emissiveMap: bayLightTexture(), emissive: 0xffb25a, emissiveIntensity: 0 });
  // The house colour tints the plaster only; shutters, glass and stone keep their own colours.
  const mask = bayMaskTexture();
  facade.onBeforeCompile = (sh) => {
    sh.uniforms.uMask = { value: mask };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uMask;')
      .replace('#include <color_fragment>', 'float plaster = texture2D(uMask, vMapUv).r;\ndiffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, plaster);')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= step(0.45, fract(sin(dot(floor(vEmissiveMapUv) + floor(vColor.rg * 7.0), vec2(12.9898, 78.233))) * 43758.5453));',
      );
  };
  const roof = new THREE.MeshLambertMaterial({ vertexColors: true, map: roofTexture() });
  const curtain = new THREE.MeshLambertMaterial({ map: curtainTexture(), side: THREE.DoubleSide });
  const awning = new THREE.MeshLambertMaterial({ vertexColors: true, map: stripeTexture(), side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  return { plain, facade, roof, curtain, awning, glow };
}

function prep(geo, hex, uvMode) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!uvMode && g.attributes.uv) g.deleteAttribute('uv');
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const n = g.attributes.position.count;
  C.setHex(hex);
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = C.r;
    c[i * 3 + 1] = C.g;
    c[i * 3 + 2] = C.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

export function createKit() {
  const buckets = new Map();
  const add = (mat, geo) => {
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  };
  const xf = (geo, x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    M.compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz, 'YXZ')), S.set(sx, sy, sz));
    geo.applyMatrix4(M);
    return geo;
  };
  const kit = {
    add,
    xf,
    /** A box resting on y (its base), rotated about y. */
    box(mat, hex, x, y, z, w, h, d, ry = 0) {
      add(mat, xf(prep(new THREE.BoxGeometry(w, h, d), hex), x, y + h / 2, z, ry));
    },
    cyl(mat, hex, x, y, z, rt, rb, h, segs = 10, ry = 0) {
      add(mat, xf(prep(new THREE.CylinderGeometry(rt, rb, h, segs), hex), x, y + h / 2, z, ry));
    },
    cone(mat, hex, x, y, z, r, h, segs = 8, ry = 0) {
      add(mat, xf(prep(new THREE.ConeGeometry(r, h, segs), hex), x, y + h / 2, z, ry));
    },
    sphere(mat, hex, x, y, z, r, sx = 1, sy = 1, sz = 1, segs = 10) {
      add(mat, xf(prep(new THREE.SphereGeometry(r, segs, Math.max(4, segs - 3)), hex), x, y, z, 0, 0, 0, sx, sy, sz));
    },
    lathe(mat, hex, x, y, z, pts, segs = 16) {
      add(mat, xf(prep(new THREE.LatheGeometry(pts.map(([r, py]) => new THREE.Vector2(r, py)), segs), hex), x, y, z));
    },
    geo(mat, hex, geo, x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
      add(mat, xf(prep(geo, hex, true), x, y, z, ry, rx, rz, sx, sy, sz));
    },
    /**
     * A house: plaster walls with window bays on its faces (bay 3.2 m wide, floors 3.4 m), a roof, a cornice. `face`
     * is the side that looks into the plaza (all sides get windows; it decides the roof's ridge).
     */
    house(mats, hex, x, z, w, d, h, ry = 0, opts = {}) {
      const geo = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      const pos = geo.attributes.position;
      const nrm = geo.attributes.normal;
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        const py = pos.getY(i) + h / 2;
        const pz = pos.getZ(i);
        const nx = nrm.getX(i);
        const ny = nrm.getY(i);
        if (Math.abs(ny) > 0.5) {
          uv[i * 2] = 0.5;
          uv[i * 2 + 1] = 0.96;
        } else {
          const along = Math.abs(nx) > 0.5 ? pz + d / 2 : px + w / 2;
          uv[i * 2] = along / 3.2;
          uv[i * 2 + 1] = 1 - py / 3.4;
        }
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      add(mats.facade, xf(prep(geo, hex, true), x, h / 2, z, ry));
      // Cornice and roof.
      kit.box(mats.plain, 0xe9dcc4, x, h - 0.05, z, w + 0.5, 0.35, d + 0.5, ry);
      if (opts.flat) {
        kit.box(mats.plain, 0xcdb99a, x, h + 0.3, z, w + 0.2, 0.6, d + 0.2, ry);
      } else {
        const rise = Math.min(w, d) * 0.28;
        const roof = new THREE.CylinderGeometry(0.0001, 1, 1, 4, 1).toNonIndexed();
        roof.rotateY(Math.PI / 4);
        const ruv = new Float32Array(roof.attributes.position.count * 2);
        for (let i = 0; i < roof.attributes.position.count; i++) {
          ruv[i * 2] = (roof.attributes.position.getX(i) + roof.attributes.position.getZ(i)) * 2.5;
          ruv[i * 2 + 1] = roof.attributes.position.getY(i) * 2.5;
        }
        roof.setAttribute('uv', new THREE.BufferAttribute(ruv, 2));
        add(mats.roof, xf(prep(roof, 0xffffff, true), x, h + 0.12 + rise / 2, z, ry, 0, 0, (w + 0.6) * 0.72, rise, (d + 0.6) * 0.72));
      }
      if (opts.chimney !== false && w > 4) {
        const cx = x + Math.cos(ry) * (w * 0.25);
        const cz = z - Math.sin(ry) * (w * 0.25);
        kit.box(mats.plain, 0xb4523a, cx, h + 0.2, cz, 0.6, 1.6, 0.6, ry);
        kit.box(mats.plain, 0x8a3e2c, cx, h + 1.75, cz, 0.8, 0.18, 0.8, ry);
      }
    },
    build(scene) {
      const meshes = [];
      for (const [mat, geos] of buckets) {
        const merged = mergeGeometries(geos, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mat);
        mesh.matrixAutoUpdate = false;
        scene.add(mesh);
        meshes.push(mesh);
        for (const g of geos) g.dispose();
      }
      buckets.clear();
      return meshes;
    },
  };
  return kit;
}
