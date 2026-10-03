// The eight costumes, built from a handful of shapes: a bell robe, a cowled head, the troupe's mask and hat. Each is one
// merged geometry with vertex colours and a part tag per vertex (0 skirt, 1 torso, 2 head, 3 mask, 4 hat) that the
// figure shader uses to bow from the waist, turn the head and let a mask slip or fall. Readable at 40 m by silhouette.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TROUPES } from '../sim/const.js';

export const PART = { skirt: 0, torso: 1, head: 2, mask: 3, hat: 4 };
export const HEAD_Y = 1.47;
export const NECK_Y = 1.31;
export const WAIST_Y = 0.98;
export const SHOULDER = { x: 0.235, y: 1.2 };

const col = new THREE.Color();

/** Strips a geometry to position + colour + part, in non-indexed form so pieces merge cleanly. */
function finish(geo, hex, part, mul = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  const n = g.attributes.position.count;
  col.setHex(hex);
  const c = new Float32Array(n * 3);
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    c[i * 3] = col.r * mul;
    c[i * 3 + 1] = col.g * mul;
    c[i * 3 + 2] = col.b * mul;
    p[i] = part;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(p, 1));
  return g;
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const S = new THREE.Vector3();
/** Places a geometry: position, rotation (x, y, z radians) and scale. */
function place(geo, [x, y, z], [rx, ry, rz] = [0, 0, 0], [sx, sy, sz] = [1, 1, 1]) {
  M.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz));
  geo.applyMatrix4(M);
  return geo;
}

const lathe = (pts, segs = 10) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
const sphere = (r, w = 9, h = 7) => new THREE.SphereGeometry(r, w, h);
/** A piece of a sphere centred on the head, facing forward: a mask that hugs the face. theta 0 is the crown. */
const cap = (r, width, thetaStart, thetaLen) => new THREE.SphereGeometry(r, 10, 5, Math.PI / 2 - width / 2, width, thetaStart, thetaLen);
const HEAD = [0, HEAD_Y, -0.01];
const cone = (r, h, segs = 7) => new THREE.ConeGeometry(r, h, segs);
const cyl = (rt, rb, h, segs = 9) => new THREE.CylinderGeometry(rt, rb, h, segs);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const torus = (r, t, segs = 10) => new THREE.TorusGeometry(r, t, 4, segs);

/** The robe: a flared skirt, a torso, and a cowl over the head (the face is the mask's). */
function body(t, extras) {
  const parts = [];
  parts.push(finish(lathe([[0.001, 0], [0.37, 0], [0.39, 0.07], [0.34, 0.36], [0.27, 0.7], [0.2, WAIST_Y]]), t.robe, PART.skirt));
  parts.push(finish(lathe([[0.2, WAIST_Y], [0.23, 1.1], [0.255, 1.2], [0.2, 1.27], [0.09, NECK_Y], [0.001, 1.34]]), t.robe, PART.torso));
  // A trim band at the hem and the waist, so every costume has two colours and reads as a costume.
  parts.push(finish(place(cyl(0.385, 0.395, 0.07, 10), [0, 0.06, 0]), t.trim, PART.skirt));
  parts.push(finish(place(cyl(0.205, 0.205, 0.06, 10), [0, WAIST_Y, 0]), t.trim, PART.torso));
  // The cowl: a hooded head, a little darker than the robe.
  parts.push(finish(place(sphere(0.168, 10, 8), [0, HEAD_Y, -0.01]), t.robe, PART.head, 0.8));
  for (const e of extras) parts.push(e);
  return parts;
}

const face = (d = 0.15) => [0, HEAD_Y, d];

const BUILD = {
  medico(t) {
    return [
      // The beak: long, curved down a little, with round brass eyes.
      finish(place(cone(0.075, 0.34, 7), [0, HEAD_Y - 0.03, 0.31], [Math.PI / 2 + 0.25, 0, 0]), t.mask, PART.mask),
      finish(place(cap(0.178, 2.5, 0.55, 1.7), HEAD), t.mask, PART.mask),
      finish(place(cyl(0.035, 0.035, 0.03, 8), [0.06, HEAD_Y + 0.04, 0.17], [Math.PI / 2, 0, 0]), 0xc89a3a, PART.mask),
      finish(place(cyl(0.035, 0.035, 0.03, 8), [-0.06, HEAD_Y + 0.04, 0.17], [Math.PI / 2, 0, 0]), 0xc89a3a, PART.mask),
      // A wide black brim and a low crown.
      finish(place(cyl(0.3, 0.3, 0.025, 12), [0, HEAD_Y + 0.15, -0.01]), 0x15110f, PART.hat),
      finish(place(cyl(0.12, 0.14, 0.15, 10), [0, HEAD_Y + 0.23, -0.01]), 0x15110f, PART.hat),
      finish(place(cyl(0.142, 0.142, 0.03, 10), [0, HEAD_Y + 0.17, -0.01]), t.trim, PART.hat, 0.6),
      // A short cape over the shoulders.
      finish(lathe([[0.3, 1.0], [0.29, 1.12], [0.24, 1.24], [0.1, 1.31]], 10), 0x15110f, PART.torso),
    ];
  },
  arlecchino(t) {
    return [
      finish(place(cap(0.177, 2.5, 1.0, 0.55), HEAD), t.mask, PART.mask),
      finish(place(box(0.24, 0.02, 0.06), [0, HEAD_Y + 0.055, 0.15]), t.mask, PART.mask),
      // Three soft points: the silhouette of the troupe.
      finish(place(cone(0.07, 0.3, 6), [0, HEAD_Y + 0.27, -0.02], [-0.15, 0, 0]), t.trim, PART.hat),
      finish(place(cone(0.07, 0.28, 6), [0.13, HEAD_Y + 0.22, -0.01], [0, 0, -0.75]), t.robe, PART.hat),
      finish(place(cone(0.07, 0.28, 6), [-0.13, HEAD_Y + 0.22, -0.01], [0, 0, 0.75]), t.robe, PART.hat),
      finish(place(cyl(0.165, 0.17, 0.07, 10), [0, HEAD_Y + 0.11, -0.01]), t.trim, PART.hat),
      finish(place(sphere(0.035, 6, 5), [0, HEAD_Y + 0.43, -0.07]), t.trim, PART.hat),
      finish(place(torus(0.16, 0.04, 12), [0, NECK_Y - 0.01, 0], [Math.PI / 2, 0, 0]), 0xf3ead6, PART.torso),
    ];
  },
  moretta(t) {
    return [
      // A round black oval, held by nothing but nerve.
      finish(place(cyl(0.125, 0.125, 0.03, 14), face(0.165), [Math.PI / 2, 0, 0], [0.92, 1, 1.12]), t.mask, PART.mask),
      // A pillbox cap with a veil falling behind.
      finish(place(cyl(0.12, 0.13, 0.08, 12), [0, HEAD_Y + 0.17, -0.02]), t.trim, PART.hat),
      finish(place(lathe([[0.001, 0.0], [0.15, -0.02], [0.2, -0.25], [0.21, -0.32]], 10), [0, HEAD_Y + 0.16, -0.05], [0.12, 0, 0]), 0x101d22, PART.hat),
      finish(place(sphere(0.04, 6, 5), [0.1, HEAD_Y + 0.2, 0.04]), 0xe9dcbf, PART.hat),
    ];
  },
  volto(t) {
    return [
      // A full white face with a gold rim, and a tall gilded headdress.
      finish(place(cap(0.18, 2.7, 0.42, 2.05), HEAD), t.mask, PART.mask),
      finish(place(new THREE.OctahedronGeometry(0.035), [0, HEAD_Y + 0.1, 0.17], [0, 0, 0], [1, 1.4, 0.6]), t.trim, PART.mask),
      finish(place(cyl(0.11, 0.13, 0.34, 10), [0, HEAD_Y + 0.29, -0.02]), t.robe, PART.hat),
      finish(place(cyl(0.135, 0.135, 0.05, 10), [0, HEAD_Y + 0.14, -0.02]), t.trim, PART.hat),
      finish(place(cyl(0.115, 0.115, 0.04, 10), [0, HEAD_Y + 0.45, -0.02]), t.trim, PART.hat),
      finish(place(sphere(0.045, 7, 5), [0, HEAD_Y + 0.5, -0.02]), t.trim, PART.hat),
      finish(place(torus(0.17, 0.045, 12), [0, NECK_Y - 0.01, 0], [Math.PI / 2, 0, 0]), 0xfbf6ea, PART.torso),
    ];
  },
  colombina(t) {
    const plume = (rz, h, x, hex) => finish(place(sphere(0.06, 6, 6), [x, HEAD_Y + 0.2 + h / 2, -0.05], [0, 0, rz], [0.6, h / 0.12, 0.35]), hex, PART.hat);
    return [
      finish(place(cap(0.177, 2.5, 0.98, 0.55), HEAD), t.mask, PART.mask),
      finish(place(sphere(0.03, 6, 5), [0.13, HEAD_Y + 0.07, 0.13]), 0xf3ead6, PART.mask),
      // A tall plume of feathers off one side: the troupe's silhouette.
      plume(-0.25, 0.42, 0.09, 0xf6d6b8),
      plume(0.05, 0.5, 0.03, t.trim),
      plume(0.35, 0.36, -0.05, 0xb3263a),
      finish(place(sphere(0.045, 7, 5), [0.07, HEAD_Y + 0.15, 0.02]), 0xf2b544, PART.hat),
    ];
  },
  gatto(t) {
    return [
      finish(place(cap(0.178, 2.6, 0.5, 1.75), HEAD), t.mask, PART.mask),
      finish(place(cone(0.035, 0.07, 5), [0, HEAD_Y - 0.01, 0.18], [Math.PI / 2, 0, 0]), 0x231d1f, PART.mask),
      // Ears and a tail.
      finish(place(cone(0.07, 0.17, 4), [0.1, HEAD_Y + 0.17, 0.0], [0, 0, -0.35]), t.mask, PART.hat),
      finish(place(cone(0.07, 0.17, 4), [-0.1, HEAD_Y + 0.17, 0.0], [0, 0, 0.35]), t.mask, PART.hat),
      finish(place(cone(0.035, 0.1, 4), [0.1, HEAD_Y + 0.16, 0.025], [0, 0, -0.35]), 0xe58c8a, PART.hat),
      finish(place(cone(0.035, 0.1, 4), [-0.1, HEAD_Y + 0.16, 0.025], [0, 0, 0.35]), 0xe58c8a, PART.hat),
      finish(place(cyl(0.035, 0.05, 0.62, 6), [0, 0.42, -0.42], [-0.9, 0, 0]), t.robe, PART.skirt, 0.85),
      finish(place(sphere(0.05, 6, 5), [0, 0.64, -0.62]), t.trim, PART.skirt),
    ];
  },
  bauta(t) {
    const tri = place(cyl(0.3, 0.3, 0.06, 3), [0, HEAD_Y + 0.15, -0.01], [0, Math.PI / 6, 0]);
    return [
      // The square jaw that juts over the mouth.
      finish(place(cap(0.178, 2.6, 0.45, 1.6), HEAD), t.mask, PART.mask),
      finish(place(box(0.2, 0.15, 0.13), [0, HEAD_Y - 0.11, 0.12], [0.2, 0, 0]), t.mask, PART.mask),
      // The tricorn, black and sharp.
      finish(tri, 0x0f1420, PART.hat),
      finish(place(cyl(0.13, 0.15, 0.12, 9), [0, HEAD_Y + 0.21, -0.01]), 0x0f1420, PART.hat),
      finish(place(cyl(0.305, 0.305, 0.02, 3), [0, HEAD_Y + 0.185, -0.01], [0, Math.PI / 6, 0]), 0xd8a032, PART.hat, 0.7),
      finish(lathe([[0.33, 0.9], [0.31, 1.1], [0.26, 1.23], [0.1, 1.32]], 10), 0x111a2c, PART.torso),
    ];
  },
  jolly(t) {
    const horn = (side) => finish(place(cone(0.06, 0.34, 6), [side * 0.17, HEAD_Y + 0.24, -0.02], [0, 0, -side * 0.85]), side > 0 ? t.robe : t.trim, PART.hat);
    return [
      finish(place(cap(0.177, 2.5, 0.98, 0.58), HEAD), t.mask, PART.mask),
      finish(place(cyl(0.165, 0.17, 0.08, 10), [0, HEAD_Y + 0.11, -0.01]), 0x231d1f, PART.hat),
      horn(1),
      horn(-1),
      finish(place(sphere(0.05, 7, 6), [0.33, HEAD_Y + 0.34, -0.02]), 0xf2b544, PART.hat),
      finish(place(sphere(0.05, 7, 6), [-0.33, HEAD_Y + 0.34, -0.02]), 0xf2b544, PART.hat),
      finish(place(torus(0.17, 0.035, 8), [0, NECK_Y - 0.01, 0], [Math.PI / 2, 0, 0]), 0xf2b544, PART.torso),
    ];
  },
};

/** One merged geometry per troupe, in troupe order. Heads are drawn a size up: masks have to read across a plaza. */
export function troupeGeometries() {
  return TROUPES.map((t) => {
    const g = mergeGeometries(body(t, BUILD[t.id](t)), false);
    const pos = g.attributes.position;
    const part = g.attributes.aPart;
    for (let i = 0; i < pos.count; i++) {
      if (part.getX(i) < 1.5) continue;
      pos.setY(i, NECK_Y + (pos.getY(i) - NECK_Y) * 1.14);
      pos.setX(i, pos.getX(i) * 1.14);
      pos.setZ(i, pos.getZ(i) * 1.14);
    }
    g.computeBoundingSphere();
    g.boundingSphere.radius = 1.4;
    g.boundingSphere.center.set(0, 0.9, 0);
    return g;
  });
}

/** An arm: sleeve and glove, hanging down from the shoulder (the pivot at the origin). */
export function armGeometry() {
  const sleeve = finish(place(cyl(0.065, 0.055, 0.42, 6), [0, -0.21, 0]), 0xffffff, 0, 0.82);
  const glove = finish(place(sphere(0.062, 6, 5), [0, -0.46, 0.0]), 0xffffff, 0, 1.12);
  return mergeGeometries([sleeve, glove], false);
}

/** A fan, opened, held at the hand (a flat half-disc with ribs). */
export function fanGeometry() {
  const leaf = finish(place(new THREE.CircleGeometry(0.22, 9, 0, Math.PI), [0, 0, 0], [0, 0, 0]), 0xb3263a, 0);
  const edge = finish(place(new THREE.RingGeometry(0.2, 0.225, 9, 1, 0, Math.PI), [0, 0, 0.002]), 0xf2b544, 0);
  const g = mergeGeometries([leaf, edge], false);
  return g;
}
