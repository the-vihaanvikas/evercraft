// EVERCRAFT - loot tables for world-generated chests.
//
// Tuning brief: "balanced". A ruin chest should feel like a genuine reward for
// exploring without letting a player skip a whole tier of progression. So the
// bulk of every chest is early-game consumables and building stock, with a
// small window for a mid-tier metal and a rare flourish (aurorite, glimmer, or
// a ready-made tool) that shows up often enough to keep chests exciting.
//
// Roll structure per chest:
//   * 3-5 "common" entries   - planks, sticks, coal, torches, food, rubble
//   * 0-2 "uncommon" entries - ingots, leather, string, bone meal, a lantern
//   * ~18% chance of ONE "rare" entry - aurorite / glimmer / crafted tool
// Every stack lands in a random free slot, so chests look hand-packed rather
// than filled left-to-right.

/** [itemId, minCount, maxCount, weight] */
const COMMON = [
  ['plank_pine', 4, 12, 10],
  ['plank_aspen', 3, 9, 7],
  ['stick', 3, 10, 10],
  ['coal', 2, 6, 9],
  ['torch', 2, 6, 8],
  ['sunberry', 2, 5, 7],
  ['raw_meat', 1, 3, 4],
  ['cooked_meat', 1, 2, 4],
  ['raw_fowl', 1, 2, 3],
  ['rubble', 4, 12, 8],
  ['seeds', 1, 4, 4],
  ['bone', 1, 3, 5],
  ['charcoal', 1, 4, 5],
  ['clay_lump', 2, 5, 3],
];

const UNCOMMON = [
  ['copper_ingot', 1, 3, 10],
  ['iron_ingot', 1, 2, 7],
  ['leather', 1, 3, 6],
  ['string', 1, 4, 6],
  ['bone_meal', 1, 3, 5],
  ['feather', 2, 5, 5],
  ['brick', 2, 6, 4],
  ['lantern', 1, 1, 3],
  ['berry_pie', 1, 1, 3],
  ['gold_ingot', 1, 2, 3],
  ['pick_stone', 1, 1, 5],
  ['axe_stone', 1, 1, 4],
  ['blade_copper', 1, 1, 3],
];

const RARE = [
  ['aurorite', 1, 2, 6],
  ['glimmer_shard', 1, 3, 7],
  ['pick_iron', 1, 1, 6],
  ['blade_iron', 1, 1, 5],
  ['axe_iron', 1, 1, 4],
  ['helm_iron', 1, 1, 4],
  ['chest_iron', 1, 1, 3],
  ['boots_iron', 1, 1, 4],
  ['pick_aurorite', 1, 1, 1],
  ['mush_stew', 1, 1, 4],
];

function pick(table, rnd) {
  let total = 0;
  for (const e of table) total += e[3];
  let r = rnd() * total;
  for (const e of table) {
    r -= e[3];
    if (r <= 0) return e;
  }
  return table[table.length - 1];
}

/**
 * Fill a 27-slot chest inventory with balanced ruin loot.
 * @param {() => number} rnd deterministic RNG so a given chest is stable
 * @param {number} size slot count (default 27)
 * @returns {Array<{id:string,count:number}|null>}
 */
export function rollChestLoot(rnd = Math.random, size = 27) {
  const slots = new Array(size).fill(null);
  const free = [];
  for (let i = 0; i < size; i++) free.push(i);
  // shuffle the slot order so stacks scatter across the grid
  for (let i = free.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = free[i]; free[i] = free[j]; free[j] = t;
  }
  let cursor = 0;
  const put = (entry) => {
    if (cursor >= free.length) return;
    const [id, min, max] = entry;
    const count = min + ((rnd() * (max - min + 1)) | 0);
    if (count <= 0) return;
    slots[free[cursor++]] = { id, count };
  };

  const commons = 3 + ((rnd() * 3) | 0);          // 3..5
  const used = new Set();
  for (let i = 0; i < commons; i++) {
    let e = pick(COMMON, rnd);
    // avoid duplicate item types so chests read as varied
    for (let tries = 0; tries < 4 && used.has(e[0]); tries++) e = pick(COMMON, rnd);
    used.add(e[0]);
    put(e);
  }

  const uncommons = rnd() < 0.72 ? (rnd() < 0.30 ? 2 : 1) : 0;
  for (let i = 0; i < uncommons; i++) {
    let e = pick(UNCOMMON, rnd);
    for (let tries = 0; tries < 4 && used.has(e[0]); tries++) e = pick(UNCOMMON, rnd);
    used.add(e[0]);
    put(e);
  }

  if (rnd() < 0.18) put(pick(RARE, rnd));

  return slots;
}

/** Deterministic RNG seeded from a chest's world position + world seed. */
export function chestRng(x, y, z, seed = 0) {
  let s = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663)
    ^ Math.imul(z | 0, 83492791) ^ (seed | 0)) >>> 0;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const LOOT_TABLES = { COMMON, UNCOMMON, RARE };
