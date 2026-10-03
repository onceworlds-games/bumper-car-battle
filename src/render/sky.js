// Dusk to midnight: the sky dome (apricot and rose at the horizon deepening to teal and night, a low sun, stars) and
// the lights that follow it. One number drives it all: 0 is the golden hour, 1 is midnight.
import * as THREE from 'three';

const KEYS = [
  // u, zenith, horizon, glow, sun colour, sun intensity, hemi sky, hemi ground (teal shadows), hemi intensity
  [0.0, 0x4a7f9c, 0xf6b46e, 0xffd79a, 0xffe2bd, 2.0, 0xdfe3e2, 0x2c5862, 1.35],
  [0.45, 0x2b5873, 0xf08a5d, 0xffb27a, 0xffc195, 1.4, 0xc9cfd4, 0x244a55, 1.15],
  [0.75, 0x163a52, 0xc8665a, 0xe8866a, 0xff9a6a, 0.6, 0x9aa9bb, 0x1c3a46, 0.9],
  [1.0, 0x0b1c2c, 0x24505e, 0x6f7a7a, 0x9fb8c8, 0.2, 0x6f8fb0, 0x16303a, 0.75],
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();
function mixKey(u, idx, out) {
  let i = 0;
  while (i < KEYS.length - 2 && u > KEYS[i + 1][0]) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (u - a[0]) / (b[0] - a[0])));
  if (typeof a[idx] === 'number' && idx >= 1 && idx <= 4) return out.copy(tmpA.setHex(a[idx])).lerp(tmpB.setHex(b[idx]), t);
  if (idx === 6 || idx === 7) return out.copy(tmpA.setHex(a[idx])).lerp(tmpB.setHex(b[idx]), t);
  return a[idx] + (b[idx] - a[idx]) * t;
}

export function createSky(scene) {
  const uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(-0.8, 0.12, -0.3).normalize() },
    uNight: { value: 0 },
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vDir;
void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunDir;
uniform float uNight;
uniform float uTime;
float h31(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.3, 71.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.55, up));
  float sun = max(dot(d, uSunDir), 0.0);
  col += uGlow * (pow(sun, 6.0) * 0.45 + pow(sun, 60.0) * 0.6) * (1.0 - uNight * 0.85);
  col += vec3(1.0, 0.92, 0.75) * smoothstep(0.9993, 0.9997, sun) * (1.0 - uNight);
  // Thin streaks of cloud lit from below by the sunset.
  float band = smoothstep(0.05, 0.12, up) * (1.0 - smoothstep(0.18, 0.32, up));
  float streak = sin(d.x * 9.0 + d.z * 4.0) * sin(d.x * 3.1 - d.z * 7.0 + 1.3);
  col = mix(col, uGlow * 0.9 + uHorizon * 0.3, band * smoothstep(0.2, 0.9, streak) * 0.35 * (1.0 - uNight * 0.6));
  // Stars, once it's dark enough.
  vec3 cell = floor(d * 160.0);
  float star = step(0.9965, h31(cell)) * smoothstep(0.08, 0.4, up);
  float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h31(cell + 1.0) * 30.0);
  col += vec3(1.0, 0.96, 0.88) * star * tw * smoothstep(0.55, 0.95, uNight);
  // Below the horizon: the far water or roofs take the horizon colour, darker.
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.15, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(-80, 25, -30);
  // Lanterns light the crowd from above as night falls: a warm fill that grows.
  const fill = new THREE.DirectionalLight(0xffb36a, 0);
  fill.position.set(10, 40, 20);
  scene.add(hemi, sun, fill);
  const fog = new THREE.Fog(0xf4a261, 80, 260);
  scene.fog = fog;

  const sunCol = new THREE.Color();
  const sky = {
    uniforms,
    dome,
    hemi,
    sun,
    fill,
    night: 0,
    /** Sets the hour: u from 0 (golden hour) to 1 (midnight). */
    set(u, time = 0) {
      u = Math.max(0, Math.min(1, u));
      sky.night = u;
      mixKey(u, 1, uniforms.uZenith.value);
      mixKey(u, 2, uniforms.uHorizon.value);
      mixKey(u, 3, uniforms.uGlow.value);
      mixKey(u, 4, sunCol);
      sun.color.copy(sunCol);
      sun.intensity = mixKey(u, 5);
      mixKey(u, 6, hemi.color);
      mixKey(u, 7, hemi.groundColor);
      hemi.intensity = mixKey(u, 8);
      fill.intensity = 0.15 + u * 0.9;
      // The sun sinks as the evening goes on.
      const elev = 0.16 - u * 0.24;
      uniforms.uSunDir.value.set(-0.85, elev, -0.35).normalize();
      sun.position.copy(uniforms.uSunDir.value).multiplyScalar(100);
      sun.position.y = Math.max(8, sun.position.y + 30 * (1 - u));
      uniforms.uNight.value = u;
      uniforms.uTime.value = time;
      fog.color.copy(uniforms.uHorizon.value).lerp(uniforms.uZenith.value, 0.25);
    },
  };
  sky.set(0);
  return sky;
}
