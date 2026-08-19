// EVERCRAFT - bootstrap: title screen, loading, game start.

import { Game } from './game.js';
import { CHUNK_X } from './blocks.js';

const $ = s => document.querySelector(s);

const TIPS = [
  'Torches keep hostiles from spawning — light your base well.',
  'Aurorite geodes glow teal below y=26. You need an iron pick to break them.',
  'Sneak (<b>Shift</b>) near ledges — you will not walk off the edge.',
  'Shear a Woolback with Shears for wool without harming it.',
  'A Smelter turns raw ore into ingots. Coal, charcoal and wood all burn.',
  'Husks burn away in morning sunlight. Survive the night and dawn clears the field.',
  'Press <b>F3</b> for performance stats, <b>F5</b> to change the camera view.',
  'Right-click a Crafting Table to open the full 3x3 grid.',
  'Falling more than three blocks hurts. Water breaks a fall completely.',
  'Glimmer clusters are the rarest find — deep, dark and worth the trip.',
  'Your world autosaves every 45 seconds and when you exit to the title.',
  'Press <b>X</b> to move an item into your off hand — a torch there lights the way.',
  'Sleep in a bed at night: you wake at dawn, rested and healed.',
  'Every wood makes its own door. Pine, aspen, emberwood and palm all hang differently.',
  'Thatch, plaster and timber frame are the makings of a proper cottage.',
];

let game = null;

// ------------------------------------------------------------- title anim
/**
 * Pixel-art parallax backdrop: a chunky voxel landscape rendered at low
 * resolution and upscaled with nearest-neighbour, so every edge stays blocky.
 * Drawn on an offscreen buffer at 1/PX scale then blitted, which is both
 * cheaper and guarantees crisp pixels.
 */
const SPLASHES = [
  'Dig deeper!', 'Now with 100% more cubes!', 'Watch out for Gloom!',
  'Torches sold separately.', 'Voxels all the way down.', 'Mine responsibly!',
  'Built from scratch!', 'No two worlds alike.', 'Try the mushroom stew.',
  'Aurorite glows in the dark!', 'Punch tree, get wood.', 'Sleep is optional.',
];

function startTitleAnim() {
  const c = $('#titleCanvas');
  const ctx = c.getContext('2d', { alpha: false });
  const PX = 4;                       // pixel size of the low-res buffer
  const buf = document.createElement('canvas');
  const bx = buf.getContext('2d', { alpha: false });
  let W = 0, H = 0, raf = 0;

  function resize() {
    c.width = c.clientWidth; c.height = c.clientHeight;
    W = Math.max(1, Math.ceil(c.width / PX));
    H = Math.max(1, Math.ceil(c.height / PX));
    buf.width = W; buf.height = H;
  }
  resize();
  window.addEventListener('resize', resize);

  // deterministic value noise for the hill silhouettes
  const rand = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
  const layerHeight = (layer, wx, amp, base) => {
    const s = wx * 0.06 + layer * 40;
    const i = Math.floor(s), f = s - i;
    const a = rand(i + layer * 13), b = rand(i + 1 + layer * 13);
    const t = f * f * (3 - 2 * f);
    return base + (a + (b - a) * t) * amp;
  };

  // parallax layers: far mountains -> mid hills -> near ground
  const LAYERS = [
    { sp: 2.5, amp: 10, base: 0.46, top: '#7d9ab0', side: '#66839b', dark: '#5a768d' },
    { sp: 6.0, amp: 12, base: 0.60, top: '#5f9c52', side: '#4a7d40', dark: '#3f6b36' },
    { sp: 13.0, amp: 9, base: 0.76, top: '#74bd5c', side: '#57964a', dark: '#487f3d' },
  ];

  // drifting pixel clouds
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    clouds.push({ x: Math.random(), y: 0.06 + Math.random() * 0.24, w: 8 + ((Math.random() * 14) | 0), sp: 0.4 + Math.random() * 0.9 });
  }
  // floating spark motes
  const motes = [];
  for (let i = 0; i < 26; i++) {
    motes.push({ x: Math.random(), y: Math.random(), sp: 0.15 + Math.random() * 0.5, ph: Math.random() * 6.28 });
  }

  function draw(t) {
    const time = t * 0.001;
    // --- sky gradient, quantised into bands so it stays pixel-art ---
    const BANDS = 12;
    const horizon = H * 0.74;
    for (let i = 0; i < BANDS; i++) {
      const f = i / (BANDS - 1);
      // deep blue overhead easing into a warm haze at the horizon
      const r = Math.round(58 + f * 118), g = Math.round(104 + f * 90), b = Math.round(168 + f * 30);
      bx.fillStyle = `rgb(${r},${g},${b})`;
      bx.fillRect(0, Math.floor(horizon * f), W, Math.ceil(horizon / BANDS) + 1);
    }
    bx.fillStyle = 'rgb(176,194,198)';
    bx.fillRect(0, Math.floor(horizon), W, H - Math.floor(horizon));

    // --- sun ---
    const sunX = Math.floor(W * 0.80), sunY = Math.floor(H * 0.15);
    bx.fillStyle = 'rgba(255,240,190,.16)';
    bx.fillRect(sunX - 7, sunY - 5, 15, 11);
    bx.fillRect(sunX - 5, sunY - 7, 11, 15);
    // stepped disc: corners trimmed so it reads round at pixel scale
    bx.fillStyle = '#ffe9a8';
    bx.fillRect(sunX - 4, sunY - 2, 9, 5);
    bx.fillRect(sunX - 2, sunY - 4, 5, 9);
    bx.fillRect(sunX - 3, sunY - 3, 7, 7);
    bx.fillStyle = '#fffbe4';
    bx.fillRect(sunX - 2, sunY - 1, 4, 3);
    bx.fillRect(sunX - 1, sunY - 2, 3, 4);

    // --- clouds ---
    bx.fillStyle = '#dce9f5';
    for (const cl of clouds) {
      cl.x -= cl.sp * 0.0004;
      if (cl.x < -0.2) { cl.x = 1.2; cl.y = 0.06 + Math.random() * 0.24; }
      const px = Math.floor(cl.x * W), py = Math.floor(cl.y * H);
      bx.fillRect(px, py, cl.w, 3);
      bx.fillRect(px + 2, py - 2, cl.w - 5, 2);
      bx.fillRect(px + 4, py + 3, cl.w - 8, 2);
    }

    // --- parallax terrain ---
    for (let li = 0; li < LAYERS.length; li++) {
      const L = LAYERS[li];
      const off = time * L.sp;
      for (let x = 0; x < W; x++) {
        const h = Math.floor(layerHeight(li, x + off, L.amp, 0) + H * L.base);
        // grass cap
        bx.fillStyle = L.top;
        bx.fillRect(x, h, 1, 2);
        // body with a subtle dither so it isn't a flat slab
        bx.fillStyle = L.side;
        bx.fillRect(x, h + 2, 1, H - h - 2);
        if (((x + li * 3) & 3) === 0) {
          bx.fillStyle = L.dark;
          bx.fillRect(x, h + 3 + ((x * 7) % 5), 1, 2);
        }
      }
    }

    // --- motes ---
    for (const m of motes) {
      m.y -= m.sp * 0.0007;
      if (m.y < 0) { m.y = 1; m.x = Math.random(); }
      const a = 0.4 + 0.6 * Math.abs(Math.sin(time * 1.6 + m.ph));
      bx.fillStyle = `rgba(255,233,168,${a.toFixed(2)})`;
      bx.fillRect(Math.floor(m.x * W), Math.floor(m.y * H), 1, 1);
    }

    // blit upscaled, nearest-neighbour
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 0, 0, W, H, 0, 0, c.width, c.height);
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}

// ----------------------------------------------------------------- menu
let chosenSlot = 1;
let chosenMode = 'survival';

function setTab(which) {
  for (const [btn, pane] of [['#tabNew', '#paneNew'], ['#tabLoad', '#paneLoad'], ['#tabHelp', '#paneHelp']]) {
    const on = btn === which;
    $(btn).classList.toggle('on', on);
    $(pane).style.display = on ? '' : 'none';
  }
  if (which === '#tabLoad') renderSaves();
}

function renderSaves() {
  const list = Game.listSaves();
  const el = $('#saveList');
  el.innerHTML = list.map((s, i) => {
    const slot = i + 1;
    if (!s) return `<div class="saveslot empty"><div class="sn"><b>Slot ${slot}</b><span>Empty</span></div></div>`;
    const when = new Date(s.savedAt).toLocaleString();
    const mode = s.mode === 'creative' ? 'Creative' : 'Survival';
    return `<div class="saveslot" data-load="${slot}">
      <div class="sn"><b>${escapeHtml(s.name || 'Haven')} — Slot ${slot}</b>
      <span>${mode} · Day ${s.day} · Level ${s.level}<br>seed “${escapeHtml(s.seedText || '?')}” · ${when}</span></div>
      <button class="del" data-del="${slot}">Delete</button>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-load]').forEach(d => {
    d.onclick = (e) => {
      if (e.target.dataset.del) return;
      begin({ slot: +d.dataset.load, load: true });
    };
  });
  el.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      if (!confirm(`Delete save slot ${b.dataset.del}? This cannot be undone.`)) return;
      Game.deleteSave(+b.dataset.del);
      renderSaves();
    };
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------------ start
async function begin(opts) {
  $('#title').style.display = 'none';
  const loading = $('#loading');
  loading.classList.remove('hidden');
  $('#loadTip').innerHTML = TIPS[(Math.random() * TIPS.length) | 0];
  const fill = $('#loadFill');
  fill.style.width = '6%';

  const canvas = $('#gl');
  if (!game) {
    try {
      game = new Game(canvas);
    } catch (err) {
      loading.innerHTML = `<div class="loadlogo">Unsupported</div>
        <div class="loadtip">EVERCRAFT needs WebGL2.<br><small>${escapeHtml(err.message)}</small></div>`;
      return;
    }
  }

  game.audio.init();
  game.audio.resume();

  fill.style.width = '18%';
  await game.start(opts);
  if (game._pendingRD) { game.world.renderDist = game._pendingRD; game.updateFog(); }

  // wait for chunks around the player
  const t0 = performance.now();
  await new Promise(res => {
    const tick = () => {
      const frac = game.world.loadedFraction(game.player.pos.x, game.player.pos.z, 2);
      fill.style.width = `${18 + frac * 78}%`;
      const elapsed = performance.now() - t0;
      if (frac >= 0.92 || elapsed > 14000) return res();
      setTimeout(tick, 90);
    };
    tick();
  });

  // drop player onto solid ground
  const p = game.player;
  if (!opts.load) {
    const y = game.world.surfaceY(p.pos.x, p.pos.z);
    p.pos.y = y + 0.2;
    p.spawnPoint = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
  } else if (p.aabbBlocked(p.pos.x, p.pos.y, p.pos.z)) {
    // never resume embedded in terrain (e.g. saved while a chunk was mid-edit)
    for (let dy = 0; dy < 24; dy++) {
      if (!p.aabbBlocked(p.pos.x, p.pos.y + dy, p.pos.z)) { p.pos.y += dy; break; }
    }
    p.vel.set(0, 0, 0);
  }
  if (game._pendingDrops) { game.itemDrops.load(game._pendingDrops); game._pendingDrops = null; }

  fill.style.width = '100%';
  setTimeout(() => {
    loading.classList.add('hidden');
    game.requestPointerLock();
    game.ui.toast(opts.load ? 'World loaded. Welcome back.' : 'Welcome to EVERCRAFT.', 'good');
    if (!opts.load) {
      setTimeout(() => game.ui.toast('Punch a tree to begin. Press <b>G</b> for the field guide.'), 2200);
    }
  }, 320);
}

// ------------------------------------------------------------------- wire
window.addEventListener('DOMContentLoaded', () => {
  startTitleAnim();
  $('#tabNew').onclick = () => setTab('#tabNew');
  $('#tabLoad').onclick = () => setTab('#tabLoad');
  $('#tabHelp').onclick = () => setTab('#tabHelp');

  // rotating splash text
  const sp = $('#splash');
  if (sp) sp.textContent = SPLASHES[(Math.random() * SPLASHES.length) | 0];

  // game mode picker
  $('#modePick').querySelectorAll('.mode-card').forEach(b => {
    b.onclick = () => {
      $('#modePick').querySelectorAll('.mode-card').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      chosenMode = b.dataset.mode;
    };
  });

  $('#slotPick').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      $('#slotPick').querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      chosenSlot = +b.dataset.slot;
    };
  });

  $('#btnCreate').onclick = () => {
    const existing = Game.listSaves()[chosenSlot - 1];
    if (existing && !confirm(`Slot ${chosenSlot} already holds "${existing.name}". Overwrite it?`)) return;
    if (existing) Game.deleteSave(chosenSlot);
    begin({
      slot: chosenSlot,
      name: $('#wname').value.trim() || 'Haven',
      seed: $('#wseed').value.trim(),
      mode: chosenMode,
      load: false,
    });
  };

  $('#wseed').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnCreate').click(); });
  $('#wname').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnCreate').click(); });

  // resume audio on any gesture
  const resume = () => { if (game) game.audio.resume(); };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);

  // warn before leaving with unsaved progress
  window.addEventListener('beforeunload', () => { if (game && game.running) game.save(true); });
});

// expose for debugging / automated testing
window.__EVERCRAFT = { get game() { return game; }, begin, Game };
