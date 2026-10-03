// The plaza floor (stone paving painted in the shader, with warm pools of lantern light that bloom as night falls)
// and the water (deep teal with moving glints and the sky's colour on it).
import * as THREE from 'three';

const MAX_POOLS = 32;

/** The floor: a big plane, paved in a running bond, with an inlay ring around `inlay` ({x, z, r}) if given. */
export function createGround(scene, { x0, x1, z0, z1, inlay = null, water = [], stoneA = 0xd9d2c3, stoneB = 0xb7ab95, margin = 30, y = 0 }) {
  const w = x1 - x0 + margin * 2;
  const d = z1 - z0 + margin * 2;
  const geo = new THREE.PlaneGeometry(w, d, 1, 1).rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const uniforms = {
    uNight: { value: 0 },
    uPools: { value: Array.from({ length: MAX_POOLS }, () => new THREE.Vector3(0, 0, 0)) },
    uPoolN: { value: 0 },
    uStoneA: { value: new THREE.Color(stoneA) },
    uStoneB: { value: new THREE.Color(stoneB) },
    uInlay: { value: new THREE.Vector3(inlay?.x ?? 0, inlay?.z ?? 0, inlay?.r ?? 0) },
    uBounds: { value: new THREE.Vector4(x0, x1, z0, z1) },
    uWater: { value: Array.from({ length: 8 }, (_, i) => (water[i] ? new THREE.Vector4(water[i].x - water[i].w / 2, water[i].x + water[i].w / 2, water[i].z - water[i].d / 2, water[i].z + water[i].d / 2) : new THREE.Vector4(0, 0, 0, 0))) },
    uWaterN: { value: Math.min(8, water.length) },
  };
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vW;
uniform float uNight;
uniform vec3 uPools[${MAX_POOLS}];
uniform int uPoolN;
uniform vec3 uStoneA;
uniform vec3 uStoneB;
uniform vec3 uInlay;
uniform vec4 uBounds;
uniform vec4 uWater[8];
uniform int uWaterN;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        'void main() {',
        `void main() {
  for (int i = 0; i < 8; i++) {
    if (i >= uWaterN) break;
    vec4 b = uWater[i];
    if (vW.x > b.x && vW.x < b.y && vW.z > b.z && vW.z < b.w) discard;
  }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 p = vW.xz;
  float row = floor(p.y / 0.42);
  vec2 q = vec2(p.x / 0.62 + mod(row, 2.0) * 0.5, p.y / 0.42);
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float g = smoothstep(0.0, 0.06, f.x) * smoothstep(0.0, 0.06, 1.0 - f.x) * smoothstep(0.0, 0.09, f.y) * smoothstep(0.0, 0.09, 1.0 - f.y);
  float n = h21(cell);
  // Big slow patches of colour under the small stones, so the floor isn't a print.
  float blot = h21(floor(p / 5.0)) * 0.5 + h21(floor(p / 2.3) + 7.0) * 0.5;
  vec3 stone = mix(uStoneA, uStoneB, n * 0.45 + blot * 0.4);
  // A ring of darker stone round the centrepiece, with a pale band inside it.
  if (uInlay.z > 0.0) {
    float r = distance(p, uInlay.xy);
    float ring = smoothstep(uInlay.z, uInlay.z + 0.08, r) * (1.0 - smoothstep(uInlay.z + 0.9, uInlay.z + 0.98, r));
    float band = smoothstep(uInlay.z + 2.6, uInlay.z + 2.66, r) * (1.0 - smoothstep(uInlay.z + 3.0, uInlay.z + 3.06, r));
    stone = mix(stone, vec3(0.55, 0.3, 0.22), ring * 0.55);
    stone = mix(stone, vec3(0.9, 0.85, 0.75), band * 0.45);
  }
  vec3 grout = stone * 0.72;
  // Walls darken the stones near them, like old soot.
  float edge = min(min(p.x - uBounds.x, uBounds.y - p.x), min(p.y - uBounds.z, uBounds.w - p.y));
  float soot = 0.72 + 0.28 * smoothstep(0.0, 3.0, edge);
  diffuseColor.rgb = mix(grout, stone, g) * soot;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 pool = vec3(0.0);
  for (int i = 0; i < ${MAX_POOLS}; i++) {
    if (i >= uPoolN) break;
    vec3 L = uPools[i];
    float d = distance(vW.xz, L.xy);
    pool += vec3(1.0, 0.62, 0.28) * L.z * (1.0 - smoothstep(0.0, 5.5, d));
  }
  totalEmissiveRadiance += pool * uNight * diffuseColor.rgb * 0.9;
}`,
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  return {
    mesh,
    uniforms,
    setPools(list) {
      const n = Math.min(MAX_POOLS, list.length);
      for (let i = 0; i < n; i++) uniforms.uPools.value[i].set(list[i][0], list[i][1], list[i][2] ?? 1);
      uniforms.uPoolN.value = n;
    },
  };
}

/** Water over a list of boxes ({x, z, w, d}), plus a far plane when `open` (the lagoon runs to the horizon). */
export function createWater(scene, boxes, { open = false } = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x0b3d47) },
    uShallow: { value: new THREE.Color(0x1b7f8c) },
    uSky: { value: new THREE.Color(0xf4a261) },
    uHorizon: { value: new THREE.Color(0xf4a261) },
    uNight: { value: 0 },
    uCam: { value: new THREE.Vector3() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform float uNight;
uniform vec3 uCam;
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vW.xz;
  float n = noise(p * 0.7 + vec2(uTime * 0.25, uTime * 0.1)) * 0.6 + noise(p * 2.3 - vec2(uTime * 0.4, -uTime * 0.2)) * 0.4;
  vec3 view = normalize(uCam - vW);
  float fres = pow(1.0 - clamp(view.y, 0.0, 1.0), 3.0);
  vec3 col = mix(uDeep, uShallow, n * 0.55);
  col = mix(col, uSky, 0.18 + fres * 0.5);
  // Glints: the light catching the ripples.
  float gl = smoothstep(0.86, 0.97, noise(p * 6.0 + vec2(uTime * 1.3, uTime * 0.7)) * n);
  col += mix(vec3(1.0, 0.85, 0.55), vec3(1.0, 0.7, 0.35), uNight) * gl * (0.7 + 0.5 * uNight);
  float far = smoothstep(40.0, 140.0, distance(uCam.xz, p));
  col = mix(col, uHorizon, far * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`,
  });
  const meshes = [];
  for (const b of boxes) {
    const geo = (b.r ? new THREE.CircleGeometry(b.r, 28) : new THREE.PlaneGeometry(b.w, b.d)).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(b.x, b.y ?? -0.35, b.z);
    scene.add(m);
    meshes.push(m);
  }
  if (open) {
    const geo = new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, -0.36, 300 - 2);
    scene.add(m);
    meshes.push(m);
  }
  return { meshes, uniforms };
}
