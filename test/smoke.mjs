// Headless smoke test for EVERCRAFT
import puppeteer from 'puppeteer';

const URL = process.env.URL || 'http://127.0.0.1:8080/';
const errors = [];
const logs = [];

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--enable-webgl', '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

page.on('console', m => {
  const t = m.text();
  logs.push(`[${m.type()}] ${t}`);
  if (m.type() === 'error') errors.push(t);
});
page.on('pageerror', e => errors.push('PAGEERROR: ' + (e.stack || e.message)));
page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url() + ' ' + r.failure()?.errorText));

console.log('→ loading', URL);
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

const webgl2 = await page.evaluate(() => {
  const c = document.createElement('canvas');
  return !!c.getContext('webgl2');
});
console.log('  webgl2 available:', webgl2);
if (!webgl2) { console.log('  (skipping run: no webgl2 in this environment)'); }

console.log('→ starting world');
await page.evaluate(() => window.__EVERCRAFT.begin({ slot: 1, name: 'Test', seed: 'testseed', load: false }));

// wait for loading overlay to hide
await page.waitForFunction(() => document.querySelector('#loading').classList.contains('hidden'),
  { timeout: 90000 }).catch(() => errors.push('TIMEOUT: loading never finished'));

const state = await page.evaluate(() => {
  const g = window.__EVERCRAFT.game;
  return {
    running: g.running,
    chunks: g.world.chunks.size,
    pos: [g.player.pos.x, g.player.pos.y, g.player.pos.z],
    fps: g.fps,
    hasMeshes: [...g.world.chunks.values()].filter(c => c.hasMesh).length,
    biome: g.biomeName(),
    tris: g.renderer.info.render.triangles,
    draws: g.renderer.info.render.calls,
  };
});
console.log('  state:', JSON.stringify(state));

// simulate a few seconds of play + interactions
console.log('→ simulating play');
await page.evaluate(async () => {
  const g = window.__EVERCRAFT.game;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // walk
  g.keys['KeyW'] = true;
  await sleep(1200);
  g.keys['KeyW'] = false;
  g.keys['Space'] = true; await sleep(200); g.keys['Space'] = false;
  // mine below-ish: pick block under crosshair by looking down
  g.player.pitch = -1.2;
  g.mouse.left = true;
  await sleep(2500);
  g.mouse.left = false;
  // place
  g.player.inv.add('stone', 10);
  g.player.hotbarIdx = 0;
  g._useAction();
  await sleep(200);
  // open screens
  g.ui.open('inventory'); await sleep(120); g.ui.close();
  g.ui.open('craft'); await sleep(200);
  // craft planks if possible
  const r = window.__EVERCRAFT.game.craftDebug;
  g.ui.close();
  g.ui.open('map'); await sleep(400); g.ui.close();
  g.ui.open('guide'); await sleep(120); g.ui.close();
  // force some entities
  await sleep(1500);
  // damage & heal
  g.player.damage(3, 'test');
  await sleep(300);
  // save/load roundtrip
  g.save(true);
  await sleep(200);
});

const after = await page.evaluate(() => {
  const g = window.__EVERCRAFT.game;
  return {
    chunks: g.world.chunks.size,
    entities: g.entities.length,
    drops: g.itemDrops.items.length,
    mined: g.player.stats.mined,
    placed: g.player.stats.placed,
    health: g.player.health,
    fps: Math.round(g.fps),
    edits: Object.keys(g.world.serializeEdits()).length,
    saveSize: (localStorage.getItem('evercraft.save.1') || '').length,
    tris: g.renderer.info.render.triangles,
    draws: g.renderer.info.render.calls,
    pos: g.player.pos.toArray().map(v => +v.toFixed(1)),
    onGround: g.player.onGround,
  };
});
console.log('  after play:', JSON.stringify(after));

// reload from save
console.log('→ testing save/load');
await page.reload({ waitUntil: 'networkidle2' });
await page.evaluate(() => window.__EVERCRAFT.begin({ slot: 1, load: true }));
await page.waitForFunction(() => document.querySelector('#loading').classList.contains('hidden'),
  { timeout: 90000 }).catch(() => errors.push('TIMEOUT: reload loading'));
const loaded = await page.evaluate(() => {
  const g = window.__EVERCRAFT.game;
  return { pos: g.player.pos.toArray().map(v => +v.toFixed(1)), mined: g.player.stats.mined, name: g.worldName };
});
console.log('  loaded:', JSON.stringify(loaded));

await page.screenshot({ path: '/home/user/evercraft/test/shot.png' });

await browser.close();

console.log('\n=== console errors ===');
if (!errors.length) console.log('  none 🎉');
else errors.slice(0, 40).forEach(e => console.log('  ✗', e.slice(0, 400)));
process.exit(errors.length ? 1 : 0);
