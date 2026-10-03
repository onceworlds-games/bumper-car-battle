// Dusk to midnight: the sky dome (apricot and rose at the horizon deepening to teal and night, a low sun, stars) and
// the lights that follow it. One number drives it all: 0 is the golden hour, 1 is midnight.
import * as THREE from 'three';

const KEYS = [
  // u, zenith, horizon, glow, sun colour, sun intensity, hemi sky, hemi ground (teal shadows), hemi intensity
  [0.0, 0x3d78a0, 0xffb070, 0xffd28a, 0xffc27d, 3.0, 0xcfd9e2, 0x35575f, 0.95],
  [0.45, 0x2a5772, 0xf2865a, 0xffb27a, 0xffa766, 2.3, 0xb8c4d0, 0x2b4d57, 0.85],
  [0.75, 0x163a52, 0xc8665a, 0xe8866a, 0xff8f5e, 1.2, 0x8fa2b8, 0x203f4b, 0.7],
  [1.0, 0x0b1c2c, 0x2b5a68, 0x6f8a8a, 0xa9c0d8, 0.3, 0x6f8fb0, 0x16303a, 0.62],
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
  col += uGlow * (pow(sun, 5.0) * 0.5 + pow(sun, 40.0) * 0.8 + pow(sun, 400.0) * 2.0) * (1.0 - uNight * 0.85);
  col += vec3(1.0, 0.78, 0.5) * smoothstep(0.9985, 0.9992, sun) * 2.6 * (1.0 - uNight);
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
  // The sun casts the shadows (high and medium tiers); a map that follows what the camera looks at.
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -34;
  sc.right = sc.top = 34;
  sc.near = 4;
  sc.far = 260;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 3;
  // After the sun goes down a cool moon takes the key's place, and the shadows soften with it.
  const moon = new THREE.DirectionalLight(0x9db8dc, 0);
  moon.position.set(30, 60, 40);
  // Lanterns light the crowd from above as night falls: a warm fill that grows.
  const fill = new THREE.DirectionalLight(0xffb36a, 0);
  fill.position.set(10, 40, 20);
  scene.add(hemi, sun, sun.target, moon, fill);
  const fog = new THREE.Fog(0xf4a261, 70, 250);
  scene.fog = fog;

  const sunCol = new THREE.Color();
  const sky = {
    uniforms,
    dome,
    hemi,
    sun,
    moon,
    fill,
    night: 0,
    sunDir: new THREE.Vector3(-0.78, 0.3, -0.5).normalize(),
    /** The shadow map covers what the camera looks at: the light's target sits there (snapped, so shadows don't crawl). */
    follow(x, z) {
      const q = 0.5;
      const tx = Math.round(x / q) * q;
      const tz = Math.round(z / q) * q;
      sun.target.position.set(tx, 0, tz);
      sun.position.set(tx + sky.sunDir.x * 110, sky.sunDir.y * 110, tz + sky.sunDir.z * 110);
      sun.target.updateMatrixWorld();
    },
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
      fill.intensity = 0.1 + u * 0.7;
      moon.intensity = Math.max(0, (u - 0.55) / 0.45) * 0.75;
      // The sun sinks as the evening goes on, and its shadows grow long.
      const elev = 0.06 + 0.58 * Math.pow(1 - u, 1.3);
      uniforms.uSunDir.value.set(-0.78, elev, -0.5).normalize();
      sky.sunDir.copy(uniforms.uSunDir.value);
      uniforms.uNight.value = u;
      uniforms.uTime.value = time;
      fog.color.copy(uniforms.uHorizon.value).lerp(uniforms.uZenith.value, 0.2);
    },
  };
  sky.set(0);
  return sky;
}
