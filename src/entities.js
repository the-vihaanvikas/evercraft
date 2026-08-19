// VOXHAVEN - creatures. Original designs, built from box primitives.

import * as THREE from '../vendor/three.module.js';
import { B, BLOCKS, isSolid, WORLD_H, SEA_LEVEL } from './blocks.js';
import { BIOME } from './worldgen.js';

const TMP = new THREE.Vector3();

// ------------------------------------------------------------- model helper
function mat(color, flat = false) {
  return new THREE.MeshLambertMaterial({ color, flatShading: flat });
}
function boxMesh(w, h, d, color, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat(color));
  m.position.set(x, y, z);
  m.castShadow = false;
  return m;
}

/**
 * A limb that rotates about its TOP end (hip / shoulder) instead of its
 * centre. Returns a pivot Group placed at (x, topY, z); rotating the group
 * swings the limb naturally the way a real leg or arm does.
 */
function limb(w, h, d, color, x, topY, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, topY, z);
  // The limb is extended slightly ABOVE its own pivot and the box is grown a
  // hair on each axis. A box whose top face sits exactly on the pivot plane
  // swings that face away as soon as the limb rotates, opening a visible wedge
  // at the shoulder/hip; overlapping the socket keeps the joint closed through
  // the whole swing without changing the limb's apparent length.
  const over = Math.min(h * 0.18, 0.055);        // how far to poke into the body
  const m = boxMesh(w * 1.02, h + over, d * 1.02, color, 0, -h / 2 + over / 2, 0);
  pivot.add(m);
  pivot.userData.len = h;
  return pivot;
}

/** wing that hinges at the shoulder (inner edge) rather than its middle */
function wing(w, h, d, color, x, y, z, side) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const m = boxMesh(w, h, d, color, side * w / 2, 0, 0);
  pivot.add(m);
  return pivot;
}

/* ---------------------------------------------------------------- species
   Friendly:
     hopper    - small spring-legged forager (plains/forest)
     woolback  - fluffy grazer, drops wool + meat (plains/meadow)
     tusker    - sturdy tusked beast, drops hide + meat (forest/pine)
     plume     - bird, drops feathers (all surface)
   Hostile:
     husk      - shambling night walker
     creeplet  - skittering ambusher that lunges
     shardling - crystalline cave dweller, ranged shard
     gloom     - deep-cave floater, drains light
*/

export const SPECIES = {
  hopper: {
    friendly: true, hp: 8, speed: 2.4, w: 0.55, h: 0.6, view: 9,
    drops: [['raw_meat', 1, 1], ['hide', 0, 1]], xp: 1,
    biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.MEADOW, BIOME.PINE_HILLS],
    build: () => {
      // Compact rabbit-like forager; total height ~0.58 to match the hitbox.
      const g = new THREE.Group();
      const px = 1 / 16;
      const fur = 0xc9a978, furL = 0xd8bb8c, furD = 0xb08f63, inner = 0xe6a8ac;
      const LEGB = 3.6 * px, hipY = LEGB;

      const body = boxMesh(6.5 * px, 4.6 * px, 8 * px, fur, 0, hipY + 2.2 * px, 0.6 * px);
      const rump = boxMesh(6 * px, 4.4 * px, 3 * px, furD, 0, hipY + 2.8 * px, 3.6 * px);
      const head = boxMesh(4.6 * px, 4.2 * px, 4 * px, furL, 0, hipY + 5.4 * px, -4.4 * px);
      const muzzle = boxMesh(2.4 * px, 2 * px, 1.6 * px, 0xe8d1aa, 0, hipY + 4.4 * px, -6.8 * px);
      const nose = boxMesh(0.9 * px, 0.7 * px, 0.7 * px, 0xd88a92, 0, hipY + 4.9 * px, -7.6 * px);
      const earL = limb(1.3 * px, 4.2 * px, 1.3 * px, furL, -1.4 * px, hipY + 9.4 * px, -4 * px);
      const earR = limb(1.3 * px, 4.2 * px, 1.3 * px, furL, 1.4 * px, hipY + 9.4 * px, -4 * px);
      const innerL = boxMesh(0.7 * px, 2.8 * px, 0.5 * px, inner, -1.4 * px, hipY + 7.6 * px, -4.6 * px);
      const innerR = boxMesh(0.7 * px, 2.8 * px, 0.5 * px, inner, 1.4 * px, hipY + 7.6 * px, -4.6 * px);
      const tail = boxMesh(2.2 * px, 2.2 * px, 1.6 * px, 0xf7ecd8, 0, hipY + 2.6 * px, 5.4 * px);
      const legFL = limb(1.7 * px, LEGB - 0.6 * px, 2 * px, furD, -2 * px, hipY - 0.4 * px, -2.4 * px);
      const legFR = limb(1.7 * px, LEGB - 0.6 * px, 2 * px, furD, 2 * px, hipY - 0.4 * px, -2.4 * px);
      const legBL = limb(2.2 * px, LEGB, 3.4 * px, 0xa8875c, -2.2 * px, hipY, 2.6 * px);
      const legBR = limb(2.2 * px, LEGB, 3.4 * px, 0xa8875c, 2.2 * px, hipY, 2.6 * px);
      const eyeL = boxMesh(0.9 * px, 1 * px, 0.5 * px, 0x2a2118, -1.7 * px, hipY + 5.8 * px, -6.3 * px);
      const eyeR = boxMesh(0.9 * px, 1 * px, 0.5 * px, 0x2a2118, 1.7 * px, hipY + 5.8 * px, -6.3 * px);

      g.add(body, rump, head, muzzle, nose, earL, earR, innerL, innerR, tail,
        legFL, legFR, legBL, legBR, eyeL, eyeR);
      g.userData.legs = [legFL, legFR, legBL, legBR];
      g.userData.head = head;
      g.userData.headParts = [muzzle, nose, eyeL, eyeR, earL, earR, innerL, innerR];
      g.userData.ears = [earL, earR];
      return g;
    },
  },
  woolback: {
    friendly: true, hp: 12, speed: 1.5, w: 0.8, h: 1.1, view: 8,
    drops: [['raw_meat', 1, 2], ['wool_white', 1, 2]], xp: 2, shearable: 'wool_white',
    biomes: [BIOME.PLAINS, BIOME.MEADOW, BIOME.FOREST],
    build: () => {
      const g = new THREE.Group();
      const wool = boxMesh(0.80, 0.68, 1.00, 0xeef1f4, 0, 0.74, 0);
      const wool2 = boxMesh(0.88, 0.52, 0.72, 0xf7f9fb, 0, 0.86, 0.06);
      const woolR = boxMesh(0.74, 0.44, 0.30, 0xe6eaef, 0, 0.72, -0.50);
      const head = boxMesh(0.40, 0.42, 0.40, 0x4a4640, 0, 0.80, -0.68);
      const snout = boxMesh(0.26, 0.22, 0.16, 0x635d55, 0, 0.71, -0.92);
      const hornL = boxMesh(0.11, 0.11, 0.22, 0xd6c8a8, -0.21, 0.96, -0.60);
      const hornR = boxMesh(0.11, 0.11, 0.22, 0xd6c8a8, 0.21, 0.96, -0.60);
      const earL = boxMesh(0.16, 0.08, 0.10, 0x3e3a35, -0.26, 0.86, -0.66);
      const earR = boxMesh(0.16, 0.08, 0.10, 0x3e3a35, 0.26, 0.86, -0.66);
      const legs = [];
      for (const [dx, dz] of [[-0.26, -0.32], [0.26, -0.32], [-0.26, 0.34], [0.26, 0.34]]) {
        const l = limb(0.17, 0.44, 0.17, 0x4a4640, dx, 0.44, dz);
        legs.push(l); g.add(l);
      }
      const eyeL = boxMesh(0.07, 0.08, 0.04, 0x14100c, -0.12, 0.86, -0.89);
      const eyeR = boxMesh(0.07, 0.08, 0.04, 0x14100c, 0.12, 0.86, -0.89);
      const tail = boxMesh(0.16, 0.20, 0.12, 0xf2f5f8, 0, 0.80, 0.52);
      g.add(wool, wool2, woolR, head, snout, hornL, hornR, earL, earR, eyeL, eyeR, tail);
      g.userData.legs = legs;
      g.userData.head = head;
      g.userData.headParts = [snout, hornL, hornR, earL, earR, eyeL, eyeR];
      g.userData.wool = [wool, wool2, woolR];
      g.userData.tail = tail;
      return g;
    },
  },
  tusker: {
    friendly: true, hp: 18, speed: 1.7, w: 0.9, h: 1.15, view: 10, defensive: true, dmg: 3,
    drops: [['raw_meat', 2, 3], ['hide', 1, 2], ['bone', 0, 1]], xp: 3,
    biomes: [BIOME.FOREST, BIOME.PINE_HILLS, BIOME.EMBERWOOD, BIOME.MARSH],
    build: () => {
      const g = new THREE.Group();
      const body = boxMesh(0.84, 0.68, 1.16, 0x6b5340, 0, 0.76, 0);
      const back = boxMesh(0.68, 0.22, 0.92, 0x54402f, 0, 1.12, 0.05);
      const mane = boxMesh(0.72, 0.26, 0.28, 0x46341f, 0, 1.10, -0.42);
      const head = boxMesh(0.54, 0.52, 0.50, 0x7a6049, 0, 0.76, -0.80);
      const snout = boxMesh(0.32, 0.26, 0.22, 0x8f7256, 0, 0.65, -1.08);
      const nostril = boxMesh(0.20, 0.06, 0.05, 0x5c4735, 0, 0.68, -1.19);
      const tuskL = boxMesh(0.08, 0.09, 0.32, 0xe8e0cc, -0.17, 0.60, -1.14);
      const tuskR = boxMesh(0.08, 0.09, 0.32, 0xe8e0cc, 0.17, 0.60, -1.14);
      const earL = boxMesh(0.10, 0.18, 0.12, 0x5e4936, -0.29, 0.96, -0.74);
      const earR = boxMesh(0.10, 0.18, 0.12, 0x5e4936, 0.29, 0.96, -0.74);
      const legs = [];
      for (const [dx, dz] of [[-0.30, -0.40], [0.30, -0.40], [-0.30, 0.42], [0.30, 0.42]]) {
        const l = limb(0.23, 0.44, 0.23, 0x4a3826, dx, 0.44, dz);
        legs.push(l); g.add(l);
      }
      const eyeL = boxMesh(0.07, 0.08, 0.04, 0x1a1410, -0.17, 0.86, -1.04);
      const eyeR = boxMesh(0.07, 0.08, 0.04, 0x1a1410, 0.17, 0.86, -1.04);
      const tail = limb(0.08, 0.28, 0.08, 0x54402f, 0, 0.92, 0.60);
      g.add(body, back, mane, head, snout, nostril, tuskL, tuskR, earL, earR, eyeL, eyeR, tail);
      g.userData.legs = legs;
      g.userData.head = head;
      g.userData.headParts = [snout, nostril, tuskL, tuskR, earL, earR, eyeL, eyeR];
      g.userData.tail = tail;
      return g;
    },
  },
  plume: {
    friendly: true, hp: 5, speed: 2.0, w: 0.4, h: 0.5, view: 10, flyer: true,
    drops: [['feather', 1, 2], ['raw_fowl', 1, 1]], xp: 1,
    biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.MEADOW, BIOME.BEACH, BIOME.EMBERWOOD],
    build: () => {
      // Ground bird on the classic chicken silhouette; ~0.55 tall incl. crest.
      const g = new THREE.Group();
      const px = 1 / 16;
      const LEG = 2.6 * px, hipY = LEG;
      const body = 0xe8e2d2, light = 0xf2eee2, wingC = 0xd0c8b4, beakC = 0xe0a03c;

      const torso = boxMesh(4.4 * px, 4.4 * px, 6 * px, body, 0, hipY + 2.4 * px, 0);
      const breast = boxMesh(3.6 * px, 3.4 * px, 2.2 * px, light, 0, hipY + 3 * px, -2.8 * px);
      const head = boxMesh(3.2 * px, 3.2 * px, 3 * px, light, 0, hipY + 6.6 * px, -2.6 * px);
      const beak = boxMesh(1.4 * px, 1.1 * px, 1.8 * px, beakC, 0, hipY + 6.2 * px, -4.9 * px);
      const wattle = boxMesh(0.8 * px, 1.3 * px, 0.7 * px, 0xd8564a, 0, hipY + 5.1 * px, -4.2 * px);
      const crest = boxMesh(0.9 * px, 1.8 * px, 1.6 * px, 0xd8564a, 0, hipY + 8.8 * px, -2.4 * px);
      const wingL = wing(1 * px, 3.4 * px, 4.6 * px, wingC, -2.4 * px, hipY + 3 * px, 0, -1);
      const wingR = wing(1 * px, 3.4 * px, 4.6 * px, wingC, 2.4 * px, hipY + 3 * px, 0, 1);
      const tail = boxMesh(3 * px, 2 * px, 2.6 * px, wingC, 0, hipY + 3.4 * px, 4 * px);
      const tailTip = boxMesh(2.2 * px, 1.4 * px, 1.6 * px, 0xb0a894, 0, hipY + 4.4 * px, 5.2 * px);
      const legL = limb(0.8 * px, LEG, 0.8 * px, beakC, -1.2 * px, hipY, 0.4 * px);
      const legR = limb(0.8 * px, LEG, 0.8 * px, beakC, 1.2 * px, hipY, 0.4 * px);
      const footL = boxMesh(1.4 * px, 0.5 * px, 2 * px, 0xd0902c, -1.2 * px, 0.25 * px, -0.4 * px);
      const footR = boxMesh(1.4 * px, 0.5 * px, 2 * px, 0xd0902c, 1.2 * px, 0.25 * px, -0.4 * px);
      const eyeL = boxMesh(0.6 * px, 0.8 * px, 0.4 * px, 0x1a1410, -1.4 * px, hipY + 6.9 * px, -4 * px);
      const eyeR = boxMesh(0.6 * px, 0.8 * px, 0.4 * px, 0x1a1410, 1.4 * px, hipY + 6.9 * px, -4 * px);

      g.add(torso, breast, head, beak, wattle, crest, wingL, wingR, tail, tailTip,
        legL, legR, footL, footR, eyeL, eyeR);
      g.userData.wings = [wingL, wingR];
      g.userData.legs = [legL, legR];
      g.userData.feet = [footL, footR];
      g.userData.head = head;
      g.userData.headParts = [beak, wattle, crest, eyeL, eyeR];
      return g;
    },
  },
  husk: {
    friendly: false, hp: 20, speed: 2.2, w: 0.6, h: 1.8, view: 22, dmg: 4, burns: true,
    drops: [['bone', 1, 2], ['hide', 0, 1]], xp: 4,
    build: () => {
      // Proportions follow the classic humanoid mob: 8x8x8 head, 8x12x4 torso,
      // 4x12x4 limbs, on a 1.8-block frame (1px = 1/16 block).
      const g = new THREE.Group();
      const px = 1 / 16;
      const LEG = 11 * px, TORSO = 11 * px, HEAD = 8 * px;
      const hipY = LEG;                      // 0.6875
      const shoulderY = hipY + TORSO;        // 1.375
      const skull = 0xa8b58c, flesh = 0x6f8257, cloth = 0x4a5b3d;

      const torso = boxMesh(8 * px, TORSO, 4 * px, cloth, 0, hipY + TORSO / 2, 0);
      const collar = boxMesh(8.4 * px, 2 * px, 4.4 * px, 0x3f4d34, 0, shoulderY - px, 0);
      const head = boxMesh(HEAD, HEAD, HEAD, skull, 0, shoulderY + HEAD / 2, 0);
      const brow = boxMesh(8.2 * px, 1.5 * px, 1 * px, 0x54633f, 0, shoulderY + 5.6 * px, -4 * px);
      const jaw = boxMesh(5 * px, 1.6 * px, 1 * px, 0x3a4630, 0, shoulderY + 1.7 * px, -4 * px);

      // arms hang from the shoulder; the AI swings them forward when chasing
      const armL = limb(4 * px, TORSO, 4 * px, flesh, -6 * px, shoulderY, 0);
      const armR = limb(4 * px, TORSO, 4 * px, flesh, 6 * px, shoulderY, 0);
      const legL = limb(4 * px, LEG, 4 * px, 0x3e4a34, -2 * px, hipY, 0);
      const legR = limb(4 * px, LEG, 4 * px, 0x3e4a34, 2 * px, hipY, 0);

      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd24a });
      const eyeL = new THREE.Mesh(new THREE.BoxGeometry(2 * px, 2 * px, px), eyeMat);
      eyeL.position.set(-2 * px, shoulderY + 4.5 * px, -4.1 * px);
      const eyeR = eyeL.clone(); eyeR.position.x = 2 * px;

      const tatterA = boxMesh(2 * px, 3 * px, 1 * px, 0x3f4d34, -3 * px, hipY + 2 * px, -2.2 * px);
      const tatterB = boxMesh(2 * px, 2 * px, 1 * px, 0x3f4d34, 3 * px, hipY + 4 * px, 2.2 * px);

      g.add(torso, collar, head, brow, jaw, armL, armR, legL, legR, eyeL, eyeR, tatterA, tatterB);
      g.userData.legs = [legL, legR];
      g.userData.arms = [armL, armR];
      g.userData.head = head;
      g.userData.headParts = [brow, jaw, eyeL, eyeR];
      g.userData.glow = [eyeL, eyeR];
      g.userData.biped = true;
      return g;
    },
  },
  creeplet: {
    friendly: false, hp: 14, speed: 3.3, w: 0.7, h: 0.62, view: 18, dmg: 3, lunges: true, burns: true,
    drops: [['string', 1, 2], ['ember_dust', 0, 1]], xp: 4,
    build: () => {
      // Low, wide ambusher. Body sits on six legs; total height stays under
      // the 0.62 hitbox so it can slip through 1-block gaps.
      const g = new THREE.Group();
      const px = 1 / 16;
      const LEG = 3.5 * px, bodyY = LEG + 2.5 * px;
      const dark = 0x2f2640, shell = 0x54406b, trim = 0x6b5287;

      const abdomen = boxMesh(9 * px, 5 * px, 10 * px, 0x3b2f4a, 0, bodyY, 1.5 * px);
      const carapace = boxMesh(7.5 * px, 2.5 * px, 8 * px, shell, 0, bodyY + 3 * px, 1.5 * px);
      const ridge = boxMesh(2 * px, 1.5 * px, 7 * px, trim, 0, bodyY + 4.4 * px, 1.5 * px);
      const thorax = boxMesh(7 * px, 4.5 * px, 3 * px, 0x352b45, 0, bodyY, -5 * px);
      const head = boxMesh(5.5 * px, 4 * px, 4 * px, dark, 0, bodyY, -8 * px);
      const mandL = boxMesh(1.2 * px, 1.2 * px, 2 * px, 0x241d30, -1.6 * px, bodyY - 1.4 * px, -10.5 * px);
      const mandR = boxMesh(1.2 * px, 1.2 * px, 2 * px, 0x241d30, 1.6 * px, bodyY - 1.4 * px, -10.5 * px);

      const legs = [];
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const l = limb(1.4 * px, LEG, 1.4 * px, 0x241d30, side * 4.5 * px, bodyY - px, (-3 + i * 3.5) * px);
          // splay outward so the body is carried on a visible stance
          l.rotation.z = side * 0.55;
          l.userData.baseZ = side * 0.55;
          legs.push(l); g.add(l);
        }
      }
      const eyes = [];
      const em = new THREE.MeshBasicMaterial({ color: 0xff5c4a });
      for (const dx of [-1.5, 1.5]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(1.4 * px, 1.4 * px, px), em);
        e.position.set(dx * px, bodyY + 0.8 * px, -10 * px);
        eyes.push(e); g.add(e);
      }
      g.add(abdomen, carapace, ridge, thorax, head, mandL, mandR);
      g.userData.legs = legs;
      g.userData.head = head;
      g.userData.headParts = [mandL, mandR, ...eyes];
      g.userData.eyes = eyes;
      g.userData.glow = eyes;
      g.userData.spider = true;
      return g;
    },
  },
  shardling: {
    friendly: false, hp: 16, speed: 1.9, w: 0.6, h: 1.2, view: 16, dmg: 3, ranged: true, cave: true,
    drops: [['glimmer_shard', 1, 1], ['rubble', 1, 2]], xp: 6,
    build: () => {
      // Stocky crystal golem: short legs, heavy torso, geode crown.
      const g = new THREE.Group();
      const px = 1 / 16;
      const LEG = 6 * px, TORSO = 8 * px, HEAD = 5 * px;
      const hipY = LEG, shoulderY = hipY + TORSO;
      const stone = 0x4a4258, light = 0x574d68, dark = 0x3b3446;

      const torso = boxMesh(7 * px, TORSO, 6 * px, stone, 0, hipY + TORSO / 2, 0);
      const plate = boxMesh(7.6 * px, 2.5 * px, 6.6 * px, light, 0, shoulderY - 1.6 * px, 0);
      const head = boxMesh(HEAD, HEAD, HEAD, light, 0, shoulderY + HEAD / 2, 0);
      const crown = boxMesh(4.6 * px, 1.2 * px, 4.6 * px, dark, 0, shoulderY + HEAD + 0.4 * px, 0);

      const crystalMat = new THREE.MeshBasicMaterial({ color: 0xc77bf5 });
      const shards = [];
      const layout = [
        [-4.4, 12.0, 1.6, 2.4, 0.45, 0.30],
        [4.6, 11.0, -0.8, 3.0, -0.35, -0.22],
        [0, 18.5, 0.3, 3.2, 0.10, 0],
        [-3.2, 7.5, -3.0, 2.1, 0.30, 0.55],
        [3.0, 8.0, 3.6, 2.4, -0.28, -0.45],
      ];
      for (const [dx, dy, dz, sc, rx, rz] of layout) {
        const c = new THREE.Mesh(
          new THREE.BoxGeometry(sc * px, sc * 1.7 * px, sc * px), crystalMat);
        c.position.set(dx * px, dy * px, dz * px);
        c.rotation.set(rx, rx * 0.7, rz);
        c.userData.base = c.position.clone();
        shards.push(c); g.add(c);
      }

      const armL = limb(2.6 * px, TORSO - px, 2.6 * px, dark, -5 * px, shoulderY - 0.5 * px, 0);
      const armR = limb(2.6 * px, TORSO - px, 2.6 * px, dark, 5 * px, shoulderY - 0.5 * px, 0);
      const legL = limb(3 * px, LEG, 3.4 * px, dark, -2 * px, hipY, 0);
      const legR = limb(3 * px, LEG, 3.4 * px, dark, 2 * px, hipY, 0);

      const eye = new THREE.Mesh(new THREE.BoxGeometry(3.4 * px, 1.2 * px, px),
        new THREE.MeshBasicMaterial({ color: 0xe8b8ff }));
      eye.position.set(0, shoulderY + 2.8 * px, -2.6 * px);

      g.add(torso, plate, head, crown, armL, armR, legL, legR, eye);
      g.userData.legs = [legL, legR];
      g.userData.arms = [armL, armR];
      g.userData.shards = shards;
      g.userData.head = head;
      g.userData.headParts = [crown, eye];
      g.userData.glow = [eye];
      g.userData.biped = true;
      return g;
    },
  },
  gloom: {
    friendly: false, hp: 24, speed: 1.6, w: 0.8, h: 0.9, view: 14, dmg: 5, floater: true, cave: true, deep: true,
    drops: [['ember_dust', 1, 2], ['glimmer_shard', 0, 1]], xp: 8,
    build: () => {
      // Floating wraith. Tendrils hang from the underside but stay above the
      // model origin so the mob never intersects the floor it hovers over.
      const g = new THREE.Group();
      const px = 1 / 16;
      const BODY = 8 * px, bodyY = 8 * px;   // hull centre, keeps base at y=4/16

      const core = boxMesh(BODY, BODY, BODY, 0x1e1a26, 0, bodyY, 0);
      const cap = boxMesh(9.5 * px, 2 * px, 9.5 * px, 0x2b2438, 0, bodyY + 4.6 * px, 0);
      const shroud = new THREE.Mesh(new THREE.BoxGeometry(11 * px, 9.5 * px, 11 * px),
        new THREE.MeshLambertMaterial({ color: 0x2b2438, transparent: true, opacity: 0.5 }));
      shroud.position.y = bodyY;
      const halo = new THREE.Mesh(new THREE.BoxGeometry(13 * px, 0.8 * px, 13 * px),
        new THREE.MeshBasicMaterial({ color: 0x4a3a6b, transparent: true, opacity: 0.42 }));
      halo.position.y = bodyY + 6.2 * px;

      const tendrils = [];
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, -4.4], [0, 4.4]]) {
        // hinge just under the hull; length keeps the tip at ~y=0
        const t = limb(1.3 * px, 3.6 * px, 1.3 * px, 0x181322, dx * px, bodyY - 3.8 * px, dz * px);
        t.userData.phase = Math.abs(dx * 0.7 + dz * 1.1);
        tendrils.push(t); g.add(t);
      }
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x8ad8ff });
      const eyes = [];
      for (const dx of [-2, 2]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(1.6 * px, 1.6 * px, px), eyeMat);
        e.position.set(dx * px, bodyY + 1.2 * px, -4.2 * px);
        eyes.push(e); g.add(e);
      }
      g.add(core, cap, shroud, halo);
      g.userData.tendrils = tendrils;
      g.userData.eyes = eyes;
      g.userData.halo = halo;
      g.userData.shroud = shroud;
      g.userData.glow = eyes;
      return g;
    },
  },
};

let nextId = 1;

export class Entity {
  constructor(kind, x, y, z) {
    this.id = nextId++;
    this.kind = kind;
    this.def = SPECIES[kind];
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.onGround = false;
    this.state = 'idle';
    this.stateT = 0;
    this.target = null;
    this.wanderDir = Math.random() * Math.PI * 2;
    this.mesh = null;
    this.animT = Math.random() * 10;
    this.animSeed = Math.random() * 6.283;
    this.flapping = false;
    this._gait = Math.random() * 6.283;
    this._amp = 0;
    this.hurtT = 0;
    this.attackCd = 0;
    this.jumpCd = 0;
    this.dead = false;
    this.despawnT = 0;
    this.sheared = false;
    this.soundCd = Math.random() * 8;
    this.fuse = 0;
    this.inWater = false;
  }

  get w() { return this.def.w; }
  get h() { return this.def.h; }

  buildMesh() {
    this.mesh = this.def.build();
    this.mesh.position.copy(this.pos);
    return this.mesh;
  }

  blocked(world, x, y, z) {
    const hw = this.w / 2;
    const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw);
    const y0 = Math.floor(y + 0.02), y1 = Math.floor(y + this.h - 0.02);
    const z0 = Math.floor(z - hw), z1 = Math.floor(z + hw);
    for (let by = y0; by <= y1; by++)
      for (let bz = z0; bz <= z1; bz++)
        for (let bx = x0; bx <= x1; bx++) {
          const id = world.getBlock(bx, by, bz);
          if (id === -1) return true;
          if (id > 0 && isSolid(id)) return true;
        }
    return false;
  }

  update(dt, world, player, ctx) {
    if (this.dead) return;
    this.animT += dt;
    this.stateT += dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.jumpCd > 0) this.jumpCd -= dt;
    this.soundCd -= dt;

    const d = this.def;
    const toPlayer = TMP.set(player.pos.x - this.pos.x, player.pos.y - this.pos.y, player.pos.z - this.pos.z);
    const distSq = toPlayer.lengthSq();
    const dist = Math.sqrt(distSq);

    this.inWater = world.getBlock(this.pos.x, this.pos.y + 0.2, this.pos.z) === B.WATER;

    // ---- AI
    if (!d.friendly) this._hostileAI(dt, world, player, dist, toPlayer, ctx);
    else this._friendlyAI(dt, world, player, dist, toPlayer, ctx);

    // ---- physics
    if (d.floater) {
      // hover toward a target altitude
      const groundY = this._groundBelow(world);
      const want = groundY + 1.6;
      this.vel.y += (want - this.pos.y) * 1.6 * dt;
      this.vel.y *= 0.92;
      this.vel.y += Math.sin(this.animT * 1.7) * 0.1 * dt;
    } else if (d.flyer) {
      // Fowl do not truly fly: they fall slowly, flapping to break the descent.
      // Gravity always applies, so they can never accumulate altitude - they
      // only ever hop up and glide back down.
      this.vel.y -= 20 * dt;
      const flapping = this.vel.y < -1.4;
      if (flapping) this.vel.y = -1.4;              // terminal glide speed
      this.flapping = flapping && !this.onGround;
      if (this.vel.y < -8) this.vel.y = -8;
    } else {
      if (this.inWater) { this.vel.y += 14 * dt; this.vel.y = Math.min(this.vel.y, 2.2); this.vel.y -= 22 * dt; }
      else this.vel.y -= 26 * dt;
      if (this.vel.y < -46) this.vel.y = -46;
    }

    const damp = this.onGround ? 8.5 : 3.0;
    this.vel.x -= this.vel.x * Math.min(1, damp * dt);
    this.vel.z -= this.vel.z * Math.min(1, damp * dt);

    this._move(dt, world);

    // ------------------------------------------------------- daylight burn
    // Undead burn in direct sunlight. The old check only tested ONE block
    // overhead, so any overhang, leaf or cloud of terrain spared them; now we
    // scan the whole column to the sky and only shelter under a real roof.
    if (d.burns && ctx.daylight > 0.55) {
      this.burnCheckT = (this.burnCheckT || 0) - dt;
      if (this.burnCheckT <= 0) {
        this.burnCheckT = 0.5;
        this.skyLit = world.hasSkyAccess
          ? world.hasSkyAccess(this.pos.x, this.pos.y + this.h * 0.5, this.pos.z)
          : false;
      }
      if (this.skyLit && !this.inWater) {
        this.burnT = (this.burnT || 0) + dt;
        // visible smoke/flame so the player can see why it is dying
        if (ctx.particles && Math.random() < dt * 14) {
          ctx.particles.spawn(
            this.pos.x + (Math.random() - 0.5) * this.w,
            this.pos.y + Math.random() * this.h,
            this.pos.z + (Math.random() - 0.5) * this.w,
            0, 1.1, 0,
            Math.random() < 0.5 ? 0xff9a3c : 0x552f18,
            0.07, 0.55, -0.25);
        }
        if (this.burnT > 0.9) {
          this.burnT = 0;
          this.hurt(3, null, ctx);
          if (ctx.audio && ctx.audio.fizz && Math.random() < 0.25) ctx.audio.fizz();
        }
      } else {
        this.burnT = 0;
      }
    }

    // lava / drown
    if (world.getBlock(this.pos.x, this.pos.y + 0.2, this.pos.z) === B.LAVA) {
      this.lavaT = (this.lavaT || 0) + dt;
      if (this.lavaT > 0.5) { this.lavaT = 0; this.hurt(4, null, ctx); }
    }
    if (this.pos.y < -4) this.hp = 0;
    if (this.hp <= 0) this.dead = true;

    // despawn when far
    if (dist > 84) { this.despawnT += dt; if (this.despawnT > 6) this.dead = true, this.despawned = true; }
    else this.despawnT = 0;

    // ambient voice
    if (this.soundCd <= 0 && dist < 22) {
      this.soundCd = 7 + Math.random() * 14;
      if (Math.random() < 0.5) ctx.audio.crit(this.kind);
    }

    this._animate(dt);
  }

  _groundBelow(world) {
    for (let y = Math.floor(this.pos.y); y > 0; y--) {
      const id = world.getBlock(this.pos.x, y, this.pos.z);
      if (id > 0 && isSolid(id)) return y + 1;
    }
    return 1;
  }

  _friendlyAI(dt, world, player, dist, toPlayer, ctx) {
    const d = this.def;
    // flee if recently hurt
    if (this.hurtT > 0 && this.fleeT === undefined) this.fleeT = 3.2;
    if (this.fleeT > 0) {
      this.fleeT -= dt;
      // face the way we are fleeing: yaw convention here is
      // forward = (-sin yaw, -cos yaw), so away-from-player is atan2(+x,+z)
      this.yaw = Math.atan2(toPlayer.x, toPlayer.z);
      const sp = d.speed * 1.7;
      this.vel.x += -toPlayer.x / (dist || 1) * sp * dt * 8;
      this.vel.z += -toPlayer.z / (dist || 1) * sp * dt * 8;
      this._maybeJump(world);
      if (this.fleeT <= 0) this.fleeT = undefined;
      return;
    }
    // defensive species retaliate
    if (d.defensive && this.aggro && dist < 14) {
      this._chase(dt, world, player, dist, toPlayer, ctx);
      return;
    }

    if (d.flyer) {
      // Ground bird: walks, pecks, and gives a short startled hop. It never
      // sets an altitude target, which is what used to let it climb the sky.
      if (this.state === 'idle') {
        if (this.stateT > 1.6 + Math.random() * 2.6) {
          this.state = Math.random() < 0.62 ? 'walk' : 'graze';
          this.stateT = 0;
          this.wanderDir = Math.random() * Math.PI * 2;
        }
      } else if (this.state === 'walk') {
        if (this.stateT > 1.8 + Math.random() * 2.4) { this.state = 'idle'; this.stateT = 0; }
        const sp = d.speed;
        this.vel.x += Math.cos(this.wanderDir) * sp * dt * 6;
        this.vel.z += Math.sin(this.wanderDir) * sp * dt * 6;
        this.yaw = -Math.atan2(Math.sin(this.wanderDir), Math.cos(this.wanderDir)) - Math.PI / 2;
        if (!this._groundAhead(world)) this.wanderDir += Math.PI * (0.6 + Math.random() * 0.8);
        // little hops over obstacles only
        this._maybeHop(world);
      } else if (this.state === 'graze') {
        if (this.stateT > 1.6 + Math.random() * 2.2) { this.state = 'idle'; this.stateT = 0; }
      }
      // startled: scurry away with one small flutter, no altitude gain
      if (dist < 3.5) {
        this.state = 'walk';
        this.wanderDir = Math.atan2(-toPlayer.z, -toPlayer.x);
        const sp = d.speed * 1.8;
        this.vel.x += -toPlayer.x / (dist || 1) * sp * dt * 7;
        this.vel.z += -toPlayer.z / (dist || 1) * sp * dt * 7;
        if (this.onGround && this.jumpCd <= 0 && Math.random() < 0.05) {
          this.vel.y = 4.2; this.jumpCd = 1.1; this.onGround = false;
        }
      }
      return;
    }

    // wander / graze
    if (this.state === 'idle') {
      if (this.stateT > 2 + Math.random() * 4) {
        this.state = Math.random() < 0.6 ? 'walk' : 'graze';
        this.stateT = 0;
        this.wanderDir = Math.random() * Math.PI * 2;
      }
    } else if (this.state === 'walk') {
      if (this.stateT > 2 + Math.random() * 3) { this.state = 'idle'; this.stateT = 0; }
      const sp = d.speed;
      this.vel.x += Math.cos(this.wanderDir) * sp * dt * 6;
      this.vel.z += Math.sin(this.wanderDir) * sp * dt * 6;
      this.yaw = -Math.atan2(Math.sin(this.wanderDir), Math.cos(this.wanderDir)) - Math.PI / 2;
      this._maybeJump(world);
      // avoid walking off cliffs / into water
      const ahead = this._groundAhead(world);
      if (!ahead) { this.wanderDir += Math.PI * (0.6 + Math.random() * 0.8); }
    } else if (this.state === 'graze') {
      if (this.stateT > 2 + Math.random() * 3) { this.state = 'idle'; this.stateT = 0; }
    }
  }

  _groundAhead(world) {
    const dx = Math.cos(this.wanderDir), dz = Math.sin(this.wanderDir);
    const nx = this.pos.x + dx * 1.1, nz = this.pos.z + dz * 1.1;
    for (let dy = -3; dy <= 1; dy++) {
      const id = world.getBlock(nx, this.pos.y + dy, nz);
      if (id === -1) return false;
      if (id > 0 && isSolid(id)) return dy <= 1;
      if (id === B.WATER || id === B.LAVA) return false;
    }
    return false;
  }

  _hostileAI(dt, world, player, dist, toPlayer, ctx) {
    const d = this.def;
    const canSee = dist < d.view && !player.creative && !player.dead;
    if (canSee) {
      this.target = player;
      this._chase(dt, world, player, dist, toPlayer, ctx);
    } else {
      this.target = null;
      if (this.state !== 'walk') { this.state = 'walk'; this.wanderDir = Math.random() * Math.PI * 2; this.stateT = 0; }
      if (this.stateT > 3) { this.wanderDir += (Math.random() - 0.5) * 2; this.stateT = 0; }
      const sp = d.speed * 0.5;
      this.vel.x += Math.cos(this.wanderDir) * sp * dt * 5;
      this.vel.z += Math.sin(this.wanderDir) * sp * dt * 5;
      this.yaw = -Math.atan2(Math.sin(this.wanderDir), Math.cos(this.wanderDir)) - Math.PI / 2;
      this._maybeJump(world);
    }
  }

  _chase(dt, world, player, dist, toPlayer, ctx) {
    const d = this.def;
    this.state = 'chase';
    const nx = toPlayer.x / (dist || 1), nz = toPlayer.z / (dist || 1);
    this.yaw = Math.atan2(nx, nz) + Math.PI;

    if (d.ranged && dist > 4 && dist < d.view) {
      // keep distance and fire shards
      if (dist < 7) { this.vel.x -= nx * d.speed * dt * 4; this.vel.z -= nz * d.speed * dt * 4; }
      else { this.vel.x += nx * d.speed * dt * 4; this.vel.z += nz * d.speed * dt * 4; }
      if (this.attackCd <= 0) {
        this.attackCd = 2.2;
        ctx.spawnProjectile(this.pos.x, this.pos.y + this.h * 0.7, this.pos.z,
          player.pos.x, player.pos.y + 1.0, player.pos.z, d.dmg);
        ctx.audio.crit('shardling');
      }
      return;
    }

    let sp = d.speed;
    if (d.lunges && dist < 6 && this.attackCd <= 0 && this.onGround) {
      this.vel.x = nx * 8.5; this.vel.z = nz * 8.5; this.vel.y = 5.4;
      this.attackCd = 2.4;
      this.lunging = 0.6;
      ctx.audio.crit('creeplet');
    } else {
      this.vel.x += nx * sp * dt * 7;
      this.vel.z += nz * sp * dt * 7;
    }
    if (this.lunging > 0) this.lunging -= dt;

    this._maybeJump(world);

    // melee
    const reach = 1.1 + this.w * 0.5;
    if (dist < reach && Math.abs(toPlayer.y) < this.h + 0.8) {
      if (this.attackCd <= 0 || (this.lunging > 0 && this.attackCd < 2.0)) {
        if (this.meleeCd === undefined || this.meleeCd <= 0) {
          player.damage(d.dmg, 'mob');
          this.meleeCd = 0.9;
          ctx.audio.hitEntity();
          // knockback
          player.vel.x += nx * 5.4; player.vel.z += nz * 5.4; player.vel.y += 3.2;
        }
      }
    }
    if (this.meleeCd > 0) this.meleeCd -= dt;
  }

  /**
   * Forward direction for obstacle probing.
   *
   * Deriving this from `yaw` was fragile: every AI branch sets yaw with its own
   * convention and one of them (flee) had the sign inverted, so mobs probed
   * *behind* themselves and never jumped. Actual horizontal velocity is what
   * the mob is really doing, so use that and fall back to yaw when standing
   * still.
   */
  _forward() {
    const vx = this.vel.x, vz = this.vel.z;
    const l = Math.hypot(vx, vz);
    if (l > 0.12) return [vx / l, vz / l];
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }

  /**
   * Launch speed needed to clear `blocks` height under gravity `g`.
   * Computing this instead of hard-coding magic numbers is what fixes the
   * chicken: its old 5.2 only reached 0.68 blocks, so a 1-block step was
   * physically impossible and it wedged itself against every ledge.
   */
  _jumpSpeedFor(blocks, g) { return Math.sqrt(2 * g * blocks); }

  /**
   * Shared 1-block step-up. Returns true if a jump was started.
   *
   * `apex` is generous (1.3 blocks) so the mob clears a full cube with margin
   * to spare - a ballistic apex of exactly 1.0 loses to discrete timesteps and
   * leaves mobs scrabbling at the wall.
   */
  _stepUp(world, apex, gravity) {
    if (!this.onGround || this.jumpCd > 0) return false;
    const [dx, dz] = this._forward();
    // probe just beyond the collision box, and again a bit further out, so a
    // mob approaching at an angle still registers the wall
    for (const reach of [this.w * 0.5 + 0.25, this.w * 0.5 + 0.55]) {
      const fx = this.pos.x + dx * reach;
      const fz = this.pos.z + dz * reach;
      const atFeet = world.getBlock(fx, this.pos.y + 0.15, fz);
      if (!(atFeet > 0 && isSolid(atFeet))) continue;
      // the step must be exactly one block: head-height must be clear both
      // where we are and where we are going, or this is a wall, not a stair
      const stepTop = world.getBlock(fx, this.pos.y + 1.15, fz);
      if (stepTop > 0 && isSolid(stepTop)) continue;        // 2+ high: no climb
      let headroom = true;
      for (let hy = 1.15; hy < this.h + 1.05; hy += 0.5) {
        const above = world.getBlock(fx, this.pos.y + hy, fz);
        if (above > 0 && isSolid(above)) { headroom = false; break; }
        const selfAbove = world.getBlock(this.pos.x, this.pos.y + hy, this.pos.z);
        if (selfAbove > 0 && isSolid(selfAbove)) { headroom = false; break; }
      }
      if (!headroom) continue;
      this.vel.y = this._jumpSpeedFor(apex, gravity);
      // nudge forward so we actually travel onto the ledge instead of
      // hopping straight up against its face
      this.vel.x += dx * 1.5;
      this.vel.z += dz * 1.5;
      this.jumpCd = 0.45;
      this.onGround = false;
      return true;
    }
    return false;
  }

  /** small obstacle hop for ground birds (never a sustained climb) */
  _maybeHop(world) {
    // Ground birds fall under g=20 (see the flyer branch in update()).
    const jumped = this._stepUp(world, 1.3, 20);
    if (!jumped && this.inWater && this.onGround !== undefined) {
      this.vel.y = Math.max(this.vel.y, 2.6);
    }
    return jumped;
  }

  _maybeJump(world) {
    if (this.def.floater || this.def.flyer) return false;
    const jumped = this._stepUp(world, 1.3, 26);   // ground gravity is 26
    if (this.inWater) this.vel.y = Math.max(this.vel.y, 3.0);
    return jumped;
  }

  _move(dt, world) {
    for (const axis of ['x', 'y', 'z']) {
      let d = this.vel[axis] * dt;
      if (d === 0) continue;
      d = Math.max(-0.5, Math.min(0.5, d));
      const old = this.pos[axis];
      this.pos[axis] += d;
      if (this.blocked(world, this.pos.x, this.pos.y, this.pos.z)) {
        this.pos[axis] = old;
        if (axis === 'y') {
          if (this.vel.y < 0) this.onGround = true;
          this.vel.y = 0;
        } else this.vel[axis] = 0;
      } else if (axis === 'y') {
        this.onGround = false;
      }
    }
    if (!this.def.floater) {
      const probeY = this.pos.y - 0.08;
      if (this.blocked(world, this.pos.x, probeY, this.pos.z) && this.vel.y <= 0) this.onGround = true;
    }
  }

  hurt(amount, from, ctx) {
    if (this.dead) return;
    this.hp -= amount;
    this.hurtT = 0.28;
    this.aggro = true;
    if (from) {
      const dx = this.pos.x - from.x, dz = this.pos.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      this.vel.x += dx / l * 6.5;
      this.vel.z += dz / l * 6.5;
      this.vel.y += 3.6;
    }
    if (ctx) ctx.audio.hitEntity();
    if (this.hp <= 0) this.dead = true;
  }

  _animate(dt) {
    if (!this.mesh) return;
    const ud = this.mesh.userData;
    const t = this.animT;

    // ---- gait driven by ACTUAL speed, so walk/run blend smoothly ----
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const moving = speed > 0.25;
    // stride frequency scales with speed; amplitude eases in/out
    const strideF = 4.2 + Math.min(speed, 6) * 1.9;
    this._gait = (this._gait || 0) + dt * strideF;
    const target = moving ? Math.min(1, speed / 3.2) : 0;
    this._amp = (this._amp === undefined) ? 0 : this._amp + (target - this._amp) * Math.min(1, dt * 9);
    const amp = this._amp;
    const sw = Math.sin(this._gait);

    // subtle idle breathing so nothing is ever perfectly frozen
    const breathe = Math.sin(t * 1.7) * 0.02 * (1 - amp);

    if (ud.legs) {
      const n = ud.legs.length;
      ud.legs.forEach((l, i) => {
        let phase;
        if (ud.spider) {
          // 6-leg alternating tripod scuttle
          phase = Math.sin(this._gait * 1.5 + i * 2.1);
          l.rotation.z = (l.userData.baseZ || 0) + phase * 0.30 * amp;
          l.rotation.x = Math.cos(this._gait * 1.5 + i * 2.1) * 0.22 * amp;
          return;
        }
        // diagonal pairing for quadrupeds, alternating for bipeds
        phase = (n >= 4)
          ? ((i === 0 || i === 3) ? sw : -sw)
          : ((i % 2 === 0) ? sw : -sw);
        l.rotation.x = phase * 0.42 * amp + breathe;
        l.rotation.z = 0;
      });
    }

    if (ud.wings) {
      // flap hard while airborne (this.flapping), light ruffle on the ground
      const flapping = this.flapping || !this.onGround;
      const f = flapping
        ? Math.sin(t * 26) * 1.15
        : Math.sin(t * 2.6) * 0.10;
      ud.wings[0].rotation.z = f;
      ud.wings[1].rotation.z = -f;
      // wings also sweep forward slightly on the downbeat
      const sweep = flapping ? Math.cos(t * 26) * 0.22 : 0;
      ud.wings[0].rotation.x = sweep;
      ud.wings[1].rotation.x = sweep;
    }

    if (ud.arms) {
      // NOTE ON SIGNS: a limb pivot hangs downward (-Y), so a POSITIVE
      // rotation.x carries its far end toward -Z, i.e. in front of the mob.
      // Reaching/chasing therefore needs a positive angle.
      if (this.state === 'chase') {
        // classic outstretched lunge, arms level and slightly parted
        const reach = 1.42 + Math.sin(t * 5) * 0.10;
        ud.arms[0].rotation.x = reach;
        ud.arms[1].rotation.x = reach;
        ud.arms[0].rotation.z = 0.09;
        ud.arms[1].rotation.z = -0.09;
      } else {
        // arms counter-swing against the legs while walking
        ud.arms[0].rotation.x = -sw * 0.34 * amp + breathe;
        ud.arms[1].rotation.x = sw * 0.34 * amp + breathe;
        ud.arms[0].rotation.z = 0.05;
        ud.arms[1].rotation.z = -0.05;
      }
    }

    if (ud.head) {
      if (this.state === 'graze') {
        // ease the head down to the grass instead of snapping
        ud.head.rotation.x += (-0.86 - ud.head.rotation.x) * Math.min(1, dt * 5);
      } else {
        const bob = Math.sin(t * 1.4) * 0.05 + (moving ? Math.sin(this._gait * 2) * 0.04 : 0);
        ud.head.rotation.x += (bob - ud.head.rotation.x) * Math.min(1, dt * 6);
        // occasional idle head turn to look around
        ud.head.rotation.y = Math.sin(t * 0.6 + this.animSeed) * (moving ? 0.05 : 0.28);
      }
      // head accessories follow the skull
      if (ud.headParts) {
        for (const hp of ud.headParts) {
          if (!hp.userData.hb) {
            hp.userData.hb = { p: hp.position.clone(), hy: ud.head.position.y, hz: ud.head.position.z };
          }
          const b = hp.userData.hb;
          const dy = b.p.y - b.hy, dz = b.p.z - b.hz;
          const cx = Math.cos(ud.head.rotation.x), sx = Math.sin(ud.head.rotation.x);
          const ry = dy * cx - dz * sx, rz = dy * sx + dz * cx;
          const dx = b.p.x;
          const cy = Math.cos(ud.head.rotation.y), sy = Math.sin(ud.head.rotation.y);
          hp.position.set(dx * cy + rz * sy, b.hy + ry, b.hz + (rz * cy - dx * sy));
          hp.rotation.x = ud.head.rotation.x;
          hp.rotation.y = ud.head.rotation.y;
        }
      }
    }

    // ear flicks (hopper) — random twitch, very readable at small size
    if (ud.ears) {
      this._earT = (this._earT || 0) - dt;
      if (this._earT <= 0) { this._earT = 1.5 + Math.random() * 3; this._earFlick = 0.5; }
      this._earFlick = Math.max(0, (this._earFlick || 0) - dt * 2.2);
      const fl = Math.sin(this._earFlick * 22) * this._earFlick * 0.6;
      ud.ears[0].rotation.z = -0.10 + fl;
      ud.ears[1].rotation.z = 0.10 - fl;
    }

    if (ud.tail) {
      if (ud.tail.isGroup) {
        ud.tail.rotation.x = Math.sin(t * 2.2) * 0.18 + amp * 0.2;
        ud.tail.rotation.z = Math.sin(t * 3.1) * 0.22;
      } else {
        ud.tail.rotation.z = Math.sin(t * 3.4) * 0.25 * (0.4 + amp);
      }
    }

    if (ud.wool) {
      // fleece jiggles a beat behind the body
      const j = Math.sin(this._gait - 0.9) * 0.012 * amp;
      ud.wool.forEach((w, i) => { w.position.y = (w.userData.by ??= w.position.y) + j * (1 + i * 0.4); });
    }

    if (ud.tendrils) {
      ud.tendrils.forEach((td, i) => {
        const ph = td.userData.phase || i;
        td.rotation.x = Math.sin(t * 2.2 + ph) * 0.42;
        td.rotation.z = Math.cos(t * 1.9 + ph) * 0.34;
      });
    }
    if (ud.halo) {
      ud.halo.rotation.y += dt * 0.7;
      ud.halo.position.y = 0.86 + Math.sin(t * 1.8) * 0.05;
    }
    if (ud.shroud) {
      const p = 1 + Math.sin(t * 1.6) * 0.035;
      ud.shroud.scale.set(p, 1 / p, p);
    }

    if (ud.shards) {
      ud.shards.forEach((sh, i) => {
        sh.rotation.y += dt * (0.6 + i * 0.18);
        if (sh.userData.base) {
          sh.position.y = sh.userData.base.y + Math.sin(t * 2.4 + i * 1.3) * 0.035;
        }
      });
    }

    if (ud.eyes) {
      // slow pulse, plus a quick blink-out every few seconds
      this._blink = (this._blink || 0) - dt;
      if (this._blink <= 0) this._blink = 2.5 + Math.random() * 3.5;
      const blinking = this._blink < 0.12;
      const pulse = blinking ? 0.15 : 0.78 + Math.sin(t * 4) * 0.22;
      ud.eyes.forEach(e => e.scale.set(1, pulse, 1));
    }

    this.mesh.position.copy(this.pos);
    // smooth the visual yaw so turns don't snap
    if (this._vyaw === undefined) this._vyaw = this.yaw;
    let dY = this.yaw - this._vyaw;
    while (dY > Math.PI) dY -= Math.PI * 2;
    while (dY < -Math.PI) dY += Math.PI * 2;
    this._vyaw += dY * Math.min(1, dt * 11);
    this.mesh.rotation.y = this._vyaw;

    // lean into a run / tilt when falling
    const lean = Math.min(0.16, speed * 0.03) * (this.state === 'chase' ? 1 : 0.5);
    this.mesh.rotation.x = lean + (this.onGround ? 0 : Math.max(-0.25, this.vel.y * 0.03));

    // hurt flash
    const flash = this.hurtT > 0;
    if (flash !== this._wasFlash) {
      this._wasFlash = flash;
      this.mesh.traverse(o => {
        if (o.isMesh && o.material && o.material.emissive !== undefined) {
          o.material.emissive.setHex(flash ? 0x992222 : 0x000000);
        }
      });
    }

    // hopper squash & stretch through its hop arc
    if (this.kind === 'hopper') {
      let sq = 1;
      if (!this.onGround) sq = 1 + Math.max(-0.10, Math.min(0.14, this.vel.y * 0.03));
      else if (this._airT > 0.15) { this._landT = 0.18; }
      this._airT = this.onGround ? 0 : (this._airT || 0) + dt;
      if (this._landT > 0) { this._landT -= dt; sq = 0.86; }
      this._sq = (this._sq || 1) + (sq - (this._sq || 1)) * Math.min(1, dt * 14);
      const inv = 1 / Math.sqrt(this._sq);
      this.mesh.scale.set(inv, this._sq, inv);
    }
  }

  rollDrops() {
    const out = [];
    for (const [id, min, max] of this.def.drops) {
      const n = min + Math.floor(Math.random() * (max - min + 1));
      if (n > 0) out.push([id, n]);
    }
    return out;
  }
}

// -------------------------------------------------------------- spawn logic
export function pickSpawnKind(biome, y, daylight, underground, deep) {
  const roll = Math.random();
  if (underground) {
    if (deep && roll < 0.34) return 'gloom';
    if (roll < 0.5) return 'shardling';
    if (roll < 0.78) return 'creeplet';
    return 'husk';
  }
  if (daylight < 0.3) {
    if (roll < 0.52) return 'husk';
    if (roll < 0.86) return 'creeplet';
    return 'shardling';
  }
  const friendly = [];
  for (const k in SPECIES) {
    const s = SPECIES[k];
    if (!s.friendly) continue;
    if (s.biomes && !s.biomes.includes(biome)) continue;
    friendly.push(k);
  }
  if (!friendly.length) return null;
  return friendly[(Math.random() * friendly.length) | 0];
}
