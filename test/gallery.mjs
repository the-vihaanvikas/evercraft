// Capture title, night, inventory, smelter and verify hostile spawning.
import puppeteer from 'puppeteer';
const URL = process.env.URL || 'http://127.0.0.1:8080/';
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + (e.stack || e.message)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 1400));
await page.screenshot({ path: '/home/user/evercraft/test/title.png' });

await page.evaluate(() => window.__EVERCRAFT.begin({ slot: 3, name: 'Gallery', seed: 'evercraft-demo', load: false }));
await page.waitForFunction(() => document.querySelector('#loading').classList.contains('hidden'), { timeout: 90000 });

// go to night on a good surface spot, check hostile spawns
const night = await page.evaluate(async () => {
  const g = window.__EVERCRAFT.game;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let best = null;
  for (const c of g.world.chunks.values()) {
    if (!c.heights) continue;
    for (let i = 0; i < 256; i += 11) {
      const h = c.heights[i], b = c.biomes[i];
      if (h < 50 || h > 76 || b === 0 || b === 1) continue;
      if (!best || h > best.h) best = { x: c.cx * 16 + (i % 16), z: c.cz * 16 + ((i / 16) | 0), h, b };
    }
  }
  if (best) { g.player.pos.set(best.x + .5, best.h + 2, best.z + .5); g.player.vel.set(0, 0, 0); }
  g.worldTime = 600 * 0.88;          // deep night
  g.player.yaw = 0.9; g.player.pitch = -0.05;
  g.player.inv.slots[0] = { id: 'torch', count: 32 };
  for (let i = 0; i < 80; i++) {
    await sleep(120);
    if (g.world.loadedFraction(g.player.pos.x, g.player.pos.z, 3) > 0.95) break;
  }
  g.player.pos.y = g.world.surfaceY(g.player.pos.x, g.player.pos.z) + 0.1;
  // place a ring of torches for the shot
  const bx = Math.floor(g.player.pos.x), by = Math.floor(g.player.pos.y), bz = Math.floor(g.player.pos.z);
  for (const [dx, dz] of [[3, 0], [-3, 1], [0, 4], [2, -3]]) {
    const y = g.world.surfaceY(bx + dx, bz + dz);
    if (g.world.getBlock(bx + dx, y, bz + dz) === 0) g.world.setBlock(bx + dx, y, bz + dz, 44);
  }
  await sleep(6000);   // let hostiles spawn
  const kinds = {};
  for (const e of g.entities) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  return { daylight: +g.daylight().toFixed(2), entities: g.entities.length, kinds,
    pos: g.player.pos.toArray().map(v => +v.toFixed(1)), biome: g.biomeName() };
});
console.log('night:', JSON.stringify(night));
await page.screenshot({ path: '/home/user/evercraft/test/night.png' });

// inventory with gear
await page.evaluate(() => {
  const g = window.__EVERCRAFT.game;
  g.player.armor.helm = { id: 'helm_iron', count: 1, dur: 300 };
  g.player.armor.chest = { id: 'chest_iron', count: 1, dur: 220 };
  g.player.armor.legs = { id: 'legs_copper', count: 1, dur: 100 };
  g.player.armor.boots = { id: 'boots_hide', count: 1, dur: 60 };
  g.player.inv.slots[1] = { id: 'pick_aurorite', count: 1, dur: 880 };
  g.player.inv.slots[2] = { id: 'blade_iron', count: 1, dur: 300 };
  g.player.inv.slots[3] = { id: 'axe_copper', count: 1, dur: 180 };
  g.player.inv.add('glimmer_shard', 21); g.player.inv.add('aurorite', 9);
  g.player.inv.add('lumen', 12); g.player.inv.add('berry_pie', 4);
  g.player.inv.add('stone_bricks', 64); g.player.inv.add('wool_teal', 17);
  g.player.inv.add('lantern', 6); g.player.inv.add('crate', 3);
  g.player.level = 14;
  g.ui.open('inventory');
});
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: '/home/user/evercraft/test/inv.png' });

// smelter UI mid-burn
await page.evaluate(() => {
  const g = window.__EVERCRAFT.game;
  g.ui.close();
  const c = { kind: 'smelter', input: { id: 'raw_iron', count: 5 }, fuel: { id: 'coal', count: 3 },
    out: { id: 'iron_ingot', count: 2 }, burn: 6, burnMax: 12, cook: 2.4 };
  g.ui.open('smelter', { container: c, pos: [0, 0, 0] });
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/home/user/evercraft/test/smelter.png' });

// guide
await page.evaluate(() => { const g = window.__EVERCRAFT.game; g.ui.close(); g.ui.open('guide'); });
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/home/user/evercraft/test/guide.png' });

await browser.close();
console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
