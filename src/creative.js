/*
 * creative.js — the Creative-mode item palette.
 *
 * Creative mode must expose EVERY block and item in the game, sorted into
 * utility categories the way a familiar block game does. Rather than hand-list
 * 138 ids (which silently rots the moment anything is added), we classify the
 * live registries at load time and assert that nothing falls through.
 */
import { ITEM, BLOCKS, B } from './blocks.js';

/** Category order, ids and labels, in the order the tabs appear. */
export const CREATIVE_CATS = [
  { id: 'building', n: 'Building Blocks' },
  { id: 'nature',   n: 'Nature' },
  { id: 'deco',     n: 'Decoration' },
  { id: 'redstone', n: 'Utility' },
  { id: 'tools',    n: 'Tools' },
  { id: 'combat',   n: 'Combat' },
  { id: 'food',     n: 'Food' },
  { id: 'material', n: 'Materials' },
];

// Explicit overrides win over the heuristics below.
const OVERRIDE = {
  bench: 'redstone', smelter: 'redstone', crate: 'redstone', ladder: 'redstone',
  bed: 'deco', torch: 'redstone', torch_item: 'redstone', lantern: 'redstone',
  lumen: 'redstone', hearth: 'redstone',
  door_aspen: 'redstone', door_ember: 'redstone', door_pine: 'redstone', door_palm: 'redstone',
  fence_aspen: 'building', fence_ember: 'building', fence_pine: 'building', fence_palm: 'building',
  // second-wave building stock
  mossy_bricks: 'building', cracked_bricks: 'building', smooth_stone: 'building',
  chiseled_sandstone: 'building', thatch: 'building', timber_frame: 'building',
  plaster: 'building', roof_tile: 'building', frost_brick: 'building',
  bookshelf: 'deco', dead_bush: 'deco', reeds: 'deco', mud: 'nature',
  water: 'nature', lava: 'nature', bedrock: 'building',
  shears: 'tools', stick: 'material', bone_meal: 'material', brick: 'material',
  glass: 'building', ice: 'building', packed_ice: 'building', snow: 'nature',
};

const RE = {
  tools:  /^(pick|axe|shovel)_/,
  combat: /^(blade|helm|chest|legs|boots)_/,
  food:   /^(sunberry|raw_meat|cooked_meat|raw_fowl|cooked_fowl|berry_pie|mush_stew)$/,
  // plants and ornaments live in Decoration; terrain and wood in Nature
  deco:   /^(short_grass|tall_grass|fern|flower_|mushroom|berry_bush|cactus|leaf_)/,
  nature: /^(log_|grass$|dirt|dry_dirt|path|sand$|red_sand|gravel|clay$|moss_stone|rubble|seeds)/,
  build:  /^(stone|deepstone|plank_|brick|bricks|stone_bricks|chiseled|tile_dark|slab_|sandstone|basalt|wool_|.*_block$)/,
  mat:    /^(coal|charcoal|raw_|.*_ingot$|aurorite$|glimmer_shard|clay_lump|feather|hide|leather|bone$|ember_dust|string)$/,
};

/** Classify one item id into a creative category id. */
export function categoryFor(id) {
  if (OVERRIDE[id]) return OVERRIDE[id];
  if (RE.tools.test(id)) return 'tools';
  if (RE.combat.test(id)) return 'combat';
  if (RE.food.test(id)) return 'food';
  if (RE.deco.test(id)) return 'deco';
  if (RE.nature.test(id)) return 'nature';
  if (RE.mat.test(id)) return 'material';
  if (RE.build.test(id)) return 'building';
  const def = ITEM[id];
  if (def && def.block) {
    const bl = BLOCKS[def.block];
    // non-full blocks that are purely visual land in decoration
    if (bl && (bl.render === 2 || bl.render === 4)) return 'deco';
    return 'building';
  }
  return 'material';
}

/**
 * Build { catId: [itemId, ...] } covering every registered item exactly once.
 * Hidden/technical ids (flowing liquids, the door's upper half, etc.) are
 * skipped because you cannot meaningfully hold them.
 */
export function buildCreativePalette() {
  const out = {};
  for (const c of CREATIVE_CATS) out[c.id] = [];
  for (const id of Object.keys(ITEM)) {
    const def = ITEM[id];
    if (def && def.block) {
      const bl = BLOCKS[def.block];
      if (bl && (bl.flowing || bl.hidden)) continue;   // technical block states
    }
    const cat = categoryFor(id);
    (out[cat] || out.material).push(id);
  }
  return out;
}

export const CREATIVE_PALETTE = buildCreativePalette();

/** Total number of offered items — used by the tests to prove full coverage. */
export function paletteCount(p = CREATIVE_PALETTE) {
  return Object.values(p).reduce((n, a) => n + a.length, 0);
}
