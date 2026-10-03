// The plazas, dressed: houses with window bays that light up at night, arcades, the clock tower whose hands run to
// midnight, bridges over teal water, gondolas, lantern strings and their warm pools on the stones. Built from the same
// data the rules use (src/sim/plazas.js), so what you see is where you can walk.
import * as THREE from 'three';
import { createKit, kitMaterials } from './kit.js';
import { createGround, createWater } from './ground.js';
import { clockTexture, glowTexture } from './textures.js';
import { troupeGeometries } from './costumes.js';
import { floorY } from '../sim/plazas.js';

const PLASTER = [0xc8553d, 0xf1e3c8, 0xe8b46a, 0xead2a8, 0xd98a7a, 0xf4ecdc, 0xb9644a, 0xe6c79a, 0xf1e3c8];
const STONE = 0xd8ccb4;
const STONE_DARK = 0xa99a82;
const WOOD = 0x7a4a2e;
const IRON = 0x232022;
const GOLD = 0xf2b544;

function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** A row of houses along a line, fronts facing `ry`'s direction into the plaza. */
function row(kit, mats, ax, az, bx, bz, ry, depth, rnd, { minH = 9, maxH = 15, skip = [] } = {}) {
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  // Outward from the plaza (the back of the houses).
  const ox = -Math.sin(ry);
  const oz = -Math.cos(ry);
  let s = 0;
  while (s < len - 0.5) {
    const w = Math.min(len - s, 5 + rnd() * 4);
    const cx = ax + ux * (s + w / 2);
    const cz = az + uz * (s + w / 2);
    const blocked = skip.some(([x0, x1, z0, z1]) => cx > x0 && cx < x1 && cz > z0 && cz < z1);
    if (!blocked) {
      const h = minH + rnd() * (maxH - minH);
      const color = PLASTER[Math.floor(rnd() * PLASTER.length)];
      kit.house(mats, color, cx + ox * (depth / 2), cz + oz * (depth / 2), w - 0.05, depth, h, ry, { flat: rnd() < 0.25 });
      // A doorway and, now and then, a balcony with flowers.
      kit.box(mats.plain, 0x3a2a22, cx - ox * 0.02, 0, cz - oz * 0.02, Math.min(1.6, w * 0.3), 2.6, 0.12, ry);
      if (rnd() < 0.45) {
        kit.box(mats.plain, IRON, cx - ox * 0.45, 3.9, cz - oz * 0.45, Math.min(3, w * 0.5), 0.12, 0.9, ry);
        kit.box(mats.plain, rnd() < 0.5 ? 0xb3263a : 0x3d8b4f, cx - ox * 0.75, 4.05, cz - oz * 0.75, Math.min(2.6, w * 0.45), 0.35, 0.3, ry);
      }
    }
    s += w;
  }
}

function column(kit, mats, x, z, r, h, y = 0, hex = STONE) {
  kit.cyl(mats.plain, STONE_DARK, x, y, z, r * 1.3, r * 1.35, 0.35, 10);
  kit.cyl(mats.plain, hex, x, y + 0.35, z, r, r * 1.08, h - 0.75, 10);
  kit.box(mats.plain, STONE_DARK, x, y + h - 0.4, z, r * 2.8, 0.4, r * 2.8);
}

/** An arcade: columns (from the plaza data) with a beam and a roof back to the wall. */
function arcade(kit, mats, pillars, wallZ, y = 0) {
  if (!pillars.length) return;
  const h = pillars[0].h;
  for (const p of pillars) column(kit, mats, p.x, p.z, p.r * 0.8, h, y);
  const xs = pillars.map((p) => p.x);
  const x0 = Math.min(...xs) - 2;
  const x1 = Math.max(...xs) + 2;
  const z = pillars[0].z;
  const depth = Math.abs(wallZ - z) + 0.6;
  const cz = (z + wallZ) / 2;
  kit.box(mats.plain, 0xe6d8bd, (x0 + x1) / 2, y + h, z, x1 - x0, 0.7, 0.9);
  kit.box(mats.roof, 0xffffff, (x0 + x1) / 2, y + h + 0.7, cz, x1 - x0 + 0.4, 0.35, depth);
}

/** A run of arcade along x for a gallery that faces east/west (pillars on a line of constant x). */
function galleryZ(kit, mats, pillars, wallX, y = 0) {
  if (!pillars.length) return;
  const h = pillars[0].h;
  for (const p of pillars) column(kit, mats, p.x, p.z, p.r * 0.8, h, y);
  const zs = pillars.map((p) => p.z);
  const z0 = Math.min(...zs) - 2;
  const z1 = Math.max(...zs) + 2;
  const x = pillars[0].x;
  kit.box(mats.plain, 0xe6d8bd, x, y + h, (z0 + z1) / 2, 0.9, 0.7, z1 - z0);
  kit.box(mats.roof, 0xffffff, (x + wallX) / 2, y + h + 0.7, (z0 + z1) / 2, Math.abs(wallX - x) + 0.6, 0.35, z1 - z0 + 0.4);
}

/** Stone walls where the land meets the water, and steps of moss. */
function canalWalls(kit, mats, plaza) {
  for (const w of plaza.water) {
    const x0 = w.x - w.w / 2;
    const x1 = w.x + w.w / 2;
    const z0 = w.z - w.d / 2;
    const z1 = w.z + w.d / 2;
    kit.box(mats.plain, 0x8f826e, x0 - 0.2, -1.2, w.z, 0.4, 1.25, w.d);
    kit.box(mats.plain, 0x8f826e, x1 + 0.2, -1.2, w.z, 0.4, 1.25, w.d);
    kit.box(mats.plain, 0x8f826e, w.x, -1.2, z0 - 0.2, w.w, 1.25, 0.4);
    kit.box(mats.plain, 0x8f826e, w.x, -1.2, z1 + 0.2, w.w, 1.25, 0.4);
    kit.box(mats.plain, 0x3e5a4a, w.x, -0.52, w.z, w.w + 0.8, 0.1, w.d + 0.8);
  }
}

/** A humped bridge over water: a deck of short slabs on the curve, parapets either side. */
function bridge(kit, mats, plaza, d) {
  const along = d.axis === 'x';
  const len = along ? d.w : d.d;
  const width = along ? d.d : d.w;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const a = -len / 2 + u * len;
    const x = along ? d.x + a : d.x;
    const z = along ? d.z : d.z + a;
    const y = floorY(plaza, x, z);
    const slope = Math.atan(d.hump * Math.PI * Math.cos(Math.PI * u) / len);
    const geo = new THREE.BoxGeometry(along ? len / n + 0.05 : width, 0.35, along ? width : len / n + 0.05);
    kit.geo(mats.plain, 0xcdbfa5, geo, x, y - 0.17, z, 0, along ? 0 : slope, along ? slope : 0);
    for (const side of [-1, 1]) {
      const px = along ? x : d.x + side * (width / 2 - 0.15);
      const pz = along ? d.z + side * (width / 2 - 0.15) : z;
      const pg = new THREE.BoxGeometry(along ? len / n + 0.05 : 0.3, 0.75, along ? 0.3 : len / n + 0.05);
      kit.geo(mats.plain, 0xe9dcc4, pg, px, y + 0.38, pz, 0, along ? 0 : slope, along ? slope : 0);
    }
  }
}

/** A striped mooring pole, Venetian style. */
function pole(kit, mats, x, z, colors = [0xf1e3c8, 0x1f7a80]) {
  for (let i = 0; i < 7; i++) kit.cyl(mats.plain, colors[i % 2], x, -0.6 + i * 0.42, z, 0.12, 0.12, 0.42, 7);
  kit.sphere(mats.plain, GOLD, x, 2.4, z, 0.14, 1, 1, 1, 7);
}

function lampPost(kit, mats, x, z, y = 0) {
  kit.cyl(mats.plain, IRON, x, y, z, 0.1, 0.16, 3.6, 7);
  kit.box(mats.plain, IRON, x, y + 3.55, z, 0.5, 0.08, 0.5);
  kit.cyl(mats.glow, 0xffc46a, x, y + 3.62, z, 0.2, 0.16, 0.5, 6);
  kit.cone(mats.plain, IRON, x, y + 4.1, z, 0.3, 0.35, 6);
}

/**
 * Lantern strings: catenaries between building fronts with paper lanterns along them. Returns the lantern positions
 * (for glows and the pools on the floor) and a line geometry for the strings.
 */
function strings(defs) {
  const lanterns = [];
  const pts = [];
  const colors = [0xffd27a, 0xffb36a, 0xf2b544, 0xf08a5d, 0xfff0c0];
  defs.forEach(([ax, ay, az, bx, by, bz, sag], k) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(4, Math.round(len / 1.7));
    let px = ax;
    let py = ay;
    let pz = az;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = ax + (bx - ax) * u;
      const z = az + (bz - az) * u;
      const y = ay + 3.6 + (by - ay) * u - sag * 0.6 * 4 * u * (1 - u);
      if (i > 0) pts.push(px, py, pz, x, y, z);
      if (i > 0 && i < n) lanterns.push({ x, y: y - 0.25, z, c: colors[(i + k) % colors.length] });
      px = x;
      py = y;
      pz = z;
    }
  });
  return { lanterns, pts };
}

function piazza(kit, mats, plaza, scene, extra) {
  const rnd = prng(101);
  row(kit, mats, -36, -21, 14, -21, 0, 7, rnd, { skip: [[-9.5, -2.5, -30, -10]] });
  row(kit, mats, 20, -21, 36, -21, 0, 7, rnd);
  row(kit, mats, -36, 21, 14, 21, Math.PI, 7, rnd);
  row(kit, mats, 20, 21, 36, 21, Math.PI, 7, rnd);
  row(kit, mats, -30, -21, -30, 21, Math.PI / 2, 7, rnd);
  row(kit, mats, 30, -21, 30, 21, -Math.PI / 2, 7, rnd);
  // The canal runs on past the plaza, between more houses.
  for (const [z0, z1] of [[-60, -28], [28, 60]]) {
    row(kit, mats, 13.6, z0, 13.6, z1, Math.PI / 2, 6, rnd);
    row(kit, mats, 20.4, z0, 20.4, z1, -Math.PI / 2, 6, rnd);
  }
  // Clock tower: stone shaft, a belfry, a pyramid roof, and a clock that runs to midnight.
  kit.box(mats.plain, 0xd8b98e, -6, 0, -20.5, 6, 18, 5);
  kit.box(mats.plain, 0xc9a77a, -6, 18, -20.5, 6.4, 0.6, 5.4);
  kit.box(mats.plain, 0x2a2420, -6, 18.6, -20.5, 5.2, 3.2, 4.2);
  for (const [dx, dz] of [[-2.7, -2.2], [2.7, -2.2], [-2.7, 2.2], [2.7, 2.2]]) kit.box(mats.plain, 0xd8b98e, -6 + dx, 18.6, -20.5 + dz, 0.6, 3.2, 0.6);
  kit.box(mats.plain, 0xc9a77a, -6, 21.8, -20.5, 6.6, 0.5, 5.6);
  kit.cone(mats.roof, 0xffffff, -6, 22.3, -20.5, 4.6, 5.5, 4, Math.PI / 4);
  kit.sphere(mats.plain, GOLD, -6, 28.1, -20.5, 0.35, 1, 1, 1, 8);
  const face = new THREE.Mesh(new THREE.CircleGeometry(2.1, 32), new THREE.MeshBasicMaterial({ map: clockTexture() }));
  face.position.set(-6, 14.5, -17.97);
  scene.add(face);
  const handMat = new THREE.MeshBasicMaterial({ color: GOLD });
  const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.2, 0.05).translate(0, 0.55, 0), handMat);
  const minHand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.8, 0.05).translate(0, 0.85, 0), handMat);
  hourHand.position.set(-6, 14.5, -17.9);
  minHand.position.set(-6, 14.5, -17.88);
  scene.add(hourHand, minHand);
  extra.clock = { hourHand, minHand };
  extra.objects.push(face, hourHand, minHand);
  // The fountain: a stone basin, a column with a bowl, a statue of a masker on top.
  kit.lathe(mats.plain, STONE, -6, 0, 0, [[3.1, 0], [3.15, 0.75], [2.85, 0.9], [2.75, 0.4], [0.001, 0.38]], 28);
  kit.lathe(mats.plain, STONE_DARK, -6, 0, 0, [[0.8, 0.3], [0.55, 1.6], [1.4, 2.0], [1.5, 2.25], [0.4, 2.3], [0.35, 2.7]], 16);
  extra.statues.push({ x: -6, y: 2.7, z: 0, ry: Math.PI * 0.15, s: 1.15, tr: 3 });
  extra.pools.push({ x: -6, z: 0, r: 2.75, y: 0.55 });
  extra.spray.push({ x: -6, y: 2.3, z: 0, r: 1.3 });
  // The stage: boards, steps, painted curtains and a string of pennants.
  kit.box(mats.plain, WOOD, -27.5, 0, 0, 5, 1.2, 12);
  for (let i = 0; i < 3; i++) kit.box(mats.plain, 0x8c5a38, -24.6 + i * 0.35, 0, 0, 0.5, 0.4 * (3 - i), 4);
  kit.box(mats.plain, 0x5a2a1e, -29.9, 1.2, 0, 0.3, 5.5, 12.6);
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 4.8), mats.curtain);
  curtain.position.set(-29.7, 3.6, 0);
  curtain.rotation.y = Math.PI / 2;
  scene.add(curtain);
  extra.objects.push(curtain);
  kit.box(mats.plain, GOLD, -29.75, 6.7, 0, 0.4, 0.5, 12.8);
  // Arcades on four corners.
  const pil = plaza.obstacles.filter((o) => o.kind === 'pillar');
  arcade(kit, mats, pil.filter((p) => p.x < -8 && p.z < 0), -21);
  arcade(kit, mats, pil.filter((p) => p.x < -8 && p.z > 0), 21);
  arcade(kit, mats, pil.filter((p) => p.x > -8 && p.z < 0), -21);
  arcade(kit, mats, pil.filter((p) => p.x > -8 && p.z > 0), 21);
  for (const o of plaza.obstacles) {
    if (o.kind === 'lamp') {
      lampPost(kit, mats, o.x, o.z);
      extra.glows.push({ x: o.x, y: 3.85, z: o.z, c: 0xffc46a, s: 1.6 });
      extra.floorPools.push([o.x, o.z, 1.2]);
    } else if (o.kind === 'post') pole(kit, mats, o.x, o.z);
    else if (o.kind === 'kiosk') {
      kit.box(mats.plain, 0x2e6b66, o.x, 0, o.z, o.w, 2.6, o.d);
      kit.geo(mats.awning, 0xffffff, new THREE.BoxGeometry(o.w + 1, 0.12, o.d + 1), o.x, 2.75, o.z);
    }
  }
  for (const d of plaza.decks) bridge(kit, mats, plaza, d);
  canalWalls(kit, mats, plaza);
  extra.gondolas.push([17, -0.35, -2, 0.05], [16.2, -0.35, 4.5, -0.04], [17.8, -0.35, 17, 0.02], [16.8, -0.35, -17, 0]);
  return strings([
    [-29, 7, -21, -8, 6.5, 21, 1.6],
    [-18, 6.8, -21, 9, 7, 21, 1.8],
    [2, 7.2, -21, -24, 6.8, 21, 1.8],
    [12, 6.5, -21, -14, 7, 21, 1.6],
    [-30, 6.4, -10, 13.5, 6.4, -6, 1.4],
    [-30, 6.4, 10, 13.5, 6.4, 6, 1.4],
    [20.5, 5.2, -20, 30, 5.6, 20, 1.1],
  ]);
}

function quay(kit, mats, plaza, scene, extra) {
  const rnd = prng(202);
  row(kit, mats, -40, -18, -22, -18, 0, 8, rnd);
  row(kit, mats, -18, -18, 18, -18, 0, 8, rnd, { minH: 12, maxH: 16 });
  row(kit, mats, 22, -18, 40, -18, 0, 8, rnd);
  row(kit, mats, -36, -18, -36, 8, Math.PI / 2, 7, rnd);
  row(kit, mats, 36, -18, 36, 8, -Math.PI / 2, 7, rnd);
  // The side canals continue north between houses.
  for (const x of [-20, 20]) {
    row(kit, mats, x - 2.4, -60, x - 2.4, -26, Math.PI / 2, 6, rnd);
    row(kit, mats, x + 2.4, -60, x + 2.4, -26, -Math.PI / 2, 6, rnd);
  }
  // Twin columns with their figures on top; the loggia; the bandstand; the well; fish stalls; the customs house.
  for (const o of plaza.obstacles) {
    if (o.kind === 'column') {
      kit.box(mats.plain, STONE_DARK, o.x, 0, o.z, 2.4, 0.9, 2.4);
      kit.cyl(mats.plain, 0xe3d3b6, o.x, 0.9, o.z, 0.75, 0.85, 11.5, 12);
      kit.box(mats.plain, STONE_DARK, o.x, 12.4, o.z, 2.2, 0.8, 2.2);
      extra.statues.push({ x: o.x, y: 13.2, z: o.z, ry: o.x < 0 ? 0.6 : -0.6, s: 1.6, tr: o.x < 0 ? 0 : 6 });
    } else if (o.kind === 'bandstand') {
      kit.cyl(mats.plain, STONE, o.x, 0, o.z, o.r, o.r + 0.1, 0.6, 8);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        kit.cyl(mats.plain, 0xf1e3c8, o.x + Math.sin(a) * (o.r - 0.3), 0.6, o.z + Math.cos(a) * (o.r - 0.3), 0.1, 0.1, 3, 6);
      }
      kit.lathe(mats.roof, 0xffffff, o.x, 3.55, o.z, [[o.r + 0.4, 0], [o.r * 0.7, 0.9], [0.3, 1.6], [0.001, 1.75]], 8);
      kit.sphere(mats.plain, GOLD, o.x, 5.4, o.z, 0.22, 1, 1, 1, 8);
      extra.glows.push({ x: o.x, y: 3.3, z: o.z, c: 0xffd27a, s: 2.6 });
      extra.floorPools.push([o.x, o.z, 1.5]);
    } else if (o.kind === 'well') {
      kit.cyl(mats.plain, STONE, o.x, 0, o.z, o.r, o.r + 0.05, 1.0, 10);
      kit.cyl(mats.plain, 0x15282c, o.x, 0.95, o.z, o.r - 0.25, o.r - 0.25, 0.07, 10);
      kit.box(mats.plain, IRON, o.x - o.r + 0.2, 1, o.z, 0.12, 1.6, 0.12);
      kit.box(mats.plain, IRON, o.x + o.r - 0.2, 1, o.z, 0.12, 1.6, 0.12);
      kit.box(mats.plain, IRON, o.x, 2.55, o.z, o.r * 2 - 0.2, 0.12, 0.12);
    } else if (o.kind === 'stall') {
      kit.box(mats.plain, WOOD, o.x, 0, o.z, o.w, 1.0, o.d);
      kit.geo(mats.awning, 0xffffff, new THREE.BoxGeometry(o.w + 0.6, 0.1, o.d + 0.8), o.x + 0.3, 2.5, o.z, 0, 0, -0.2);
      kit.box(mats.plain, 0xc0c8cc, o.x, 1.0, o.z, o.w - 0.4, 0.25, o.d - 0.5);
    } else if (o.kind === 'customs') {
      kit.house(mats, 0xead2a8, o.x, o.z, o.d, o.w, o.h, -Math.PI / 2, { flat: true, chimney: false });
      kit.box(mats.plain, 0xd8b98e, o.x - 1, o.h + 0.6, o.z, 2.4, 3, 2.4);
      kit.sphere(mats.plain, GOLD, o.x - 1, o.h + 4.4, o.z, 0.9, 1, 1, 1, 12);
    } else if (o.kind === 'post') pole(kit, mats, o.x, o.z, [0xf1e3c8, 0xb3263a]);
  }
  arcade(kit, mats, plaza.obstacles.filter((o) => o.kind === 'pillar'), -18);
  // The pier: planks on posts.
  const pier = plaza.decks.find((d) => d.kind === 'pier');
  kit.box(mats.plain, 0x8a6a4a, pier.x, -0.3, pier.z, pier.w, 0.3, pier.d);
  for (let z = pier.z - pier.d / 2 + 0.6; z < pier.z + pier.d / 2; z += 2.2) {
    for (const s of [-1, 1]) pole(kit, mats, pier.x + s * (pier.w / 2 - 0.1), z, [0x6a4a2e, 0x8a6a4a]);
    extra.glows.push({ x: pier.x - pier.w / 2, y: 2.5, z, c: 0xffd27a, s: 1 });
  }
  for (const d of plaza.decks) if (d.kind === 'bridge') bridge(kit, mats, plaza, d);
  canalWalls(kit, mats, plaza);
  // Across the lagoon: a low skyline of domes and a bell tower at dusk.
  for (const [x, z, w, h] of [[-90, 170, 40, 6], [-30, 190, 30, 8], [40, 175, 50, 7], [110, 160, 40, 5]]) kit.box(mats.plain, 0x31535c, x, -0.5, z, w, h, 14);
  kit.box(mats.plain, 0x2c4b54, 42, 6, 175, 5, 22, 5);
  kit.cone(mats.plain, 0x2c4b54, 42, 28, 175, 4, 6, 4, Math.PI / 4);
  kit.sphere(mats.plain, 0x2f5058, 15, 6, 182, 9, 1, 0.7, 1, 12);
  extra.gondolas.push([-10, -0.35, 11, 0.4], [11, -0.35, 12.5, -0.3], [-14, -0.35, 15, 0.9], [-20, -0.35, -14, 1.57], [20, -0.35, 6, 1.57]);
  return strings([
    [-17, 5.5, 6.5, 17, 5.5, 6.5, 1.2],
    [-16, 6, -14.5, 14, 6, -14.5, 0.9],
    [-30, 5, -17, -30, 5, 7, 1],
    [30, 5, -8, 30, 5, 7, 1],
    [-12, 6, -14.5, 6, 6, 6.5, 1.6],
    [12, 6, -14.5, -6, 6, 6.5, 1.6],
  ]);
}

function palazzo(kit, mats, plaza, scene, extra) {
  const rnd = prng(303);
  // The palace on every side: a tall north front behind the terrace, wings east and west, a wall with a gate south.
  kit.house(mats, 0xead2a8, 0, -27, 50, 10, 17, 0, { flat: true, chimney: false });
  kit.house(mats, 0xe8b46a, -27, 0, 46, 10, 13, Math.PI / 2, { flat: false, chimney: false });
  kit.house(mats, 0xe8b46a, 27, 0, 46, 10, 13, -Math.PI / 2, { flat: false, chimney: false });
  kit.box(mats.plain, 0xd9734f, -13, 0, 19.5, 18, 6.5, 3);
  kit.box(mats.plain, 0xd9734f, 13, 0, 19.5, 18, 6.5, 3);
  kit.box(mats.plain, 0xe9dcc4, 0, 6.5, 19.5, 44, 0.5, 3.4);
  kit.box(mats.plain, 0xd8b98e, -2.8, 0, 19.5, 1.2, 7, 3.2);
  kit.box(mats.plain, 0xd8b98e, 2.8, 0, 19.5, 1.2, 7, 3.2);
  kit.box(mats.plain, 0xd8b98e, 0, 5.2, 19.5, 6.8, 1.8, 3.2);
  kit.box(mats.plain, IRON, 0, 0, 20.6, 4.4, 5, 0.12);
  void rnd;
  // The terrace: solid stone with a balustrade, three stairs, and its own loggia of columns.
  kit.box(mats.plain, 0xc9b79a, 0, 0, -17, 44, 2.4, 10);
  kit.box(mats.plain, 0xb8a585, 0, 0, -12.05, 44, 2.4, 0.1);
  for (const r of plaza.obstacles.filter((o) => o.kind === 'rail')) {
    kit.box(mats.plain, 0xe9dcc4, r.x, 2.4, r.z, r.w, 0.12, 0.45);
    kit.box(mats.plain, 0xe9dcc4, r.x, 3.25, r.z, r.w, 0.12, 0.4);
    for (let x = r.x - r.w / 2 + 0.25; x < r.x + r.w / 2; x += 0.5) kit.cyl(mats.plain, 0xf1e3c8, x, 2.52, r.z, 0.09, 0.12, 0.73, 6);
  }
  for (const rp of plaza.ramps) {
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const u0 = i / steps;
      const z = rp.z0 + (rp.z1 - rp.z0) * (u0 + 0.5 / steps);
      const y = rp.y0 + (rp.y1 - rp.y0) * (u0 + 1 / steps);
      kit.box(mats.plain, i % 2 ? 0xe2d4ba : 0xd6c7ab, (rp.x0 + rp.x1) / 2, 0, z, rp.x1 - rp.x0, Math.max(0.05, y), (rp.z1 - rp.z0) / steps + 0.02);
    }
  }
  for (const w of plaza.obstacles.filter((o) => o.kind === 'stairwall')) kit.box(mats.plain, 0xe9dcc4, w.x, 0, w.z, w.w, 2.6, w.d);
  const pil = plaza.obstacles.filter((o) => o.kind === 'pillar');
  arcade(kit, mats, pil.filter((p) => p.z < -15), -22.5, 2.4);
  galleryZ(kit, mats, pil.filter((p) => p.x < -15), -22);
  galleryZ(kit, mats, pil.filter((p) => p.x > 15), 22);
  for (const o of plaza.obstacles) {
    if (o.kind === 'well') {
      // A stone well-head with a wrought-iron arch and a lantern hung from it.
      kit.cyl(mats.plain, STONE, o.x, 0, o.z, o.r, o.r + 0.1, 1.0, 8);
      kit.cyl(mats.plain, 0xe9dcc4, o.x, 1.0, o.z, o.r + 0.12, o.r + 0.12, 0.14, 8);
      kit.cyl(mats.plain, 0x15282c, o.x, 1.1, o.z, o.r - 0.25, o.r - 0.25, 0.06, 8);
      for (const side of [-1, 1]) kit.cyl(mats.plain, IRON, o.x + side * (o.r - 0.15), 1.0, o.z, 0.07, 0.08, 1.6, 6);
      kit.geo(mats.plain, IRON, new THREE.TorusGeometry(o.r - 0.15, 0.06, 5, 14, Math.PI), o.x, 2.6, o.z);
      kit.cyl(mats.glow, 0xffc46a, o.x, 2.1, o.z, 0.16, 0.13, 0.32, 6);
      extra.glows.push({ x: o.x, y: 2.3, z: o.z, c: 0xffc46a, s: 1.4 });
    } else if (o.kind === 'tree') {
      kit.cyl(mats.plain, STONE_DARK, o.x, 0, o.z, o.r, o.r + 0.05, 0.7, 8);
      kit.cyl(mats.plain, 0x5a3a26, o.x, 0.7, o.z, 0.14, 0.2, 1.6, 6);
      kit.geo(mats.plain, 0x2f5a35, new THREE.IcosahedronGeometry(1.5, 1), o.x, 3.2, o.z, 0, 0, 0, 1, 0.85, 1);
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        kit.sphere(mats.glow, 0xf08a2d, o.x + Math.sin(a) * 1.2, 3.0 + Math.sin(i * 1.7) * 0.6, o.z + Math.cos(a) * 1.2, 0.11, 1, 1, 1, 5);
      }
    } else if (o.kind === 'statue') {
      kit.box(mats.plain, STONE_DARK, o.x, 0, o.z, 1.3, 1.1, 1.3);
      extra.statues.push({ x: o.x, y: 1.1, z: o.z, ry: Math.atan2(-o.x, -o.z), s: 1.05, tr: o.x > 13 ? 7 : 4 });
    }
  }
  return strings([
    [-21.5, 6.8, -12.3, 6, 5.8, 18, 1.4],
    [21.5, 6.8, -12.3, -6, 5.8, 18, 1.4],
    [-17.5, 5.6, -6, 17.5, 5.6, 14, 1.2],
    [17.5, 5.6, -6, -17.5, 5.6, 14, 1.2],
    [-20, 8.8, -21.5, 20, 8.8, -21.5, 0.8],
  ]);
}

const BUILDERS = { piazza, quay, palazzo };

/** Builds a plaza's scenery into the scene. Returns { update(time, night, clockU), dispose(), pools }. */
export function buildPlaza(scene, plaza) {
  const group = new THREE.Group();
  scene.add(group);
  const mats = kitMaterials();
  const kit = createKit();
  const extra = { objects: [], statues: [], glows: [], floorPools: [], pools: [], spray: [], gondolas: [], clock: null };
  const { lanterns, pts } = BUILDERS[plaza.id](kit, mats, plaza, group, extra);
  const meshes = kit.build(group);
  const b = plaza.bounds;
  const ground = createGround(group, { ...b, water: plaza.water, inlay: plaza.id === 'piazza' ? { x: -6, z: 0, r: 4.2 } : plaza.id === 'palazzo' ? { x: 0, z: 3, r: 2.6 } : null });
  if (plaza.id === 'palazzo') createGround(group, { x0: -22, x1: 22, z0: -22, z1: -12, y: 2.401, margin: 0 });
  const water = createWater(group, [...plaza.water, ...extra.pools.map((p) => ({ x: p.x, z: p.z, r: p.r, y: p.y }))], { open: plaza.id === 'quay' });
  // Statues: maskers in stone.
  const geos = troupeGeometries();
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0xcfc4ae, flatShading: true });
  for (const s of extra.statues) {
    const m = new THREE.Mesh(geos[s.tr], stoneMat);
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.ry;
    m.scale.setScalar(s.s);
    group.add(m);
  }
  // Lanterns: bulbs, their glows, and the strings they hang from.
  const all = [...lanterns, ...extra.glows];
  const bulbGeo = new THREE.SphereGeometry(0.085, 6, 5);
  const bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, lanterns.length));
  const M = new THREE.Matrix4();
  const C = new THREE.Color();
  lanterns.forEach((l, i) => {
    M.makeTranslation(l.x, l.y, l.z);
    M.scale(new THREE.Vector3(1, 1.25, 1));
    bulbs.setMatrixAt(i, M);
    bulbs.setColorAt(i, C.setHex(l.c));
  });
  bulbs.count = lanterns.length;
  group.add(bulbs);
  const glowGeo = new THREE.BufferGeometry();
  const gp = new Float32Array(all.length * 3);
  const gc = new Float32Array(all.length * 3);
  const gs = new Float32Array(all.length);
  all.forEach((l, i) => {
    gp.set([l.x, l.y, l.z], i * 3);
    C.setHex(l.c);
    gc.set([C.r, C.g, C.b], i * 3);
    gs[i] = l.s ?? 1;
  });
  glowGeo.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  glowGeo.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  glowGeo.setAttribute('aSize', new THREE.BufferAttribute(gs, 1));
  const glowUniforms = { uMap: { value: glowTexture() }, uNight: { value: 0 }, uScale: { value: 150 } };
  const glowMat = new THREE.ShaderMaterial({
    uniforms: glowUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    vertexShader: `attribute float aSize; varying vec3 vC; varying float vNear; uniform float uScale; uniform float uNight;
void main() { vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); vNear = smoothstep(2.5, 7.0, -mv.z); gl_PointSize = min(48.0, aSize * uScale * (0.55 + uNight) / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uNight; varying vec3 vC; varying float vNear;
void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb * (0.45 + 0.8 * uNight), t.a * (0.5 + 0.5 * uNight) * vNear); }`,
  });
  const glows = new THREE.Points(glowGeo, glowMat);
  glows.frustumCulled = false;
  group.add(glows);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  group.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x2a1c18 })));
  // Pools of light on the stones under the lanterns.
  const poolList = [...extra.floorPools];
  for (let i = 0; i < lanterns.length; i += 3) poolList.push([lanterns[i].x, lanterns[i].z, 0.65]);
  ground.setPools(poolList);
  // Gondolas bob on the water.
  const gondolaGeo = gondola();
  const gondolas = new THREE.InstancedMesh(gondolaGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, extra.gondolas.length));
  gondolas.count = extra.gondolas.length;
  group.add(gondolas);
  // Fountain spray: water on parabolas.
  const spray = sprayPoints(extra.spray);
  if (spray) group.add(spray.points);

  const Q = new THREE.Quaternion();
  const E = new THREE.Euler();
  const P = new THREE.Vector3();
  const S = new THREE.Vector3(1, 1, 1);
  return {
    group,
    lanternCount: lanterns.length,
    /** time: seconds; night: 0..1; clockU: 0..1 from eleven to midnight (null leaves the clock at a quarter to). */
    update(time, night, camPos, clockU = null) {
      mats.facade.emissiveIntensity = Math.max(0, night * 1.35 - 0.1);
      glowUniforms.uNight.value = night;
      ground.uniforms.uNight.value = night;
      water.uniforms.uTime.value = time;
      water.uniforms.uNight.value = night;
      if (camPos) water.uniforms.uCam.value.copy(camPos);
      extra.gondolas.forEach(([x, y, z, ry], i) => {
        E.set(Math.sin(time * 0.8 + i) * 0.03, ry, Math.sin(time * 1.1 + i * 2) * 0.04);
        Q.setFromEuler(E);
        P.set(x, y + Math.sin(time * 1.3 + i * 1.7) * 0.05, z);
        M.compose(P, Q, S);
        gondolas.setMatrixAt(i, M);
      });
      gondolas.instanceMatrix.needsUpdate = true;
      if (spray) spray.uniforms.uTime.value = time;
      if (extra.clock) {
        const u = clockU ?? 0.75;
        // From 11:00 to 12:00: the minute hand sweeps a whole turn, the hour hand the last twelfth.
        extra.clock.minHand.rotation.z = -u * Math.PI * 2;
        extra.clock.hourHand.rotation.z = -((11 + u) / 12) * Math.PI * 2;
      }
    },
    setSky(sky) {
      water.uniforms.uSky.value.copy(sky.uniforms.uHorizon.value).lerp(sky.uniforms.uZenith.value, 0.4);
      water.uniforms.uHorizon.value.copy(sky.uniforms.uHorizon.value);
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        o.geometry?.dispose?.();
      });
      for (const m of meshes) m.geometry.dispose();
    },
  };
}

/** A gondola: a long black hull curving up at both ends, a silver prow, a red cushion. */
function gondola() {
  const shape = new THREE.Shape();
  shape.moveTo(-3.6, 1.0);
  shape.quadraticCurveTo(-3.0, 0.1, -1.5, 0.0);
  shape.lineTo(1.5, 0.0);
  shape.quadraticCurveTo(3.0, 0.1, 3.7, 1.25);
  shape.lineTo(3.4, 1.25);
  shape.quadraticCurveTo(2.6, 0.55, 1.4, 0.5);
  shape.lineTo(-1.4, 0.5);
  shape.quadraticCurveTo(-2.6, 0.55, -3.3, 1.0);
  shape.closePath();
  const hull = new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -0.55);
  const kit = createKit();
  const mats = { a: 'a', b: 'b' };
  kit.geo(mats.a, 0x151214, hull, 0, 0, 0, Math.PI / 2);
  kit.box(mats.a, 0x151214, 0, 0.05, 0, 1.0, 0.45, 6.0);
  kit.box(mats.a, 0xb3263a, 0, 0.45, -0.6, 0.8, 0.2, 1.2);
  kit.box(mats.a, 0xd0d4d6, 0, 1.0, 3.62, 0.08, 0.5, 0.3);
  const holder = new THREE.Group();
  const [mesh] = kit.build(holder);
  return mesh.geometry;
}

function sprayPoints(list) {
  if (!list.length) return null;
  const n = 140;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = list[i % list.length];
    pos.set([s.x, s.y, s.z], i * 3);
    seed[i] = i / n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { uTime: { value: 0 }, uMap: { value: glowTexture() } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aSeed; uniform float uTime; varying float vA;
void main() {
  float t = fract(uTime * 0.55 + aSeed * 7.13);
  float ang = aSeed * 6.2831 * 13.0;
  vec3 p = position + vec3(cos(ang), 0.0, sin(ang)) * t * 1.35 + vec3(0.0, t * 2.6 - t * t * 3.4, 0.0);
  vA = 1.0 - t;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 28.0 / -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform sampler2D uMap; varying float vA;
void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(0.75, 0.92, 1.0) * t.rgb, t.a * vA * 0.7); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, uniforms };
}
