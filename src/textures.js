// VOXHAVEN - fully procedural pixel-art texture generation.
// Every tile & icon is drawn in code here. No external image assets.

import { mulberry32, hashString } from './noise.js';

export const TILE = 16;

// ------------------------------------------------------------------ palette
const P = {
  // earth
  soil: '#7a5638', soilD: '#5f4029', soilL: '#8f6845',
  dry: '#8a6b47', dryD: '#6d5236',
  turf: '#5fa83c', turfD: '#4a8a2d', turfL: '#7cc355', turfP: '#3d7326',
  sand: '#e3d09a', sandD: '#cbb47b', sandL: '#f2e3bb',
  rsand: '#bf7448', rsandD: '#a45f38',
  // rock
  stone: '#8d8f96', stoneD: '#74767d', stoneL: '#a3a5ac',
  deep: '#4a4c55', deepD: '#3a3c44', deepL: '#5c5e68',
  basalt: '#3b3740', basaltD: '#2c2930',
  gravelA: '#8a8b90', gravelB: '#6d6e74',
  clay: '#a9a3ae', clayD: '#8e8894',
  // snow / ice
  snow: '#f2f7fb', snowD: '#d8e3ee',
  ice: '#a9d8ee', iceD: '#87c2e0',
  // liquids
  water: '#2b7fbf', waterD: '#20648f', waterL: '#57a6db',
  lava: '#e8622a', lavaD: '#b83a12', lavaL: '#ffb648',
  // woods
  aspen: '#cfc0a1', aspenD: '#a99a7e', aspenBark: '#dcd3bd', aspenBarkD: '#a89e88',
  ember: '#8c4a35', emberD: '#6b3626', emberBark: '#a35b3f',
  pine: '#7d5a3c', pineD: '#5f4429', pineBark: '#6a4a30',
  palm: '#a8875c', palmD: '#856a45',
  leafA: '#6fbe4c', leafAD: '#529a35', leafE: '#c4533f', leafED: '#9c3b2b',
  leafP: '#2f7a4f', leafPD: '#21603c', leafPa: '#5aa83f', leafPaD: '#417f2c',
  // metals
  coal: '#2a2a30', coalL: '#3d3d45',
  copper: '#c9743c', copperL: '#e39a5f',
  iron: '#d6cdc0', ironL: '#efe8dd',
  gold: '#f0c04a', goldL: '#ffdd80',
  auro: '#5fe0d0', auroL: '#a9fff4',
  glim: '#c77bf5', glimL: '#e8b8ff',
  // build
  brick: '#b05a45', brickD: '#8d4433', mortar: '#d9cbb8',
  lumen: '#ffe9a8', lumenL: '#fff8dc',
  glassT: '#cfe9f5',
};

// ------------------------------------------------------------------ painter
class Px {
  constructor(seed) {
    this.d = new Uint8ClampedArray(TILE * TILE * 4);
    this.r = mulberry32(seed >>> 0);
  }
  static hex(c) {
    if (c[0] === '#') c = c.slice(1);
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  }
  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const [r, g, b] = typeof c === 'string' ? Px.hex(c) : c;
    const i = (y * TILE + x) * 4;
    if (a >= 255) { this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = 255; return; }
    const t = a / 255, inv = 1 - t, sa = this.d[i + 3] / 255;
    const na = t + sa * inv;
    this.d[i] = (r * t + this.d[i] * sa * inv) / (na || 1);
    this.d[i + 1] = (g * t + this.d[i + 1] * sa * inv) / (na || 1);
    this.d[i + 2] = (b * t + this.d[i + 2] * sa * inv) / (na || 1);
    this.d[i + 3] = na * 255;
  }
  get(x, y) { const i = (y * TILE + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  fill(c) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) this.set(x, y, c); return this; }
  clear() { this.d.fill(0); return this; }
  rect(x, y, w, h, c, a = 255) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c, a);
    return this;
  }
  hline(y, x0, x1, c, a) { for (let x = x0; x <= x1; x++) this.set(x, y, c, a); return this; }
  vline(x, y0, y1, c, a) { for (let y = y0; y <= y1; y++) this.set(x, y, c, a); return this; }
  border(c) { this.hline(0, 0, 15, c); this.hline(15, 0, 15, c); this.vline(0, 0, 15, c); this.vline(15, 0, 15, c); return this; }
  /** random speckles */
  spark(c, n, a = 255) {
    for (let i = 0; i < n; i++) this.set((this.r() * TILE) | 0, (this.r() * TILE) | 0, c, a);
    return this;
  }
  /** value-noise dither between two colours */
  grain(cA, cB, density = 0.35) {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      if (this.r() < density) this.set(x, y, this.r() < 0.5 ? cA : cB);
    }
    return this;
  }
  /** soft vertical gradient tint */
  shadeV(topA, botA) {
    for (let y = 0; y < TILE; y++) {
      const t = y / (TILE - 1);
      const a = topA + (botA - topA) * t;
      if (a > 0) this.rectRowMul(y, 1 - a);
      else if (a < 0) this.rectRowAdd(y, -a);
    }
    return this;
  }
  rectRowMul(y, m) {
    for (let x = 0; x < TILE; x++) { const i = (y * TILE + x) * 4; this.d[i] *= m; this.d[i + 1] *= m; this.d[i + 2] *= m; }
  }
  rectRowAdd(y, a) {
    for (let x = 0; x < TILE; x++) { const i = (y * TILE + x) * 4; this.d[i] += 255 * a * 0.3; this.d[i + 1] += 255 * a * 0.3; this.d[i + 2] += 255 * a * 0.3; }
  }
  /** organic blob cluster */
  blob(cx, cy, rad, c, jitter = 0.3) {
    for (let y = -rad - 1; y <= rad + 1; y++) for (let x = -rad - 1; x <= rad + 1; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d <= rad + (this.r() - 0.5) * 2 * jitter) this.set(cx + x, cy + y, c);
    }
    return this;
  }
  /** pixel line */
  line(x0, y0, x1, y1, c, a) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    for (let g = 0; g < 200; g++) {
      this.set(x, y, c, a);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return this;
  }
  /** darken outline where alpha edge meets transparency (icon pop) */
  outline(c = '#241c16') {
    const copy = this.d.slice();
    const at = (x, y) => (x < 0 || y < 0 || x >= TILE || y >= TILE) ? 0 : copy[(y * TILE + x) * 4 + 3];
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      if (at(x, y) > 0) continue;
      if (at(x - 1, y) > 128 || at(x + 1, y) > 128 || at(x, y - 1) > 128 || at(x, y + 1) > 128) this.set(x, y, c);
    }
    return this;
  }
  /** simple pixel bevel: light top-left, dark bottom-right */
  bevel(l = 0.18, d = 0.2) {
    for (let x = 0; x < TILE; x++) { this.mul(x, 0, 1 + l); this.mul(x, 15, 1 - d); }
    for (let y = 0; y < TILE; y++) { this.mul(0, y, 1 + l * 0.7); this.mul(15, y, 1 - d * 0.7); }
    return this;
  }
  mul(x, y, m) {
    const i = (y * TILE + x) * 4;
    this.d[i] *= m; this.d[i + 1] *= m; this.d[i + 2] *= m;
  }
}

// -------------------------------------------------------------- tile drawers
const T = {};

T.stone = p => p.fill(P.stone).grain(P.stoneD, P.stoneL, 0.4).blob(4, 5, 2, P.stoneD, .6).blob(11, 11, 2, P.stoneL, .6).spark(P.stoneD, 10).bevel(.06, .08);
T.deepstone = p => p.fill(P.deep).grain(P.deepD, P.deepL, 0.42).blob(10, 4, 2, P.deepD, .7).spark(P.deepL, 8).bevel(.05, .07);
T.rubble = p => { p.fill(P.stoneD).grain(P.stone, P.stoneD, .5); for (let i = 0; i < 7; i++) { const x = (p.r() * 13) | 0, y = (p.r() * 13) | 0, s = 2 + ((p.r() * 2) | 0); p.rect(x, y, s, s, p.r() < .5 ? P.stone : P.stoneL); p.hline(y + s - 1, x, x + s - 1, P.deepD); } return p; };
T.basalt = p => { p.fill(P.basalt).grain(P.basaltD, '#4a4552', .4); for (let x = 1; x < 16; x += 5) p.vline(x, 0, 15, P.basaltD); return p.spark('#5a5462', 8); };
T.moss_stone = p => { T.stone(p); for (let i = 0; i < 26; i++) { const x = (p.r() * 16) | 0, y = (p.r() * 16) | 0; p.set(x, y, p.r() < .5 ? P.turfD : P.turfP); } return p.blob(3, 12, 2, P.turfP, .8).blob(12, 3, 2, P.turfD, .8); };
T.bedrock = p => { p.fill('#2a2730').grain('#1c1a21', '#413d4a', .55); for (let i = 0; i < 6; i++) p.blob((p.r() * 16) | 0, (p.r() * 16) | 0, 2, p.r() < .5 ? '#161419' : '#4d4857', .7); return p; };

T.dirt = p => p.fill(P.soil).grain(P.soilD, P.soilL, .45).spark(P.soilD, 14).spark('#4d331f', 5).bevel(.07, .09);
T.dry_dirt = p => p.fill(P.dry).grain(P.dryD, '#a3835c', .45).spark(P.dryD, 12);
// Grass: fine even-grained turf, no large blobs or bevel — reads cleanly when
// tiled across a whole landscape instead of looking patchy.
T.grass_top = p => {
  p.fill(P.turf);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const r = p.r();
    if (r < 0.30) p.set(x, y, P.turfD);
    else if (r < 0.52) p.set(x, y, P.turfL);
    else if (r < 0.60) p.set(x, y, P.turfP);
  }
  return p;
};
// Dirt block with a turf cap whose lower edge is a ragged overhang.
T.grass_side = p => {
  T.dirt(p);
  for (let x = 0; x < 16; x++) {
    const d = 3 + ((p.r() * 4) | 0);          // fringe depth 3..6 px from top
    for (let y = 0; y < d; y++) {
      const r = p.r();
      p.set(x, y, y === d - 1 ? P.turfP : (r < 0.30 ? P.turfD : r < 0.55 ? P.turfL : P.turf));
    }
  }
  return p;
};
T.path_top = p => { p.fill('#8a6a4a').grain('#6f5439', '#9c7c58', .45); for (let i = 0; i < 5; i++) p.blob((p.r() * 16) | 0, (p.r() * 16) | 0, 2, '#7a5c3e', .6); return p.border('#6f5439'); };
T.path_side = p => { T.dirt(p); p.rect(0, 0, 16, 2, '#8a6a4a'); p.hline(2, 0, 15, '#6f5439'); return p; };
T.sand = p => p.fill(P.sand).grain(P.sandD, P.sandL, .4).spark(P.sandD, 14).bevel(.05, .06);
T.red_sand = p => p.fill(P.rsand).grain(P.rsandD, '#d78a58', .4).spark(P.rsandD, 12);
T.gravel = p => { p.fill(P.gravelB); for (let i = 0; i < 30; i++) { const x = (p.r() * 15) | 0, y = (p.r() * 15) | 0; p.rect(x, y, 2, 2, p.r() < .5 ? P.gravelA : '#9ea0a6'); p.set(x, y + 1, '#5a5b60'); } return p; };
T.clay = p => p.fill(P.clay).grain(P.clayD, '#c0bac6', .3).spark(P.clayD, 8);
T.snow = p => p.fill(P.snow).grain(P.snowD, '#ffffff', .3).spark(P.snowD, 6);
T.snow_side = p => { T.dirt(p); p.rect(0, 0, 16, 4, P.snow); for (let x = 0; x < 16; x++) { const d = 4 + ((p.r() * 2) | 0); for (let y = 4; y < d; y++) p.set(x, y, P.snowD); } return p; };
T.ice = p => { p.fill(P.ice); p.grain(P.iceD, '#c8e9f8', .3); for (let i = 0; i < 4; i++) { const x = (p.r() * 12) | 0; p.line(x, 0, x + 4, 15, '#c8ecff', 170); } for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4; p.d[i + 3] = 205; } return p; };
T.packed_ice = p => { p.fill(P.iceD).grain('#7ab4d4', P.ice, .4); for (let i = 0; i < 3; i++) p.line((p.r() * 14) | 0, 0, (p.r() * 14) | 0, 15, '#bfe6f7', 120); return p; };

T.water = p => { p.fill(P.water); p.grain(P.waterD, P.waterL, .22); for (let i = 0; i < 3; i++) { const y = 2 + ((p.r() * 12) | 0); p.hline(y, 1, 8 + ((p.r() * 6) | 0), P.waterL, 150); } for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4; p.d[i + 3] = 190; } return p; };
T.lava = p => { p.fill(P.lava); p.grain(P.lavaD, P.lavaL, .3); for (let i = 0; i < 5; i++) p.blob((p.r() * 16) | 0, (p.r() * 16) | 0, 2, P.lavaL, .7); return p.spark('#fff2a8', 6); };

T.sandstone_top = p => p.fill(P.sandL).grain(P.sand, '#fff3d2', .3).border(P.sandD);
T.sandstone_side = p => { p.fill(P.sand).grain(P.sandD, P.sandL, .25); p.hline(5, 0, 15, P.sandD); p.hline(11, 0, 15, P.sandD); p.hline(6, 0, 15, '#f7ecc9'); p.hline(12, 0, 15, '#f7ecc9'); return p; };

// wood
function logSide(p, base, dark, light) {
  p.fill(base);
  for (let x = 0; x < 16; x++) {
    if (p.r() < .35) p.vline(x, 0, 15, dark);
    else if (p.r() < .3) p.vline(x, 0, 15, light);
  }
  for (let i = 0; i < 10; i++) { const x = (p.r() * 16) | 0, y = (p.r() * 14) | 0; p.set(x, y, dark); p.set(x, y + 1, dark); }
  return p.bevel(.08, .1);
}
function logTop(p, base, dark, light) {
  p.fill(base).grain(dark, light, .25);
  for (let r = 7; r > 0; r -= 2) p.blob(8, 8, r, r % 4 === 1 ? dark : light, .35);
  p.blob(8, 8, 1, dark, .2);
  return p;
}
T.log_aspen_side = p => { logSide(p, P.aspenBark, P.aspenBarkD, '#efe7d5'); for (let i = 0; i < 4; i++) { const y = (p.r() * 13) | 0, x = (p.r() * 11) | 0; p.rect(x, y, 4, 2, '#4a4438'); p.rect(x, y, 4, 1, '#6b6455'); } return p; };
T.log_aspen_top = p => logTop(p, P.aspen, P.aspenD, '#e8dcc2');
T.log_ember_side = p => logSide(p, P.emberBark, P.emberD, '#b86f4e');
T.log_ember_top = p => logTop(p, P.ember, P.emberD, '#a8614a');
T.log_pine_side = p => logSide(p, P.pineBark, '#4a3521', '#87643f');
T.log_pine_top = p => logTop(p, P.pine, P.pineD, '#96714b');
T.log_palm_side = p => { logSide(p, P.palm, P.palmD, '#c2a173'); for (let y = 1; y < 16; y += 4) p.hline(y, 0, 15, P.palmD); return p; };
T.log_palm_top = p => logTop(p, P.palm, P.palmD, '#c2a173');

function leaves(p, base, dark, light, dense = .82) {
  p.clear();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (p.r() < dense) {
      const v = p.r();
      p.set(x, y, v < .3 ? dark : v < .75 ? base : light);
    }
  }
  // fill small holes so it reads as foliage not static
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
    if (p.get(x, y)[3] === 0 && p.r() < .5) p.set(x, y, base);
  }
  return p;
}
T.leaf_aspen = p => leaves(p, P.leafA, P.leafAD, '#93d96e');
T.leaf_ember = p => leaves(p, P.leafE, P.leafED, '#e07a56');
T.leaf_pine = p => leaves(p, P.leafP, P.leafPD, '#43996a', .74);
T.leaf_palm = p => leaves(p, P.leafPa, P.leafPaD, '#7fc95e', .7);

function planks(p, base, dark, light) {
  p.fill(base);
  for (let band = 0; band < 4; band++) {
    const y0 = band * 4;
    for (let y = y0; y < y0 + 4; y++) for (let x = 0; x < 16; x++) {
      if (p.r() < .22) p.set(x, y, p.r() < .5 ? dark : light);
    }
    p.hline(y0, 0, 15, light);
    p.hline(y0 + 3, 0, 15, dark);
    const notch = 3 + ((p.r() * 10) | 0);
    p.vline(notch, y0, y0 + 3, dark);
  }
  return p;
}
T.plank_aspen = p => planks(p, P.aspen, P.aspenD, '#e6dbc3');
T.plank_ember = p => planks(p, '#a55c42', '#7d4230', '#c2765a');
T.plank_pine = p => planks(p, '#96714b', '#6d5033', '#b08d64');
T.plank_palm = p => planks(p, '#bda079', '#977c58', '#d6bd99');

// ores
function ore(p, host, gem, gemL, gemD, count = 5, glow = false) {
  host(p);
  for (let i = 0; i < count; i++) {
    const cx = 2 + ((p.r() * 12) | 0), cy = 2 + ((p.r() * 12) | 0), r = 1 + ((p.r() * 1.6) | 0);
    p.blob(cx, cy, r, gem, .35);
    p.set(cx - 1, cy - 1, gemL);
    p.set(cx + r, cy + r, gemD);
    if (glow) { p.set(cx, cy - 1, gemL); p.set(cx + 1, cy, gemL); }
  }
  return p;
}
T.ore_coal = p => ore(p, T.stone, P.coal, P.coalL, '#161619', 5);
T.ore_copper = p => ore(p, T.stone, P.copper, P.copperL, '#93521f', 5);
T.ore_iron = p => ore(p, T.stone, '#c4b7a4', P.ironL, '#8e8371', 5);
T.ore_gold = p => ore(p, T.stone, P.gold, P.goldL, '#b98d1e', 4);
T.ore_aurorite = p => ore(p, T.deepstone, P.auro, P.auroL, '#2f9c90', 4, true);
T.ore_glimmer = p => ore(p, T.deepstone, P.glim, P.glimL, '#8b45b8', 4, true);

T.coal_block = p => { p.fill(P.coal).grain('#181820', P.coalL, .45); return p.spark('#4d4d57', 10).bevel(.1, .12); };
function metalBlock(p, base, light, dark) {
  p.fill(base).grain(dark, light, .2);
  p.rect(1, 1, 6, 6, light, 60); p.rect(9, 9, 6, 6, dark, 70);
  p.hline(7, 0, 15, dark); p.vline(7, 0, 15, dark);
  p.hline(8, 0, 15, light); p.vline(8, 0, 15, light);
  return p.bevel(.1, .12);
}
T.copper_block = p => metalBlock(p, P.copper, P.copperL, '#8f4f1e');
T.iron_block = p => metalBlock(p, P.iron, P.ironL, '#a49a8b');
T.gold_block = p => metalBlock(p, P.gold, P.goldL, '#c39a22');
T.aurorite_block = p => { metalBlock(p, P.auro, P.auroL, '#2f9c90'); return p.spark(P.auroL, 12); };
T.glimmer_block = p => { metalBlock(p, P.glim, P.glimL, '#8b45b8'); return p.spark('#ffffff', 10); };

// building
T.glass = p => {
  p.clear();
  p.rect(0, 0, 16, 16, P.glassT, 46);
  p.border('#eaf7ff'); p.hline(1, 1, 14, '#ffffff', 120); p.vline(1, 1, 14, '#ffffff', 120);
  p.line(3, 12, 11, 3, '#ffffff', 130); p.line(4, 12, 12, 3, '#ffffff', 70);
  return p;
};
T.bricks = p => {
  p.fill(P.mortar);
  for (let row = 0; row < 4; row++) {
    const y = row * 4, off = row % 2 ? 4 : 0;
    for (let bx = -1; bx < 3; bx++) {
      const x = bx * 8 + off;
      p.rect(x, y, 7, 3, P.brick);
      for (let i = 0; i < 6; i++) p.set(x + ((p.r() * 7) | 0), y + ((p.r() * 3) | 0), P.brickD);
      p.hline(y, Math.max(0, x), Math.min(15, x + 6), '#c46b53');
    }
  }
  return p;
};
T.stone_bricks = p => {
  p.fill(P.stoneD);
  for (let row = 0; row < 4; row++) {
    const y = row * 4, off = row % 2 ? 4 : 0;
    for (let bx = -1; bx < 3; bx++) {
      const x = bx * 8 + off;
      p.rect(x, y, 7, 3, P.stone);
      for (let i = 0; i < 5; i++) p.set(x + ((p.r() * 7) | 0), y + ((p.r() * 3) | 0), p.r() < .5 ? P.stoneD : P.stoneL);
      p.hline(y, Math.max(0, x), Math.min(15, x + 6), P.stoneL);
    }
  }
  return p;
};
T.chiseled = p => { p.fill(P.stone).grain(P.stoneD, P.stoneL, .25); p.border(P.stoneD); p.rect(3, 3, 10, 10, P.stoneL); p.rect(4, 4, 8, 8, P.stone); p.blob(8, 8, 3, P.stoneD, .3); p.rect(6, 6, 4, 4, P.stoneL); return p; };
T.tile_dark = p => { p.fill(P.deep).grain(P.deepD, P.deepL, .25); p.hline(7, 0, 15, '#2b2d34'); p.vline(7, 0, 15, '#2b2d34'); p.hline(8, 0, 15, P.deepL); p.vline(8, 0, 15, P.deepL); p.border('#2b2d34'); return p; };
T.slab_stone = p => { p.fill(P.stoneL).grain(P.stone, '#b6b8bf', .3); p.border(P.stoneD); p.hline(1, 1, 14, '#c4c6cd'); return p; };
T.lumen = p => { p.fill(P.lumen); p.grain('#ffd982', P.lumenL, .4); for (let i = 0; i < 6; i++) p.blob((p.r() * 16) | 0, (p.r() * 16) | 0, 2, P.lumenL, .6); return p.spark('#ffffff', 12); };

function woolTile(p, base, dark, light) {
  p.fill(base);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = p.r();
    if (v < .18) p.set(x, y, dark); else if (v < .34) p.set(x, y, light);
  }
  for (let i = 0; i < 8; i++) { const x = (p.r() * 14) | 0, y = (p.r() * 14) | 0; p.set(x, y, light); p.set(x + 1, y + 1, dark); }
  return p;
}
T.wool_white = p => woolTile(p, '#eceff3', '#cdd3da', '#ffffff');
T.wool_red = p => woolTile(p, '#c34a45', '#9b3531', '#dd6a63');
T.wool_amber = p => woolTile(p, '#e0a13c', '#b87c26', '#f5be62');
T.wool_teal = p => woolTile(p, '#3fa39a', '#2c7c75', '#5fc4b9');
T.wool_violet = p => woolTile(p, '#8a5cc0', '#6a439a', '#a97ddb');
T.wool_slate = p => woolTile(p, '#5a6472', '#434b57', '#78838f');

// stations
T.bench_top = p => {
  T.plank_aspen(p);
  p.rect(1, 1, 14, 14, '#8a6a45', 90);
  p.rect(2, 2, 5, 5, '#6f563a'); p.rect(9, 2, 5, 5, '#7d6240');
  p.rect(2, 9, 5, 5, '#7d6240'); p.rect(9, 9, 5, 5, '#6f563a');
  p.set(4, 4, '#d8cbb0'); p.set(11, 11, '#d8cbb0');
  p.border('#5e4930');
  return p;
};
T.bench_side = p => {
  T.plank_aspen(p);
  p.rect(0, 0, 16, 4, '#8f6f49');
  p.hline(4, 0, 15, '#5e4930');
  // hanging tools silhouette
  p.line(3, 7, 6, 12, '#5b4a35'); p.rect(2, 5, 4, 2, '#9aa0a8');
  p.line(11, 6, 11, 12, '#5b4a35'); p.rect(9, 5, 5, 2, '#b08050');
  return p;
};
T.smelter_top = p => { T.stone_bricks(p); p.rect(5, 5, 6, 6, '#3a3c44'); p.rect(6, 6, 4, 4, '#22242a'); p.set(7, 7, '#5c5e68'); return p; };
T.smelter_side = p => { T.stone_bricks(p); p.rect(2, 2, 12, 12, '#7a7c83', 60); return p; };
function smelterFront(p, lit) {
  T.stone_bricks(p);
  p.rect(3, 7, 10, 7, '#33353c');
  p.rect(4, 8, 8, 5, lit ? P.lava : '#1c1e23');
  if (lit) {
    for (let i = 0; i < 10; i++) p.set(4 + ((p.r() * 8) | 0), 8 + ((p.r() * 5) | 0), p.r() < .5 ? P.lavaL : '#ffe08a');
    p.hline(12, 4, 11, '#ffd36a');
  } else {
    p.spark('#2c2e34', 6);
  }
  p.hline(6, 2, 13, '#a3a5ac'); p.rect(6, 3, 4, 2, '#6a6c73');
  return p;
}
T.smelter_front = p => smelterFront(p, false);
T.smelter_front_lit = p => smelterFront(p, true);
// ---- Chest: warm oak boards, dark iron bands and a gold latch. Drawn as a
// full 16x16 tile set; the 3D block-entity model UVs into these same tiles so
// the animated chest and its inventory icon always agree.
function chestBoards(p, shade = 0) {
  const base = ['#8a6134', '#7d5730', '#96693a'][shade + 1] || '#8a6134';
  p.fill(base);
  // vertical plank seams + grain
  for (let x = 0; x < 16; x++) {
    if (x % 5 === 0) p.vline(x, 0, 15, '#6b4a28');
  }
  p.grain('#7a5530', '#9a6d3c', 0.30);
  return p;
}
T.crate_top = p => {
  chestBoards(p, 1);
  p.border('#4a331c');
  // iron band across the lid + the hinge line at the back
  p.rect(0, 0, 16, 2, '#3d3a36');
  p.hline(1, 0, 15, '#565250');
  p.rect(6, 0, 4, 4, '#4a4642');
  p.rect(7, 1, 2, 2, '#6a6560');
  p.grain('#8f6438', '#7d5730', 0.14);
  return p;
};
T.crate_side = p => {
  chestBoards(p, 0);
  p.border('#4a331c');
  // lid / base split (the 3D model splits here too: 5px lid, 11px base)
  p.rect(0, 4, 16, 1, '#3d3a36');
  p.hline(5, 0, 15, '#2e2b28');
  // corner iron straps
  p.rect(1, 6, 2, 9, '#4a4642', 200);
  p.rect(13, 6, 2, 9, '#4a4642', 200);
  p.hline(15, 0, 15, '#3d3a36');
  return p;
};
T.crate_front = p => {
  T.crate_side(p);
  // latch plate + gold keyhole, centred on the lid seam
  p.rect(6, 3, 4, 5, '#3d3a36');
  p.rect(7, 4, 2, 3, '#6a6560');
  p.rect(7, 5, 2, 2, '#d8ac3e');
  p.set(7, 6, '#8a6a20');
  p.set(8, 6, '#f0d070');
  return p;
};

// Torch: a 2px stick occupying the lower tile with a compact flame on top.
// Only the centre column is opaque so the cutout shader discards the rest.
T.torch = p => {
  p.clear();
  // handle (rows 9..15 = lower half once flipped upright)
  p.rect(7, 9, 2, 7, '#6b4c31');
  p.vline(7, 9, 15, '#8a6743');
  p.set(8, 12, '#5a3f28'); p.set(7, 14, '#7d5a3c');
  // ember bed
  p.rect(6, 7, 4, 2, '#c25a1e');
  p.rect(7, 7, 2, 2, '#ff9a3c');
  // flame
  p.rect(6, 5, 4, 2, '#ff9a3c');
  p.rect(7, 3, 2, 3, '#ffc44f');
  p.rect(7, 2, 2, 1, '#ffe089');
  p.set(7, 1, '#fff3c4');
  return p;
};
T.lantern = p => {
  p.fill('#4a4c55');
  p.rect(2, 2, 12, 12, '#6a6c75');
  p.rect(3, 3, 10, 10, P.lumen);
  p.rect(4, 4, 8, 8, P.lumenL);
  p.blob(8, 8, 2, '#fffdf0', .3);
  p.rect(0, 0, 16, 2, '#3a3c44'); p.rect(0, 14, 16, 2, '#3a3c44');
  p.vline(2, 2, 13, '#8a8c95'); p.vline(13, 2, 13, '#3a3c44');
  p.rect(7, 0, 2, 3, '#8a8c95');
  return p;
};
T.ladder = p => {
  p.clear();
  p.rect(2, 0, 2, 16, '#96714b'); p.rect(12, 0, 2, 16, '#96714b');
  p.vline(2, 0, 15, '#b08d64'); p.vline(13, 0, 15, '#6d5033');
  for (let y = 2; y < 16; y += 5) { p.rect(4, y, 8, 2, '#a8825a'); p.hline(y, 4, 11, '#c2a173'); }
  return p;
};
T.door_low = p => {
  p.fill('#8a6a45');
  planksDoor(p);
  p.rect(11, 6, 3, 3, '#3a3c44'); p.rect(12, 7, 1, 1, '#d8b24a');
  return p;
};
T.door_top = p => {
  p.fill('#8a6a45');
  planksDoor(p);
  p.rect(3, 3, 10, 6, '#5e4930');
  p.rect(4, 4, 8, 4, P.glassT); p.rect(4, 4, 8, 4, '#cfe9f5');
  p.line(5, 7, 10, 4, '#ffffff', 140);
  p.vline(8, 4, 7, '#5e4930');
  return p;
};
function planksDoor(p) {
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) if (p.r() < .18) p.set(x, y, p.r() < .5 ? '#6f563a' : '#a8825a');
  p.border('#5e4930');
  p.vline(1, 1, 14, '#a8825a');
  p.hline(1, 1, 14, '#a8825a');
  p.rect(0, 5, 16, 2, '#6f563a'); p.hline(5, 0, 15, '#a8825a');
}

// plants (cross)
/** shared blade painter: upright tufts rooted at the tile bottom (y=15) */
function grassBlades(p, count, minH, maxH, seedRow = 15) {
  p.clear();
  for (let i = 0; i < count; i++) {
    const x = 1 + ((p.r() * 14) | 0);
    const h = minH + ((p.r() * (maxH - minH + 1)) | 0);
    const lean = p.r() < 0.5 ? -1 : 1;
    const c = p.r() < .35 ? P.turfD : p.r() < .75 ? P.turf : P.turfL;
    for (let k = 0; k < h; k++) {
      const y = seedRow - k;
      if (y < 0) break;
      // blades bend outward toward the tip
      const bend = (k > h * 0.6) ? lean : 0;
      p.set(x + bend, y, k === h - 1 ? P.turfL : c);
    }
  }
  return p;
}
// short variant — ankle-height clumps
T.short_grass = p => grassBlades(p, 11, 4, 7);
// tall variant — reaches most of the block
T.tall_grass = p => grassBlades(p, 10, 9, 14);
// upper half of the two-block tall grass: blades continue and taper off
T.tall_grass_top = p => {
  p.clear();
  for (let i = 0; i < 8; i++) {
    const x = 1 + ((p.r() * 14) | 0);
    const h = 3 + ((p.r() * 5) | 0);
    const lean = p.r() < 0.5 ? -1 : 1;
    const c = p.r() < .35 ? P.turfD : p.r() < .75 ? P.turf : P.turfL;
    for (let k = 0; k < h; k++) {
      const y = 15 - k;
      p.set(x + (k > h * 0.5 ? lean : 0), y, k === h - 1 ? P.turfL : c);
    }
  }
  return p;
};
T.fern = p => {
  p.clear();
  p.vline(8, 4, 15, P.turfD);
  for (let y = 5; y < 15; y += 2) {
    const w = ((15 - y) * .55 + 1) | 0;
    p.hline(y, 8 - w, 8 + w, p.r() < .5 ? P.turf : P.turfD);
  }
  p.set(8, 3, P.turfL);
  return p;
};
T.flower_sun = p => {
  p.clear();
  p.vline(8, 8, 15, P.turfD);
  p.set(7, 11, P.turf); p.set(9, 12, P.turf);
  p.blob(8, 5, 3, '#f7c948', .25);
  p.blob(8, 5, 1, '#a8681e', .1);
  p.set(8, 1, '#ffe08a'); p.set(5, 5, '#ffe08a'); p.set(11, 5, '#ffe08a'); p.set(8, 9, '#ffe08a');
  return p;
};
T.flower_dusk = p => {
  p.clear();
  p.vline(8, 7, 15, P.turfD);
  p.set(7, 10, P.turf); p.set(9, 12, P.turf);
  p.blob(8, 5, 2, '#8a5cc0', .2);
  p.rect(6, 5, 5, 3, '#9d6fd4');
  p.set(8, 8, '#c9a8ec'); p.set(7, 3, '#c9a8ec'); p.set(9, 3, '#c9a8ec');
  return p;
};
T.mushroom = p => {
  p.clear();
  p.rect(7, 8, 2, 7, '#e0d8c4');
  p.blob(8, 6, 4, '#4fb8d8', .25);
  p.blob(8, 6, 2, '#7fd8f0', .2);
  p.set(6, 5, '#c8f2ff'); p.set(10, 6, '#c8f2ff'); p.set(8, 3, '#c8f2ff');
  p.hline(9, 5, 11, '#2f8aa8');
  return p;
};
T.berry_bush = p => {
  p.clear();
  for (let i = 0; i < 60; i++) {
    const x = 2 + ((p.r() * 12) | 0), y = 4 + ((p.r() * 11) | 0);
    p.set(x, y, p.r() < .4 ? P.turfP : P.turfD);
  }
  for (let i = 0; i < 6; i++) { const x = 3 + ((p.r() * 10) | 0), y = 6 + ((p.r() * 8) | 0); p.set(x, y, '#e8563f'); p.set(x + 1, y, '#c23a28'); p.set(x, y - 1, '#ff8f72'); }
  return p;
};
T.cactus_top = p => { p.fill('#4f9e5c').grain('#3d7d47', '#6ebd78', .3); p.blob(8, 8, 4, '#5cb069', .3); p.spark('#d8f0c8', 6); return p; };
T.cactus_side = p => {
  p.fill('#4f9e5c').grain('#3d7d47', '#6ebd78', .25);
  p.vline(2, 0, 15, '#3d7d47'); p.vline(13, 0, 15, '#3d7d47');
  p.vline(3, 0, 15, '#6ebd78'); p.vline(12, 0, 15, '#6ebd78');
  for (let y = 1; y < 16; y += 4) { p.set(5, y, '#e8f2d8'); p.set(10, y + 2, '#e8f2d8'); }
  return p;
};

// ------------------------------------------------------------- item icons
const MAT_COL = {
  timber: ['#b08d64', '#d6bd99', '#7d5a3c'],
  stone: [P.stone, P.stoneL, P.stoneD],
  copper: [P.copper, P.copperL, '#8f4f1e'],
  iron: [P.iron, P.ironL, '#a49a8b'],
  aurorite: [P.auro, P.auroL, '#2f9c90'],
  hide: ['#9c6b3f', '#c08d5c', '#6f4a29'],
};
const HANDLE = '#8a6a45', HANDLE_D = '#5e4930';

function drawHandle(p, x0, y0, x1, y1) {
  p.line(x0, y0, x1, y1, HANDLE);
  p.line(x0 + 1, y0, x1 + 1, y1, HANDLE_D);
}
function toolIcon(kind, mat) {
  return p => {
    const [c, l, d] = MAT_COL[mat];
    p.clear();
    if (kind === 'pick') {
      drawHandle(p, 5, 14, 10, 5);
      p.line(3, 6, 13, 4, c); p.line(3, 5, 13, 3, c);
      p.line(2, 7, 4, 4, c); p.line(13, 5, 14, 7, c);
      p.line(4, 4, 13, 2, l);
      p.set(2, 8, d); p.set(14, 8, d);
    } else if (kind === 'axe') {
      drawHandle(p, 5, 14, 9, 4);
      p.rect(8, 2, 5, 6, c);
      p.rect(6, 3, 3, 4, c);
      p.line(8, 2, 12, 2, l); p.vline(6, 3, 6, l);
      p.line(9, 8, 13, 7, d); p.vline(13, 3, 7, d);
      p.set(12, 3, l);
    } else if (kind === 'shovel') {
      drawHandle(p, 5, 14, 9, 6);
      p.rect(7, 2, 5, 5, c);
      p.hline(2, 7, 11, l); p.vline(7, 2, 6, l);
      p.hline(7, 7, 11, d); p.vline(11, 2, 6, d);
      p.set(9, 4, l);
    } else {
      // blade
      p.line(4, 13, 5, 12, HANDLE_D);
      p.rect(3, 12, 3, 3, HANDLE);
      p.line(2, 11, 7, 11, '#5e4930');
      p.line(4, 10, 12, 2, c); p.line(5, 10, 13, 2, c);
      p.line(4, 9, 12, 1, l);
      p.line(6, 11, 13, 4, d);
      p.set(13, 1, l); p.set(12, 1, l);
    }
    return p.outline();
  };
}
function armorIcon(slot, mat) {
  return p => {
    const [c, l, d] = MAT_COL[mat];
    p.clear();
    if (slot === 'helm') {
      p.blob(8, 7, 5, c, .1);
      p.rect(3, 7, 11, 6, c);
      p.rect(4, 8, 9, 3, '#2a2530');
      p.hline(2, 5, 10, l); p.hline(3, 4, 11, l);
      p.hline(13, 3, 13, d);
      p.set(5, 4, l); p.set(11, 11, d);
    } else if (slot === 'chest') {
      p.rect(3, 3, 10, 11, c);
      p.rect(1, 4, 3, 5, c); p.rect(12, 4, 3, 5, c);
      p.hline(3, 4, 11, l); p.vline(3, 3, 13, l);
      p.hline(13, 3, 12, d); p.vline(12, 4, 13, d);
      p.rect(6, 5, 4, 6, d); p.rect(7, 6, 2, 4, l);
    } else if (slot === 'legs') {
      p.rect(3, 2, 10, 4, c);
      p.rect(3, 6, 4, 9, c); p.rect(9, 6, 4, 9, c);
      p.hline(2, 3, 12, l); p.vline(3, 2, 14, l); p.vline(9, 6, 14, l);
      p.vline(6, 6, 14, d); p.vline(12, 2, 14, d);
      p.hline(6, 3, 12, d);
    } else {
      p.rect(2, 7, 5, 6, c); p.rect(9, 7, 5, 6, c);
      p.rect(2, 12, 7, 3, c); p.rect(9, 12, 6, 3, c);
      p.hline(7, 2, 6, l); p.hline(7, 9, 13, l);
      p.hline(14, 2, 8, d); p.hline(14, 9, 14, d);
      p.vline(2, 7, 14, l); p.vline(13, 7, 14, d);
    }
    return p.outline();
  };
}

const I = {};
I.i_stick = p => { p.clear(); p.line(4, 13, 11, 4, HANDLE); p.line(5, 13, 12, 4, HANDLE_D); p.set(11, 3, '#a8825a'); return p.outline(); };
function nugget(p, c, l, d, n = 4) {
  p.clear();
  const pts = [[5, 6], [10, 5], [7, 10], [11, 11], [4, 11]];
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i % 5];
    p.blob(x, y, 2, c, .2);
    p.set(x - 1, y - 1, l); p.set(x + 1, y + 1, d);
  }
  return p.outline();
}
I.i_coal = p => nugget(p, P.coal, P.coalL, '#141418', 4);
I.i_charcoal = p => nugget(p, '#3a3a42', '#54545e', '#1e1e24', 4);
I.i_raw_copper = p => nugget(p, P.copper, P.copperL, '#8f4f1e', 3);
I.i_raw_iron = p => nugget(p, '#c4b7a4', P.ironL, '#8e8371', 3);
I.i_raw_gold = p => nugget(p, P.gold, P.goldL, '#b98d1e', 3);
I.i_aurorite = p => { p.clear(); p.blob(8, 8, 4, P.auro, .1); p.blob(7, 7, 2, P.auroL, .1); p.set(5, 10, '#2f9c90'); p.set(11, 10, '#2f9c90'); p.set(8, 3, '#ffffff'); return p.outline(); };
I.i_glimmer = p => { p.clear(); p.line(8, 1, 8, 14, P.glim); p.line(7, 3, 7, 12, P.glim); p.line(9, 3, 9, 12, P.glim); p.line(6, 6, 6, 10, P.glimL); p.line(10, 6, 10, 10, '#8b45b8'); p.set(8, 2, '#ffffff'); p.set(7, 6, P.glimL); return p.outline(); };
function ingot(p, c, l, d) {
  p.clear();
  p.rect(3, 7, 10, 5, c);
  p.rect(4, 6, 8, 1, c);
  p.hline(6, 4, 11, l); p.hline(7, 3, 12, l);
  p.hline(11, 3, 12, d);
  p.set(5, 8, l); p.set(10, 10, d);
  return p.outline();
}
I.i_copper_ingot = p => ingot(p, P.copper, P.copperL, '#8f4f1e');
I.i_iron_ingot = p => ingot(p, P.iron, P.ironL, '#a49a8b');
I.i_gold_ingot = p => ingot(p, P.gold, P.goldL, '#b98d1e');
I.i_clay = p => nugget(p, P.clay, '#c0bac6', P.clayD, 4);
I.i_brick = p => { p.clear(); p.rect(2, 5, 12, 7, P.brick); p.hline(5, 2, 13, '#c46b53'); p.hline(11, 2, 13, P.brickD); p.spark(P.brickD, 6); return p.outline(); };
I.i_seeds = p => { p.clear(); for (let i = 0; i < 7; i++) { const x = 3 + ((p.r() * 10) | 0), y = 4 + ((p.r() * 9) | 0); p.set(x, y, '#c2a76a'); p.set(x + 1, y, '#8f7a44'); p.set(x, y + 1, '#e0cb95'); } return p.outline(); };
I.i_feather = p => { p.clear(); p.line(11, 3, 5, 13, '#d8d8d8'); for (let i = 0; i < 7; i++) { const t = i / 6; const x = (11 - 6 * t) | 0, y = (3 + 10 * t) | 0; p.line(x, y, x - 2 - ((3 * (1 - t)) | 0), y, '#f2f2f2'); p.line(x + 1, y, x + 2, y - 1, '#c0c0c8'); } return p.outline(); };
I.i_hide = p => { p.clear(); p.blob(8, 8, 5, '#9c6b3f', .3); p.rect(2, 4, 3, 3, '#9c6b3f'); p.rect(11, 4, 3, 3, '#9c6b3f'); p.rect(4, 11, 3, 3, '#9c6b3f'); p.rect(9, 11, 3, 3, '#9c6b3f'); p.blob(7, 7, 2, '#c08d5c', .2); return p.outline(); };
I.i_leather = p => { p.clear(); p.rect(2, 4, 12, 9, '#a8703f'); p.hline(4, 2, 13, '#c9915c'); p.hline(12, 2, 13, '#7a4d28'); p.rect(4, 6, 8, 5, '#b87d4a'); p.spark('#7a4d28', 5); return p.outline(); };
I.i_bone = p => { p.clear(); p.line(4, 12, 11, 5, '#ece6d4'); p.line(5, 12, 12, 5, '#ece6d4'); p.blob(3, 12, 2, '#f7f3e4', .1); p.blob(12, 4, 2, '#f7f3e4', .1); p.set(4, 13, '#c2bca8'); p.set(13, 5, '#c2bca8'); return p.outline(); };
I.i_bone_meal = p => { p.clear(); p.rect(4, 6, 8, 8, '#e0dccc'); p.hline(6, 4, 11, '#f2eee0'); p.rect(5, 4, 6, 2, '#c9c4b2'); p.spark('#ffffff', 6); return p.outline(); };
I.i_ember_dust = p => { p.clear(); for (let i = 0; i < 16; i++) { const x = 3 + ((p.r() * 10) | 0), y = 4 + ((p.r() * 10) | 0); p.set(x, y, p.r() < .5 ? '#e8622a' : '#ffb648'); } p.blob(8, 10, 3, '#c2401a', .4); return p.outline(); };
I.i_string = p => { p.clear(); for (let y = 2; y < 14; y++) p.set(8 + ((Math.sin(y * .9) * 3) | 0), y, '#e8e4d8'); for (let y = 2; y < 14; y++) p.set(8 + ((Math.sin(y * .9 + 1) * 3) | 0), y, '#c8c4b8'); return p.outline(); };
I.i_shears = p => { p.clear(); p.line(4, 13, 9, 5, P.iron); p.line(11, 13, 7, 5, P.iron); p.line(5, 13, 10, 5, P.ironL); p.rect(3, 12, 3, 3, '#5a6472'); p.rect(10, 12, 3, 3, '#5a6472'); p.set(8, 8, '#8a8c95'); return p.outline(); };
I.i_sunberry = p => { p.clear(); p.blob(6, 9, 2, '#e8563f', .1); p.blob(10, 10, 2, '#e8563f', .1); p.blob(8, 6, 2, '#ff7a5c', .1); p.set(5, 8, '#ff9f88'); p.set(9, 4, P.turfD); p.set(8, 3, P.turfD); return p.outline(); };
I.i_raw_meat = p => { p.clear(); p.blob(8, 9, 5, '#d0685f', .3); p.blob(7, 8, 3, '#e88a80', .2); p.rect(10, 3, 3, 5, '#ece6d4'); p.set(12, 3, '#f7f3e4'); p.spark('#a84a44', 5); return p.outline(); };
I.i_cooked_meat = p => { p.clear(); p.blob(8, 9, 5, '#9c5a30', .3); p.blob(7, 8, 3, '#c27a44', .2); p.rect(10, 3, 3, 5, '#ece6d4'); p.spark('#6f3c1c', 6); return p.outline(); };
I.i_raw_fowl = p => { p.clear(); p.blob(7, 9, 4, '#e0a898', .3); p.blob(6, 8, 2, '#f2c8b8', .2); p.line(11, 4, 12, 9, '#ece6d4'); p.line(12, 4, 13, 9, '#ece6d4'); return p.outline(); };
I.i_cooked_fowl = p => { p.clear(); p.blob(7, 9, 4, '#c98a44', .3); p.blob(6, 8, 2, '#e8b06a', .2); p.line(11, 4, 12, 9, '#ece6d4'); p.line(12, 4, 13, 9, '#ece6d4'); return p.outline(); };
I.i_pie = p => { p.clear(); p.rect(2, 8, 12, 5, '#d6a860'); p.rect(3, 6, 10, 3, '#e8c084'); p.rect(4, 5, 8, 2, '#c94a3a'); p.set(6, 5, '#e8563f'); p.set(9, 5, '#e8563f'); p.hline(12, 2, 13, '#a8783c'); return p.outline(); };
I.i_stew = p => { p.clear(); p.rect(2, 7, 12, 6, '#9aa0a8'); p.rect(3, 6, 10, 2, '#6a4a2c'); p.rect(4, 5, 8, 2, '#8a5a34'); p.set(6, 5, '#4fb8d8'); p.set(9, 5, '#c2a173'); p.hline(12, 3, 12, '#6a6c75'); return p.outline(); };

for (const [mat] of Object.entries(MAT_COL)) { /* noop, keeps MAT_COL referenced */ }
for (const kind of ['pick', 'axe', 'shovel', 'blade'])
  for (const mat of ['timber', 'stone', 'copper', 'iron', 'aurorite'])
    I[`i_${kind}_${mat}`] = toolIcon(kind, mat);
for (const slot of ['helm', 'chest', 'legs', 'boots'])
  for (const mat of ['hide', 'copper', 'iron', 'aurorite'])
    I[`i_${slot}_${mat}`] = armorIcon(slot, mat);

// --------------------------------------------------------------- atlas build
export const TILE_NAMES = Object.keys(T);
export const ICON_NAMES = Object.keys(I);

export function buildTileLayers() {
  const names = TILE_NAMES;
  const n = names.length;
  const data = new Uint8Array(TILE * TILE * 4 * n);
  const index = {};
  const ROW = TILE * 4;
  names.forEach((name, i) => {
    const p = new Px(hashString(name) + 7);
    T[name](p);
    // Tiles are authored top-down (row 0 = top edge, the natural way to draw),
    // but GL samples texture V from the bottom up, which rendered every tile
    // upside down on block faces (grass fringe underneath, torch flame at the
    // floor). Flip rows once here so the atlas matches the authored artwork.
    const base = i * TILE * TILE * 4;
    for (let y = 0; y < TILE; y++) {
      data.set(p.d.subarray(y * ROW, y * ROW + ROW), base + (TILE - 1 - y) * ROW);
    }
    index[name] = i;
  });
  return { data, index, count: n };
}

/** returns {canvas} for a single 16x16 tile/icon, scaled */
export function drawToCanvas(name, scale = 4) {
  const fn = T[name] || I[name];
  if (!fn) return null;
  const p = new Px(hashString(name) + 7);
  fn(p);
  const c = document.createElement('canvas');
  c.width = TILE * scale; c.height = TILE * scale;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(TILE, TILE);
  img.data.set(p.d);
  const tmp = document.createElement('canvas');
  tmp.width = TILE; tmp.height = TILE;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, c.width, c.height);
  return c;
}

const _dataUrlCache = new Map();
export function iconDataURL(name, scale = 3) {
  if (_dataUrlCache.has(name)) return _dataUrlCache.get(name);
  const c = drawToCanvas(name, scale);
  const url = c ? c.toDataURL() : '';
  _dataUrlCache.set(name, url);
  return url;
}

/** Renders a pseudo-3D block preview icon from its tile textures */
export function blockIconDataURL(key, texSpec, scale = 3) {
  const ck = 'blk:' + key;
  if (_dataUrlCache.has(ck)) return _dataUrlCache.get(ck);
  const S = 16 * scale;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const topName = typeof texSpec === 'string' ? texSpec : (texSpec.top || texSpec.side);
  const sideName = typeof texSpec === 'string' ? texSpec : (texSpec.front || texSpec.side || texSpec.top);
  const top = drawToCanvas(topName, scale);
  const side = drawToCanvas(sideName, scale);
  if (!top || !side) return '';
  const cx = S / 2, w = S * 0.44, hh = S * 0.25, bodyH = S * 0.34;
  const oy = S * 0.10;
  // top face (rhombus)
  drawParallelogram(ctx, top, [cx, oy], [cx + w, oy + hh], [cx, oy + hh * 2], [cx - w, oy + hh], 1.0);
  // left face
  drawParallelogram(ctx, side, [cx - w, oy + hh], [cx, oy + hh * 2], [cx, oy + hh * 2 + bodyH], [cx - w, oy + hh + bodyH], 0.72);
  // right face
  drawParallelogram(ctx, side, [cx, oy + hh * 2], [cx + w, oy + hh], [cx + w, oy + hh + bodyH], [cx, oy + hh * 2 + bodyH], 0.88);
  const url = c.toDataURL();
  _dataUrlCache.set(ck, url);
  return url;
}

function drawParallelogram(ctx, img, p0, p1, p2, p3, shade) {
  // affine map unit square -> parallelogram (p0 origin, p1-p0 = u, p3-p0 = v)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]);
  ctx.closePath(); ctx.clip();
  const ux = (p1[0] - p0[0]) / img.width, uy = (p1[1] - p0[1]) / img.width;
  const vx = (p3[0] - p0[0]) / img.height, vy = (p3[1] - p0[1]) / img.height;
  ctx.transform(ux, uy, vx, vy, p0[0], p0[1]);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  ctx.restore();
  if (shade < 1) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]);
    ctx.closePath();
    ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
    ctx.fill();
    ctx.restore();
  }
}
