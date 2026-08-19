// VOXHAVEN - crafting & smelting recipes (original progression design)

import { B, ITEM, TOOL_KINDS, TOOL_MATS, ARMOR_SLOTS, ARMOR_MATS } from './blocks.js';

/*  Recipe: { id, out:[itemId,count], need:[[itemId|tag, count],...], bench:bool, cat }
    Tags:  '#planks'  '#logs'  '#wool'
*/
export const TAGS = {
  '#planks': ['plank_aspen', 'plank_ember', 'plank_pine', 'plank_palm'],
  '#logs': ['log_aspen', 'log_ember', 'log_pine', 'log_palm'],
  '#wool': ['wool_white', 'wool_red', 'wool_amber', 'wool_teal', 'wool_violet', 'wool_slate'],
  '#stone': ['rubble', 'stone', 'deepstone'],
  '#coal': ['coal', 'charcoal'],
};

export const CATS = ['basics', 'tools', 'armor', 'build', 'light', 'food', 'deco'];

/*  Recipes are SHAPED or SHAPELESS, Minecraft-style.

    Shaped:    pattern rows of single-char keys + a key->ingredient map.
               The pattern may be placed anywhere in the grid (it is trimmed
               and matched by offset), and optionally mirrored.
    Shapeless: an unordered list of ingredients.

    An ingredient is an item id or a '#tag'.
*/
const R = [];
let rid = 0;

/** shaped recipe: rows like ['XXX',' / ',' / '] */
function shaped(cat, out, count, rows, key, bench = false) {
  // trim blank rows/cols so the pattern can float anywhere in the grid
  const grid = rows.map(r => r.split(''));
  const w = Math.max(...grid.map(r => r.length));
  for (const r of grid) while (r.length < w) r.push(' ');
  R.push({
    id: 'r' + (rid++), cat, out, count, bench,
    shaped: true, rows: grid, key,
    need: condense(grid, key),
  });
}
/** shapeless recipe: any arrangement */
function shapeless(cat, out, count, need, bench = false) {
  R.push({ id: 'r' + (rid++), cat, out, count, bench, shaped: false, need });
}
/** collapse a pattern into a [[ingredient,count],...] list (for the book UI) */
function condense(grid, key) {
  const m = new Map();
  for (const row of grid) for (const ch of row) {
    if (ch === ' ') continue;
    const ing = key[ch];
    m.set(ing, (m.get(ing) || 0) + 1);
  }
  return [...m.entries()];
}

// ------------------------------------------------------------------- basics
for (const log of TAGS['#logs']) {
  const plank = log.replace('log_', 'plank_');
  shapeless('basics', plank, 4, [[log, 1]], false);
}
shaped('basics', 'stick', 4, ['P', 'P'], { P: '#planks' });
shaped('basics', 'bench', 1, ['PP', 'PP'], { P: '#planks' });
shaped('basics', 'torch', 4, ['C', 'S'], { C: '#coal', S: 'stick' });
shaped('basics', 'smelter', 1, ['SSS', 'S S', 'SSS'], { S: '#stone' }, true);
shaped('basics', 'crate', 1, ['PPP', 'P P', 'PPP'], { P: '#planks' }, true);
shaped('basics', 'ladder', 3, ['S S', 'SSS', 'S S'], { S: 'stick' }, true);
shaped('basics', 'door_low', 1, ['PP', 'PP', 'PP'], { P: '#planks' }, true);
shaped('basics', 'shears', 1, [' I', 'I '], { I: 'iron_ingot' }, true);
shapeless('basics', 'charcoal', 1, [['#logs', 1], ['ember_dust', 1]], false);
shapeless('basics', 'bone_meal', 3, [['bone', 1]], false);
shapeless('basics', 'leather', 1, [['hide', 2]], false);
// 3x3 compaction blocks
for (const [outId, inId] of [['coal_block', 'coal'], ['copper_block', 'copper_ingot'],
['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'],
['aurorite_block', 'aurorite'], ['glimmer_block', 'glimmer_shard']]) {
  shaped('basics', outId, 1, ['XXX', 'XXX', 'XXX'], { X: inId }, true);
}

// -------------------------------------------------------------------- tools
// Classic silhouettes: pick = 3 across + 2 sticks down; axe = L; shovel = 1 + 2;
// blade = 2 stacked + 1 stick.
const TOOL_SHAPES = {
  pick: ['MMM', ' S ', ' S '],
  axe: ['MM', 'MS', ' S'],
  shovel: ['M', 'S', 'S'],
  blade: ['M', 'M', 'S'],
};
for (const [mat, , matItem] of TOOL_MATS) {
  for (const kind of TOOL_KINDS) {
    const head = matItem === 'plank_any' ? '#planks' : matItem;
    shaped('tools', `${kind}_${mat}`, 1, TOOL_SHAPES[kind],
      { M: head, S: 'stick' }, mat !== 'timber');
  }
}

// -------------------------------------------------------------------- armor
const ARMOR_SHAPES = {
  helm: ['MMM', 'M M'],
  chest: ['M M', 'MMM', 'MMM'],
  legs: ['MMM', 'M M', 'M M'],
  boots: ['M M', 'M M'],
};
for (const [mat, , matItem] of ARMOR_MATS) {
  for (const slot of ARMOR_SLOTS) {
    shaped('armor', `${slot}_${mat}`, 1, ARMOR_SHAPES[slot], { M: matItem }, true);
  }
}

// -------------------------------------------------------------------- build
shaped('build', 'stone_bricks', 4, ['SS', 'SS'], { S: 'stone' }, true);
shaped('build', 'slab_stone', 6, ['SSS'], { S: '#stone' }, true);
shaped('build', 'chiseled', 2, ['B', 'B'], { B: 'stone_bricks' }, true);
shaped('build', 'tile_dark', 4, ['DD', 'DD'], { D: 'deepstone' }, true);
shaped('build', 'bricks', 4, ['BB', 'BB'], { B: 'brick' }, true);
shaped('build', 'sandstone', 1, ['SS', 'SS'], { S: 'sand' });
shaped('build', 'packed_ice', 1, ['II', 'II'], { I: 'ice' }, true);
shaped('build', 'path', 4, ['DD', 'DD'], { D: 'dirt' });
for (const w of TAGS['#wool']) {
  if (w === 'wool_white') continue;
  shapeless('build', w, 1, [['wool_white', 1], [dyeFor(w), 1]], false);
}
function dyeFor(w) {
  return { wool_red: 'sunberry', wool_amber: 'ember_dust', wool_teal: 'aurorite', wool_violet: 'glimmer_shard', wool_slate: 'coal' }[w];
}
shaped('build', 'wool_white', 1, ['TT', 'TT'], { T: 'string' });

// -------------------------------------------------------------------- light
shaped('light', 'lantern', 1, [' I ', 'ILI', ' I '], { I: 'iron_ingot', L: 'lumen' }, true);
shaped('light', 'lumen', 1, ['GG', 'GG'], { G: 'glimmer_shard' }, true);
shapeless('light', 'torch', 8, [['stick', 2], ['ember_dust', 1]], false);

// --------------------------------------------------------------------- food
shaped('food', 'berry_pie', 1, ['BBB', 'SSS', 'CCC'],
  { B: 'sunberry', S: 'seeds', C: 'clay_lump' }, true);
shapeless('food', 'mush_stew', 1, [['mushroom', 2], ['sunberry', 1], ['clay_lump', 2]], true);

// --------------------------------------------------------------------- deco
shapeless('deco', 'glass', 1, [['sand', 1], ['#coal', 1]], true);
shapeless('deco', 'berry_bush', 1, [['sunberry', 3], ['seeds', 1]], false);
shapeless('deco', 'tall_grass', 2, [['seeds', 1]], false);

export const RECIPES = R;

// ----------------------------------------------------------------- smelting
export const SMELT = {
  raw_copper: ['copper_ingot', 1, 6],
  raw_iron: ['iron_ingot', 1, 8],
  raw_gold: ['gold_ingot', 1, 9],
  sand: ['glass', 1, 5],
  clay_lump: ['brick', 1, 5],
  raw_meat: ['cooked_meat', 1, 6],
  raw_fowl: ['cooked_fowl', 1, 5],
  log_aspen: ['charcoal', 1, 7],
  log_ember: ['charcoal', 1, 7],
  log_pine: ['charcoal', 1, 7],
  log_palm: ['charcoal', 1, 7],
  cactus: ['ember_dust', 1, 5],
  stone: ['slab_stone', 1, 6],
  rubble: ['stone', 1, 6],
  ore_aurorite: ['aurorite', 1, 12],
  ore_glimmer: ['glimmer_shard', 2, 14],
};

export const FUEL = {
  coal: 8, charcoal: 7, coal_block: 80, ember_dust: 4,
  plank_aspen: 1.5, plank_ember: 1.5, plank_pine: 1.5, plank_palm: 1.5,
  log_aspen: 2.2, log_ember: 2.2, log_pine: 2.2, log_palm: 2.2,
  stick: 0.5, bench: 3, crate: 4, ladder: 1, door_low: 2,
};

export function tagMatches(tag, itemId) {
  const list = TAGS[tag];
  return list ? list.includes(itemId) : tag === itemId;
}
export function isTag(x) { return typeof x === 'string' && x[0] === '#'; }

// --------------------------------------------------------- grid matching
/**
 * Match a crafting grid against the recipe table, Minecraft-style.
 *
 * @param grid  flat array of length size*size holding {id,count}|null
 * @param size  2 (inventory) or 3 (bench)
 * @param bench true when the 3x3 bench grid is open
 * @returns the matching recipe, or null
 */
export function matchGrid(grid, size, bench) {
  // collect the bounding box of non-empty cells
  let minR = 99, maxR = -1, minC = 99, maxC = -1, filled = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r * size + c]) continue;
      filled++;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
  }
  if (filled === 0) return null;
  const gh = maxR - minR + 1, gw = maxC - minC + 1;

  for (const rec of RECIPES) {
    if (rec.bench && !bench) continue;
    if (rec.shaped) {
      const rows = rec.rows;
      // trim the recipe pattern too
      let pMinR = 99, pMaxR = -1, pMinC = 99, pMaxC = -1;
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          if (rows[r][c] === ' ') continue;
          if (r < pMinR) pMinR = r;
          if (r > pMaxR) pMaxR = r;
          if (c < pMinC) pMinC = c;
          if (c > pMaxC) pMaxC = c;
        }
      }
      const ph = pMaxR - pMinR + 1, pw = pMaxC - pMinC + 1;
      if (ph !== gh || pw !== gw) continue;
      if (ph > size || pw > size) continue;
      // try normal and mirrored orientations
      if (patternFits(grid, size, rows, rec.key, minR, minC, pMinR, pMinC, ph, pw, false) ||
        patternFits(grid, size, rows, rec.key, minR, minC, pMinR, pMinC, ph, pw, true)) {
        return rec;
      }
    } else {
      // shapeless: multiset compare
      const want = [];
      for (const [ing, n] of rec.need) for (let i = 0; i < n; i++) want.push(ing);
      if (want.length !== filled) continue;
      const pool = [];
      for (let i = 0; i < size * size; i++) {
        const s = grid[i];
        if (!s) continue;
        for (let k = 0; k < 1; k++) pool.push(s.id);   // 1 item per slot
      }
      if (pool.length !== want.length) continue;
      const used = new Array(pool.length).fill(false);
      let all = true;
      for (const ing of want) {
        let hit = -1;
        for (let i = 0; i < pool.length; i++) {
          if (used[i]) continue;
          if (ingredientMatches(ing, pool[i])) { hit = i; break; }
        }
        if (hit < 0) { all = false; break; }
        used[hit] = true;
      }
      if (all) return rec;
    }
  }
  return null;
}

function patternFits(grid, size, rows, key, gMinR, gMinC, pMinR, pMinC, ph, pw, mirror) {
  for (let r = 0; r < ph; r++) {
    for (let c = 0; c < pw; c++) {
      const src = rows[pMinR + r][pMinC + (mirror ? pw - 1 - c : c)] || ' ';
      const cell = grid[(gMinR + r) * size + (gMinC + c)];
      if (src === ' ') { if (cell) return false; continue; }
      if (!cell) return false;
      if (!ingredientMatches(key[src], cell.id)) return false;
    }
  }
  // every filled cell must be inside the pattern box
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r * size + c]) continue;
      if (r < gMinR || r >= gMinR + ph || c < gMinC || c >= gMinC + pw) return false;
    }
  }
  return true;
}

export function ingredientMatches(ing, itemId) {
  if (ing === undefined || ing === null) return false;
  return isTag(ing) ? tagMatches(ing, itemId) : ing === itemId;
}
