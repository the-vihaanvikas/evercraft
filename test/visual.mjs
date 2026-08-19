// Visual + diagnostics run: teleport to good terrain, midday, screenshot.
import puppeteer from 'puppeteer';
const URL = process.env.URL || 'http://127.0.0.1:8080/';
const errors = [];

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--enable-webgl', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', e => errors.push('PAGEERROR: ' + (e.stack || e.message)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await page.evaluate(() => window.__EVERCRAFT.begin({ slot: 3, name: 'Visual', seed: 'evercraft-demo', load: false }));
await page.waitForFunction(() => document.querySelector('#loading').classList.contains('hidden'), { timeout: 90000 });

// find a scenic surface spot and stand on it
const info = await page.evaluate(async () => {
  const g = window.__EVERCRAFT.game;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  g.worldTime = 600 * 0.34;              // late morning
  // search loaded chunks for a high land column with trees nearby
  let best = null;
  for (const c of g.world.chunks.values()) {
    if (!c.heights) continue;
    for (let i = 0; i < 256; i += 7) {
      const h = c.heights[i], b = c.biomes[i];
      if (h < 48 || h > 78) continue;
      if (b === 0 || b === 1) continue;
      const score = h + (b === 3 || b === 9 || b === 5 ? 22 : 0);
      if (!best || score > best.score) {
        best = { score, x: c.cx * 16 + (i % 16), z: c.cz * 16 + Math.floor(i / 16), h, b };
      }
    }
  }
  if (best) {
    g.player.pos.set(best.x + 0.5, best.h + 2.2, best.z + 0.5);
    g.player.vel.set(0, 0, 0);
  }
  g.player.yaw = 0.7; g.player.pitch = -0.12;
  // let chunks stream in around new position
  for (let i = 0; i < 90; i++) {
    await sleep(120);
    if (g.world.loadedFraction(g.player.pos.x, g.player.pos.z, 3) > 0.95) break;
  }
  await sleep(1500);
  g.player.pos.y = g.world.surfaceY(g.player.pos.x, g.player.pos.z) + 0.1;
  await sleep(700);

  // HUD diagnostics: find oversized elements
  const big = [];
  document.querySelectorAll('#ui *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 60 && (el.className || '').toString().includes('pip')) {
      big.push({ cls: el.className, w: Math.round(r.width), h: Math.round(r.height), id: el.parentElement?.id });
    }
  });
  const rows = {};
  ['healthRow', 'armorRow', 'hungerRow', 'airRow'].forEach(id => {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    rows[id] = { n: el.children.length, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
  });
  return {
    best, big, rows,
    pos: g.player.pos.toArray().map(v => +v.toFixed(1)),
    biome: g.biomeName(),
    chunks: g.world.chunks.size,
    tris: g.renderer.info.render.triangles,
    draws: g.renderer.info.render.calls,
    entities: g.entities.length,
    daylight: +g.daylight().toFixed(2),
  };
});
console.log(JSON.stringify(info, null, 1));

await page.screenshot({ path: '/home/user/evercraft/test/surface.png' });

// underground shot
await page.evaluate(async () => {
  const g = window.__EVERCRAFT.game;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  g.player.creative = true; g.player.flying = true;
  g.player.pos.y = 22; g.player.pitch = 0; g.player.yaw = 1.2;
  g.player.inv.slots[0] = { id: 'torch', count: 20 };
  await sleep(2500);
});
await page.screenshot({ path: '/home/user/evercraft/test/cave.png' });

// UI shots
await page.evaluate(() => { const g = window.__EVERCRAFT.game;
  g.player.inv.add('log_aspen', 12); g.player.inv.add('rubble', 30); g.player.inv.add('stick', 9);
  g.player.inv.add('iron_ingot', 14); g.player.inv.add('coal', 8); g.player.inv.add('cooked_meat', 3);
  g.nearBench = true; g.ui.open('craft'); });
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: '/home/user/evercraft/test/craft.png' });

await page.evaluate(() => { const g = window.__EVERCRAFT.game; g.ui.close(); g.ui.open('inventory'); });
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/home/user/evercraft/test/inv.png' });

await page.evaluate(() => { const g = window.__EVERCRAFT.game; g.ui.close(); g.ui.open('map'); });
await new Promise(r => setTimeout(r, 900));
await page.screenshot({ path: '/home/user/evercraft/test/map.png' });

await browser.close();
console.log('errors:', errors.length ? errors.slice(0, 10) : 'none');
