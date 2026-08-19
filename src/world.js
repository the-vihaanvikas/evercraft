// EVERCRAFT - main-thread world manager: chunk streaming, edits, queries, save.

import * as THREE from '../vendor/three.module.js';
import { B, CHUNK_X, CHUNK_Z, WORLD_H, SEA_LEVEL, BLOCKS, block, isSolid } from './blocks.js';
import { rollChestLoot, chestRng } from './loot.js';

// Squared half-diagonal of a chunk's horizontal footprint. Combined with the
// mesh's actual vertical extent this gives a tight bounding sphere without
// walking every vertex component.
const CHUNK_HALF_DIAG_SQ = (CHUNK_X * CHUNK_X + CHUNK_Z * CHUNK_Z) / 4;

const XZ = CHUNK_X * CHUNK_Z;
export const ckey = (x, z) => x + ',' + z;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = null;
    this.heights = null;
    this.biomes = null;
    this.meshes = { solid: null, cutout: null, liquid: null };
    this.dirty = false;
    this.meshing = false;
    this.meshVersion = 0;
    this.hasMesh = false;
  }
  get(x, y, z) {
    if (y < 0 || y >= WORLD_H) return 0;
    return this.blocks[x + z * CHUNK_X + y * XZ];
  }
  set(x, y, z, id) {
    this.blocks[x + z * CHUNK_X + y * XZ] = id;
  }
}

export class World {
  constructor(scene, seed, materials) {
    this.scene = scene;
    this.seed = seed;
    // numeric form of the seed, used to make chest loot deterministic
    this.seedNum = (typeof seed === 'number') ? (seed | 0)
      : Array.from(String(seed)).reduce((a, ch) => (Math.imul(a, 31) + ch.charCodeAt(0)) | 0, 0);
    this.materials = materials;
    this.chunks = new Map();
    this.edits = new Map();       // "cx,cz" -> Map(index -> id)
    this.containers = new Map();  // "x,y,z" -> {items:[], kind}
    this.pending = new Map();
    this.meshQueue = [];
    this.genQueue = [];
    this.inflightGen = 0;
    this.inflightMesh = 0;
    this.maxInflight = 3;
    this.renderDist = 7;
    this.reqId = 1;
    this.onChunkReady = null;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.worker = null;
    this.ready = false;
    this._probeCbs = new Map();
    this._probeId = 1;
    this.blockUpdateQueue = [];
    this._fluidQueue = [];
    this._fluidSet = new Set();
    this._fluidT = 0;
    this._fluidTick = 0;
  }

  initWorker(texIndex, savedEdits) {
    return new Promise((resolve) => {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this._onWorker(e.data, resolve);
      const editsObj = {};
      if (savedEdits) for (const k in savedEdits) editsObj[k] = savedEdits[k];
      this.worker.postMessage({ t: 'init', seed: this.seed, texIndex, edits: editsObj });
    });
  }

  _onWorker(m, resolveReady) {
    switch (m.t) {
      case 'ready': this.ready = true; resolveReady && resolveReady(); break;
      case 'chunk': {
        this.inflightGen--;
        const k = ckey(m.cx, m.cz);
        let c = this.chunks.get(k);
        if (!c) { c = new Chunk(m.cx, m.cz); this.chunks.set(k, c); }
        c.blocks = new Uint8Array(m.blocks);
        c.heights = new Uint8Array(m.heights);
        c.biomes = new Uint8Array(m.biomes);
        c.dirty = true;
        this.pending.delete(k);
        break;
      }
      case 'meshed': {
        this.inflightMesh--;
        const k = ckey(m.cx, m.cz);
        const c = this.chunks.get(k);
        if (!c) break;
        this._applyMesh(c, m.mesh);
        c.meshing = false;
        c.hasMesh = true;
        if (this.onChunkReady) this.onChunkReady(c);
        break;
      }
      case 'probe': {
        const cb = this._probeCbs.get(m.id);
        if (cb) { cb(new Int16Array(m.out)); this._probeCbs.delete(m.id); }
        break;
      }
    }
  }

  probe(pts) {
    return new Promise(res => {
      const id = this._probeId++;
      this._probeCbs.set(id, res);
      this.worker.postMessage({ t: 'probe', id, pts });
    });
  }

  _applyMesh(chunk, mesh) {
    for (const part of ['solid', 'cutout', 'liquid']) {
      const data = mesh[part];
      let m = chunk.meshes[part];
      if (!data.count) {
        if (m) { this.group.remove(m); m.geometry.dispose(); chunk.meshes[part] = null; }
        continue;
      }
      let geo;
      if (!m) {
        geo = new THREE.BufferGeometry();
        const mat = this.materials[part];
        m = new THREE.Mesh(geo, mat);
        m.frustumCulled = true;
        m.position.set(chunk.cx * CHUNK_X, 0, chunk.cz * CHUNK_Z);
        m.renderOrder = part === 'liquid' ? 2 : part === 'cutout' ? 1 : 0;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        chunk.meshes[part] = m;
        this.group.add(m);
      } else {
        geo = m.geometry;
      }
      // The worker transfers these buffers, so they are already the right
      // typed arrays and we own them. Wrapping them in `new Float32Array(...)`
      // copied every vertex attribute a second time on the main thread for
      // every chunk - pure waste. Adopt them directly instead.
      geo.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
      geo.setAttribute('layer', new THREE.BufferAttribute(data.lay, 1));
      geo.setAttribute('lt', new THREE.BufferAttribute(data.lt, 2));
      geo.setAttribute('ao', new THREE.BufferAttribute(data.ao, 1));
      geo.setIndex(new THREE.BufferAttribute(data.idx, 1));
      // Bounding sphere from the vertical extent only. X/Z are always the
      // 16x16 chunk footprint, so we just need min/max Y - one cheap strided
      // pass instead of THREE's full three-component vertex walk. Keeping the
      // sphere tight (rather than a fixed full-column radius) is what lets
      // frustum culling actually reject chunks.
      const pos = data.pos;
      let minY = Infinity, maxY = -Infinity;
      for (let i = 1; i < pos.length; i += 3) {
        const v = pos[i];
        if (v < minY) minY = v;
        if (v > maxY) maxY = v;
      }
      if (!(minY <= maxY)) { minY = 0; maxY = 0; }
      const midY = (minY + maxY) / 2, halfY = (maxY - minY) / 2;
      if (!geo.boundingSphere) geo.boundingSphere = new THREE.Sphere();
      geo.boundingSphere.center.set(CHUNK_X / 2, midY, CHUNK_Z / 2);
      geo.boundingSphere.radius = Math.sqrt(CHUNK_HALF_DIAG_SQ + halfY * halfY);
    }
  }

  // ------------------------------------------------------------- streaming
  update(px, pz, budgetMs = 6) {
    const pcx = Math.floor(px / CHUNK_X), pcz = Math.floor(pz / CHUNK_Z);
    const R = this.renderDist;

    // request generation in a spiral
    if (this.inflightGen < this.maxInflight) {
      outer:
      for (let r = 0; r <= R + 1; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const cx = pcx + dx, cz = pcz + dz;
            const k = ckey(cx, cz);
            if (this.chunks.has(k) || this.pending.has(k)) continue;
            this.pending.set(k, 1);
            this.inflightGen++;
            this.worker.postMessage({ t: 'gen', cx, cz, id: this.reqId++ });
            if (this.inflightGen >= this.maxInflight) break outer;
          }
        }
      }
    }

    // mesh chunks whose neighbours exist, nearest first
    if (this.inflightMesh < this.maxInflight) {
      let best = null, bestD = Infinity;
      for (const c of this.chunks.values()) {
        if (!c.dirty || c.meshing || !c.blocks) continue;
        let ok = true;
        for (let dz = -1; dz <= 1 && ok; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const n = this.chunks.get(ckey(c.cx + dx, c.cz + dz));
            if (!n || !n.blocks) { ok = false; break; }
          }
        if (!ok) continue;
        const d = (c.cx - pcx) * (c.cx - pcx) + (c.cz - pcz) * (c.cz - pcz);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best) {
        best.dirty = false;
        best.meshing = true;
        this.inflightMesh++;
        this.worker.postMessage({ t: 'mesh', cx: best.cx, cz: best.cz, id: this.reqId++ });
      }
    }

    // unload far chunks
    const drop = [];
    for (const [k, c] of this.chunks) {
      const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (d > R + 3) {
        for (const p of ['solid', 'cutout', 'liquid']) {
          const m = c.meshes[p];
          if (m) { this.group.remove(m); m.geometry.dispose(); }
        }
        this.chunks.delete(k);
        drop.push(k);
      }
    }
    if (drop.length) this.worker.postMessage({ t: 'drop', keys: drop });

    this._flushBlockUpdates();
  }

  loadedFraction(px, pz, radius) {
    const pcx = Math.floor(px / CHUNK_X), pcz = Math.floor(pz / CHUNK_Z);
    let total = 0, done = 0;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      total++;
      const c = this.chunks.get(ckey(pcx + dx, pcz + dz));
      if (c && c.hasMesh) done++;
    }
    return done / total;
  }

  // ---------------------------------------------------------------- access
  chunkAt(x, z) {
    return this.chunks.get(ckey(Math.floor(x / CHUNK_X), Math.floor(z / CHUNK_Z)));
  }

  getBlock(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= WORLD_H) return 0;
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const c = this.chunks.get(ckey(cx, cz));
    if (!c || !c.blocks) return -1;   // unloaded
    const lx = x - cx * CHUNK_X, lz = z - cz * CHUNK_Z;
    return c.blocks[lx + lz * CHUNK_X + y * XZ];
  }

  isLoaded(x, z) {
    const c = this.chunks.get(ckey(Math.floor(x / CHUNK_X), Math.floor(z / CHUNK_Z)));
    return !!(c && c.blocks);
  }

  setBlock(x, y, z, id, record = true) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= WORLD_H) return false;
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const k = ckey(cx, cz);
    const c = this.chunks.get(k);
    if (!c || !c.blocks) return false;
    const lx = x - cx * CHUNK_X, lz = z - cz * CHUNK_Z;
    const i = lx + lz * CHUNK_X + y * XZ;
    const prevId = c.blocks[i];
    if (prevId === id) return false;
    c.blocks[i] = id;
    c.dirty = true;
    // Invalidate cached animated block-entity lists for this chunk.
    if (id === B.CRATE || c._chestList) c._chestList = null;
    if (id === B.LANTERN || c._lanternList) c._lanternList = null;

    if (record) {
      let e = this.edits.get(k);
      if (!e) { e = new Map(); this.edits.set(k, e); }
      e.set(i, id);
    }
    this.worker.postMessage({ t: 'edit', cx, cz, i, id });

    // mark neighbour chunks dirty when on a border (lighting bleed)
    const mark = (nx, nz) => {
      const n = this.chunks.get(ckey(nx, nz));
      if (n && n.blocks) n.dirty = true;
    };
    if (lx === 0) mark(cx - 1, cz);
    if (lx === CHUNK_X - 1) mark(cx + 1, cz);
    if (lz === 0) mark(cx, cz - 1);
    if (lz === CHUNK_Z - 1) mark(cx, cz + 1);
    // light travels: also dirty diagonal when in corner
    if ((lx === 0 || lx === CHUNK_X - 1) && (lz === 0 || lz === CHUNK_Z - 1)) {
      mark(cx + (lx === 0 ? -1 : 1), cz + (lz === 0 ? -1 : 1));
    }
    // Emissive/opaque changes affect a radius, so nearby chunks must relight.
    // This has to look at the block that was REMOVED as well as the one placed:
    // breaking a torch turns the cell into air (light 0), and only testing the
    // new block left the neighbouring chunks holding the torch's baked light,
    // so a ghost glow lingered around the empty socket.
    const bl = BLOCKS[id], prevBl = BLOCKS[prevId];
    const emitted = Math.max(bl ? bl.light : 0, prevBl ? prevBl.light : 0);
    if (emitted > 4 || lx < 2 || lz < 2 || lx > CHUNK_X - 3 || lz > CHUNK_Z - 3) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) mark(cx + dx, cz + dz);
    }

    this.queueBlockUpdate(x, y, z);
    // wake any liquid that might now flow into / out of this cell
    this._spread(x, y, z);
    return true;
  }

  queueBlockUpdate(x, y, z) {
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      this.blockUpdateQueue.push(x + dx, y + dy, z + dz);
    }
  }

  /** gravity for sand/gravel + plant support checks */
  _flushBlockUpdates() {
    const q = this.blockUpdateQueue;
    if (!q.length) return;
    const limit = Math.min(q.length, 900);
    const done = [];
    for (let i = 0; i < limit; i += 3) {
      const x = q[i], y = q[i + 1], z = q[i + 2];
      const id = this.getBlock(x, y, z);
      if (id <= 0) continue;
      const bl = BLOCKS[id];
      if (!bl) continue;
      if (bl.falls) {
        const below = this.getBlock(x, y - 1, z);
        if (below === 0 || (BLOCKS[below] && BLOCKS[below].liquid)) {
          this.setBlock(x, y, z, 0);
          this.setBlock(x, y - 1, z, id);
          continue;
        }
      }
      if (id === B.TALL_GRASS_TOP) {
        // upper half only survives while its base is there
        if (this.getBlock(x, y - 1, z) !== B.TALL_GRASS) this.setBlock(x, y, z, 0);
      } else if (bl.render === 2 || id === B.CACTUS) { // cross plants need ground
        const below = this.getBlock(x, y - 1, z);
        if (below === 0 || below === B.WATER) this.setBlock(x, y, z, 0);
      }
      // Wall fixtures fall away cleanly when their supporting face is mined.
      if (bl.wallDir !== undefined) {
        const supports = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const [sx, sz] = supports[bl.wallDir & 3];
        if (!isSolid(this.getBlock(x + sx, y, z + sz))) this.setBlock(x, y, z, 0);
      }
      if (bl.door) {
        const other = BLOCKS[this.getBlock(x, y + (bl.doorTop ? -1 : 1), z)];
        const unsupported = !bl.doorTop && !isSolid(this.getBlock(x, y - 1, z));
        if (unsupported || !other || !other.door || other.doorDir !== bl.doorDir ||
          other.open !== bl.open || other.doorTop === bl.doorTop) this.setBlock(x, y, z, 0);
      }
      if (bl.bed) {
        const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const [dx, dz] = dirs[bl.bedDir & 3];
        const ox = x + (bl.bedHead ? -dx : dx), oz = z + (bl.bedHead ? -dz : dz);
        const other = BLOCKS[this.getBlock(ox, y, oz)];
        if (!isSolid(this.getBlock(x, y - 1, z)) || !other || !other.bed ||
          other.bedDir !== bl.bedDir || other.bedHead === bl.bedHead)
          this.setBlock(x, y, z, 0);
      }
    }
    q.splice(0, limit);
  }

  // ------------------------------------------------------------- fluids
  /**
   * Minecraft-style liquid flow.
   *
   * Rules implemented:
   *  - A source block (WATER / LAVA) feeds neighbours forever.
   *  - Flowing blocks carry a level: 7 (next to a source) down to 1. Lava only
   *    reaches level 3, so it spreads a much shorter distance than water.
   *  - Liquid always prefers to fall straight down; a falling column feeds the
   *    next cell at full strength.
   *  - Flowing liquid with no upstream neighbour drains away.
   *  - Water meeting lava makes stone (source) or rubble-free basalt-ish
   *    stone (flowing), which is how you build safely near lava.
   *
   * Cells are queued and ticked on a fixed cadence so flow looks like a
   * spreading wavefront rather than resolving instantly.
   */
  queueFluid(x, y, z) {
    const k = x + ',' + y + ',' + z;
    if (this._fluidSet.has(k)) return;
    this._fluidSet.add(k);
    this._fluidQueue.push(x, y, z);
  }

  /** Fluid info for an id, or null when it is not a liquid. */
  _fluid(id) {
    if (id === B.WATER) return { kind: 'water', level: 8, source: true };
    if (id === B.LAVA) return { kind: 'lava', level: 4, source: true };
    const b = BLOCKS[id];
    if (!b || !b.flowing) return null;
    return {
      kind: b.still === B.WATER ? 'water' : 'lava',
      level: b.level,
      source: false,
    };
  }

  /** Block id for a given kind + level (level<=0 means air). */
  _fluidId(kind, level) {
    if (level <= 0) return B.AIR;
    if (kind === 'water') {
      if (level >= 8) return B.WATER;
      return B.WATER_F7 + (7 - Math.min(7, level));
    }
    if (level >= 4) return B.LAVA;
    return B.LAVA_F3 + (3 - Math.min(3, level));
  }

  /** Can liquid displace whatever currently occupies this cell? */
  _canFlowInto(id) {
    if (id === B.AIR) return true;
    const b = BLOCKS[id];
    if (!b) return false;
    // washes away plants and torches, like Minecraft
    return !b.liquid && b.noCollide && b.render !== 5 && b.render !== 6;
  }

  tickFluids(dt) {
    this._fluidT = (this._fluidT || 0) + dt;
    const STEP = 0.16;                 // visible delay after a block opens
    if (this._fluidT < STEP) return;
    // Subtract the step rather than zeroing: zeroing threw away the remainder
    // every tick, so the effective rate drifted below the intended one and
    // spills crawled. Clamp the catch-up so a long stall can't burst.
    this._fluidT = Math.min(this._fluidT - STEP, STEP * 2);
    this._fluidTick++;
    const allowLava = this._fluidTick % 3 === 0; // lava advances about 3x slower

    const q = this._fluidQueue;
    if (!q.length) return;
    // process a bounded slice so a huge spill can't stall a frame
    const budget = Math.min(q.length, 3000);
    const batch = q.splice(0, budget);
    for (let i = 0; i < batch.length; i += 3) {
      this._fluidSet.delete(batch[i] + ',' + batch[i + 1] + ',' + batch[i + 2]);
    }
    for (let i = 0; i < batch.length; i += 3) {
      this._stepFluid(batch[i], batch[i + 1], batch[i + 2], allowLava);
    }
  }

  _stepFluid(x, y, z, allowLava = true) {
    if (y < 1 || y >= WORLD_H) return;
    const id = this.getBlock(x, y, z);
    const self = this._fluid(id);

    // --- an empty cell: see whether anything upstream should fill it
    if (!self) {
      if (!this._canFlowInto(id)) return;
      const fed = this._incomingLevel(x, y, z);
      if (fed.level > 0) {
        if (fed.kind === 'lava' && !allowLava) { this.queueFluid(x, y, z); return; }
        this.setBlock(x, y, z, this._fluidId(fed.kind, fed.level));
        this._spread(x, y, z);
      }
      return;
    }

    if (self.kind === 'lava' && !allowLava) { this.queueFluid(x, y, z); return; }

    // --- water + lava interaction
    if (this._mixed(x, y, z, self)) return;

    // --- flowing liquid must still be fed, or it drains
    if (!self.source) {
      const fed = this._incomingLevel(x, y, z);
      if (fed.level <= 0 || fed.kind !== self.kind) {
        this.setBlock(x, y, z, B.AIR);
        this._spread(x, y, z);
        return;
      }
      if (fed.level !== self.level) {
        this.setBlock(x, y, z, this._fluidId(self.kind, fed.level));
        this._spread(x, y, z);
        return;
      }
    }

    // --- outflow, in priority order -------------------------------------
    // Liquid falls before it spreads. Previously every neighbour (including
    // the four sides) was queued unconditionally, so a stream poured sideways
    // at the same time as it fell and puddles crept out in all directions
    // instead of running downhill. Now: if the cell below can accept liquid we
    // ONLY feed downward, exactly like the game this mimics.
    const belowId = this.getBlock(x, y - 1, z);
    const belowF = this._fluid(belowId);
    const canFall = this._canFlowInto(belowId) ||
      (belowF && belowF.kind === self.kind && !belowF.source &&
        belowF.level < (self.kind === 'water' ? 7 : 3));
    if (canFall) {
      this.queueFluid(x, y - 1, z);
      return;
    }

    // Blocked below: spread outward, but only if we still have strength left.
    const out = self.source
      ? (self.kind === 'water' ? 7 : 3)
      : self.level - 1;
    if (out > 0) {
      // Prefer directions that reach a drop soonest instead of spreading in a
      // perfect diamond across a ledge. This is the characteristic downhill
      // path selection used by Minecraft-style fluids.
      for (const [dx, dz] of this._flowDirections(x, y, z, self.kind))
        this.queueFluid(x + dx, y, z + dz);
    }
    // always let the cell above re-evaluate (it may need to drain)
    this.queueFluid(x, y + 1, z);
  }

  /** Horizontal directions that lead to the nearest available downward step. */
  _flowDirections(x, y, z, kind) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const scored = [];
    const maxSearch = kind === 'water' ? 4 : 2;
    for (const [dx, dz] of dirs) {
      const nx = x + dx, nz = z + dz;
      const id = this.getBlock(nx, y, nz);
      const li = this._fluid(id);
      if (!this._canFlowInto(id) && !(li && li.kind === kind && !li.source)) continue;
      const below = this.getBlock(nx, y - 1, nz);
      if (this._canFlowInto(below)) { scored.push({ dx, dz, cost: 0 }); continue; }
      scored.push({ dx, dz, cost: this._dropDistance(nx, y, nz, kind, maxSearch, x, z) });
    }
    if (!scored.length) return [];
    const best = Math.min(...scored.map(s => s.cost));
    // If no reachable drop exists every open side is equally valid.
    return scored.filter(s => best > maxSearch || s.cost === best).map(s => [s.dx, s.dz]);
  }

  _dropDistance(sx, y, sz, kind, max, blockX, blockZ) {
    const queue = [[sx, sz, 0]];
    const seen = new Set([`${sx},${sz}`, `${blockX},${blockZ}`]);
    for (let qi = 0; qi < queue.length; qi++) {
      const [x, z, dist] = queue[qi];
      if (dist >= max) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, key = `${nx},${nz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const id = this.getBlock(nx, y, nz);
        const li = this._fluid(id);
        if (!this._canFlowInto(id) && !(li && li.kind === kind && !li.source)) continue;
        if (this._canFlowInto(this.getBlock(nx, y - 1, nz))) return dist + 1;
        queue.push([nx, nz, dist + 1]);
      }
    }
    return max + 1;
  }

  /**
   * Strongest supply reaching this cell.
   * Falling liquid from directly above always wins at full strength.
   */
  _incomingLevel(x, y, z) {
    const above = this._fluid(this.getBlock(x, y + 1, z));
    if (above) return { kind: above.kind, level: above.kind === 'water' ? 7 : 3 };

    let best = 0, kind = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nf = this._fluid(this.getBlock(x + dx, y, z + dz));
      if (!nf) continue;
      // a source feeds at max; flowing liquid feeds one level weaker
      const give = nf.source
        ? (nf.kind === 'water' ? 7 : 3)
        : nf.level - 1;
      if (give > best) { best = give; kind = nf.kind; }
    }
    return { kind, level: best };
  }

  /** Water/lava contact conversion. Returns true if the cell was consumed. */
  _mixed(x, y, z, self) {
    const other = self.kind === 'water' ? 'lava' : 'water';
    let touching = false;
    for (const [dx, dy, dz] of
      [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
      const nf = this._fluid(this.getBlock(x + dx, y + dy, z + dz));
      if (nf && nf.kind === other) { touching = true; break; }
    }
    if (!touching) return false;
    // lava turns to stone where water reaches it; water boils off over lava
    if (self.kind === 'lava') {
      this.setBlock(x, y, z, self.source ? B.STONE : B.BASALT);
      this._spread(x, y, z);
      return true;
    }
    if (!self.source) {
      this.setBlock(x, y, z, B.AIR);
      this._spread(x, y, z);
      return true;
    }
    return false;
  }

  /** Re-examine this cell's neighbourhood on the next fluid tick. */
  _spread(x, y, z) {
    this.queueFluid(x, y - 1, z);
    this.queueFluid(x, y + 1, z);
    this.queueFluid(x + 1, y, z);
    this.queueFluid(x - 1, y, z);
    this.queueFluid(x, y, z + 1);
    this.queueFluid(x, y, z - 1);
    this.queueFluid(x, y, z);
  }

  /**
   * True when nothing opaque stands between this point and the sky.
   * Used for daylight burning: mobs sheltering in a cave, under a tree canopy
   * or beneath any solid roof must be safe, but a mob caught in the open at
   * dawn should catch fire.
   */
  hasSkyAccess(x, y, z) {
    const fx = Math.floor(x), fz = Math.floor(z);
    if (!this.isLoaded(fx, fz)) return false;
    for (let yy = Math.floor(y) + 1; yy < WORLD_H; yy++) {
      const id = this.getBlock(fx, yy, fz);
      if (id <= 0) continue;
      const b = BLOCKS[id];
      if (!b) continue;
      // anything that meaningfully blocks light shelters the mob
      if (b.opacity >= 8 || (b.render === 0 && !b.blockEntity)) return false;
    }
    return true;
  }

  biomeAt(x, z) {
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const c = this.chunks.get(ckey(cx, cz));
    if (!c || !c.biomes) return 2;
    const lx = Math.floor(x) - cx * CHUNK_X, lz = Math.floor(z) - cz * CHUNK_Z;
    return c.biomes[lx + lz * CHUNK_X];
  }
  heightAt(x, z) {
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const c = this.chunks.get(ckey(cx, cz));
    if (!c || !c.heights) return SEA_LEVEL;
    const lx = Math.floor(x) - cx * CHUNK_X, lz = Math.floor(z) - cz * CHUNK_Z;
    return c.heights[lx + lz * CHUNK_X];
  }
  /**
   * Y of the first free cell above the topmost SOLID **or LIQUID** surface.
   * Unlike `heightAt`/`surfaceY` this stops at a water or lava top, which is
   * what weather splashes and surface effects need — rain has to break on the
   * sea, not on the seabed underneath it.
   * Returns null when the column is not loaded.
   * @returns {{y:number, liquid:number}|null} y = splash height, liquid = block id (0 if solid)
   */
  splashSurface(x, z) {
    const fx = Math.floor(x), fz = Math.floor(z);
    if (!this.isLoaded(fx, fz)) return null;
    // start a little above the terrain height so we catch standing water
    const start = Math.min(WORLD_H - 1, Math.max(this.heightAt(fx, fz) + 12, SEA_LEVEL + 4));
    for (let y = start; y > 0; y--) {
      const id = this.getBlock(fx, y, fz);
      if (id <= 0) continue;
      const b = BLOCKS[id];
      if (!b) continue;
      if (b.liquid) return { y: y + 1, liquid: id };
      if (isSolid(id)) return { y: y + 1, liquid: 0 };
    }
    return null;
  }

  /** first non-solid y above terrain at x,z (for spawning) */
  surfaceY(x, z) {
    for (let y = WORLD_H - 1; y > 1; y--) {
      const id = this.getBlock(x, y, z);
      if (id > 0 && isSolid(id)) return y + 1;
    }
    return SEA_LEVEL + 1;
  }

  /**
   * Cheap main-thread light estimate for block entities (chests). The real
   * flood-fill lives in the worker, so we approximate: sky light is full
   * unless something solid is stacked overhead, and block light is taken from
   * the brightest emitter within a small radius.
   * @returns [sky 0..1, block 0..1]
   */
  lightProbe(x, y, z) {
    let sky = 1;
    for (let yy = y + 1; yy < Math.min(WORLD_H, y + 24); yy++) {
      const id = this.getBlock(x, yy, z);
      if (id > 0) {
        const b = BLOCKS[id];
        if (b && b.opacity >= 15) { sky = 0; break; }
        if (b && b.opacity > 0) sky = Math.min(sky, 0.45);
      }
    }
    let blk = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const id = this.getBlock(x + dx, y + dy, z + dz);
          if (!id) continue;
          const b = BLOCKS[id];
          if (!b || !b.light) continue;
          const dist = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
          blk = Math.max(blk, (b.light - dist) / 15);
        }
      }
    }
    return [sky, Math.max(0, Math.min(1, blk))];
  }

  // ------------------------------------------------------------ containers
  containerAt(x, y, z, create = false, kind = 'crate', loot = false) {
    const k = `${x},${y},${z}`;
    let c = this.containers.get(k);
    if (!c && create) {
      if (kind === 'smelter') {
        c = { kind, input: null, fuel: null, out: null, burn: 0, burnMax: 0, cook: 0 };
      } else {
        // `loot` marks a chest the world generated rather than one the player
        // placed. Its contents are rolled lazily on first open and then stored
        // like any other container, so a chest is only ever filled once.
        c = { kind, items: new Array(27).fill(null) };
        if (loot) {
          c.items = rollChestLoot(chestRng(x, y, z, this.seedNum));
          c.looted = true;
        }
      }
      this.containers.set(k, c);
    }
    return c || null;
  }

  /** True if a chest at this position was placed by world generation. */
  isNaturalChest(x, y, z) {
    return !this.containers.has(`${x},${y},${z}`) &&
      this.getBlock(x, y, z) === B.CRATE;
  }
  removeContainer(x, y, z) {
    const k = `${x},${y},${z}`;
    const c = this.containers.get(k);
    this.containers.delete(k);
    return c;
  }

  // ------------------------------------------------------------------ save
  serializeEdits() {
    const o = {};
    for (const [k, m] of this.edits) {
      const arr = new Array(m.size * 2);
      let i = 0;
      for (const [idx, id] of m) { arr[i++] = idx; arr[i++] = id; }
      o[k] = arr;
    }
    return o;
  }
  serializeContainers() {
    const o = {};
    for (const [k, c] of this.containers) o[k] = c;
    return o;
  }
  loadContainers(o) {
    this.containers.clear();
    if (!o) return;
    for (const k in o) this.containers.set(k, o[k]);
  }
}
