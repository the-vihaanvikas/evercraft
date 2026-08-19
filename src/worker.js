// EVERCRAFT - background worker: terrain generation + greedy-ish mesh building.

import { WorldGen } from './worldgen.js';
import { buildChunkMesh, setTexIndex } from './mesher.js';
import { CHUNK_X, CHUNK_Z, WORLD_H } from './blocks.js';

let gen = null;
const chunks = new Map();           // key -> Uint8Array
const meta = new Map();             // key -> {heights,biomes}
const key = (x, z) => x + ',' + z;

function getChunk(cx, cz) {
  const k = key(cx, cz);
  let c = chunks.get(k);
  if (c) return c;
  if (!gen) return null;
  const r = gen.generateChunk(cx, cz);
  chunks.set(k, r.blocks);
  meta.set(k, { heights: r.heights, biomes: r.biomes });
  return r.blocks;
}

function ensureNeighbours(cx, cz) {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) getChunk(cx + dx, cz + dz);
}

self.onmessage = (e) => {
  const m = e.data;
  switch (m.t) {
    case 'init': {
      gen = new WorldGen(m.seed);
      setTexIndex(m.texIndex);
      // apply saved edits before anything is generated
      if (m.edits) {
        for (const k in m.edits) pendingEdits.set(k, m.edits[k]);
      }
      self.postMessage({ t: 'ready' });
      break;
    }
    case 'gen': {
      const { cx, cz, id } = m;
      const k = key(cx, cz);
      let fresh = !chunks.has(k);
      const blocks = getChunk(cx, cz);
      if (!blocks) break;
      if (fresh) applyPending(cx, cz, blocks);
      const md = meta.get(k);
      const copy = blocks.slice();
      self.postMessage({
        t: 'chunk', cx, cz, id, blocks: copy.buffer,
        heights: md.heights.slice().buffer, biomes: md.biomes.slice().buffer,
      }, [copy.buffer]);
      break;
    }
    case 'mesh': {
      const { cx, cz, id } = m;
      ensureNeighbours(cx, cz);
      const k = key(cx, cz);
      if (!chunks.has(k)) break;
      const res = buildChunkMesh(cx, cz, (x, z) => chunks.get(key(x, z)) || null);
      if (!res) break;
      const transfer = [];
      for (const part of ['solid', 'cutout', 'liquid']) {
        const p = res[part];
        transfer.push(p.pos.buffer, p.uv.buffer, p.lay.buffer, p.lt.buffer, p.ao.buffer, p.idx.buffer);
      }
      self.postMessage({ t: 'meshed', cx, cz, id, mesh: res }, transfer);
      break;
    }
    case 'edit': {
      const { cx, cz, i, id } = m;
      const k = key(cx, cz);
      const c = chunks.get(k);
      if (c) c[i] = id;
      else {
        let p = pendingEdits.get(k);
        if (!p) { p = []; pendingEdits.set(k, p); }
        p.push(i, id);
      }
      break;
    }
    case 'edits': {
      // bulk (used on load)
      for (const k in m.edits) {
        const arr = m.edits[k];
        const c = chunks.get(k);
        if (c) { for (let j = 0; j < arr.length; j += 2) c[arr[j]] = arr[j + 1]; }
        else pendingEdits.set(k, arr.slice());
      }
      break;
    }
    case 'drop': {
      for (const k of m.keys) { chunks.delete(k); meta.delete(k); }
      break;
    }
    case 'probe': {
      // height query for spawn / map
      const out = new Int16Array(m.pts.length / 2 * 2);
      for (let i = 0; i < m.pts.length; i += 2) {
        const c = gen.column(m.pts[i], m.pts[i + 1]);
        out[i] = c.h; out[i + 1] = c.biome;
      }
      self.postMessage({ t: 'probe', id: m.id, out: out.buffer }, [out.buffer]);
      break;
    }
  }
};

const pendingEdits = new Map();
function applyPending(cx, cz, blocks) {
  const k = key(cx, cz);
  const p = pendingEdits.get(k);
  if (!p) return;
  for (let j = 0; j < p.length; j += 2) blocks[p[j]] = p[j + 1];
  pendingEdits.delete(k);
}
