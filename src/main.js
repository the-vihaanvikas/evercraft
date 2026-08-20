// EVERCRAFT - bootstrap: cinematic title, loading, game start.

import { Game } from './game.js';
import * as THREE from '../vendor/three.module.js';
import { World } from './world.js';
import { WorldGen, findSpawn } from './worldgen.js';
import { makeMaterials, Sky, Particles } from './render.js';
import { Audio } from './audio.js';

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

// ------------------------------------------------------------- title splash
const SPLASHES = [
  'Dig deeper!', 'Now with 100% more cubes!', 'Watch out for Gloom!',
  'Torches sold separately.', 'Voxels all the way down.', 'Mine responsibly!',
  'Built from scratch!', 'No two worlds alike.', 'Try the mushroom stew.',
  'Aurorite glows in the dark!', 'Punch tree, get wood.', 'Sleep is optional.',
];

/* ----------------------------------------------------------------- title
 * A cinematic title, in the spirit of the reference: the game boots to a
 * black screen, the wordmark slams in, and the camera then rises through a
 * REAL generated voxel world — the same worldgen, shaders and chunk streaming
 * the game itself uses — while the menu fades in over the flyover.
 *
 * The 3D scene renders to a small offscreen WebGL canvas and is blitted to
 * the full-screen #titleCanvas with nearest-neighbour scaling, which keeps
 * the blocky pixel look and costs a fraction of a full-res frame.
 */
class TitleWorld {
  constructor() {
    this.ready = false;
    this.gen = new WorldGen((Math.random() * 1e9) >>> 0);
    this.spawn = findSpawn(this.gen);

    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.materials = makeMaterials(this.renderer);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 500);
    this.sky = new Sky(this.scene);
    this.particles = new Particles(this.scene);

    // warm golden-morning light for the flyover
    this.scene.add(new THREE.HemisphereLight(0xbfd8f0, 0x37424f, 0.9));
    const sun = new THREE.DirectionalLight(0xffe9c4, 1.25);
    sun.position.set(40, 90, 20);
    this.scene.add(sun);
    this.sun = sun;

    this.world = new World(this.scene, this.gen.seed, this.materials);
    this.world.renderDist = 4;
    this._resize();
    window.addEventListener('resize', this._resize = this._resize.bind(this));

    // stream the world around the spawn point, then start the flyover
    this.world.initWorker(this.materials.texIndex, null).then(() => {
      this.ready = true;
    });
  }

  _resize() {
    // low-res render target: ~1/3 of the screen, crisp when upscaled
    const w = window.innerWidth, h = window.innerHeight;
    this.rw = Math.max(320, Math.floor(w / 3));
    this.rh = Math.max(180, Math.floor(h / 3));
    this.canvas.width = this.rw;
    this.canvas.height = this.rh;
    this.renderer.setSize(this.rw, this.rh, false);
    this.renderer.setPixelRatio(1);
    this.camera.aspect = this.rw / this.rh;
    this.camera.updateProjectionMatrix();
  }

  /**
   * The flyover: a slow spiral that starts at grass level looking across the
   * meadow, rises as it circles out, and keeps the spawn hill in frame.
   * `t` is seconds since the flyover began; the loop is ~26s.
   */
  _cam(t, dt) {
    const sp = this.spawn;
    const loop = 26;
    const u = (t % loop) / loop;
    // one full turn, easing out so the motion breathes
    const ang = u * Math.PI * 2 * (0.55 + u * 0.45);
    const radius = 7 + u * 16 + Math.sin(u * Math.PI) * 2;
    const x = sp.x + Math.cos(ang) * radius;
    const z = sp.z + Math.sin(ang) * radius * 0.82;
    const ground = this.world.heightAt(x, z);
    // The ground estimate eases in, so the camera never snaps when a fresh
    // chunk arrives — it simply glides to the real terrain height.
    this._gY = this._gY === undefined ? ground : this._gY + (ground - this._gY) * Math.min(1, dt * 1.8);
    // rise from a low walker's view to a high vista, with a gentle bob
    const alt = 2.6 + u * 7.5 + Math.sin(t * 0.31) * 0.28;
    const y = Math.max(this._gY + alt, this._gY + 2.2);
    // look at the spawn hill, drifting slightly ahead of the camera
    const look = new THREE.Vector3(
      sp.x + Math.cos(ang + 0.45) * 5,
      sp.y + 3.2 + Math.sin(t * 0.23) * 0.4,
      sp.z + Math.sin(ang + 0.45) * 4);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(look);
    this.camera.fov = 62 + Math.sin(t * 0.12) * 3;
    this.camera.updateProjectionMatrix();
  }

  update(dt, t) {
    if (!this.ready) return;
    // keep the chunk ring streaming around the camera
    this.world.update(this.camera.position.x, this.camera.position.z);
    this._cam(t, dt);
    this.particles.update(dt, this.world);
    // drifting motes of golden light
    if (Math.random() < dt * 6) {
      const p = this.camera.position;
      this.particles.spawn(
        p.x + (Math.random() - 0.5) * 30,
        p.y + 1 + Math.random() * 8,
        p.z + (Math.random() - 0.5) * 30,
        0, 0.2 + Math.random() * 0.3, 0,
        Math.random() < 0.5 ? 0xffe9a8 : 0xffd76a, 0.05, 1.8, 0);
    }
    const u = this.sky.uniforms;
    u.uTop.value.setHex(0x4a86d6);
    u.uHorizon.value.setHex(0xf0c9a0);
    u.uNight.value = 0;
    this.materials.shared.uDaylight.value = 1;
    this.materials.shared.uSunColor.value.setHex(0xffe9c4);
    this.materials.shared.uFogColor.value.setHex(0xcfe0ee);
    // same fog falloff as the game, so the edge of the loaded ring stays hidden
    const d = this.world.renderDist * 16;
    this.materials.shared.uFogNear.value = d * 0.55;
    this.materials.shared.uFogFar.value = d * 1.02;
    this.sky.update(t, this.camera.position, 0.35);
    this.sun.position.copy(this.camera.position).add(new THREE.Vector3(30, 60, 15));
    this.sun.target.position.copy(this.camera.position);
    this.sun.target.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }

  blit(ctx, w, h) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.canvas, 0, 0, this.rw, this.rh, 0, 0, w, h);
  }

  dispose() {
    window.removeEventListener('resize', this._resize);
    if (this.world.worker) this.world.worker.terminate();
    this.renderer.dispose();
  }
}

/**
 * Boot the cinematic title: wordmark sting, 3D flyover, menu fade-in.
 * Returns a dispose function for when the game starts.
 */
function startTitle() {
  const c = $('#titleCanvas');
  const ctx = c.getContext('2d', { alpha: false });
  const boot = $('#boot');
  const flash = $('#bootFlash');
  const inner = $('#titleInner');
  let titleWorld = null;
  try {
    titleWorld = new TitleWorld();
  } catch (err) {
    // No WebGL2: the menu must still work (the game reports unsupported on
    // its own loading screen). Fall back to the plain backdrop.
    console.warn('title flyover unavailable:', err.message);
  }
  let raf = 0;
  let t0 = performance.now();
  let bootDone = false;

  const resize = () => {
    c.width = c.clientWidth; c.height = c.clientHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  function finishBoot() {
    if (bootDone) return;
    bootDone = true;
    boot.classList.add('gone');
    flash.classList.add('play');
    $('#title').classList.add('live');
    inner.classList.add('show');
    setTimeout(() => boot.remove(), 900);
    setTimeout(() => flash.classList.remove('play'), 900);
  }

  // skip the sting on any input
  const skip = () => finishBoot();
  window.addEventListener('pointerdown', skip, { once: true });
  window.addEventListener('keydown', skip, { once: true });

  // the boot sting is on a timer even without input
  setTimeout(finishBoot, 2600);

  let last = t0;
  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    // black backdrop until the world is streaming
    ctx.fillStyle = '#0d1017';
    ctx.fillRect(0, 0, c.width, c.height);
    if (titleWorld && titleWorld.ready) {
      titleWorld.update(dt, t);
      titleWorld.blit(ctx, c.width, c.height);
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointerdown', skip);
    window.removeEventListener('keydown', skip);
    if (titleWorld) titleWorld.dispose();
  };
}

// ------------------------------------------------------------ title music
let titleAudio = null;
let titleMusicTimer = null;
let titleBar = 0;

function startTitleMusic() {
  if (titleAudio || !window.AudioContext) return;
  titleAudio = new Audio();
  titleAudio.init();
  titleAudio.resume();
  titleAudio.menuTick(0);
  titleBar = 1;
  titleMusicTimer = setInterval(() => {
    if (titleAudio && titleAudio.ctx) {
      titleAudio.menuTick(titleBar++);
    }
  }, 3600);
}

function stopTitleMusic() {
  if (titleMusicTimer) { clearInterval(titleMusicTimer); titleMusicTimer = null; }
  titleAudio = null;
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
let disposeTitle = null;

async function begin(opts) {
  $('#title').style.display = 'none';
  if (disposeTitle) { disposeTitle(); disposeTitle = null; }
  stopTitleMusic();
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
  disposeTitle = startTitle();
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

  // resume audio on any gesture; the title theme starts with the first one
  const resume = () => {
    if (game) { game.audio.resume(); return; }
    startTitleMusic();
  };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);

  // warn before leaving with unsaved progress
  window.addEventListener('beforeunload', () => { if (game && game.running) game.save(true); });
});

// expose for debugging / automated testing
window.__EVERCRAFT = { get game() { return game; }, begin, Game };
