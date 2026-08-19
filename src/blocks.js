// VOXHAVEN - block & item registry (original design)

export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const WORLD_H = 128;
export const SEA_LEVEL = 46;

// ---------------------------------------------------------------- block ids
export const B = {
  AIR: 0, STONE: 1, DEEPSTONE: 2, DIRT: 3, GRASS: 4, SAND: 5, RED_SAND: 6,
  GRAVEL: 7, CLAY: 8, SNOW: 9, ICE: 10, WATER: 11, LAVA: 12, BEDROCK: 13,
  BASALT: 14, MOSS_STONE: 15, RUBBLE: 16, SANDSTONE: 17,
  LOG_ASPEN: 18, LEAF_ASPEN: 19, LOG_EMBER: 20, LEAF_EMBER: 21,
  LOG_PINE: 22, LEAF_PINE: 23, LOG_PALM: 24, LEAF_PALM: 25,
  PLANK_ASPEN: 26, PLANK_EMBER: 27, PLANK_PINE: 28, PLANK_PALM: 29,
  ORE_COAL: 30, ORE_COPPER: 31, ORE_IRON: 32, ORE_GOLD: 33,
  ORE_AURORITE: 34, ORE_GLIMMER: 35,
  GLASS: 36, BRICKS: 37, STONE_BRICKS: 38, LUMEN: 39,
  BENCH: 40, SMELTER: 41, SMELTER_LIT: 42, CRATE: 43,
  TORCH: 44, LANTERN: 45, LADDER: 46,
  TALL_GRASS: 47, FERN: 48, FLOWER_SUN: 49, FLOWER_DUSK: 50, MUSHROOM: 51,
  BERRY_BUSH: 52, CACTUS: 53,
  DOOR_LOW: 54, DOOR_TOP: 55,
  WOOL_WHITE: 56, WOOL_RED: 57, WOOL_AMBER: 58, WOOL_TEAL: 59,
  WOOL_VIOLET: 60, WOOL_SLATE: 61,
  PACKED_ICE: 62, DRY_DIRT: 63, PATH: 64, COAL_BLOCK: 65,
  COPPER_BLOCK: 66, IRON_BLOCK: 67, GOLD_BLOCK: 68, AURORITE_BLOCK: 69,
  GLIMMER_BLOCK: 70, SLAB_STONE: 71, CHISELED: 72, TILE_DARK: 73,
  SHORT_GRASS: 74, TALL_GRASS_TOP: 75,
  // Flowing liquid levels. The voxel array is one byte per block with no
  // metadata, so each falloff level needs its own id. Level 7 is closest to
  // the source, level 1 is the thin leading edge.
  WATER_F7: 76, WATER_F6: 77, WATER_F5: 78, WATER_F4: 79,
  WATER_F3: 80, WATER_F2: 81, WATER_F1: 82,
  LAVA_F3: 83, LAVA_F2: 84, LAVA_F1: 85,

  // Wall-mounted variants. Same no-metadata constraint as the fluids: facing
  // has to live in the block id. Order is the standard dir convention used
  // everywhere else in this codebase: 0 = -Z, 1 = +X, 2 = +Z, 3 = -X, and the
  // value names the wall the fixture is ATTACHED to.
  LADDER_N: 86, LADDER_E: 87, LADDER_S: 88, LADDER_W: 89,
  TORCH_N: 90, TORCH_E: 91, TORCH_S: 92, TORCH_W: 93,
};

/** wall-mounted ladder ids indexed by attach dir (0=-Z,1=+X,2=+Z,3=-X) */
export const LADDER_DIR = [86, 87, 88, 89];
/** wall-mounted torch ids indexed by attach dir */
export const TORCH_DIR = [90, 91, 92, 93];

// render classes
export const R_SOLID = 0;   // full opaque cube
export const R_CUTOUT = 1;  // full cube w/ alpha (glass=own pass? no: leaves)
export const R_CROSS = 2;   // X-shaped plant
export const R_LIQUID = 3;  // water / lava
export const R_TORCH = 4;   // small post
export const R_LADDER = 5;  // flat panel on wall
export const R_DOOR = 6;    // thin panel

const D = [];
function def(id, o) { D[id] = Object.assign({ id }, o); return D[id]; }

/*  fields:
    n     display name
    tex   string | {top,bottom,side} | {top,bottom,side,front}
    render  render class (default R_SOLID)
    opacity light attenuation (15 = blocks sky)
    light   emitted light level
    hard    mining time base (seconds w/ bare hand baseline)
    tool    'pick'|'axe'|'shovel'|'shears'|null
    tier    min tool tier to yield a drop (0 = always)
    drop    item id dropped (default own item)
    noCollide  true = walk-through
    liquid  true
*/
def(B.STONE, { n: 'Stone', tex: 'stone', hard: 1.5, tool: 'pick', tier: 1, drop: 'rubble' });
def(B.DEEPSTONE, { n: 'Deepstone', tex: 'deepstone', hard: 2.6, tool: 'pick', tier: 1, drop: 'rubble' });
def(B.DIRT, { n: 'Soil', tex: 'dirt', hard: 0.6, tool: 'shovel' });
def(B.DRY_DIRT, { n: 'Parched Soil', tex: 'dry_dirt', hard: 0.6, tool: 'shovel' });
def(B.PATH, { n: 'Trodden Path', tex: { top: 'path_top', bottom: 'dirt', side: 'path_side' }, hard: 0.6, tool: 'shovel', drop: 'dirt' });
def(B.GRASS, { n: 'Verdant Turf', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, hard: 0.7, tool: 'shovel', drop: 'dirt' });
def(B.SAND, { n: 'Sand', tex: 'sand', hard: 0.55, tool: 'shovel', falls: true });
def(B.RED_SAND, { n: 'Rust Sand', tex: 'red_sand', hard: 0.55, tool: 'shovel', falls: true });
def(B.GRAVEL, { n: 'Gravel', tex: 'gravel', hard: 0.7, tool: 'shovel', falls: true });
def(B.CLAY, { n: 'Clay', tex: 'clay', hard: 0.75, tool: 'shovel', drop: 'clay_lump', dropCount: 4 });
def(B.SNOW, { n: 'Snowpack', tex: { top: 'snow', bottom: 'dirt', side: 'snow_side' }, hard: 0.5, tool: 'shovel' });
def(B.ICE, { n: 'Ice', tex: 'ice', hard: 0.6, tool: 'pick', opacity: 2, alpha: true, render: R_CUTOUT, drop: null });
def(B.PACKED_ICE, { n: 'Packed Ice', tex: 'packed_ice', hard: 1.1, tool: 'pick' });
def(B.WATER, { n: 'Water', tex: 'water', render: R_LIQUID, liquid: true, noCollide: true, opacity: 2, hard: -1 });
def(B.LAVA, { n: 'Molten Rock', tex: 'lava', render: R_LIQUID, liquid: true, noCollide: true, light: 15, opacity: 15, hard: -1 });

// Flowing variants: same look and physics as their source block but they are
// transient — the liquid tick rebuilds them from whatever still feeds them.
for (let i = 7; i >= 1; i--) {
  def(B.WATER_F7 + (7 - i), {
    n: 'Water', tex: 'water', render: R_LIQUID, liquid: true, noCollide: true,
    opacity: 2, hard: -1, drop: null, flowing: true, level: i, still: B.WATER,
  });
}
for (let i = 3; i >= 1; i--) {
  def(B.LAVA_F3 + (3 - i), {
    n: 'Molten Rock', tex: 'lava', render: R_LIQUID, liquid: true, noCollide: true,
    light: 15, opacity: 15, hard: -1, drop: null, flowing: true, level: i, still: B.LAVA,
  });
}
def(B.BEDROCK, { n: 'Worldshell', tex: 'bedrock', hard: -1 });
def(B.BASALT, { n: 'Basalt', tex: 'basalt', hard: 3.2, tool: 'pick', tier: 2 });
def(B.MOSS_STONE, { n: 'Mossy Stone', tex: 'moss_stone', hard: 1.6, tool: 'pick', tier: 1 });
def(B.RUBBLE, { n: 'Rubble', tex: 'rubble', hard: 1.7, tool: 'pick', tier: 1 });
def(B.SANDSTONE, { n: 'Sandstone', tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone_side' }, hard: 1.1, tool: 'pick', tier: 1 });

def(B.LOG_ASPEN, { n: 'Aspen Log', tex: { top: 'log_aspen_top', bottom: 'log_aspen_top', side: 'log_aspen_side' }, hard: 1.4, tool: 'axe', wood: 'aspen' });
def(B.LOG_EMBER, { n: 'Emberwood Log', tex: { top: 'log_ember_top', bottom: 'log_ember_top', side: 'log_ember_side' }, hard: 1.5, tool: 'axe', wood: 'ember' });
def(B.LOG_PINE, { n: 'Pine Log', tex: { top: 'log_pine_top', bottom: 'log_pine_top', side: 'log_pine_side' }, hard: 1.4, tool: 'axe', wood: 'pine' });
def(B.LOG_PALM, { n: 'Palm Log', tex: { top: 'log_palm_top', bottom: 'log_palm_top', side: 'log_palm_side' }, hard: 1.3, tool: 'axe', wood: 'palm' });
def(B.LEAF_ASPEN, { n: 'Aspen Leaves', tex: 'leaf_aspen', render: R_CUTOUT, opacity: 1, hard: 0.28, leaves: true, sapling: B.LOG_ASPEN });
def(B.LEAF_EMBER, { n: 'Emberwood Leaves', tex: 'leaf_ember', render: R_CUTOUT, opacity: 1, hard: 0.28, leaves: true, sapling: B.LOG_EMBER });
def(B.LEAF_PINE, { n: 'Pine Needles', tex: 'leaf_pine', render: R_CUTOUT, opacity: 1, hard: 0.28, leaves: true, sapling: B.LOG_PINE });
def(B.LEAF_PALM, { n: 'Palm Fronds', tex: 'leaf_palm', render: R_CUTOUT, opacity: 1, hard: 0.28, leaves: true, sapling: B.LOG_PALM });

def(B.PLANK_ASPEN, { n: 'Aspen Planks', tex: 'plank_aspen', hard: 1.1, tool: 'axe' });
def(B.PLANK_EMBER, { n: 'Emberwood Planks', tex: 'plank_ember', hard: 1.1, tool: 'axe' });
def(B.PLANK_PINE, { n: 'Pine Planks', tex: 'plank_pine', hard: 1.1, tool: 'axe' });
def(B.PLANK_PALM, { n: 'Palm Planks', tex: 'plank_palm', hard: 1.1, tool: 'axe' });

def(B.ORE_COAL, { n: 'Coal Seam', tex: 'ore_coal', hard: 2.0, tool: 'pick', tier: 1, drop: 'coal', xp: 1 });
def(B.ORE_COPPER, { n: 'Copper Vein', tex: 'ore_copper', hard: 2.4, tool: 'pick', tier: 2, drop: 'raw_copper', dropCount: 2, xp: 1 });
def(B.ORE_IRON, { n: 'Iron Vein', tex: 'ore_iron', hard: 2.8, tool: 'pick', tier: 3, drop: 'raw_iron', xp: 1 });
// Tier gates (tool tiers: timber 1, stone 2, copper 3, iron 4, aurorite 5).
// Gold + Aurorite need an Iron pick; Glimmer needs an Aurorite pick.
def(B.ORE_GOLD, { n: 'Gold Vein', tex: 'ore_gold', hard: 3.0, tool: 'pick', tier: 4, drop: 'raw_gold', xp: 2 });
def(B.ORE_AURORITE, { n: 'Aurorite Geode', tex: 'ore_aurorite', hard: 3.6, tool: 'pick', tier: 4, drop: 'aurorite', xp: 4, light: 3 });
def(B.ORE_GLIMMER, { n: 'Glimmer Cluster', tex: 'ore_glimmer', hard: 4.2, tool: 'pick', tier: 5, drop: 'glimmer_shard', dropCount: 2, xp: 6, light: 6 });

def(B.GLASS, { n: 'Pane Glass', tex: 'glass', render: R_CUTOUT, opacity: 0, alpha: true, hard: 0.4, drop: null });
def(B.BRICKS, { n: 'Clay Bricks', tex: 'bricks', hard: 1.9, tool: 'pick', tier: 1 });
def(B.STONE_BRICKS, { n: 'Stone Bricks', tex: 'stone_bricks', hard: 1.9, tool: 'pick', tier: 1 });
def(B.CHISELED, { n: 'Chiseled Stone', tex: 'chiseled', hard: 1.9, tool: 'pick', tier: 1 });
def(B.TILE_DARK, { n: 'Slate Tile', tex: 'tile_dark', hard: 2.0, tool: 'pick', tier: 1 });
def(B.SLAB_STONE, { n: 'Cut Stone', tex: 'slab_stone', hard: 1.8, tool: 'pick', tier: 1 });
def(B.LUMEN, { n: 'Lumen Block', tex: 'lumen', hard: 0.5, light: 15 });
def(B.COAL_BLOCK, { n: 'Coal Block', tex: 'coal_block', hard: 2.6, tool: 'pick', tier: 1 });
def(B.COPPER_BLOCK, { n: 'Copper Block', tex: 'copper_block', hard: 2.8, tool: 'pick', tier: 2 });
def(B.IRON_BLOCK, { n: 'Iron Block', tex: 'iron_block', hard: 3.4, tool: 'pick', tier: 2 });
def(B.GOLD_BLOCK, { n: 'Gold Block', tex: 'gold_block', hard: 3.0, tool: 'pick', tier: 3 });
def(B.AURORITE_BLOCK, { n: 'Aurorite Block', tex: 'aurorite_block', hard: 3.8, tool: 'pick', tier: 4, light: 6 });
def(B.GLIMMER_BLOCK, { n: 'Glimmer Block', tex: 'glimmer_block', hard: 4.0, tool: 'pick', tier: 4, light: 12 });

def(B.BENCH, { n: 'Crafting Table', tex: { top: 'bench_top', bottom: 'plank_aspen', side: 'bench_side' }, hard: 1.4, tool: 'axe', use: 'bench' });
def(B.SMELTER, { n: 'Smelter', tex: { top: 'smelter_top', bottom: 'smelter_top', side: 'smelter_side', front: 'smelter_front' }, hard: 2.4, tool: 'pick', tier: 1, use: 'smelter', dir: true });
def(B.SMELTER_LIT, { n: 'Smelter', tex: { top: 'smelter_top', bottom: 'smelter_top', side: 'smelter_side', front: 'smelter_front_lit' }, hard: 2.4, tool: 'pick', tier: 1, use: 'smelter', dir: true, light: 13, drop: 'smelter' });
def(B.CRATE, { n: 'Chest', tex: { top: 'crate_top', bottom: 'crate_top', side: 'crate_side', front: 'crate_front' }, hard: 1.5, tool: 'axe', use: 'crate', dir: true, blockEntity: 'chest', opacity: 0 });

def(B.TORCH, { n: 'Torch', tex: 'torch', render: R_TORCH, noCollide: true, opacity: 0, light: 14, hard: 0.05 });
def(B.LANTERN, { n: 'Lantern', tex: 'lantern', render: R_SOLID, opacity: 0, light: 15, hard: 0.6 });
def(B.LADDER, { n: 'Ladder', tex: 'ladder', render: R_LADDER, noCollide: true, climb: true, opacity: 0, hard: 0.4, dir: true });
// Wall-mounted ladders and torches. `wallDir` is the face they cling to and
// drives the mesher's placement; they drop the plain item so the inventory
// only ever shows one Ladder / Torch.
for (let d = 0; d < 4; d++) {
  def(B.LADDER_N + d, {
    n: 'Ladder', tex: 'ladder', render: R_LADDER, noCollide: true, climb: true,
    opacity: 0, hard: 0.4, wallDir: d, drop: 'ladder', hidden: true,
  });
  def(B.TORCH_N + d, {
    n: 'Torch', tex: 'torch', render: R_TORCH, noCollide: true, opacity: 0,
    light: 14, hard: 0.05, wallDir: d, drop: 'torch', hidden: true,
  });
}

def(B.DOOR_LOW, { n: 'Timber Door', tex: 'door_low', render: R_DOOR, noCollide: false, opacity: 0, hard: 1.0, dir: true, use: 'door' });
def(B.DOOR_TOP, { n: 'Timber Door', tex: 'door_top', render: R_DOOR, noCollide: false, opacity: 0, hard: 1.0, dir: true, use: 'door', drop: 'door_low' });

def(B.SHORT_GRASS, { n: 'Wild Grass', tex: 'short_grass', render: R_CROSS, noCollide: true, opacity: 0, hard: 0.05, drop: 'seeds', dropChance: 0.35 });
def(B.TALL_GRASS, { n: 'Tall Grass', tex: 'tall_grass', render: R_CROSS, noCollide: true, opacity: 0, hard: 0.05, drop: 'seeds', dropChance: 0.5 });
// upper half of a two-block tall grass; always paired with TALL_GRASS below
def(B.TALL_GRASS_TOP, { n: 'Tall Grass', tex: 'tall_grass_top', render: R_CROSS, noCollide: true, opacity: 0, hard: 0.05, drop: null, dropChance: 0 });
def(B.FERN, { n: 'Fern', tex: 'fern', render: R_CROSS, noCollide: true, opacity: 0, hard: 0.05, drop: 'seeds', dropChance: 0.35 });
def(B.FLOWER_SUN, { n: 'Suncap Bloom', tex: 'flower_sun', render: R_CROSS, noCollide: true, opacity: 0, hard: 0.05 });
def(B.FLOWER_DUSK, { n: 'Duskbell', tex: 'flower_dusk', render: R_CROSS, noCollide: true, opacity: 0, hard: 0.05 });
def(B.MUSHROOM, { n: 'Cave Shroom', tex: 'mushroom', render: R_CROSS, noCollide: true, opacity: 0, light: 2, hard: 0.05 });
def(B.BERRY_BUSH, { n: 'Sunberry Bush', tex: 'berry_bush', render: R_CROSS, noCollide: true, opacity: 0, hard: 0.1, drop: 'sunberry', dropCount: 2 });
def(B.CACTUS, { n: 'Spinepear', tex: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' }, hard: 0.5, hurt: 1 });

def(B.WOOL_WHITE, { n: 'Cloud Wool', tex: 'wool_white', hard: 0.8, tool: 'shears' });
def(B.WOOL_RED, { n: 'Crimson Wool', tex: 'wool_red', hard: 0.8, tool: 'shears' });
def(B.WOOL_AMBER, { n: 'Amber Wool', tex: 'wool_amber', hard: 0.8, tool: 'shears' });
def(B.WOOL_TEAL, { n: 'Teal Wool', tex: 'wool_teal', hard: 0.8, tool: 'shears' });
def(B.WOOL_VIOLET, { n: 'Violet Wool', tex: 'wool_violet', hard: 0.8, tool: 'shears' });
def(B.WOOL_SLATE, { n: 'Slate Wool', tex: 'wool_slate', hard: 0.8, tool: 'shears' });

// fill gaps
for (let i = 0; i < 96; i++) if (!D[i]) D[i] = D[0] || null;

def(B.AIR, { n: 'Air', tex: null, render: -1, noCollide: true, opacity: 0, hard: -1 });
D[0] = { id: 0, n: 'Air', tex: null, render: -1, noCollide: true, opacity: 0, light: 0, hard: -1 };

// normalise defaults
export const BLOCKS = [];
for (let i = 0; i < 96; i++) {
  const d = D[i];
  if (!d || d.id !== i) { BLOCKS[i] = null; continue; }
  BLOCKS[i] = {
    id: i,
    n: d.n,
    tex: d.tex,
    render: d.render === undefined ? R_SOLID : d.render,
    opacity: d.opacity === undefined ? 15 : d.opacity,
    light: d.light || 0,
    hard: d.hard === undefined ? 1 : d.hard,
    tool: d.tool || null,
    tier: d.tier || 0,
    drop: d.drop === undefined ? undefined : d.drop,
    dropCount: d.dropCount || 1,
    dropChance: d.dropChance === undefined ? 1 : d.dropChance,
    noCollide: !!d.noCollide,
    liquid: !!d.liquid,
    alpha: !!d.alpha,
    leaves: !!d.leaves,
    falls: !!d.falls,
    climb: !!d.climb,
    hurt: d.hurt || 0,
    use: d.use || null,
    dir: !!d.dir,
    wood: d.wood || null,
    xp: d.xp || 0,
    blockEntity: d.blockEntity || null,
    flowing: !!d.flowing,
    level: d.level || 0,
    still: d.still || 0,
    // which wall a ladder/torch is mounted on (0=-Z,1=+X,2=+Z,3=-X);
    // undefined means floor-standing
    wallDir: d.wallDir === undefined ? undefined : d.wallDir,
    hidden: !!d.hidden,
  };
}

export function block(id) { return BLOCKS[id] || BLOCKS[0]; }
export function isSolid(id) { const b = BLOCKS[id]; return !!b && id !== 0 && !b.noCollide && !b.liquid; }
export function isOpaqueCube(id) {
  const b = BLOCKS[id];
  return !!b && id !== 0 && b.render === R_SOLID && !b.alpha;
}
export function opacityOf(id) { const b = BLOCKS[id]; return b ? b.opacity : 0; }
export function lightOf(id) { const b = BLOCKS[id]; return b ? b.light : 0; }

// -------------------------------------------------------------------- items
// Non-block items. Block items are auto-derived from BLOCKS.
export const TIER_NAME = ['Hand', 'Timber', 'Stone', 'Copper', 'Iron', 'Aurorite'];

const ITEMS = {};
function item(id, o) { ITEMS[id] = Object.assign({ id, stack: 64 }, o); }

item('stick', { n: 'Stick', icon: 'i_stick' });
item('coal', { n: 'Coal', icon: 'i_coal', fuel: 8 });
item('charcoal', { n: 'Charcoal', icon: 'i_charcoal', fuel: 7 });
item('raw_copper', { n: 'Raw Copper', icon: 'i_raw_copper' });
item('raw_iron', { n: 'Raw Iron', icon: 'i_raw_iron' });
item('raw_gold', { n: 'Raw Gold', icon: 'i_raw_gold' });
item('copper_ingot', { n: 'Copper Ingot', icon: 'i_copper_ingot' });
item('iron_ingot', { n: 'Iron Ingot', icon: 'i_iron_ingot' });
item('gold_ingot', { n: 'Gold Ingot', icon: 'i_gold_ingot' });
item('aurorite', { n: 'Aurorite', icon: 'i_aurorite' });
item('glimmer_shard', { n: 'Glimmer Shard', icon: 'i_glimmer' });
item('clay_lump', { n: 'Clay Lump', icon: 'i_clay' });
item('brick', { n: 'Fired Brick', icon: 'i_brick' });
item('seeds', { n: 'Grass Seeds', icon: 'i_seeds' });
item('feather', { n: 'Down Feather', icon: 'i_feather' });
item('hide', { n: 'Beast Hide', icon: 'i_hide' });
item('leather', { n: 'Cured Leather', icon: 'i_leather' });
item('bone', { n: 'Bone', icon: 'i_bone' });
item('bone_meal', { n: 'Bone Meal', icon: 'i_bone_meal' });
item('ember_dust', { n: 'Ember Dust', icon: 'i_ember_dust', fuel: 4 });
item('string', { n: 'Silk Thread', icon: 'i_string' });
item('shears', { n: 'Shears', icon: 'i_shears', tool: 'shears', tier: 3, dur: 220, stack: 1 });

// food
item('sunberry', { n: 'Sunberry', icon: 'i_sunberry', food: 2, sat: 1 });
item('raw_meat', { n: 'Raw Cut', icon: 'i_raw_meat', food: 2, sat: 1 });
item('cooked_meat', { n: 'Roast Cut', icon: 'i_cooked_meat', food: 8, sat: 7 });
item('raw_fowl', { n: 'Raw Fowl', icon: 'i_raw_fowl', food: 2, sat: 1 });
item('cooked_fowl', { n: 'Roast Fowl', icon: 'i_cooked_fowl', food: 6, sat: 5 });
item('berry_pie', { n: 'Sunberry Tart', icon: 'i_pie', food: 10, sat: 9 });
item('mush_stew', { n: 'Grotto Stew', icon: 'i_stew', food: 7, sat: 8, stack: 1 });

// tools : type + tier
const TOOL_MAT = [
  ['timber', 1, 'plank_any', 62, 1.9],
  ['stone', 2, 'rubble', 140, 3.2],
  ['copper', 3, 'copper_ingot', 210, 4.6],
  ['iron', 4, 'iron_ingot', 330, 6.4],
  ['aurorite', 5, 'aurorite', 900, 9.0],
];
export const TOOL_KINDS = ['pick', 'axe', 'shovel', 'blade'];
const KIND_NAME = { pick: 'Pick', axe: 'Axe', shovel: 'Spade', blade: 'Blade' };
export const TOOL_MATS = TOOL_MAT;

for (const [mat, tier, , dur, speed] of TOOL_MAT) {
  for (const kind of TOOL_KINDS) {
    item(`${kind}_${mat}`, {
      n: `${cap(mat)} ${KIND_NAME[kind]}`,
      icon: `i_${kind}_${mat}`,
      tool: kind, tier, dur, speed,
      dmg: kind === 'blade' ? 2 + tier * 1.5 : 1 + tier * 0.5,
      stack: 1,
    });
  }
}

// armour
const ARMOR_MAT = [
  ['hide', 1, 'leather', 90, [1, 2, 2, 1]],
  ['copper', 2, 'copper_ingot', 190, [2, 3, 4, 2]],
  ['iron', 3, 'iron_ingot', 300, [2, 5, 6, 2]],
  ['aurorite', 4, 'aurorite', 700, [3, 6, 8, 3]],
];
export const ARMOR_SLOTS = ['helm', 'chest', 'legs', 'boots'];
const ASLOT_NAME = { helm: 'Helm', chest: 'Cuirass', legs: 'Greaves', boots: 'Boots' };
export const ARMOR_MATS = ARMOR_MAT;
for (const [mat, , , dur, pts] of ARMOR_MAT) {
  ARMOR_SLOTS.forEach((slot, i) => {
    item(`${slot}_${mat}`, {
      n: `${cap(mat)} ${ASLOT_NAME[slot]}`,
      icon: `i_${slot}_${mat}`,
      armor: pts[i], slot, dur, stack: 1,
    });
  });
}

item('torch_item', { n: 'Torch', icon: null, place: B.TORCH });

function cap(s) { return s[0].toUpperCase() + s.slice(1); }

// Build the final item table incl. block items
export const ITEM = {};
for (const k in ITEMS) ITEM[k] = ITEMS[k];

export const BLOCK_ITEM = {}; // itemId -> blockId
function itemIdForBlock(id) {
  const names = {
    [B.STONE]: 'stone', [B.DEEPSTONE]: 'deepstone', [B.DIRT]: 'dirt', [B.GRASS]: 'grass',
    [B.SAND]: 'sand', [B.RED_SAND]: 'red_sand', [B.GRAVEL]: 'gravel', [B.CLAY]: 'clay',
    [B.SNOW]: 'snow', [B.ICE]: 'ice', [B.PACKED_ICE]: 'packed_ice', [B.BEDROCK]: 'bedrock',
    [B.BASALT]: 'basalt', [B.MOSS_STONE]: 'moss_stone', [B.RUBBLE]: 'rubble',
    [B.SANDSTONE]: 'sandstone', [B.DRY_DIRT]: 'dry_dirt', [B.PATH]: 'path',
    [B.LOG_ASPEN]: 'log_aspen', [B.LOG_EMBER]: 'log_ember', [B.LOG_PINE]: 'log_pine', [B.LOG_PALM]: 'log_palm',
    [B.LEAF_ASPEN]: 'leaf_aspen', [B.LEAF_EMBER]: 'leaf_ember', [B.LEAF_PINE]: 'leaf_pine', [B.LEAF_PALM]: 'leaf_palm',
    [B.PLANK_ASPEN]: 'plank_aspen', [B.PLANK_EMBER]: 'plank_ember', [B.PLANK_PINE]: 'plank_pine', [B.PLANK_PALM]: 'plank_palm',
    [B.ORE_COAL]: 'ore_coal', [B.ORE_COPPER]: 'ore_copper', [B.ORE_IRON]: 'ore_iron',
    [B.ORE_GOLD]: 'ore_gold', [B.ORE_AURORITE]: 'ore_aurorite', [B.ORE_GLIMMER]: 'ore_glimmer',
    [B.GLASS]: 'glass', [B.BRICKS]: 'bricks', [B.STONE_BRICKS]: 'stone_bricks',
    [B.CHISELED]: 'chiseled', [B.TILE_DARK]: 'tile_dark', [B.SLAB_STONE]: 'slab_stone',
    [B.LUMEN]: 'lumen', [B.BENCH]: 'bench', [B.SMELTER]: 'smelter', [B.CRATE]: 'crate',
    [B.TORCH]: 'torch', [B.LANTERN]: 'lantern', [B.LADDER]: 'ladder',
    [B.DOOR_LOW]: 'door_low', [B.TALL_GRASS]: 'tall_grass',
    [B.SHORT_GRASS]: 'short_grass', [B.FERN]: 'fern',
    [B.FLOWER_SUN]: 'flower_sun', [B.FLOWER_DUSK]: 'flower_dusk', [B.MUSHROOM]: 'mushroom',
    [B.BERRY_BUSH]: 'berry_bush', [B.CACTUS]: 'cactus',
    [B.WOOL_WHITE]: 'wool_white', [B.WOOL_RED]: 'wool_red', [B.WOOL_AMBER]: 'wool_amber',
    [B.WOOL_TEAL]: 'wool_teal', [B.WOOL_VIOLET]: 'wool_violet', [B.WOOL_SLATE]: 'wool_slate',
    [B.COAL_BLOCK]: 'coal_block', [B.COPPER_BLOCK]: 'copper_block', [B.IRON_BLOCK]: 'iron_block',
    [B.GOLD_BLOCK]: 'gold_block', [B.AURORITE_BLOCK]: 'aurorite_block', [B.GLIMMER_BLOCK]: 'glimmer_block',
    [B.WATER]: 'water', [B.LAVA]: 'lava',
  };
  return names[id] || null;
}

for (let i = 1; i < BLOCKS.length; i++) {
  const b = BLOCKS[i];
  if (!b) continue;
  const iid = itemIdForBlock(i);
  if (!iid) continue;
  BLOCK_ITEM[iid] = i;
  if (!ITEM[iid]) ITEM[iid] = { id: iid, n: b.n, stack: 64, block: i };
  else ITEM[iid].block = i;
}

export function itemDef(id) { return ITEM[id] || null; }
export function itemName(id) { const d = ITEM[id]; return d ? d.n : id; }

/** what an item id drops when the block is broken */
export function blockDrop(id) {
  const b = BLOCKS[id];
  if (!b) return null;
  if (b.drop === null) return null;
  if (b.drop !== undefined) return b.drop;
  return itemIdForBlock(id);
}
export { itemIdForBlock };

/** mining time in seconds for a block with a given held item */
export function miningTime(blockId, heldId) {
  const b = BLOCKS[blockId];
  if (!b || b.hard < 0) return Infinity;
  const it = heldId ? ITEM[heldId] : null;
  let speed = 1;
  let correct = !b.tool;
  if (it && it.tool) {
    if (it.tool === b.tool) { speed = it.speed || 2; correct = true; }
    else if (b.tool === null) { speed = 1 + (it.speed || 1) * 0.15; }
    else speed = 1;
  }
  if (b.leaves && it && it.tool === 'shears') { speed = 12; correct = true; }
  if (b.tool === 'shears' && it && it.tool === 'blade') { speed = 4; correct = true; }
  let t = (b.hard * 1.5) / speed;
  if (!correct) t *= 2.6;
  return Math.max(0.045, t);
}

/** can the held item actually collect this block */
export function canHarvest(blockId, heldId) {
  const b = BLOCKS[blockId];
  if (!b) return false;
  if (!b.tier) return true;
  const it = heldId ? ITEM[heldId] : null;
  if (!it || !it.tool) return false;
  if (b.tool && it.tool !== b.tool) return false;
  return (it.tier || 0) >= b.tier;
}
