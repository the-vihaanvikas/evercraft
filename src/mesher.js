// EVERCRAFT - chunk lighting + mesh building (runs inside worker).

import {
  B, CHUNK_X, CHUNK_Z, WORLD_H, BLOCKS, block,
  R_SOLID, R_CUTOUT, R_CROSS, R_LIQUID, R_TORCH, R_LADDER, R_DOOR, R_BED,
} from './blocks.js';

const PAD = CHUNK_X;           // one chunk of padding each side
const PW = CHUNK_X * 3;        // 48
const PXZ = PW * PW;           // 2304
const PSIZE = PXZ * WORLD_H;

// scratch buffers (reused per worker)
let padBlocks = null, padLight = null, lightQueue = null, colTop = null;
function ensureScratch() {
  if (!padBlocks) {
    padBlocks = new Uint8Array(PSIZE);
    padLight = new Uint8Array(PSIZE);      // hi nibble = sky, lo nibble = block
    lightQueue = new Int32Array(1 << 19);
    colTop = new Int32Array(PXZ);          // highest non-air y per padded column
  }
}
const pidx = (x, y, z) => x + z * PW + y * PXZ;

// ------------------------------------------------------------------ tables
// face order: +X, -X, +Y, -Y, +Z, -Z
const FACES = [
  { // +X
    dir: [1, 0, 0], key: 'side',
    corners: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]],
    uvs: [[0, 1], [0, 0], [1, 0], [1, 1]],
    // AO sample basis: for each corner, the two side neighbours and the corner neighbour
    ao: [[[1, 1, 0], [1, 0, 1], [1, 1, 1]], [[1, -1, 0], [1, 0, 1], [1, -1, 1]],
    [[1, -1, 0], [1, 0, -1], [1, -1, -1]], [[1, 1, 0], [1, 0, -1], [1, 1, -1]]],
    shade: 0.80,
  },
  { // -X
    dir: [-1, 0, 0], key: 'side',
    corners: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]],
    uvs: [[0, 1], [0, 0], [1, 0], [1, 1]],
    ao: [[[-1, 1, 0], [-1, 0, -1], [-1, 1, -1]], [[-1, -1, 0], [-1, 0, -1], [-1, -1, -1]],
    [[-1, -1, 0], [-1, 0, 1], [-1, -1, 1]], [[-1, 1, 0], [-1, 0, 1], [-1, 1, 1]]],
    shade: 0.80,
  },
  { // +Y (top)
    dir: [0, 1, 0], key: 'top',
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    ao: [[[-1, 1, 0], [0, 1, 1], [-1, 1, 1]], [[1, 1, 0], [0, 1, 1], [1, 1, 1]],
    [[1, 1, 0], [0, 1, -1], [1, 1, -1]], [[-1, 1, 0], [0, 1, -1], [-1, 1, -1]]],
    shade: 1.0,
  },
  { // -Y (bottom)
    dir: [0, -1, 0], key: 'bottom',
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    ao: [[[-1, -1, 0], [0, -1, -1], [-1, -1, -1]], [[1, -1, 0], [0, -1, -1], [1, -1, -1]],
    [[1, -1, 0], [0, -1, 1], [1, -1, 1]], [[-1, -1, 0], [0, -1, 1], [-1, -1, 1]]],
    shade: 0.55,
  },
  { // +Z
    dir: [0, 0, 1], key: 'side',
    corners: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]],
    uvs: [[0, 1], [0, 0], [1, 0], [1, 1]],
    ao: [[[0, 1, 1], [-1, 0, 1], [-1, 1, 1]], [[0, -1, 1], [-1, 0, 1], [-1, -1, 1]],
    [[0, -1, 1], [1, 0, 1], [1, -1, 1]], [[0, 1, 1], [1, 0, 1], [1, 1, 1]]],
    shade: 0.90,
  },
  { // -Z
    dir: [0, 0, -1], key: 'side',
    corners: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]],
    uvs: [[0, 1], [0, 0], [1, 0], [1, 1]],
    ao: [[[0, 1, -1], [1, 0, -1], [1, 1, -1]], [[0, -1, -1], [1, 0, -1], [1, -1, -1]],
    [[0, -1, -1], [-1, 0, -1], [-1, -1, -1]], [[0, 1, -1], [-1, 0, -1], [-1, 1, -1]]],
    shade: 0.90,
  },
];

// ------------------------------------------------------------ buffer helper
class Buf {
  constructor() {
    this.pos = new Float32Array(4096);
    this.uv = new Float32Array(2730);
    this.lay = new Float32Array(1365);
    this.lt = new Float32Array(2730);
    this.ao = new Float32Array(1365);
    this.idx = new Uint32Array(2048);
    this.v = 0; this.i = 0;
  }
  grow() {
    const need = (this.v + 4) * 3;
    if (need > this.pos.length) {
      const g = a => { const n = new a.constructor(a.length * 2); n.set(a); return n; };
      this.pos = g(this.pos); this.uv = g(this.uv); this.lay = g(this.lay);
      this.lt = g(this.lt); this.ao = g(this.ao);
    }
    if (this.i + 6 > this.idx.length) { const n = new Uint32Array(this.idx.length * 2); n.set(this.idx); this.idx = n; }
  }
  quad(px, py, pz, corners, uvs, layer, lightVals, aoVals, flip) {
    this.grow();
    const v0 = this.v;
    for (let k = 0; k < 4; k++) {
      const c = corners[k];
      this.pos[this.v * 3] = px + c[0];
      this.pos[this.v * 3 + 1] = py + c[1];
      this.pos[this.v * 3 + 2] = pz + c[2];
      this.uv[this.v * 2] = uvs[k][0];
      this.uv[this.v * 2 + 1] = uvs[k][1];
      this.lay[this.v] = layer;
      this.lt[this.v * 2] = lightVals[k * 2];
      this.lt[this.v * 2 + 1] = lightVals[k * 2 + 1];
      this.ao[this.v] = aoVals[k];
      this.v++;
    }
    const I = this.idx;
    if (flip) {
      I[this.i++] = v0 + 1; I[this.i++] = v0 + 2; I[this.i++] = v0 + 3;
      I[this.i++] = v0 + 1; I[this.i++] = v0 + 3; I[this.i++] = v0;
    } else {
      I[this.i++] = v0; I[this.i++] = v0 + 1; I[this.i++] = v0 + 2;
      I[this.i++] = v0; I[this.i++] = v0 + 2; I[this.i++] = v0 + 3;
    }
  }
  out() {
    return {
      pos: this.pos.slice(0, this.v * 3),
      uv: this.uv.slice(0, this.v * 2),
      lay: this.lay.slice(0, this.v),
      lt: this.lt.slice(0, this.v * 2),
      ao: this.ao.slice(0, this.v),
      idx: this.idx.slice(0, this.i),
      count: this.i,
    };
  }
}

// ------------------------------------------------------------------ helpers
let texIndex = null;
export function setTexIndex(ix) { texIndex = ix; }

function layerFor(bl, faceKey, dirMeta) {
  const t = bl.tex;
  if (!t) return 0;
  if (typeof t === 'string') return texIndex[t] ?? 0;
  if (faceKey === 'top') return texIndex[t.top ?? t.side] ?? 0;
  if (faceKey === 'bottom') return texIndex[t.bottom ?? t.side] ?? 0;
  return texIndex[t.side ?? t.top] ?? 0;
}

function isOpaqueId(id) {
  const b = BLOCKS[id];
  // block entities are smaller than a full cube, so they cast no AO
  return !!b && id !== 0 && !b.blockEntity &&
    b.render === R_SOLID && !b.alpha && b.opacity >= 15;
}
function opacityFor(id) { const b = BLOCKS[id]; return b ? b.opacity : 0; }

/** should a face between `self` and `other` be drawn? */
function faceVisible(selfId, otherId) {
  if (otherId === B.AIR) return true;
  const o = BLOCKS[otherId];
  if (!o) return true;
  const s = BLOCKS[selfId];
  // Block entities (chests/lanterns) are smaller than a cube and must not cull
  // the faces of neighbouring terrain.
  if (o.blockEntity) return true;
  if (o.render === R_SOLID && !o.alpha) return false;
  if (selfId === otherId && (s.leaves || s.alpha || s.liquid)) return false;
  if (o.liquid && s.liquid) return false;
  if (o.render === R_SOLID && o.alpha) return selfId !== otherId;
  return true;
}

/** Fluid kind + surface height within its cell. */
function liquidInfo(id) {
  const b = BLOCKS[id];
  if (!b || !b.liquid) return null;
  const kind = (id === B.WATER || b.still === B.WATER) ? 'water' : 'lava';
  const max = kind === 'water' ? 7 : 3;
  // Sources sit one pixel below the cell top. Flowing levels descend smoothly
  // but never become paper-thin, leaving enough side wall to close the mesh.
  const height = b.flowing ? 0.18 + 0.695 * (b.level / max) : 0.875;
  return { kind, height };
}

/**
 * Height at one corner of a liquid top. Average the touching cells of the same
 * fluid, as Minecraft does, so adjacent levels share an identical edge. A
 * source in the sample keeps that corner high and prevents visible pinholes.
 */
function liquidCornerHeight(x, y, z, kind, sx, sz) {
  const cells = [[x, z], [x + sx, z], [x, z + sz], [x + sx, z + sz]];
  let sum = 0, n = 0, source = false;
  for (const [cx, cz] of cells) {
    const li = liquidInfo(padBlocks[pidx(cx, y, cz)]);
    if (!li || li.kind !== kind) continue;
    sum += li.height; n++;
    if (li.height >= 0.874) source = true;
  }
  if (!n) return 0;
  return source ? 0.875 : sum / n;
}

function liquidTopHeights(x, y, z, kind) {
  // corner order matches FACES[+Y]: (0,+Z),(+X,+Z),(+X,-Z),(0,-Z)
  return [
    liquidCornerHeight(x, y, z, kind, -1, 1),
    liquidCornerHeight(x, y, z, kind, 1, 1),
    liquidCornerHeight(x, y, z, kind, 1, -1),
    liquidCornerHeight(x, y, z, kind, -1, -1),
  ];
}

// ----------------------------------------------------------------- lighting
/**
 * Fill padBlocks from provider, then compute sky+block light.
 * provider(cx,cz) -> Uint8Array | null
 */
function buildPadded(cx, cz, provider) {
  ensureScratch();
  padBlocks.fill(0);
  const XZ = CHUNK_X * CHUNK_Z;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const src = provider(cx + dx, cz + dz);
      const ox = (dx + 1) * CHUNK_X, oz = (dz + 1) * CHUNK_Z;
      if (!src) {
        // treat missing neighbours as opaque wall below sea level so we don't
        // leak light; leave as air (rare - neighbours are always generated)
        continue;
      }
      for (let y = 0; y < WORLD_H; y++) {
        const sBase = y * XZ, dBase = y * PXZ;
        for (let z = 0; z < CHUNK_Z; z++) {
          const s0 = sBase + z * CHUNK_X;
          const d0 = dBase + (oz + z) * PW + ox;
          for (let x = 0; x < CHUNK_X; x++) padBlocks[d0 + x] = src[s0 + x];
        }
      }
    }
  }
}

function computeLight() {
  const Q = lightQueue;
  let qHead = 0, qTail = 0;
  const push = (i) => { if (qTail < Q.length) Q[qTail++] = i; };

  // ---- column tops: highest non-air cell per column.
  // Everything above the global top is open sky at full strength, so it needs
  // neither a descent loop nor BFS seeding. This is what makes torch placement
  // cheap: we no longer walk 128 levels of empty air for 2304 columns.
  const top = colTop;
  let globalTop = 0;
  for (let z = 0; z < PW; z++) {
    for (let x = 0; x < PW; x++) {
      let t = -1;
      for (let y = WORLD_H - 1; y >= 0; y--) {
        if (padBlocks[pidx(x, y, z)] !== 0) { t = y; break; }
      }
      top[z * PW + x] = t;
      if (t > globalTop) globalTop = t;
    }
  }

  // clear only the region we will actually compute, then blanket the open sky
  const skyBase = (globalTop + 1) * PXZ;
  padLight.fill(0, 0, Math.min(skyBase, PSIZE));
  if (skyBase < PSIZE) padLight.fill(0xf0, skyBase, PSIZE);

  // ---- sky light: descend columns (only down to the terrain top)
  for (let z = 0; z < PW; z++) {
    for (let x = 0; x < PW; x++) {
      // a column only needs BFS seeding where a neighbour column is taller
      const c = z * PW + x;
      let nMax = -1;
      if (x > 0) nMax = Math.max(nMax, top[c - 1]);
      if (x < PW - 1) nMax = Math.max(nMax, top[c + 1]);
      if (z > 0) nMax = Math.max(nMax, top[c - PW]);
      if (z < PW - 1) nMax = Math.max(nMax, top[c + PW]);

      let level = 15;
      for (let y = globalTop; y >= 0; y--) {
        const i = pidx(x, y, z);
        const id = padBlocks[i];
        const op = opacityFor(id);
        if (op >= 15) { level = 0; }
        else if (op > 0) { level = Math.max(0, level - op); }
        if (level <= 0) break;
        padLight[i] = (level << 4) | (padLight[i] & 0x0f);
        // only seed where light can actually flow sideways into a darker column
        if (level === 15 && y <= nMax) push(i);
      }
    }
  }
  // BFS sky spread
  while (qHead < qTail) {
    const i = Q[qHead++];
    const lvl = padLight[i] >> 4;
    if (lvl <= 1) continue;
    const y = (i / PXZ) | 0, r = i - y * PXZ, z = (r / PW) | 0, x = r - z * PW;
    for (let f = 0; f < 6; f++) {
      const d = FACES[f].dir;
      const nx = x + d[0], ny = y + d[1], nz = z + d[2];
      if (nx < 0 || nz < 0 || ny < 0 || nx >= PW || nz >= PW || ny >= WORLD_H) continue;
      const ni = pidx(nx, ny, nz);
      const op = Math.max(1, opacityFor(padBlocks[ni]));
      if (op >= 15) continue;
      const nl = lvl - op;
      if (nl > (padLight[ni] >> 4)) {
        padLight[ni] = (nl << 4) | (padLight[ni] & 0x0f);
        push(ni);
      }
    }
    if (qHead > 400000 && qHead === qTail) break;
  }

  // ---- block light (emitters only exist at or below the terrain top)
  qHead = 0; qTail = 0;
  const emitTop = Math.min(WORLD_H - 1, globalTop);
  for (let y = 0; y <= emitTop; y++) {
    for (let z = 0; z < PW; z++) {
      const base = y * PXZ + z * PW;
      for (let x = 0; x < PW; x++) {
        const i = base + x;
        const bl = BLOCKS[padBlocks[i]];
        if (bl && bl.light) {
          padLight[i] = (padLight[i] & 0xf0) | bl.light;
          push(i);
        }
      }
    }
  }
  while (qHead < qTail) {
    const i = Q[qHead++];
    const lvl = padLight[i] & 0x0f;
    if (lvl <= 1) continue;
    const y = (i / PXZ) | 0, r = i - y * PXZ, z = (r / PW) | 0, x = r - z * PW;
    for (let f = 0; f < 6; f++) {
      const d = FACES[f].dir;
      const nx = x + d[0], ny = y + d[1], nz = z + d[2];
      if (nx < 0 || nz < 0 || ny < 0 || nx >= PW || nz >= PW || ny >= WORLD_H) continue;
      const ni = pidx(nx, ny, nz);
      const op = Math.max(1, opacityFor(padBlocks[ni]));
      if (op >= 15) continue;
      const nl = lvl - op;
      if (nl > (padLight[ni] & 0x0f)) {
        padLight[ni] = (padLight[ni] & 0xf0) | nl;
        push(ni);
      }
    }
  }
}

// --------------------------------------------------------------- mesh build
const AO_TABLE = [0.42, 0.62, 0.80, 1.0];

function sampleLight(x, y, z) {
  if (y < 0 || y >= WORLD_H) return y < 0 ? 0 : 0xf0;
  if (x < 0 || z < 0 || x >= PW || z >= PW) return 0;
  return padLight[pidx(x, y, z)];
}
function sampleOpaque(x, y, z) {
  if (y < 0 || y >= WORLD_H || x < 0 || z < 0 || x >= PW || z >= PW) return false;
  return isOpaqueId(padBlocks[pidx(x, y, z)]);
}

/**
 * Build meshes for chunk (cx,cz).
 * provider(cx,cz) returns block array for that chunk (already edit-applied).
 */
export function buildChunkMesh(cx, cz, provider) {
  buildPadded(cx, cz, provider);
  computeLight();

  const solid = new Buf();
  const cutout = new Buf();
  const liquid = new Buf();

  const ox = PAD, oz = PAD; // centre chunk origin in padded space
  const XZ = CHUNK_X * CHUNK_Z;
  const center = provider(cx, cz);
  if (!center) return null;

  const lightCorner = (bx, by, bz, face, cornerIdx, isTopSurface) => {
    // average light of the 4 cells touching this vertex on the face side
    const a = FACES[face].ao[cornerIdx];
    const d = FACES[face].dir;
    const s1 = a[0], s2 = a[1], c = a[2];
    const base = sampleLight(bx + d[0], by + d[1], bz + d[2]);
    const l1 = sampleLight(bx + s1[0], by + s1[1], bz + s1[2]);
    const l2 = sampleLight(bx + s2[0], by + s2[1], bz + s2[2]);
    const l3 = sampleLight(bx + c[0], by + c[1], bz + c[2]);
    let sky = 0, blk = 0, n = 0;
    for (const L of [base, l1, l2, l3]) {
      sky += (L >> 4); blk += (L & 0x0f); n++;
    }
    return [(sky / n) / 15, (blk / n) / 15];
  };

  const aoCorner = (bx, by, bz, face, cornerIdx) => {
    const a = FACES[face].ao[cornerIdx];
    const s1 = sampleOpaque(bx + a[0][0], by + a[0][1], bz + a[0][2]) ? 1 : 0;
    const s2 = sampleOpaque(bx + a[1][0], by + a[1][1], bz + a[1][2]) ? 1 : 0;
    const co = sampleOpaque(bx + a[2][0], by + a[2][1], bz + a[2][2]) ? 1 : 0;
    if (s1 && s2) return 0;
    return 3 - (s1 + s2 + co);
  };

  for (let y = 0; y < WORLD_H; y++) {
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const id = center[lx + lz * CHUNK_X + y * XZ];
        if (id === B.AIR) continue;
        const bl = BLOCKS[id];
        if (!bl) continue;
        const bx = ox + lx, by = y, bz = oz + lz;
        const rc = bl.render;

        if (rc === R_CROSS) {
          emitCross(cutout, lx, y, lz, bl, sampleLight(bx, by, bz));
          continue;
        }
        if (rc === R_TORCH) {
          emitTorch(cutout, lx, y, lz, bl);
          continue;
        }
        if (rc === R_LADDER || rc === R_DOOR) {
          emitPanel(cutout, lx, y, lz, bl, bx, by, bz, rc);
          continue;
        }
        if (rc === R_BED) {
          emitBed(cutout, lx, y, lz, bl, bx, by, bz);
          continue;
        }
        // Block entities (chests/lanterns) are drawn on the main thread as animated
        // 3D models, so the chunk mesh must not emit a cube for them.
        if (bl.blockEntity) continue;

        const buf = rc === R_LIQUID ? liquid : (rc === R_CUTOUT ? cutout : solid);

        const selfLiquid = rc === R_LIQUID ? liquidInfo(id) : null;
        const liquidHeights = selfLiquid ? liquidTopHeights(bx, by, bz, selfLiquid.kind) : null;
        for (let f = 0; f < 6; f++) {
          const d = FACES[f].dir;
          const nId = padBlocks[pidx(bx + d[0], by + d[1], bz + d[2])];
          if (by + d[1] < 0 || by + d[1] >= WORLD_H) {
            if (d[1] < 0) continue;
          }

          let corners = FACES[f].corners;
          if (selfLiquid) {
            const other = liquidInfo(nId);
            // Same-fluid faces are internal. The corner-height averaging below
            // guarantees both top quads meet on exactly the same edge.
            if (other && other.kind === selfLiquid.kind) continue;
            if (f === 2) {
              corners = FACES[f].corners.map((c, i) => [c[0], liquidHeights[i], c[2]]);
            } else if (f === 0) {
              corners = [[1, liquidHeights[1], 1], [1, 0, 1], [1, 0, 0], [1, liquidHeights[2], 0]];
            } else if (f === 1) {
              corners = [[0, liquidHeights[3], 0], [0, 0, 0], [0, 0, 1], [0, liquidHeights[0], 1]];
            } else if (f === 4) {
              corners = [[0, liquidHeights[0], 1], [0, 0, 1], [1, 0, 1], [1, liquidHeights[1], 1]];
            } else if (f === 5) {
              corners = [[1, liquidHeights[2], 0], [1, 0, 0], [0, 0, 0], [0, liquidHeights[3], 0]];
            }
            // Opaque neighbours still hide a fluid side/bottom.
            if (other === null && !faceVisible(id, nId)) continue;
          } else if (!faceVisible(id, nId)) continue;

          const layer = layerFor(bl, FACES[f].key);
          const shade = FACES[f].shade;
          const lts = new Float32Array(8);
          const aos = new Float32Array(4);
          let aoSum0 = 0, aoSum1 = 0;
          for (let k = 0; k < 4; k++) {
            const [s, b2] = lightCorner(bx, by, bz, f, k);
            lts[k * 2] = s; lts[k * 2 + 1] = b2;
            const aoLvl = (rc === R_LIQUID || rc === R_CUTOUT) ? 3 : aoCorner(bx, by, bz, f, k);
            aos[k] = AO_TABLE[aoLvl] * shade;
          }
          aoSum0 = aos[0] + aos[2]; aoSum1 = aos[1] + aos[3];
          const flip = aoSum0 < aoSum1;
          buf.quad(lx, y, lz, corners, FACES[f].uvs, layer, lts, aos, flip);
        }
      }
    }
  }

  return {
    solid: solid.out(),
    cutout: cutout.out(),
    liquid: liquid.out(),
  };
}

function emitCross(buf, x, y, z, bl, light) {
  const layer = texIndex[bl.tex] ?? 0;
  const sky = (light >> 4) / 15, blk = (light & 0x0f) / 15;
  const lts = new Float32Array([sky, blk, sky, blk, sky, blk, sky, blk]);
  const aoV = new Float32Array([0.96, 0.82, 0.82, 0.96]);
  const uvs = [[0, 1], [0, 0], [1, 0], [1, 1]];
  const k = 0.146; // inset
  const A = [
    [[k, 1, k], [k, 0, k], [1 - k, 0, 1 - k], [1 - k, 1, 1 - k]],
    [[1 - k, 1, k], [1 - k, 0, k], [k, 0, 1 - k], [k, 1, 1 - k]],
  ];
  // The cutout material is already THREE.DoubleSide, so emitting a manually
  // reversed copy of each quad put two coplanar faces at the exact same depth.
  // That z-fights and makes plants shimmer/flicker as the camera creeps -
  // emit each blade once and let DoubleSide handle the back face.
  for (const c of A) {
    buf.quad(x, y, z, c, uvs, layer, lts, aoV, false);
  }
}

/**
 * Torch: a 2/16-wide post standing on the block floor, 10/16 tall.
 * The four side quads sample the matching 2px-wide strip of the tile so the
 * stick and flame line up exactly; the cap samples the flame rows only.
 */
function emitTorch(buf, x, y, z, bl) {
  const layer = texIndex[bl.tex] ?? 0;
  const headLayer = texIndex.torch_head ?? layer;
  // torches are self-lit: full block light, no sky contribution needed
  const lts = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]);
  const aoV = new Float32Array([1, 1, 1, 1]);

  // Two stacked boxes: a slim 2px stick and a FATTER 4px burning head on top,
  // so the flame end visibly bulges instead of the old uniform post.
  const S = 1 / 16;
  const stickR = 1 * S;        // half-width of the stick  (2px wide)
  const headR = 2 * S;         // half-width of the head   (4px wide)
  const stickTop = 9 * S;      // where the stick ends
  const headTop = 13 * S;      // where the head ends

  // UVs: lower rows of the tile are the stick, upper rows are the flame
  const su0 = 7 / 16, su1 = 9 / 16, sv0 = 0, sv1 = 9 / 16;
  const hu0 = 6 / 16, hu1 = 10 / 16, hv0 = 9 / 16, hv1 = 13 / 16;

  // A wall torch is pushed back against its wall and tilted up and away, the
  // way a real bracket torch sits. `wallDir` is undefined for floor torches.
  const wd = bl.wallDir;
  let ox = 0, oz = 0, lean = 0, lx = 0, lz = 0;
  if (wd !== undefined) {
    //          0=-Z        1=+X       2=+Z       3=-X   (wall it hangs on)
    const push = [[0, 0.30], [-0.30, 0], [0, -0.30], [0.30, 0]][wd];
    ox = push[0]; oz = push[1];
    lean = 0.28;                       // radians of outward tilt
    lx = [0, -1, 0, 1][wd];            // lean direction
    lz = [1, 0, -1, 0][wd];
  }

  // build a box from a half-width + y range, applying offset and lean
  const mk = (r, y0, y1) => {
    const pt = (sx, sy, sz) => {
      // lean scales with height so the base stays on the wall
      const t = lean * (sy - y0) / Math.max(1e-6, y1 - y0) * (wd !== undefined ? 1 : 0);
      return [0.5 + ox + sx * r + lx * t, sy, 0.5 + oz + sz * r + lz * t];
    };
    return [
      [pt(1, y1, 1), pt(1, y0, 1), pt(1, y0, -1), pt(1, y1, -1)],   // +X
      [pt(-1, y1, -1), pt(-1, y0, -1), pt(-1, y0, 1), pt(-1, y1, 1)], // -X
      [pt(-1, y1, 1), pt(1, y1, 1), pt(1, y1, -1), pt(-1, y1, -1)], // +Y
      [pt(-1, y0, 1), pt(1, y0, 1), pt(1, y0, -1), pt(-1, y0, -1)], // -Y
      [pt(-1, y1, 1), pt(-1, y0, 1), pt(1, y0, 1), pt(1, y1, 1)],   // +Z
      [pt(1, y1, -1), pt(1, y0, -1), pt(-1, y0, -1), pt(-1, y1, -1)], // -Z
    ];
  };

  // wall torches start a little higher up the wall
  const baseY = wd !== undefined ? 3 * S : 0;
  const stick = mk(stickR, baseY, stickTop);
  const head = mk(headR, stickTop, headTop);

  const sideUV = [[su0, sv1], [su0, sv0], [su1, sv0], [su1, sv1]];
  const headUV = [[hu0, hv1], [hu0, hv0], [hu1, hv0], [hu1, hv1]];
  const capUV = [[hu0, hv0], [hu1, hv0], [hu1, hv1], [hu0, hv1]];

  // stick: skip its top cap (the head covers it)
  stick.forEach((c, i) => {
    if (i === 2) return;
    buf.quad(x, y, z, c, sideUV, layer, lts, aoV, i === 3);
  });
  // Head: all six faces use a dedicated fully opaque ember material. The old
  // cutout flame silhouette left literal windows through the 3D head.
  head.forEach((c, i) => {
    buf.quad(x, y, z, c, i === 2 || i === 3 ? capUV : headUV, headLayer, lts, aoV, i === 3);
  });
}

function emitPanel(buf, x, y, z, bl, bx, by, bz, rc) {
  const layer = texIndex[typeof bl.tex === 'string' ? bl.tex : bl.tex.side] ?? 0;
  const L = sampleLight(bx, by, bz);
  const sky = Math.max((L >> 4) / 15, (sampleLight(bx, by + 1, bz) >> 4) / 15 * 0.9);
  const blk = (L & 0x0f) / 15;
  const lts = new Float32Array([sky, blk, sky, blk, sky, blk, sky, blk]);
  const aoV = new Float32Array([1, 0.9, 0.9, 1]);
  const uvs = [[0, 1], [0, 0], [1, 0], [1, 1]];

  if (rc === R_LADDER) {
    // A ladder is a FLAT panel hugging one wall, not a centred box. `wallDir`
    // names the wall it is attached to, so the panel sits just in front of
    // that face and the rungs face out into the room.
    const d = 2 / 16;                 // how far the ladder stands off the wall
    const wd = bl.wallDir === undefined ? 0 : bl.wallDir;
    // near/far plane along the axis the ladder is perpendicular to
    let quads;
    if (wd === 0) {          // attached to the -Z wall, faces +Z
      quads = [
        [[1, 1, d], [1, 0, d], [0, 0, d], [0, 1, d]],   // outward face
        [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]],   // against the wall
      ];
    } else if (wd === 2) {   // attached to the +Z wall, faces -Z
      const f = 1 - d;
      quads = [
        [[0, 1, f], [0, 0, f], [1, 0, f], [1, 1, f]],
        [[1, 1, 1], [1, 0, 1], [0, 0, 1], [0, 1, 1]],
      ];
    } else if (wd === 1) {   // attached to the +X wall, faces -X
      const f = 1 - d;
      quads = [
        [[f, 1, 1], [f, 0, 1], [f, 0, 0], [f, 1, 0]],
        [[1, 1, 0], [1, 0, 0], [1, 0, 1], [1, 1, 1]],
      ];
    } else {                 // wd === 3, attached to the -X wall, faces +X
      quads = [
        [[d, 1, 0], [d, 0, 0], [d, 0, 1], [d, 1, 1]],
        [[0, 1, 1], [0, 0, 1], [0, 0, 0], [0, 1, 0]],
      ];
    }
    // One offset panel is enough because the cutout material is DoubleSide.
    // The second panel used to sit exactly on the supporting block's face and
    // z-fight as the camera moved slowly, producing the ladder shimmer.
    buf.quad(x, y, z, quads[0], uvs, layer, lts, aoV, false);
    return;
  }

  // Thin oriented door panel. Opening rotates around a stable hinge while the
  // blocks remain in place, so doorways never jump into an unrelated cell.
  const t = 3 / 16;
  let x0, x1, z0, z1;
  const dir = bl.doorDir & 3;
  if (!bl.open) {
    if ((dir & 1) === 0) { x0 = 0; x1 = 1; z0 = 0.5 - t / 2; z1 = 0.5 + t / 2; }
    else { x0 = 0.5 - t / 2; x1 = 0.5 + t / 2; z0 = 0; z1 = 1; }
  } else if (dir === 0) { x0 = 0; x1 = t; z0 = 0; z1 = 1; }
  else if (dir === 1) { x0 = 0; x1 = 1; z0 = 0; z1 = t; }
  else if (dir === 2) { x0 = 1 - t; x1 = 1; z0 = 0; z1 = 1; }
  else { x0 = 0; x1 = 1; z0 = 1 - t; z1 = 1; }

  const box = boxCorners(x0, 0, z0, x1, 1, z1);
  box.forEach((c, i) => buf.quad(x, y, z, c, uvs, layer, lts, aoV, i === 3));
}

/** Six consistently wound faces for an axis-aligned local-space box. */
function boxCorners(x0, y0, z0, x1, y1, z1) {
  return [
    [[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]],
    [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]],
    [[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]],
  ];
}

/** Low bed frame + mattress, one half per block. */
function emitBed(buf, x, y, z, bl, bx, by, bz) {
  const L = sampleLight(bx, by + 1, bz);
  const sky = (L >> 4) / 15, blk = (L & 0x0f) / 15;
  const lts = new Float32Array([sky, blk, sky, blk, sky, blk, sky, blk]);
  const aoV = new Float32Array([0.96, 0.86, 0.86, 0.96]);
  const uv = [[0, 1], [0, 0], [1, 0], [1, 1]];
  const wood = texIndex.plank_aspen ?? 0;
  const cloth = texIndex[bl.tex] ?? wood;
  const emit = (coords, lay) => boxCorners(...coords).forEach((c, i) =>
    buf.quad(x, y, z, c, uv, lay, lts, aoV, i === 3));

  // Four short legs and a timber rail under the mattress.
  const s = 2 / 16;
  for (const lx of [1 / 16, 13 / 16]) for (const lz of [1 / 16, 13 / 16])
    emit([lx, 0, lz, lx + s, 4 / 16, lz + s], wood);
  emit([0, 3 / 16, 0, 1, 7 / 16, 1], wood);
  emit([1 / 32, 7 / 16, 1 / 32, 31 / 32, 10 / 16, 31 / 32], cloth);

  // A small raised pillow on the head half makes direction readable.
  if (bl.bedHead) {
    let x0 = 2 / 16, x1 = 14 / 16, z0 = 2 / 16, z1 = 7 / 16;
    if (bl.bedDir === 1) { x0 = 9 / 16; x1 = 14 / 16; z0 = 2 / 16; z1 = 14 / 16; }
    else if (bl.bedDir === 2) { z0 = 9 / 16; z1 = 14 / 16; }
    else if (bl.bedDir === 3) { x0 = 2 / 16; x1 = 7 / 16; z0 = 2 / 16; z1 = 14 / 16; }
    emit([x0, 10 / 16, z0, x1, 12 / 16, z1], texIndex.wool_white ?? cloth);
  }
}

export { PW, PAD, pidx };
