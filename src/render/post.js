// The high tier's finishing: lanterns, windows, the sun and the fireworks bloom, then the picture is toned and graded
// (a warm light, a teal shadow, a soft vignette, a little grain). Used only at the high quality tier; the lower tiers
// draw straight to the screen.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uNight: { value: 0 }, uGrain: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uNight; uniform float uGrain; varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  // Split toning: warm in the lights, teal in the shadows, a little more of both as night falls.
  c = mix(c, c * vec3(1.06, 1.0, 0.9), smoothstep(0.35, 0.9, l) * 0.8);
  c = mix(c, c * vec3(0.86, 1.0, 1.08) + vec3(0.0, 0.012, 0.022), (1.0 - smoothstep(0.0, 0.4, l)) * (0.55 + 0.3 * uNight));
  // A gentle S: deeper darks, brighter lights.
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.28);
  c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.1);
  // The vignette: the edges draw back, so the middle of the frame is where the eye goes.
  vec2 q = vUv - 0.5;
  float v = smoothstep(0.82, 0.18, length(q * vec2(1.0, 1.15)));
  c *= mix(0.62, 1.0, v);
  c += (h(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5) * 0.028 * uGrain;
  gl_FragColor = vec4(c, 1.0);
}`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  // Multisampling the half-float target is for screens with a mouse; a phone's pixels are dense enough without it.
  const coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
  const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: coarse ? 0 : 4 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pr);
  composer.setSize(size.x, size.y);
  const render = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.5, 1.0);
  const output = new OutputPass();
  const grade = new ShaderPass(GRADE);
  composer.addPass(render);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);
  return {
    composer,
    bloom,
    grade,
    setSize(w, h, ratio) {
      composer.setPixelRatio(ratio);
      composer.setSize(w, h);
    },
    /** night 0..1 (more bloom and toning after dark), reduced: no moving grain. */
    draw(time, night, reduced, grain = 1) {
      bloom.strength = 0.24 + night * 0.3;
      grade.uniforms.uTime.value = reduced ? 0 : time;
      grade.uniforms.uNight.value = night;
      grade.uniforms.uGrain.value = reduced ? 0.35 : grain;
      composer.render();
    },
    dispose() {
      composer.dispose();
      target.dispose();
    },
  };
}
