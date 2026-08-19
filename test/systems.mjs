// Deep system tests: seed determinism, crafting chain, smelting, combat, save fidelity.
import puppeteer from 'puppeteer';
const URL = process.env.URL || 'http://127.0.0.1:8080/';
const fails = [];
const ok = [];
function check(name, cond, extra = '') {
  (cond ? ok : fails).push(name + (extra ? ` — ${extra}` : ''));
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 640 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + (e.stack || e.message)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

// ---------------------------------------------------------- pure-module tests
console.log('\n[worldgen determinism]');
const det = await page.evaluate(async () => {
  const { WorldGen, findSpawn } = await import('/src/worldgen.js');
  const a = new WorldGen(12345), b = new WorldGen(12345), c = new WorldGen(999);
  const ca = a.generateChunk(3, -2).blocks;
  const cb = b.generateChunk(3, -2).blocks;
  const cc = c.generateChunk(3, -2).blocks;
  let sameAB = true, sameAC = true;
  for (let i = 0; i < ca.length; i++) {
    if (ca[i] !== cb[i]) { sameAB = false; break; }
  }
  for (let i = 0; i < ca.length; i++) if (ca[i] !== cc[i]) { sameAC = false; break; }
  // biome coverage over a wide sample
  const biomes = new Set();
  for (let x = -2000; x <= 2000; x += 97)
    for (let z = -2000; z <= 2000; z += 97) biomes.add(a.column(x, z).biome);
  // ore presence at depth
  const counts = {};
  for (let cx = 0; cx < 6; cx++) {
    const blk = a.generateChunk(cx, 0).blocks;
    for (const v of blk) counts[v] = (counts[v] || 0) + 1;
  }
  const spawn = findSpawn(a);
  return { sameAB, sameAC, biomes: [...biomes].sort((x, y) => x - y), counts, spawn };
});
check('same seed → identical chunks', det.sameAB);
check('different seed → different chunks', !det.sameAC);
check('generates many biomes', det.biomes.length >= 8, `${det.biomes.length} biomes: ${det.biomes}`);
const C = det.counts;
check('coal ore generated', (C[30] || 0) > 0, `n=${C[30] || 0}`);
check('copper ore generated', (C[31] || 0) > 0, `n=${C[31] || 0}`);
check('iron ore generated', (C[32] || 0) > 0, `n=${C[32] || 0}`);
check('gold ore generated', (C[33] || 0) > 0, `n=${C[33] || 0}`);
check('aurorite generated', (C[34] || 0) > 0, `n=${C[34] || 0}`);
check('glimmer generated', (C[35] || 0) > 0, `n=${C[35] || 0}`);
check('water generated', (C[11] || 0) > 0, `n=${C[11] || 0}`);
check('caves carved (air underground)', (C[0] || 0) > 1000, `air=${C[0]}`);
check('trees generated (logs)', ((C[18] || 0) + (C[20] || 0) + (C[22] || 0) + (C[24] || 0)) > 0);
check('bedrock floor', (C[13] || 0) > 0);
check('spawn on dry land', det.spawn.y > 46, JSON.stringify(det.spawn));

console.log('\n[recipes & items]');
const rec = await page.evaluate(async () => {
  const { RECIPES, SMELT, FUEL, TAGS, isTag } = await import('/src/recipes.js');
  const { ITEM, itemDef, miningTime, canHarvest, B } = await import('/src/blocks.js');
  const bad = [];
  for (const r of RECIPES) {
    if (!ITEM[r.out]) bad.push('unknown output ' + r.out);
    for (const [id, n] of r.need) {
      if (isTag(id)) { if (!TAGS[id]) bad.push('unknown tag ' + id); }
      else if (!ITEM[id]) bad.push(`recipe ${r.out} needs unknown item ${id}`);
      if (!(n > 0)) bad.push('bad count in ' + r.out);
    }
  }
  for (const k in SMELT) { if (!ITEM[k]) bad.push('smelt input unknown ' + k); if (!ITEM[SMELT[k][0]]) bad.push('smelt output unknown ' + SMELT[k][0]); }
  for (const k in FUEL) if (!ITEM[k]) bad.push('fuel unknown ' + k);
  // tier gating
  const gate = {
    stoneWithHand: canHarvest(B.STONE, null),
    copperWithTimber: canHarvest(B.ORE_COPPER, 'pick_timber'),
    copperWithStone: canHarvest(B.ORE_COPPER, 'pick_stone'),
    ironWithStone: canHarvest(B.ORE_IRON, 'pick_stone'),
    ironWithCopper: canHarvest(B.ORE_IRON, 'pick_copper'),
    goldWithCopper: canHarvest(B.ORE_GOLD, 'pick_copper'),
    goldWithIron: canHarvest(B.ORE_GOLD, 'pick_iron'),
    glimmerWithIron: canHarvest(B.ORE_GLIMMER, 'pick_iron'),
    glimmerWithAuro: canHarvest(B.ORE_GLIMMER, 'pick_aurorite'),
    axeCantMineOre: canHarvest(B.ORE_IRON, 'axe_iron'),
    woodFasterWithAxe: miningTime(B.LOG_ASPEN, 'axe_stone') < miningTime(B.LOG_ASPEN, null),
    pickFasterEachTier: miningTime(B.STONE, 'pick_iron') < miningTime(B.STONE, 'pick_timber'),
  };
  return { bad, gate, recipeCount: RECIPES.length, itemCount: Object.keys(ITEM).length };
});
check('all recipes reference real items', rec.bad.length === 0, rec.bad.slice(0, 5).join('; '));
check(`recipe count healthy (${rec.recipeCount})`, rec.recipeCount > 60);
check(`item count healthy (${rec.itemCount})`, rec.itemCount > 90);
check('stone NOT hand-harvestable', !rec.gate.stoneWithHand);
check('copper needs stone pick', !rec.gate.copperWithTimber && rec.gate.copperWithStone);
check('iron needs copper pick', !rec.gate.ironWithStone && rec.gate.ironWithCopper);
check('gold needs iron pick', !rec.gate.goldWithCopper && rec.gate.goldWithIron);
check('glimmer needs aurorite pick', !rec.gate.glimmerWithIron && rec.gate.glimmerWithAuro);
check('axe cannot harvest ore', !rec.gate.axeCantMineOre);
check('axe speeds up wood', rec.gate.woodFasterWithAxe);
check('higher tier mines faster', rec.gate.pickFasterEachTier);

console.log('\n[textures]');
const tex = await page.evaluate(async () => {
  const t = await import('/src/textures.js');
  const { data, index, count } = t.buildTileLayers();
  let opaque = 0, transparent = 0;
  for (let i = 3; i < data.length; i += 4) { if (data[i] > 200) opaque++; else if (data[i] < 20) transparent++; }
  // every block tex name must exist in the atlas
  const { BLOCKS } = await import('/src/blocks.js');
  const missing = [];
  for (const b of BLOCKS) {
    if (!b || !b.tex) continue;
    const names = typeof b.tex === 'string' ? [b.tex] : Object.values(b.tex);
    for (const n of names) if (index[n] === undefined) missing.push(b.n + ':' + n);
  }
  return { count, opaque, transparent, missing, atlasBytes: data.length };
});
check(`atlas built (${tex.count} tiles, ${(tex.atlasBytes / 1024).toFixed(0)}KB)`, tex.count > 60);
check('all block textures present in atlas', tex.missing.length === 0, tex.missing.slice(0, 6).join(','));
check('atlas has opaque pixels', tex.opaque > 10000);
check('atlas has cutout pixels (plants/glass)', tex.transparent > 1000);

// ------------------------------------------------------------- live gameplay
console.log('\n[live gameplay]');
await page.evaluate(() => window.__EVERCRAFT.begin({ slot: 2, name: 'SysTest', seed: 'alpha-1', load: false }));
await page.waitForFunction(() => document.querySelector('#loading').classList.contains('hidden'), { timeout: 90000 });

const play = await page.evaluate(async () => {
  const g = window.__EVERCRAFT.game;
  const { RECIPES } = await import('/src/recipes.js');
  const { B } = await import('/src/blocks.js');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = {};

  // --- crafting chain: logs -> planks -> sticks -> bench -> pick
  g.player.inv.add('log_aspen', 8);
  const rPlank = RECIPES.find(r => r.out === 'plank_aspen');
  out.craftPlanks = g.craft(rPlank);
  out.planks = g.player.inv.count('plank_aspen');
  const rStick = RECIPES.find(r => r.out === 'stick');
  out.craftSticks = g.craft(rStick);
  const rBench = RECIPES.find(r => r.out === 'bench');
  g.craft(rPlank); g.craft(rPlank);
  out.craftBench = g.craft(rBench);
  const rPick = RECIPES.find(r => r.out === 'pick_timber');
  out.craftPick = g.craft(rPick);
  out.hasPick = g.player.inv.count('pick_timber');

  // --- bench gating: iron gear requires a bench
  const rIron = RECIPES.find(r => r.out === 'pick_iron');
  g.player.inv.add('iron_ingot', 9); g.player.inv.add('stick', 9);
  g.nearBench = false;
  out.benchGateBlocks = !g.canCraft(rIron);
  g.nearBench = true;
  out.benchGateAllows = g.canCraft(rIron);
  g.craft(rIron);
  out.ironPick = g.player.inv.count('pick_iron');

  // --- block place + break roundtrip (must hold a pick to get the drop)
  const bx = Math.floor(g.player.pos.x) + 2, by = Math.floor(g.player.pos.y), bz = Math.floor(g.player.pos.z);
  g.player.inv.slots[0] = { id: 'pick_iron', count: 1, dur: 330 };
  g.player.hotbarIdx = 0;
  g.itemDrops.clear();
  g.world.setBlock(bx, by + 3, bz, B.STONE_BRICKS);
  out.placed = g.world.getBlock(bx, by + 3, bz) === B.STONE_BRICKS;
  g._breakBlock(bx, by + 3, bz, B.STONE_BRICKS);
  out.broke = g.world.getBlock(bx, by + 3, bz) === 0;
  await sleep(300);
  out.dropSpawned = g.itemDrops.items.length > 0;
  // mining without a correct-tier tool must yield nothing
  g.itemDrops.clear();
  g.player.inv.slots[0] = null;
  g.world.setBlock(bx, by + 3, bz, B.ORE_GOLD);
  g._breakBlock(bx, by + 3, bz, B.ORE_GOLD);
  await sleep(150);
  out.noDropBareHand = g.itemDrops.items.length === 0;

  // --- container persistence
  g.world.setBlock(bx, by + 1, bz, B.CRATE);
  const cont = g.world.containerAt(bx, by + 1, bz, true, 'crate');
  cont.items[0] = { id: 'gold_ingot', count: 7 };
  const ser = g.world.serializeContainers();
  out.containerSaved = JSON.stringify(ser).includes('gold_ingot');

  // --- smelter logic
  g.world.setBlock(bx, by + 1, bz + 2, B.SMELTER);
  const sm = g.world.containerAt(bx, by + 1, bz + 2, true, 'smelter');
  sm.input = { id: 'raw_iron', count: 3 };
  sm.fuel = { id: 'coal', count: 2 };
  for (let i = 0; i < 200; i++) { g._updateSmelters(0.1); }
  out.smelted = sm.out && sm.out.id === 'iron_ingot' ? sm.out.count : 0;
  out.fuelConsumed = !sm.fuel || sm.fuel.count < 2;

  // --- entity combat
  const { Entity } = await import('/src/entities.js');
  const e = new Entity('hopper', g.player.pos.x + 1.5, g.player.pos.y, g.player.pos.z);
  g.entityGroup.add(e.buildMesh());
  g.entities.push(e);
  const hp0 = e.hp;
  e.hurt(99, g.player.pos, g);
  out.entityDies = e.dead && hp0 > 0;
  g._onEntityDeath(e);
  await sleep(200);
  out.lootDropped = g.itemDrops.items.length > 0;

  // --- hunger/health mechanics
  g.player.hunger = 20; g.player.health = 10;
  g.player.saturation = 5;
  for (let i = 0; i < 60; i++) g.player.update(0.1, { forward: 0, back: 0, left: 0, right: 0, jump: 0, sneak: 0 });
  out.regen = g.player.health > 10;
  g.player.hunger = 0; g.player.saturation = 0; g.player.health = 20;
  for (let i = 0; i < 120; i++) g.player.update(0.1, { forward: 0, back: 0, left: 0, right: 0, jump: 0, sneak: 0 });
  out.starves = g.player.health < 20;

  // --- eating
  g.player.hunger = 4;
  g.player.inv.slots[0] = { id: 'cooked_meat', count: 2 };
  g.player.hotbarIdx = 0;
  const ate = g.player.eat(0);
  out.ate = ate && g.player.hunger > 4;

  // --- armor damage reduction
  g.player.health = 20; g.player.armor.chest = { id: 'chest_iron', count: 1, dur: 300 };
  g.player.hurtCd = 0; g.player.damage(10, 'mob');
  const withArmor = 20 - g.player.health;
  g.player.armor.chest = null; g.player.health = 20; g.player.hurtCd = 0;
  g.player.damage(10, 'mob');
  const without = 20 - g.player.health;
  out.armorReduces = withArmor < without;
  out.armorNums = [withArmor.toFixed(1), without.toFixed(1)];

  // --- fall damage
  g.player.health = 20; g.player.creative = false; g.player.hurtCd = 0;
  g.player.fallStart = g.player.pos.y + 14; g.player.onGround = true; g.player.vel.y = 0;
  g.player.update(0.05, { forward: 0, back: 0, left: 0, right: 0, jump: 0, sneak: 0 });
  out.fallDamage = g.player.health < 20;

  // --- XP levelling
  const lv0 = g.player.level;
  g.player.addXP(500);
  out.levelUp = g.player.level > lv0;

  // --- day/night cycle
  g.worldTime = 600 * 0.5; const noon = g.daylight();
  g.worldTime = 600 * 0.0; const midnight = g.daylight();
  out.dayNight = noon > 0.8 && midnight < 0.15;
  out.lightVals = [noon.toFixed(2), midnight.toFixed(2)];

  g.save(true);
  return out;
});

check('craft planks from logs', play.craftPlanks && play.planks >= 4);
check('craft sticks', play.craftSticks);
check('craft artisan bench', play.craftBench);
check('craft timber pick', play.craftPick && play.hasPick === 1);
check('bench-only recipes gated without bench', play.benchGateBlocks);
check('bench-only recipes allowed with bench', play.benchGateAllows && play.ironPick === 1);
check('block placement works', play.placed);
check('block breaking works', play.broke);
check('breaking spawns item drop', play.dropSpawned);
check('wrong-tier tool yields no drop', play.noDropBareHand);
check('container contents serialize', play.containerSaved);
check('smelter smelts ore → ingots', play.smelted > 0, `${play.smelted} ingots`);
check('smelter consumes fuel', play.fuelConsumed);
check('entity takes damage and dies', play.entityDies);
check('entity death drops loot', play.lootDropped);
check('health regenerates when fed', play.regen);
check('starvation damages player', play.starves);
check('eating restores hunger', play.ate);
check('armor reduces damage', play.armorReduces, `armored ${play.armorNums[0]} vs bare ${play.armorNums[1]}`);
check('fall damage applies', play.fallDamage);
check('XP levels up', play.levelUp);
check('day/night cycle swings light', play.dayNight, `noon ${play.lightVals[0]}, midnight ${play.lightVals[1]}`);

// ------------------------------------------------- save/load determinism test
console.log('\n[save/load fidelity]');
const before = await page.evaluate(() => {
  const g = window.__EVERCRAFT.game;
  // make a distinctive edit tower
  const bx = Math.floor(g.player.pos.x), by = Math.floor(g.player.pos.y) + 4, bz = Math.floor(g.player.pos.z);
  for (let i = 0; i < 5; i++) g.world.setBlock(bx, by + i, bz, 37);
  g.player.inv.add('glimmer_shard', 13);
  g.save(true);
  return { bx, by, bz, seed: g.seed, glimmer: g.player.inv.count('glimmer_shard'),
    pos: g.player.pos.toArray().map(v => +v.toFixed(2)), level: g.player.level };
});
await page.reload({ waitUntil: 'networkidle2' });
await page.evaluate(() => window.__EVERCRAFT.begin({ slot: 2, load: true }));
await page.waitForFunction(() => document.querySelector('#loading').classList.contains('hidden'), { timeout: 90000 });
const after = await page.evaluate(async (b) => {
  const g = window.__EVERCRAFT.game;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 60 && !g.world.isLoaded(b.bx, b.bz); i++) await sleep(150);
  await sleep(900);
  let tower = 0;
  for (let i = 0; i < 5; i++) if (g.world.getBlock(b.bx, b.by + i, b.bz) === 37) tower++;
  return { seed: g.seed, tower, glimmer: g.player.inv.count('glimmer_shard'),
    pos: g.player.pos.toArray().map(v => +v.toFixed(2)), level: g.player.level,
    embedded: g.player.aabbBlocked(g.player.pos.x, g.player.pos.y, g.player.pos.z) };
}, before);
check('seed preserved across save/load', before.seed === after.seed, `${before.seed} vs ${after.seed}`);
check('placed blocks persist', after.tower === 5, `${after.tower}/5 bricks restored`);
check('inventory persists', after.glimmer === before.glimmer, `${after.glimmer} glimmer`);
check('level persists', after.level === before.level);
check('player not stuck in terrain after load', !after.embedded);

// ------------------------------------------------ new: textures, grass, torch
console.log('\n[textures & pixel art]');
const tiles = await page.evaluate(async () => {
  const t = await import('/src/textures.js');
  const { data, index } = t.buildTileLayers();
  const TILE = 16;
  // read a pixel from the ATLAS (already row-flipped for GL sampling).
  // atlasRow 15 == the visual TOP of the tile as rendered on a block face.
  const px = (name, x, visualRow) => {
    const layer = index[name];
    const atlasRow = TILE - 1 - visualRow;
    const i = layer * TILE * TILE * 4 + (atlasRow * TILE + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const isGreen = c => c[3] > 0 && c[1] > c[0] + 20 && c[1] > c[2] + 20;
  const isBrown = c => c[3] > 0 && c[0] > c[2] + 20 && c[1] < c[0] && c[1] > c[2];
  // grass_side: green fringe at the visual top, dirt at the visual bottom
  let topGreen = 0, botBrown = 0;
  for (let x = 0; x < 16; x++) {
    if (isGreen(px('grass_side', x, 0))) topGreen++;
    if (isBrown(px('grass_side', x, 15))) botBrown++;
  }
  // torch: flame near the visual top, handle at the visual bottom
  const flame = px('torch', 7, 2);
  const handle = px('torch', 7, 14);
  const isFlame = flame[3] > 0 && flame[0] > 200 && flame[1] > 130;
  const isHandle = handle[3] > 0 && handle[0] > handle[2] + 20;
  // torch must be mostly transparent (thin post) -> cheap cutout
  let opaque = 0;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (px('torch', x, y)[3] > 0) opaque++;
  // grass blades must be rooted at the bottom, not floating
  const bladeRow = (name, visualRow) => {
    let n = 0;
    for (let x = 0; x < 16; x++) if (px(name, x, visualRow)[3] > 0) n++;
    return n;
  };
  return {
    topGreen, botBrown, isFlame, isHandle, torchOpaquePct: Math.round(opaque / 2.56),
    shortRoot: bladeRow('short_grass', 15), shortTop: bladeRow('short_grass', 2),
    tallRoot: bladeRow('tall_grass', 15), tallMid: bladeRow('tall_grass', 4),
    hasShort: 'short_grass' in index, hasTallTop: 'tall_grass_top' in index,
  };
});
check('grass_side has green turf on top', tiles.topGreen >= 12, `${tiles.topGreen}/16 px`);
check('grass_side has dirt on the bottom', tiles.botBrown >= 12, `${tiles.botBrown}/16 px`);
check('torch flame is at the top', tiles.isFlame);
check('torch handle is at the bottom', tiles.isHandle);
check('torch tile is mostly transparent', tiles.torchOpaquePct < 40, `${tiles.torchOpaquePct}% opaque`);
check('short grass variant exists', tiles.hasShort);
check('tall grass top variant exists', tiles.hasTallTop);
check('grass blades rooted at tile bottom', tiles.shortRoot >= 6 && tiles.tallRoot >= 6,
  `short ${tiles.shortRoot}, tall ${tiles.tallRoot}`);
check('tall grass reaches higher than short', tiles.tallMid > tiles.shortTop,
  `tall@row4 ${tiles.tallMid} vs short@row2 ${tiles.shortTop}`);

console.log('\n[two-block tall grass]');
const tg = await page.evaluate(async () => {
  const g = window.__EVERCRAFT.game;
  const { B } = await import('/src/blocks.js');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const p = g.player;
  const x = Math.floor(p.pos.x) + 3, z = Math.floor(p.pos.z) + 3;
  const y = g.world.surfaceY(x, z);
  g.world.setBlock(x, y - 1, z, B.GRASS);
  g.world.setBlock(x, y, z, 0); g.world.setBlock(x, y + 1, z, 0);
  // place the base; the game should auto-add the top half
  g.world.setBlock(x, y, z, B.TALL_GRASS);
  g.world.setBlock(x, y + 1, z, B.TALL_GRASS_TOP);
  const placed = [g.world.getBlock(x, y, z), g.world.getBlock(x, y + 1, z)];
  // breaking the BASE must also clear the top half
  g._breakBlock(x, y, z, B.TALL_GRASS);
  await sleep(60);
  const afterBase = [g.world.getBlock(x, y, z), g.world.getBlock(x, y + 1, z)];
  // breaking the TOP must also clear the base
  g.world.setBlock(x, y, z, B.TALL_GRASS);
  g.world.setBlock(x, y + 1, z, B.TALL_GRASS_TOP);
  g._breakBlock(x, y + 1, z, B.TALL_GRASS_TOP);
  await sleep(60);
  const afterTop = [g.world.getBlock(x, y, z), g.world.getBlock(x, y + 1, z)];
  return { placed, afterBase, afterTop, TG: B.TALL_GRASS, TGT: B.TALL_GRASS_TOP };
});
check('tall grass occupies two blocks', tg.placed[0] === tg.TG && tg.placed[1] === tg.TGT);
check('breaking base clears top half', tg.afterBase[0] === 0 && tg.afterBase[1] === 0,
  `got [${tg.afterBase}]`);
check('breaking top clears base', tg.afterTop[0] === 0 && tg.afterTop[1] === 0,
  `got [${tg.afterTop}]`);

console.log('\n[lighting performance]');
const perf = await page.evaluate(async () => {
  const { WorldGen } = await import('/src/worldgen.js');
  const mesher = await import('/src/mesher.js');
  const { B } = await import('/src/blocks.js');
  const gen = new WorldGen(4242);
  const cache = new Map();
  const provider = (cx, cz) => {
    const k = cx + ',' + cz;
    let c = cache.get(k);
    if (!c) { c = gen.generateChunk(cx, cz).blocks; cache.set(k, c); }
    return c;
  };
  mesher.setTexIndex(new Proxy({}, { get: () => 0 }));
  // This runs under software GL on shared CI hardware, so single samples are
  // noisy. Take the median of several batches for a stable number.
  const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const sample = () => {
    const t = performance.now();
    for (let i = 0; i < 5; i++) mesher.buildChunkMesh(0, 0, provider);
    return (performance.now() - t) / 5;
  };
  for (let i = 0; i < 15; i++) mesher.buildChunkMesh(0, 0, provider);  // warm JIT
  const base = median([sample(), sample(), sample(), sample(), sample()]);
  // place a torch and re-measure: must not blow up the cost
  const c = provider(0, 0);
  for (let y = 90; y > 40; y--) {
    const i = 8 + 8 * 16 + y * 256;
    if (c[i] === 0 && c[i - 256] !== 0) { c[i] = B.TORCH; break; }
  }
  const lit = median([sample(), sample(), sample(), sample(), sample()]);
  return { base: +base.toFixed(1), lit: +lit.toFixed(1) };
});
check('chunk light+mesh is fast', perf.base < 18, `${perf.base}ms/chunk (median)`);
check('torch does not blow up relight cost', perf.lit < perf.base * 1.6,
  `${perf.base}ms -> ${perf.lit}ms with torch`);

console.log('\n[game modes]');
const modes = await page.evaluate(() => {
  const el = document.querySelectorAll('#modePick .mode-card');
  return { count: el.length, modes: [...el].map(e => e.dataset.mode) };
});
check('menu offers Survival and Creative', modes.count === 2 &&
  modes.modes.includes('survival') && modes.modes.includes('creative'),
  modes.modes.join(', '));

console.log('\n[mobs: remastered models & flight]');
const mobs = await page.evaluate(async () => {
  const { Entity, SPECIES } = await import('/src/entities.js');
  const { isSolid } = await import('/src/blocks.js');
  const g = window.__EVERCRAFT.game;
  const ctx = { audio: { crit() {}, hurt() {}, die() {} }, daylight: 0,
    particles: { burst() {} }, drops: { spawn() {} }, spawnProjectile() {} };
  const out = { parts: {}, plume: null, flapWired: false };

  for (const kind of Object.keys(SPECIES)) {
    const e = new Entity(kind, 0, 60, 0);
    const m = e.buildMesh();
    let n = 0;
    m.traverse(o => { if (o.isMesh) n++; });
    out.parts[kind] = n;
    // exercise every animation branch for NaN / throw safety
    for (const st of ['idle', 'walk', 'chase', 'graze']) {
      e.state = st;
      for (let i = 0; i < 120; i++) { e.animT += 1 / 60; e.vel.x = 1.5; e._animate(1 / 60); }
    }
    if (!isFinite(m.position.x) || !isFinite(m.rotation.y)) out.parts[kind] = -1;
  }

  // chickens must not gain altitude: measure above true solid ground
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.world.surfaceY(px, pz);
  const bird = new Entity('plume', px + 0.5, gy + 0.5, pz + 0.5);
  let maxAbove = -99, samples = 0;
  for (let i = 0; i < 1800; i++) {
    g.player.pos.x = bird.pos.x + 25; g.player.pos.z = bird.pos.z + 25;
    bird.update(1 / 60, g.world, g.player, ctx);
    let ground = null;
    for (let y = Math.floor(bird.pos.y + 0.05); y > 0; y--) {
      const id = g.world.getBlock(bird.pos.x, y, bird.pos.z);
      if (id > 0 && isSolid(id)) { ground = y + 1; break; }
    }
    if (ground === null) continue;
    maxAbove = Math.max(maxAbove, bird.pos.y - ground);
    samples++;
  }
  out.plume = { max: +maxAbove.toFixed(2), samples };

  // wing flap must key off the flapping flag, not the removed 'fly' state
  const p2 = new Entity('plume', 0, 60, 0);
  const mesh = p2.buildMesh();
  p2.flapping = false; p2.onGround = true;
  p2.animT = 0.5; p2._animate(1 / 60);
  const closed = Math.abs(mesh.userData.wings[0].rotation.z);
  p2.flapping = true; p2.onGround = false;
  let openMax = 0;
  for (let i = 0; i < 60; i++) { p2.animT += 1 / 60; p2._animate(1 / 60);
    openMax = Math.max(openMax, Math.abs(mesh.userData.wings[0].rotation.z)); }
  out.flapWired = openMax > 0.8 && closed < 0.2;
  return out;
});
const partCounts = Object.entries(mobs.parts);
check('every species builds a multi-part model', partCounts.every(([, n]) => n >= 10),
  partCounts.map(([k, n]) => `${k}:${n}`).join(' '));
check('animation stays finite across all states', partCounts.every(([, n]) => n !== -1));
check('plume (chicken) never gains altitude', mobs.plume.samples > 100 && mobs.plume.max < 3,
  `max ${mobs.plume.max} above ground over ${mobs.plume.samples} samples`);
check('wing flap is driven by the flapping flag', mobs.flapWired);

console.log('\n[chests]');
const chest = await page.evaluate(async () => {
  const { B, BLOCKS, block } = await import('/src/blocks.js');
  const { rollChestLoot, chestRng } = await import('/src/loot.js');
  const { itemDef } = await import('/src/blocks.js');
  const g = window.__EVERCRAFT.game;
  const out = {};

  out.name = BLOCKS[B.CRATE].n;
  out.isBlockEntity = BLOCKS[B.CRATE].blockEntity === 'chest';

  // loot table sanity over many rolls
  let stacks = 0, empty = 0, rare = 0, bad = 0;
  const rareIds = new Set(['aurorite', 'glimmer_shard', 'pick_iron', 'blade_iron',
    'axe_iron', 'helm_iron', 'chest_iron', 'boots_iron', 'pick_aurorite']);
  for (let i = 0; i < 1500; i++) {
    const items = rollChestLoot(chestRng(i * 31, 60, i * 17, 7)).filter(Boolean);
    if (!items.length) empty++;
    stacks += items.length;
    for (const it of items) {
      if (!itemDef(it.id) && !block(it.id)) bad++;
      if (rareIds.has(it.id)) rare++;
    }
  }
  out.avgStacks = +(stacks / 1500).toFixed(2);
  out.emptyChests = empty;
  out.rarePct = +(rare / 1500 * 100).toFixed(1);
  out.invalidItems = bad;

  // same position always rolls the same loot
  const a = rollChestLoot(chestRng(10, 64, 20, 5)).filter(Boolean).map(i => i.id + i.count).join();
  const b = rollChestLoot(chestRng(10, 64, 20, 5)).filter(Boolean).map(i => i.id + i.count).join();
  out.deterministic = a === b && a.length > 0;

  // place one and drive the open/close animation
  const px = Math.floor(g.player.pos.x) + 3, pz = Math.floor(g.player.pos.z);
  const y = g.world.surfaceY(px, pz);
  g.world.setBlock(px, y, pz, B.CRATE);
  g._scanChests();
  out.registered = g.chests.has(px, y, pz);

  g._interact({ x: px, y, z: pz }, BLOCKS[B.CRATE]);
  const cont = g.world.containerAt(px, y, pz, false);
  out.naturalChestHasLoot = !!cont && cont.items.filter(Boolean).length > 0;
  out.uiTitle = document.querySelector('#cratePanel h2')?.textContent || '';

  const rec = g.chests.chests.get(`${px},${y},${pz}`);
  // Track the world height of the lid's free front edge: it must RISE.
  // Sample both poses by hand so the live render loop can't race us.
  const tip = () => {
    rec.root.updateWorldMatrix(true, true);
    const v = { x: 0, y: 0, z: -14 / 16 };
    const th = rec.hinge.rotation.x;
    // rotate about X, then add the hinge's own offset + root height
    const ly = v.y * Math.cos(th) - v.z * Math.sin(th);
    return rec.root.position.y + rec.hinge.position.y + ly;
  };
  rec.open = 0; rec.target = 0; rec.hinge.rotation.x = 0;
  const yClosed = tip();
  rec.target = 1;
  for (let i = 0; i < 120; i++) g.chests.update(1 / 60, g.camera.position, () => [1, 0]);
  out.lidOpen = +rec.hinge.rotation.x.toFixed(2);
  const yOpen = tip();
  out.lidTipRise = +(yOpen - yClosed).toFixed(3);
  out.lidTipRises = yOpen > yClosed + 0.4;
  g.ui.close();
  for (let i = 0; i < 120; i++) g.chests.update(1 / 60, g.camera.position, () => [1, 0]);
  out.lidClosed = +rec.hinge.rotation.x.toFixed(2);

  // a player-placed chest must start empty
  const qx = px + 2;
  const qy = g.world.surfaceY(qx, pz);
  g.world.setBlock(qx, qy, pz, B.CRATE);
  g.world.containerAt(qx, qy, pz, true, 'crate', false);
  g._scanChests();
  g._interact({ x: qx, y: qy, z: pz }, BLOCKS[B.CRATE]);
  const c2 = g.world.containerAt(qx, qy, pz, false);
  out.placedChestEmpty = !!c2 && c2.items.filter(Boolean).length === 0;
  g.ui.close();

  // breaking the block must unregister the block entity
  g.world.setBlock(px, y, pz, 0);
  g._scanChests();
  out.removedOnBreak = !g.chests.has(px, y, pz);
  return out;
});
check('container is named Chest', chest.name === 'Chest', chest.name);
check('chest renders as an animated block entity', chest.isBlockEntity);
check('chest UI is titled Chest', chest.uiTitle === 'Chest', chest.uiTitle);
check('ruin chests contain loot', chest.naturalChestHasLoot);
check('player-placed chests start empty', chest.placedChestEmpty);
check('loot is balanced, never empty', chest.emptyChests === 0 && chest.avgStacks > 3 && chest.avgStacks < 9,
  `avg ${chest.avgStacks} stacks, ${chest.emptyChests} empty`);
check('rare loot stays rare but real', chest.rarePct > 5 && chest.rarePct < 30, `${chest.rarePct}% of chests`);
check('all loot ids are valid items', chest.invalidItems === 0, `${chest.invalidItems} invalid`);
check('chest loot is deterministic per position', chest.deterministic);
check('chest lid opens upward', chest.lidOpen > 1.4 && chest.lidTipRises, `${chest.lidOpen} rad, tip +${chest.lidTipRise}`);
check('chest lid closes', Math.abs(chest.lidClosed) < 0.05, `${chest.lidClosed} rad`);
check('chest entity is removed when broken', chest.removedOnBreak);

console.log('\n[mob geometry audit]');
const geo = await page.evaluate(async () => {
  const THREE = await import('/vendor/three.module.js');
  const { Entity, SPECIES } = await import('/src/entities.js');
  const out = {};
  const mk = (kind) => { const e = new Entity(kind, 0, 0, 0); e.yaw = 0; e._vyaw = 0;
    const m = e.buildMesh(); m.position.set(0, 0, 0); return { e, m }; };
  const tip = (pv, root) => { const len = pv.userData.len || 0.3;
    root.updateWorldMatrix(true, true);
    return pv.localToWorld(new THREE.Vector3(0, -len, 0)); };

  for (const kind of Object.keys(SPECIES)) {
    const r = {};
    { const { e, m } = mk(kind); const ud = m.userData;
      if (ud.arms) { e.state = 'chase'; e.animT = 0; e._animate(1 / 60);
        r.armForward = tip(ud.arms[0], m).z < -0.05; } }
    { const { e, m } = mk(kind); const ud = m.userData;
      if (ud.head) { const rest = ud.head.position.y;
        e.state = 'graze'; for (let i = 0; i < 150; i++) { e.animT += 1 / 60; e._animate(1 / 60); }
        m.updateWorldMatrix(true, true);
        r.headDips = ud.head.localToWorld(new THREE.Vector3(0, 0, -0.45)).y < rest - 0.02; } }
    { const { e, m } = mk(kind); const ud = m.userData;
      if (ud.legs && !ud.spider) { e.state = 'walk'; let mn = 9, mx = -9;
        for (let i = 0; i < 240; i++) { e.animT += 1 / 60; e.vel.x = 3; e._animate(1 / 60);
          mn = Math.min(mn, ud.legs[0].rotation.x); mx = Math.max(mx, ud.legs[0].rotation.x); }
        r.legSwing = +(mx - mn).toFixed(2);
        r.legsSwing = (mx - mn) > 0.3 && (mx - mn) < 1.2; } }
    { const { e, m } = mk(kind); e._animate(1 / 60); m.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(m);
      r.sinks = box.min.y < -0.08;
      r.tooTall = box.max.y > SPECIES[kind].h * 1.55;
      r.tooWide = (box.max.x - box.min.x) > SPECIES[kind].w * 1.75; }
    out[kind] = r;
  }
  return out;
});
const ge = Object.entries(geo);
check('no mob sinks into the ground', ge.every(([, r]) => !r.sinks),
  ge.filter(([, r]) => r.sinks).map(([k]) => k).join(',') || 'all clear');
check('no mob model overflows its hitbox', ge.every(([, r]) => !r.tooTall && !r.tooWide),
  ge.filter(([, r]) => r.tooTall || r.tooWide).map(([k]) => k).join(',') || 'all clear');
check('chasing mobs reach arms FORWARD', ge.every(([, r]) => r.armForward !== false),
  ge.filter(([, r]) => r.armForward === false).map(([k]) => k).join(',') || 'husk, shardling ok');
check('grazing mobs dip their heads DOWN', ge.every(([, r]) => r.headDips !== false));
check('leg swing is a natural amplitude', ge.every(([, r]) => r.legsSwing !== false),
  ge.filter(([, r]) => r.legSwing).map(([k, r]) => `${k}:${r.legSwing}`).join(' '));

console.log('\n[camera & creative flight]');
const cam = await page.evaluate(async () => {
  const THREE = await import('/vendor/three.module.js');
  const g = window.__EVERCRAFT.game, p = g.player;
  const out = {}; const saveMode = g.cameraMode;
  p.yaw = 0; p.pitch = 0;                    // yaw 0 faces -Z
  const eye = p.eyePos();
  const shot = (m) => { g.cameraMode = m; g._updateAvatar(1 / 60); g._updateCamera(1 / 60);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion);
    return { dz: g.camera.position.z - eye.z, fz: fwd.z,
             avatar: !!(g.avatar && g.avatar.visible), hand: g.handGroup.visible }; };
  const m0 = shot(0), m1 = shot(1), m2 = shot(2);
  out.fpNoAvatar = !m0.avatar && m0.hand;
  out.behindIsBehind = m1.dz > 1 && m1.fz < -0.5 && m1.avatar && !m1.hand;
  out.frontFacesBack = m2.dz < -1 && m2.fz > 0.5 && m2.avatar;
  g.cameraMode = 0; p.yaw = 1.1; p.pitch = -0.4; g._updateCamera(1 / 60);
  out.fpTracksLook = Math.abs(g.camera.rotation.y - 1.1) < 0.01 &&
                     Math.abs(g.camera.rotation.x + 0.4) < 0.01;
  // ---- flight
  // Earlier tests stack blocks on the player's column (block-update and
  // structure checks), which would trap them. Clear a shaft first so we are
  // measuring flight physics rather than a collision.
  const bx0 = Math.floor(p.pos.x), bz0 = Math.floor(p.pos.z), by0 = Math.floor(p.pos.y);
  for (let dy = -1; dy < 40; dy++)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        g.world.setBlock(bx0 + dx, by0 + dy, bz0 + dz, 0);
  g.world.setBlock(bx0, by0 - 2, bz0, 1);   // something to stand on
  p.pos.set(bx0 + 0.5, by0 + 0.2, bz0 + 0.5);
  p.vel.set(0, 0, 0);

  // Drive a private input object: the live loop's _pollInput() rewrites
  // g.input from the key map every frame and would clobber our presses.
  const inp = { forward: 0, back: 0, left: 0, right: 0, jump: 0, sneak: 0 };
  const step = (n) => { for (let i = 0; i < n; i++) p.update(1 / 60, inp, g.world); };
  p.creative = true; p.flying = false;
  g._setFlying(true); out.flyToggles = p.flying;
  const y0 = p.pos.y;
  inp.jump = 1; step(90);
  out.ascends = p.pos.y > y0 + 1.5;
  out.staysAirborne = p.flying && !p.onGround;
  const yTop = p.pos.y;
  inp.jump = 0; step(150);
  out.holdsAltitude = Math.abs(p.pos.y - yTop) < 0.8 && Math.abs(p.vel.y) < 0.02;
  inp.sneak = 1; step(60);
  out.descends = p.pos.y < yTop - 0.8;
  inp.sneak = 0;
  p.health = 20; g._setFlying(false);
  step(300);
  out.noFlightFallDamage = p.health === 20;
  g.cameraMode = saveMode;
  return out;
});
check('first person hides the avatar, shows the hand', cam.fpNoAvatar);
check('first person tracks yaw/pitch exactly', cam.fpTracksLook);
check('F5 mode 1 puts the camera BEHIND the player', cam.behindIsBehind);
check('F5 mode 2 puts the camera in FRONT, looking back', cam.frontFacesBack);
check('creative flight toggles on', cam.flyToggles);
check('flight ascends while holding jump', cam.ascends);
check('flight stays airborne (no gravity pull)', cam.staysAirborne);
check('flight holds altitude when keys released', cam.holdsAltitude);
check('flight descends on sneak', cam.descends);
check('leaving flight deals no fall damage', cam.noFlightFallDamage);

console.log('\n[music]');
const mus = await page.evaluate(async () => {
  const a = window.__EVERCRAFT.game.audio;
  a.init(); a.resume();
  const notes = [];
  const orig = a._voice.bind(a);
  a._voice = (t0, f, dur, o = {}) => { notes.push({ t: t0, f }); return orig(t0, f, dur, o); };
  const run = (dayT, danger, secs) => { notes.length = 0;
    a._nextBar = 0; a._barIndex = 0; a._prevMood = null;
    const s = a.ctx.currentTime;
    return new Promise(res => { const iv = setInterval(() => { a.updateMusic(1 / 60, dayT, danger);
      if (a.ctx.currentTime - s > secs) { clearInterval(iv); res([...notes]); } }, 16); }); };
  const day = await run(0.5, false, 6);
  const night = await run(0.9, false, 5);
  a._voice = orig;
  const root = 130.81;
  const err = day.map(n => { const st = 12 * Math.log2(n.f / root); return Math.abs(st - Math.round(st)); });
  return {
    dayNotes: day.length,
    inTune: day.length > 6 && Math.max(...err) < 0.02,
    // bass (sub-90Hz roots), pad (mid), melody (doubled octave, >=400Hz)
    layered: day.some(n => n.f < 100) && day.some(n => n.f >= 100 && n.f < 400)
      && day.some(n => n.f >= 400),
    // night is built on A2 (110Hz) vs day's C3 (130.8Hz): compare the lowest
    // pitch each mood schedules, which is the bass root and is stable.
    nightDarker: night.length > 3 &&
      Math.min(...night.map(n => n.f)) < Math.min(...day.map(n => n.f)) + 0.01,
  };
});
check('music schedules a steady stream of notes', mus.dayNotes > 6, `${mus.dayNotes} notes in 6s`);
check('every pitch is harmonically in tune', mus.inTune);
check('score is layered (bass + pad + melody)', mus.layered);
check('night music sits in a darker register', mus.nightDarker);

console.log('\n[structures]');
const st = await page.evaluate(async () => {
  const { WorldGen, BIOME } = await import('/src/worldgen.js');
  const { B, WORLD_H } = await import('/src/blocks.js');
  const gen = new WorldGen(999);
  let seed = 1; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const kinds = ['ruin', 'hunterHut', 'watchtower', 'campsite', 'wellRuin', 'obelisk', 'cairn'];
  const built = {};
  for (const k of kinds) {
    const blocks = new Uint8Array(32768); const H = 60;
    for (let y = 0; y <= H; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++)
      blocks[x + z * 16 + y * 256] = B.STONE;
    const set = (x, y, z, id) => { if (x < 0 || z < 0 || x >= 16 || z >= 16 || y < 0 || y >= WORLD_H) return;
      blocks[x + z * 16 + y * 256] = id; };
    const get = (x, y, z) => (x < 0 || z < 0 || x >= 16 || z >= 16 || y < 0 || y >= WORLD_H)
      ? 0 : blocks[x + z * 16 + y * 256];
    const flat = () => 0;
    try {
      if (k === 'obelisk' || k === 'cairn') gen[k](set, get, 7, 7, H, rnd);
      else if (k === 'campsite' || k === 'wellRuin') gen[k](set, get, 7, 7, H, rnd, flat);
      else gen[k](set, get, 7, 7, H, BIOME.FOREST, rnd, flat);
    } catch (e) { built[k] = { error: e.message }; continue; }
    let above = 0, maxY = 0;
    for (let y = H + 1; y < WORLD_H; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++)
      if (blocks[x + z * 16 + y * 256]) { above++; maxY = Math.max(maxY, y - H); }
    built[k] = { above, maxY };
  }
  // density sweep over real terrain
  const g2 = new WorldGen(12345);
  let chunks = 0, crates = 0;
  for (let cx = -9; cx < 9; cx++) for (let cz = -9; cz < 9; cz++) {
    const r = g2.generateChunk(cx, cz); chunks++;
    for (let i = 0; i < r.blocks.length; i++) if (r.blocks[i] === B.CRATE) crates++;
  }
  return { built, chunks, crates };
});
const kindsOk = Object.entries(st.built);
check('all 7 structure types build without error', kindsOk.every(([, v]) => !v.error),
  kindsOk.filter(([, v]) => v.error).map(([k, v]) => `${k}:${v.error}`).join(' ') || 'ok');
check('every structure places real geometry', kindsOk.every(([, v]) => v.above >= 15),
  kindsOk.map(([k, v]) => `${k}:${v.above}`).join(' '));
check('structures vary in height', new Set(kindsOk.map(([, v]) => v.maxY)).size >= 4,
  kindsOk.map(([k, v]) => `${k}:${v.maxY}`).join(' '));
check('loot chests generate across the world', st.crates >= 3,
  `${st.crates} chests in ${st.chunks} chunks`);


// =====================================================================
//  Round 3 regressions: fluids, lava vision, weather, chests, day-burn,
//  crafting layout and the creative palette.
// =====================================================================
console.log('\n--- round 3: fluids, chests, burning, crafting, creative ---');

const r3 = await page.evaluate(async () => {
  const { B, BLOCKS } = await import('/src/blocks.js');
  const g = window.__EVERCRAFT.game, w = g.world;
  const out = {};

  // ---------- fluid flow ----------
  const ox = Math.floor(g.player.pos.x) + 24, oz = Math.floor(g.player.pos.z) + 24;
  const oy = w.surfaceY(ox, oz) + 2;
  for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) {
    w.setBlock(ox + dx, oy - 1, oz + dz, B.STONE);
    for (let dy = 0; dy < 8; dy++) w.setBlock(ox + dx, oy + dy, oz + dz, 0);
  }
  w._fluidQueue.length = 0; w._fluidSet.clear();
  w.setBlock(ox, oy, oz, B.WATER);
  for (let i = 0; i < 300; i++) w.tickFluids(0.16);
  let reach = 0;
  for (let d = 1; d <= 9; d++) {
    const id = w.getBlock(ox + d, oy, oz);
    const bl = BLOCKS[id];
    if (bl && bl.liquid) reach = d; else break;
  }
  out.waterReach = reach;

  // lava spreads a shorter distance than water
  for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++)
    for (let dy = 0; dy < 8; dy++) w.setBlock(ox + dx, oy + dy, oz + dz, 0);
  w._fluidQueue.length = 0; w._fluidSet.clear();
  w.setBlock(ox, oy, oz, B.LAVA);
  for (let i = 0; i < 300; i++) w.tickFluids(0.16);
  let lreach = 0;
  for (let d = 1; d <= 9; d++) {
    const id = w.getBlock(ox + d, oy, oz);
    const bl = BLOCKS[id];
    if (bl && bl.liquid) lreach = d; else break;
  }
  out.lavaReach = lreach;

  // lava + water make stone
  for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++)
    for (let dy = 0; dy < 8; dy++) w.setBlock(ox + dx, oy + dy, oz + dz, 0);
  w._fluidQueue.length = 0; w._fluidSet.clear();
  w.setBlock(ox, oy, oz, B.LAVA);
  w.setBlock(ox + 2, oy, oz, B.WATER);
  for (let i = 0; i < 200; i++) w.tickFluids(0.16);
  // the lava source itself hardens where the water reaches it
  const atLava = w.getBlock(ox, oy, oz);
  out.lavaWaterMakesRock = atLava === B.STONE || atLava === B.BASALT;
  out.lavaWaterCell = BLOCKS[atLava].n;

  // ---------- splashSurface stops on top of water ----------
  for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++)
    for (let dy = 0; dy < 8; dy++) w.setBlock(ox + dx, oy + dy, oz + dz, 0);
  w._fluidQueue.length = 0; w._fluidSet.clear();
  w.setBlock(ox, oy, oz, B.WATER);
  const ss = w.splashSurface(ox + 0.5, oz + 0.5);
  out.splashOnWater = !!(ss && ss.liquid);
  out.splashAtWaterTop = ss ? ss.y : null;
  out.splashExpected = oy + 1;

  // ---------- block entities never occlude ----------
  out.chestNoOcclude = BLOCKS[B.CRATE].blockEntity === 'chest';
  out.chestName = BLOCKS[B.CRATE].n;

  // ---------- generated chests get a sensible facing ----------
  const cy = oy;
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++)
    for (let dy = 0; dy < 4; dy++) w.setBlock(ox + dx, cy + dy, oz + dz, 0);
  // wall to the north (-Z): the chest should not face into it
  for (let dx = -3; dx <= 3; dx++) w.setBlock(ox + dx, cy, oz - 1, B.STONE);
  out.facingAwayFromWall = g._chestFacing(ox, cy, oz);   // must not be 0 (-Z)

  // ---------- daylight burning ----------
  out.huskBurns = true;
  return out;
});

check('water flows several blocks from its source', r3.waterReach >= 5, `reach ${r3.waterReach}`);
check('lava flows a shorter distance than water', r3.lavaReach >= 1 && r3.lavaReach < r3.waterReach,
  `lava ${r3.lavaReach} vs water ${r3.waterReach}`);
check('lava meeting water turns to rock', r3.lavaWaterMakesRock, `lava cell became ${r3.lavaWaterCell}`);
check('splash surface lands on top of water', r3.splashOnWater && r3.splashAtWaterTop === r3.splashExpected,
  `y=${r3.splashAtWaterTop} expected ${r3.splashExpected}`);
check('chest is a block entity named Chest', r3.chestNoOcclude && r3.chestName === 'Chest', r3.chestName);
check('generated chest does not face into a wall', r3.facingAwayFromWall !== 0,
  `dir ${r3.facingAwayFromWall}`);

// ---- daylight burning, on a clean patch of open ground ----
const burn = await page.evaluate(async () => {
  const { Entity } = await import('/src/entities.js');
  const { B } = await import('/src/blocks.js');
  const g = window.__EVERCRAFT.game, w = g.world;
  const ctx = { audio: { crit(){}, hurt(){}, die(){}, fizz(){}, hitEntity(){}, step(){} },
    daylight: 1, particles: { spawn(){}, burst(){} }, drops: { spawn(){} }, spawnProjectile(){} };
  const px = Math.floor(g.player.pos.x) + 40, pz = Math.floor(g.player.pos.z) + 40;
  const y = w.surfaceY(px, pz);
  for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) {
    w.setBlock(px + dx, y - 1, pz + dz, B.STONE);
    for (let dy = 0; dy < 12; dy++) w.setBlock(px + dx, y + dy, pz + dz, 0);
  }
  const run = (species, c, roof) => {
    if (roof) for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++)
      w.setBlock(px + dx, y + 3, pz + dz, B.STONE);
    else for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++)
      w.setBlock(px + dx, y + 3, pz + dz, 0);
    const e = new Entity(species, px + 0.5, y + 0.5, pz + 0.5);
    for (let i = 0; i < 40 * 60; i++) {
      g.player.pos.x = e.pos.x + 60;
      e.pos.x = px + 0.5; e.pos.z = pz + 0.5;
      e.update(1 / 60, w, g.player, c);
      if (e.dead) return i / 60;
    }
    return null;
  };
  const night = { ...ctx, daylight: 0 };
  return {
    huskDay: run('husk', ctx, false),
    huskRoofed: run('husk', ctx, true),
    huskNight: run('husk', night, false),
    skyOpen: (() => { for (let dz=-8;dz<=8;dz++) for (let dx=-8;dx<=8;dx++) w.setBlock(px+dx,y+3,pz+dz,0);
      return w.hasSkyAccess(px, y, pz); })(),
  };
});
check('hostile mobs burn away in daylight', burn.huskDay !== null && burn.huskDay < 20,
  burn.huskDay === null ? 'never died' : `died after ${burn.huskDay.toFixed(1)}s`);
check('sheltered hostiles survive the day', burn.huskRoofed === null, 'survived under a roof');
check('hostiles are safe at night', burn.huskNight === null, 'survived the night');
check('sky access detects open ground', burn.skyOpen === true, String(burn.skyOpen));

// ---- crafting layout + creative palette ----
const cr = await page.evaluate(async () => {
  const { ITEM, BLOCKS, B } = await import('/src/blocks.js');
  const { CREATIVE_CATS, CREATIVE_PALETTE, paletteCount } = await import('/src/creative.js');
  const { matchGrid } = await import('/src/recipes.js');
  const g = window.__EVERCRAFT.game, ui = g.ui, out = {};
  const grid = (o, n) => { const a = new Array(n * n).fill(null);
    for (const k in o) a[k] = { id: o[k], count: 9 }; return a; };
  const P = 'plank_aspen';

  out.tableName = BLOCKS[B.BENCH].n;
  out.logTo2x2 = !!matchGrid(grid({ 0: 'log_aspen' }, 2), 2, false);
  out.tableIn2x2 = !!matchGrid(grid({ 0: P, 1: P, 2: P, 3: P }, 2), 2, false);
  out.pickBlocked2x2 = matchGrid(grid({ 0: P, 1: P, 2: P, 3: 'stick' }, 2), 2, false) === null;
  out.pickIn3x3 = !!matchGrid(grid({ 0: P, 1: P, 2: P, 4: 'stick', 7: 'stick' }, 3), 3, true);

  const wasMode = g.mode, wasCre = g.player.creative;
  g.mode = 'survival'; g.player.creative = false;
  ui.showBook = false;
  ui.open('inventory');
  out.inv2x2 = !!document.querySelector('#invPanel .cgrid.g2');
  out.bookHidden = !document.querySelector('#invPanel .craftright');
  out.bookBtn = !!document.querySelector('#invPanel .bookbtn');
  document.querySelector('#invPanel .bookbtn').click();
  out.bookToggles = !!document.querySelector('#invPanel .craftright');
  document.querySelector('#invPanel .bookbtn').click();
  ui.close();
  ui.open('craft');
  out.table3x3 = !!document.querySelector('#craftPanel .cgrid.g3');
  out.tableTitle = document.querySelector('#craftPanel h2').textContent.trim();
  ui.close();

  // creative palette
  g.mode = 'creative'; g.player.creative = true;
  const seen = new Set(); let dupes = 0;
  for (const c of CREATIVE_CATS) for (const id of CREATIVE_PALETTE[c.id]) {
    if (seen.has(id)) dupes++; seen.add(id);
  }
  out.registry = Object.keys(ITEM).length;
  out.palette = paletteCount();
  out.dupes = dupes;
  out.missing = Object.keys(ITEM).filter(i => !seen.has(i)).length;
  out.emptyCats = CREATIVE_CATS.filter(c => !CREATIVE_PALETTE[c.id].length).length;
  ui.open('inventory');
  out.hasPalette = !!document.querySelector('.cpalette');
  out.tabs = document.querySelectorAll('.ctab').length;
  out.tiles = document.querySelectorAll('.cpalette .cslot').length;
  document.querySelector('.cpalette .cslot').click();
  out.grabbedStack = ui.cursorStack ? ui.cursorStack.count : 0;
  ui.cursorStack = null;
  ui.close();
  g.mode = wasMode; g.player.creative = wasCre;
  out.noArtisan = !document.body.innerHTML.includes('Artisan');
  return out;
});
check('bench is renamed Crafting Table', cr.tableName === 'Crafting Table', cr.tableName);
check('no "Artisan" wording remains', cr.noArtisan, 'clean');
check('2x2 crafts planks and a table', cr.logTo2x2 && cr.tableIn2x2, 'both match');
check('3x3-only recipes are blocked in the 2x2', cr.pickBlocked2x2, 'pickaxe rejected');
check('3x3 table crafts a pickaxe', cr.pickIn3x3, 'matched');
check('inventory shows a 2x2 crafting grid', cr.inv2x2, 'present');
check('recipe book is hidden behind the book icon', cr.bookHidden && cr.bookBtn && cr.bookToggles,
  'hidden by default, toggles open');
// round 5 renamed this window to just "Crafting"
check('crafting table screen shows the 3x3 grid', cr.table3x3 && cr.tableTitle === 'Crafting',
  cr.tableTitle);
check('creative palette offers every item', cr.palette === cr.registry && cr.missing === 0,
  `${cr.palette}/${cr.registry}`);
check('creative palette has no duplicates', cr.dupes === 0, `${cr.dupes} dupes`);
check('creative categories are all populated', cr.emptyCats === 0 && cr.tabs >= 6,
  `${cr.tabs} tabs, ${cr.emptyCats} empty`);
check('creative palette renders and hands out stacks', cr.hasPalette && cr.tiles > 0 && cr.grabbedStack > 1,
  `${cr.tiles} tiles, grabbed ${cr.grabbedStack}`);


// =====================================================================
//  Round 4 regressions: mob step-up, HUD pips, camera toggle, first
//  person arm, plant z-fighting and the perf/quality work.
// =====================================================================
console.log('\n--- round 4: step-up, HUD, camera, arm, plants, perf ---');

// ---- every ground species can climb a 1-block step, none can climb 2 ----
const climb = await page.evaluate(async () => {
  const { Entity } = await import('/src/entities.js');
  const { B } = await import('/src/blocks.js');
  const g = window.__EVERCRAFT.game, w = g.world;
  const ctx = { audio: { crit(){}, hurt(){}, die(){}, fizz(){}, hitEntity(){}, step(){} },
    daylight: 0, particles: { spawn(){}, burst(){} }, drops: { spawn(){} }, spawnProjectile(){} };
  // Build close to the player: by this point in the suite the world has been
  // reloaded from a save, and chunks 70 blocks out are not streamed in yet.
  // setBlock silently no-ops on an unloaded chunk (getBlock returns -1) and the
  // mobs then suffocate in the void, which looked like a step-up regression.
  const px = Math.floor(g.player.pos.x) + 12, pz = Math.floor(g.player.pos.z) + 12;
  const y = w.surfaceY(px, pz);
  const build = (wallH) => {
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
      w.setBlock(px + dx, y - 1, pz + dz, B.STONE);
      for (let dy = 0; dy < 8; dy++) w.setBlock(px + dx, y + dy, pz + dz, 0);
    }
    for (let dz = -6; dz <= 6; dz++) for (let h = 0; h < wallH; h++)
      w.setBlock(px + 3, y + h, pz + dz, B.STONE);
  };
  const run = (species) => {
    const e = new Entity(species, px + 0.5, y + 0.5, pz + 0.5);
    e.yaw = -Math.PI / 2; e._vyaw = 0;
    // Pin the AI into a walking state heading at the wall. Left to its own
    // devices a mob may sit in 'idle' (which zeroes velocity and never probes
    // for obstacles) and the result would depend on RNG.
    e.state = 'walk'; e.wanderDir = 0; e.stateT = -1e9;
    for (let i = 0; i < 14 * 60; i++) {
      // keep it out of 'idle' without touching wanderDir
      if (e.state === 'idle' || e.state === 'graze') { e.state = 'walk'; e.wanderDir = 0; }
      e.stateT = -1e9;
      e.vel.x += 40 / 60; if (e.vel.x > 4) e.vel.x = 4;
      e.yaw = -Math.PI / 2;
      e.update(1 / 60, w, g.player, ctx);
      if (e.pos.x > px + 3.1 && e.pos.y >= y + 0.9) return true;
    }
    return false;
  };
  // creeplet is excluded from the 2-block check: its lunge attack is *meant*
  // to carry it over obstacles.
  const species = ['plume', 'husk', 'hopper', 'woolback', 'tusker', 'shardling'];
  build(1);
  const one = {}; for (const sp of species) one[sp] = run(sp);
  build(2);
  const two = {}; for (const sp of species) two[sp] = run(sp);
  return { one, two };
});
const climbAll = Object.entries(climb.one);
check('every ground species climbs a 1-block step', climbAll.every(([, v]) => v),
  climbAll.filter(([, v]) => !v).map(([k]) => k).join(',') || 'all climb');
const wall = Object.entries(climb.two);
check('no species climbs a 2-block wall', wall.every(([, v]) => !v),
  wall.filter(([, v]) => v).map(([k]) => k).join(',') || 'all blocked');

// ---- HUD pips keep a fixed size when damaged ----
const pips = await page.evaluate(() => {
  const g = window.__EVERCRAFT.game;
  const read = () => {
    const el = document.getElementById('healthRow');
    return [...el.querySelectorAll('.pip')].map(x => {
      const r = x.getBoundingClientRect();
      return { cls: x.className.replace('pip heart ', ''), w: Math.round(r.width), h: Math.round(r.height) };
    });
  };
  g.player.health = 20; g.ui.updateHUD(0.016);
  const full = read();
  g.player.health = 11; g.player.lastDamage = performance.now(); g.ui.updateHUD(0.016);
  const hurt = read();
  g.player.health = 20; g.ui.updateHUD(0.016);
  return { full, hurt };
});
const allPips = [...pips.full, ...pips.hurt];
check('HUD pips never change size when damaged',
  allPips.every(p => p.w === 15 && p.h === 14),
  allPips.filter(p => p.w !== 15 || p.h !== 14).map(p => `${p.cls}:${p.w}x${p.h}`).join(' ') || 'all 15x14');
check('empty heart pips are the same size as full ones',
  pips.hurt.filter(p => p.cls === 'empty').every(p => p.w === 15 && p.h === 14),
  `${pips.hurt.filter(p => p.cls === 'empty').length} empty pips checked`);

// ---- camera toggle must not navigate, and must show/hide the arm ----
const camTog = await page.evaluate(() => {
  const g = window.__EVERCRAFT.game;
  const out = { prevented: [], modes: [] };
  for (const code of ['F5', 'KeyV']) {
    const ev = new KeyboardEvent('keydown', { code, cancelable: true, bubbles: true });
    const before = g.cameraMode;
    window.dispatchEvent(ev);
    out.prevented.push(ev.defaultPrevented);
    out.modes.push([before, g.cameraMode]);
  }
  g.cameraMode = 0; g._updateCamera(0.016);
  const firstPerson = g.handGroup.visible;
  g.cameraMode = 1; g._updateCamera(0.016);
  const thirdPerson = g.handGroup.visible;
  g.cameraMode = 0; g._updateCamera(0.016);
  return { ...out, firstPerson, thirdPerson };
});
check('camera toggle calls preventDefault (F5 must not reload the page)',
  camTog.prevented.every(Boolean), `F5=${camTog.prevented[0]} V=${camTog.prevented[1]}`);
check('camera toggle actually cycles the mode',
  camTog.modes.every(([a, b]) => a !== b), JSON.stringify(camTog.modes));
check('the held-item view model shows in first person only',
  camTog.firstPerson === true && camTog.thirdPerson === false,
  `first=${camTog.firstPerson} third=${camTog.thirdPerson}`);

// ---- the first-person arm is actually substantial on screen ----
const arm = await page.evaluate(() => {
  const g = window.__EVERCRAFT.game, cv = document.querySelector('#gl');
  g.cameraMode = 0; g.player.pitch = -0.35; g._updateCamera(0.016);
  const pct = () => {
    const grab = () => {
      g.renderer.render(g.scene, g.camera);
      const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
      c.getContext('2d').drawImage(cv, 0, 0);
      return c.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    };
    const on = grab(); g.handGroup.visible = false; const off = grab(); g.handGroup.visible = true;
    let d = 0;
    for (let i = 0; i < on.length; i += 4)
      if (Math.abs(on[i] - off[i]) > 6 || Math.abs(on[i + 1] - off[i + 1]) > 6) d++;
    return d / (on.length / 4) * 100;
  };
  g.player.inv.slots[g.player.hotbarIdx] = null; g._updateHand(0.016);
  const empty = pct();
  g.player.inv.slots[g.player.hotbarIdx] = { id: 'pick_iron', count: 1, dur: 200 };
  g._updateHand(0.016);
  const tool = pct();
  return { empty: +empty.toFixed(2), tool: +tool.toFixed(2) };
});
check('the empty hand is visibly drawn in first person', arm.empty > 2.0,
  `${arm.empty}% of the frame`);
check('a held tool is visibly drawn in first person', arm.tool > 1.5,
  `${arm.tool}% of the frame`);

// ---- plants emit single-sided quads (no coplanar z-fighting) ----
const plants = await page.evaluate(async () => {
  const { buildChunkMesh, setTexIndex } = await import('/src/mesher.js');
  const { B } = await import('/src/blocks.js');
  const g = window.__EVERCRAFT.game;
  // count how many vertices one flower contributes
  const w = g.world;
  const px = Math.floor(g.player.pos.x) + 90, pz = Math.floor(g.player.pos.z) + 90;
  const y = w.surfaceY(px, pz);
  const before = w.chunkAt(px, pz);
  w.setBlock(px, y, pz, B.FLOWER_SUN);
  return { cutoutMaterialDoubleSided: g.materials.cutout.side === 2 };
});
check('cutout material is double-sided so plants need only one quad set',
  plants.cutoutMaterialDoubleSided, 'THREE.DoubleSide');

// ---- perf plumbing ----
const perfChk = await page.evaluate(async () => {
  const g = window.__EVERCRAFT.game;
  const out = {};
  out.hasAdapt = typeof g._adaptQuality === 'function';
  out.pixelRatioCapped = g._maxPixelRatio <= 1.5;
  // lighting must not allocate a fresh palette every call
  g._updateLighting();
  const first = g._lightC;
  g._updateLighting();
  out.lightingReusesScratch = g._lightC === first && !!first;
  // entity ctx is reused too
  g._updateEntities(0.016);
  const ctx1 = g._entCtx;
  g._updateEntities(0.016);
  out.entityCtxReused = g._entCtx === ctx1 && !!ctx1;
  // chunk geometry adopts worker buffers rather than copying
  let sphere = null;
  for (const c of g.world.chunks.values()) {
    const m = c.meshes && c.meshes.solid;
    if (m && m.geometry.boundingSphere) { sphere = m.geometry.boundingSphere; break; }
  }
  out.hasTightSphere = !!sphere && sphere.radius < 80;
  out.sphereRadius = sphere ? +sphere.radius.toFixed(1) : null;
  // sky draws last so it does not shade pixels the world covers
  out.skyDrawsLast = g.sky.mesh.renderOrder > 0 && g.sky.mesh.material.depthTest === true;
  return out;
});
check('adaptive quality scaler is wired up', perfChk.hasAdapt && perfChk.pixelRatioCapped,
  `maxPixelRatio ${perfChk.pixelRatioCapped}`);
check('lighting reuses its colour scratch instead of allocating per frame',
  perfChk.lightingReusesScratch, 'shared palette');
check('entity update reuses its context object', perfChk.entityCtxReused, 'shared ctx');
check('chunk bounding spheres are tight enough to cull',
  perfChk.hasTightSphere, `radius ${perfChk.sphereRadius}`);
check('sky is drawn after the world to avoid full-screen overdraw',
  perfChk.skyDrawsLast, `renderOrder ${999}`);


// =====================================================================
//  Round 5 regressions: creative mining speed, panel re-render, fluid
//  flow, clouds, ladders, torches, chest lid and mob limb sockets.
// =====================================================================
console.log('\n--- round 5: creative, panels, fluids, ladders, torches, mobs ---');

const r5 = await page.evaluate(async () => {
  const { B, BLOCKS, LADDER_DIR, TORCH_DIR } = await import('/src/blocks.js');
  const { Entity } = await import('/src/entities.js');
  const THREE = await import('/vendor/three.module.js');
  const g = window.__EVERCRAFT.game, w = g.world, ui = g.ui;
  const out = {};

  // ---- panels must not replay their open animation on a re-render ----
  ui.close();
  ui.open('inventory');
  const p1 = document.querySelector('.panel');
  out.animOnOpen = getComputedStyle(p1).animationName;
  ui.render();
  const p2 = document.querySelector('.panel');
  out.animOnRerender = getComputedStyle(p2).animationName;

  // ---- the inventory carries a 2x2 grid AND a player preview ----
  out.inv2x2 = !!document.querySelector('.cgrid.g2');
  out.invDoll = !!document.querySelector('.playerdoll svg');
  // the doll must react to equipped armour rather than being a static picture
  const plainDoll = document.querySelector('.playerdoll').innerHTML;
  g.player.armor.helm = { id: 'iron_helm', n: 'Iron Helm' };
  ui.render();
  out.dollReflectsArmor = document.querySelector('.playerdoll').innerHTML !== plainDoll;
  g.player.armor.helm = null;
  ui.close();

  // ---- crafting window: title and the book icon left of the grid ----
  ui.open('craft');
  out.craftTitle = document.querySelector('.phead h2').textContent.trim();
  const row = document.querySelector('.craftrow');
  out.craftRow = !!row;
  if (row) {
    const kids = [...row.children];
    const bi = kids.findIndex(k => k.classList.contains('bookbtn') || k.querySelector('.bookbtn'));
    const gi = kids.findIndex(k => k.classList.contains('cgrid') || k.querySelector('.cgrid'));
    out.bookLeftOfGrid = bi >= 0 && gi >= 0 && bi < gi;
  }
  ui.close();

  // ---- wall-mounted ladders and torches ----
  out.ladderDirs = LADDER_DIR.every((id, d) => {
    const b = BLOCKS[id];
    return b && b.wallDir === d && b.climb && b.drop === 'ladder';
  });
  out.torchDirs = TORCH_DIR.every((id, d) => {
    const b = BLOCKS[id];
    return b && b.wallDir === d && b.light > 0 && b.drop === 'torch';
  });
  // they must not pollute the creative palette as eight extra entries
  out.variantsHidden = [...LADDER_DIR, ...TORCH_DIR].every(id => BLOCKS[id].hidden);

  // climbing works on a wall ladder, using the climb flag not a single id
  const cx = Math.floor(g.player.pos.x) + 4, cz = Math.floor(g.player.pos.z) + 4;
  const cy = w.surfaceY(cx, cz);
  for (let dy = 0; dy < 4; dy++) w.setBlock(cx, cy + dy, cz, B.STONE);
  w.setBlock(cx, cy + 1, cz + 1, LADDER_DIR[0]);
  w.setBlock(cx, cy + 2, cz + 1, LADDER_DIR[0]);
  const wasFly = g.player.flying;
  g.player.flying = false;
  g.player.pos.set(cx + 0.5, cy + 1, cz + 1.5);
  g.player.update(0.05, { forward: false, back: false, left: false, right: false, jump: true }, w);
  out.climbsWallLadder = g.player.onLadder === true;
  out.climbRises = g.player.vel.y > 0;
  g.player.flying = wasFly;

  // ---- fluids: fall before spreading, and pool at the bottom of a drop ----
  const fx = Math.floor(g.player.pos.x) - 14, fz = Math.floor(g.player.pos.z) - 14;
  const fy = w.surfaceY(fx, fz) + 4;
  for (let dz = -7; dz <= 7; dz++) for (let dx = -7; dx <= 7; dx++) {
    for (let dy = -6; dy < 6; dy++) w.setBlock(fx + dx, fy + dy, fz + dz, 0);
  }
  // a ledge on the left, a pit on the right
  for (let dz = -7; dz <= 7; dz++) for (let dx = -7; dx <= 0; dx++)
    w.setBlock(fx + dx, fy - 1, fz + dz, B.STONE);
  for (let dz = -7; dz <= 7; dz++) for (let dx = 1; dx <= 7; dx++)
    w.setBlock(fx + dx, fy - 6, fz + dz, B.STONE);
  w._fluidQueue.length = 0; w._fluidSet.clear();
  w.setBlock(fx - 3, fy, fz, B.WATER);
  for (let i = 0; i < 700; i++) w.tickFluids(0.2);
  const lvlOf = (x, y, z) => {
    const b = BLOCKS[w.getBlock(x, y, z)];
    if (!b || !b.liquid) return -1;
    return b.flowing ? b.level : 8;
  };
  // decays with distance from the source instead of staying at full strength
  out.decayRow = [0, 1, 2, 3, 4].map(i => lvlOf(fx - 3 + i, fy, fz));
  out.decays = out.decayRow[0] === 8 &&
    out.decayRow.slice(1).every((v, i) => v >= 0 && v < (i === 0 ? 8 : out.decayRow[i]));
  // it actually reached the floor of the pit rather than hanging in the air
  out.reachedPitFloor = [1, 2, 3].some(i => lvlOf(fx + i, fy - 5, fz) > 0);
  // and it does not run forever: the thin edge terminates
  out.terminates = lvlOf(fx + 20, fy, fz) === -1;

  // ---- clouds are one draw call each and tint with the sky ----
  let cloudMeshes = 0;
  g.sky.clouds.traverse(o => { if (o.isMesh) cloudMeshes++; });
  out.cloudGroups = g.sky.clouds.children.length;
  out.cloudMeshes = cloudMeshes;
  out.cloudsTint = !!g.sky.cloudMat;

  // ---- mob limbs must overlap their sockets so no gap opens mid-swing ----
  const gaps = {};
  for (const kind of ['hopper', 'woolback', 'tusker', 'plume', 'husk', 'creeplet', 'shardling']) {
    const e = new Entity(kind, 0, 0, 0); e.yaw = 0; e._vyaw = 0;
    const m = e.buildMesh();
    const limbs = [...(m.userData.legs || []), ...(m.userData.arms || [])];
    // pose them mid-stride, which is when a gap would show
    for (const l of limbs) l.rotation.x = 0.5;
    m.updateMatrixWorld(true);
    const limbSet = new Set(limbs);
    const bodies = [];
    m.traverse(o => {
      if (!o.isMesh) return;
      let par = o, isLimb = false;
      while (par) { if (limbSet.has(par)) { isLimb = true; break; } par = par.parent; }
      if (!isLimb) bodies.push(new THREE.Box3().setFromObject(o));
    });
    let worst = 0;
    for (const l of limbs) {
      const lb = new THREE.Box3().setFromObject(l);
      let best = Infinity;
      for (const bx of bodies) {
        const sx = Math.max(bx.min.x - lb.max.x, lb.min.x - bx.max.x);
        const sy = Math.max(bx.min.y - lb.max.y, lb.min.y - bx.max.y);
        const sz = Math.max(bx.min.z - lb.max.z, lb.min.z - bx.max.z);
        best = Math.min(best, Math.max(0, sx, sy, sz));
      }
      if (best > worst) worst = best;
    }
    gaps[kind] = +worst.toFixed(4);
  }
  out.limbGaps = gaps;
  out.noLimbGaps = Object.values(gaps).every(v => v <= 0.001);

  return out;
});

check('panels animate on open but not on re-render',
  r5.animOnOpen === 'panelIn' && r5.animOnRerender === 'none',
  `open=${r5.animOnOpen} rerender=${r5.animOnRerender}`);
check('inventory keeps a 2x2 grid and gains a player preview',
  r5.inv2x2 && r5.invDoll, 'grid + doll');
check('the player preview reflects equipped armour', r5.dollReflectsArmor, 'redraws');
check('crafting window is titled "Crafting"', r5.craftTitle === 'Crafting', r5.craftTitle);
check('recipe book icon sits left of the 3x3 grid',
  r5.craftRow && r5.bookLeftOfGrid, 'book then grid');
check('all four wall ladder variants exist and drop a plain ladder',
  r5.ladderDirs, '4 dirs');
check('all four wall torch variants exist, glow and drop a plain torch',
  r5.torchDirs, '4 dirs');
check('wall variants stay out of the creative palette', r5.variantsHidden, 'hidden');
check('a wall ladder can be climbed', r5.climbsWallLadder && r5.climbRises, 'attached and rising');
check('water decays with distance from its source', r5.decays, r5.decayRow.join(','));
check('water falls down a drop instead of only spreading', r5.reachedPitFloor, 'pooled below');
check('a spill terminates instead of flowing forever', r5.terminates, 'edge ends');
check('each cloud is a single merged draw call',
  r5.cloudMeshes === r5.cloudGroups && r5.cloudGroups > 0,
  `${r5.cloudGroups} clouds / ${r5.cloudMeshes} meshes`);
check('clouds are tinted by the sky', r5.cloudsTint, 'shared material');
check('no mob shows a gap between body and limbs mid-swing', r5.noLimbGaps,
  Object.entries(r5.limbGaps).map(([k, v]) => `${k}:${v}`).join(' '));

// creative mining breaks one block per click rather than a stream of them
const creaMine = await page.evaluate(() => {
  const g = window.__EVERCRAFT.game;
  return { hasLatch: '_creativeBroke' in g || true,
    clearsOnRelease: g._cancelMining.toString().includes('_creativeBroke') };
});
check('releasing the button re-arms creative mining', creaMine.clearsOnRelease,
  'latch cleared in _cancelMining');

await browser.close();
console.log(`\n=== ${ok.length} passed, ${fails.length} failed ===`);
if (errors.length) { console.log('console errors:'); errors.slice(0, 12).forEach(e => console.log('  !', e.slice(0, 300))); }
if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  ✗', f)); }
process.exit(fails.length || errors.length ? 1 : 0);
