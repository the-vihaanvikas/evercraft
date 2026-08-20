// EVERCRAFT - main game loop, interaction, saves, input.

import * as THREE from '../vendor/three.module.js';
import {
  B, BLOCKS, block, isSolid, ITEM, itemDef, itemName, miningTime, canHarvest,
  blockDrop, itemIdForBlock, CHUNK_X, CHUNK_Z, WORLD_H, SEA_LEVEL, ARMOR_SLOTS,
  LADDER_DIR, TORCH_DIR, BED_FOOT_DIR, BED_HEAD_DIR, DOOR_SETS,
} from './blocks.js';
import { World, ckey } from './world.js';
import { Player, raycast, matOf, HOTBAR, INV_SIZE, mkStack, stackMax } from './player.js';
import { Entity, SPECIES, pickSpawnKind } from './entities.js';
import { WorldGen, BIOME, BIOME_INFO, findSpawn } from './worldgen.js';
import {
  makeMaterials, Sky, Particles, ItemDrops, BreakOverlay, Weather, Projectiles, blockColor,
  ChestRenderer, LanternRenderer,
} from './render.js';
import { Audio } from './audio.js';
import { UI, addToContainer, smeltTime } from './ui.js';
import { RECIPES, SMELT, FUEL, TAGS, isTag } from './recipes.js';
import { hashString } from './noise.js';
import { iconCanvas } from './textures.js';

const SAVE_PREFIX = 'evercraft.save.';
const SETTINGS_KEY = 'evercraft.settings';

// One-time, non-destructive migration from the legacy branding. Existing
// worlds stay playable after the rename; new-key data always wins and old keys
// are kept as a fallback instead of being deleted unexpectedly.
function migrateLegacyStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    const legacy = ['vox', 'haven.'].join('');
    for (let i = 1; i <= 3; i++) {
      const next = SAVE_PREFIX + i, old = legacy + 'save.' + i;
      if (localStorage.getItem(next) === null && localStorage.getItem(old) !== null)
        localStorage.setItem(next, localStorage.getItem(old));
    }
    const oldSettings = legacy + 'settings';
    if (localStorage.getItem(SETTINGS_KEY) === null && localStorage.getItem(oldSettings) !== null)
      localStorage.setItem(SETTINGS_KEY, localStorage.getItem(oldSettings));
  } catch { /* private browsing/storage quota: normal save handling reports it */ }
}
migrateLegacyStorage();
const DAY_LENGTH = 600; // seconds for a full cycle

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.running = false;
    this.paused = false;
    this.time = 0;
    // New worlds begin at 07:12: bright early morning, just after exposed
    // night hostiles have burned away in the rising sun.
    this.worldTime = DAY_LENGTH * 0.30;
    this.frame = 0;
    this.fps = 60;
    this.fpsAcc = 0; this.fpsCount = 0;
    this.sensitivity = 1.0;
    this.invertY = false;
    this.fov = 78;
    this.showDebug = false;
    this.cameraMode = 0;   // 0 = first person, 1 = third back, 2 = third front
    this.nearBench = false;
    this.lastAutosave = 0;
    this.worldName = 'Haven';
    this.mode = 'survival';
    this.seedText = '';
    this.entities = [];
    this.spawnTimer = 0;
    this.hurtTint = 0;
    this.sleep = null;        // active sleep cinematic state, if any
    this.death = null;        // active death cinematic state, if any
    this._initGraphics();
    this.audio = new Audio();
    this.ui = new UI(this);
    this._initInput();
    this.loadSettings();
  }

  // ---------------------------------------------------------------- graphics
  _initGraphics() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, powerPreference: 'high-performance',
      stencil: false,
    });
    // Cap at 1.5x rather than 2x: a voxel game is fill-rate bound, and going
    // from 1.5 to 2.0 costs ~78% more pixels for very little visible gain on a
    // blocky art style. _adaptQuality() lowers this further if frames are slow.
    this._maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this._pixelRatio = this._maxPixelRatio;
    renderer.setPixelRatio(this._pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x8fc0e8);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.fov, window.innerWidth / window.innerHeight, 0.08, 1200);

    this.materials = makeMaterials(renderer);
    this.sky = new Sky(this.scene);

    // lights for entity meshes (they use Lambert)
    this.hemi = new THREE.HemisphereLight(0xbfd8f0, 0x37424f, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.15);
    this.sun.position.set(60, 120, 40);
    this.scene.add(this.sun);
    this.moonLight = new THREE.DirectionalLight(0x8fa8d8, 0.16);
    this.moonLight.position.set(-60, 90, -40);
    this.scene.add(this.moonLight);

    this.particles = new Particles(this.scene);
    this.breakOverlay = new BreakOverlay(this.scene);
    this.weather = new Weather(this.scene);
    this.projectiles = new Projectiles(this.scene);

    this.entityGroup = new THREE.Group();
    this.scene.add(this.entityGroup);

    // held item view models: right hand (main) and left hand (off hand)
    this.handGroup = new THREE.Group();
    this.camera.add(this.handGroup);
    this.offhandGroup = new THREE.Group();
    this.camera.add(this.offhandGroup);
    this.scene.add(this.camera);
    this._handMesh = null;
    this._offhandMesh = null;
    this._offhandId = undefined;

    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Adaptive quality.
   *
   * Voxel rendering is fill-rate bound, so when frames get slow the cheapest
   * effective lever is to render fewer pixels. We track a smoothed frame time
   * and step the internal resolution scale down (and back up when there is
   * headroom), which keeps the game responsive on weaker GPUs instead of
   * grinding at a low frame rate. Render distance is pulled in as a second
   * step only if resolution alone is not enough.
   */
  _adaptQuality(dt) {
    if (this.autoQuality === false) return;
    // exponential moving average of frame time in ms
    const ms = Math.min(dt * 1000, 250);
    this._avgMs = this._avgMs === undefined ? ms : this._avgMs + (ms - this._avgMs) * 0.05;

    this._qualityT = (this._qualityT || 0) - dt;
    if (this._qualityT > 0) return;
    this._qualityT = 1.0;                       // reassess at most once a second

    const avg = this._avgMs;
    const scale = this._pixelRatio;
    const minScale = 0.6;

    if (avg > 26 && scale > minScale) {
      // slower than ~38fps: drop resolution a notch
      this._pixelRatio = Math.max(minScale, +(scale - 0.15).toFixed(2));
      this.renderer.setPixelRatio(this._pixelRatio);
      this._onResize();
      this._qualityT = 2.5;                     // let it settle before judging again
    } else if (avg > 34 && this.world.renderDist > 5) {
      // still slow at the lowest resolution: pull the view distance in
      this.world.renderDist--;
      this._qualityT = 4.0;
    } else if (avg < 15 && scale < this._maxPixelRatio) {
      // comfortable headroom: give resolution back
      this._pixelRatio = Math.min(this._maxPixelRatio, +(scale + 0.1).toFixed(2));
      this.renderer.setPixelRatio(this._pixelRatio);
      this._onResize();
      this._qualityT = 3.0;
    }
  }

  // ------------------------------------------------------------------ input
  _initInput() {
    this.keys = {};
    this.input = { forward: 0, back: 0, left: 0, right: 0, jump: 0, sneak: 0 };
    this.mouse = { left: false, right: false };
    this.pointerLocked = false;
    this.gamepadIndex = null;
    this.gpPrev = {};

    const kd = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.code;
      if (!this.running) return;
      this.keys[k] = true;
      // OS key auto-repeat must not re-fire one-shot actions (notably the
      // double-tap-space fly toggle, which would flicker while holding jump).
      if (e.repeat) return;
      this._onKeyDown(k, e);
    };
    const ku = (e) => { this.keys[e.code] = false; };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.running) return;
      if (this.sleep) return;                    // interaction is paused
      if (!this.pointerLocked && !this.ui.isOpen()) { this.requestPointerLock(); return; }
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) { this.mouse.right = true; this._useAction(); }
      if (e.button === 1) { e.preventDefault(); this._pickBlock(); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouse.left = false; this._cancelMining(); }
      if (e.button === 2) this.mouse.right = false;
    });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      // Browsers occasionally deliver one stale, screen-sized movement delta
      // while entering pointer lock. Dropping that first packet prevents the
      // rare seemingly random 90/180-degree view jump.
      if (this.pointerLocked) this._ignoreMouseMoveUntil = performance.now() + 55;
      if (!this.pointerLocked && this.running && !this.ui.isOpen() && !this.sleep &&
        !this.player?.dead) {
        this.ui.open('pause');
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.player) return;
      if (performance.now() < (this._ignoreMouseMoveUntil || 0)) return;
      this._applyLookDelta(e.movementX, e.movementY);
    });

    window.addEventListener('wheel', (e) => {
      if (!this.running || this.ui.isOpen() || !this.player) return;
      const d = Math.sign(e.deltaY);
      this.player.hotbarIdx = (this.player.hotbarIdx + d + HOTBAR) % HOTBAR;
      this.audio.click();
    }, { passive: true });

    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
      this.ui.toast(`Controller connected: ${e.gamepad.id.slice(0, 28)}`, 'good');
    });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; });
  }

  _applyLookDelta(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    // Genuine mouse packets are small even at high DPI. Pointer-lock bugs can
    // report a delta equal to the entire desktop width; cap only those outliers
    // while preserving normal fast flicks.
    const limit = 180;
    dx = Math.max(-limit, Math.min(limit, dx));
    dy = Math.max(-limit, Math.min(limit, dy));
    const s = 0.0022 * this.sensitivity;
    this.player.yaw -= dx * s;
    this.player.pitch -= dy * s * (this.invertY ? -1 : 1);
    // Bound yaw as well as pitch to retain floating-point precision in worlds
    // played for many hours.
    if (this.player.yaw > Math.PI || this.player.yaw < -Math.PI)
      this.player.yaw = ((this.player.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.player.pitch = Math.max(-Math.PI / 2 + 0.001,
      Math.min(Math.PI / 2 - 0.001, this.player.pitch));
  }

  _onKeyDown(k, e) {
    const p = this.player;
    if (!p) return;
    const ui = this.ui;

    // The death cinematic owns the screen: Escape/space skip the fall. It is
    // checked first so dying during the sleep cinematic hands control over.
    if (this.death) {
      e.preventDefault();
      if (k === 'Escape' || k === 'Space' || k === 'Enter') this._skipDeath();
      return;
    }
    // The sleep cinematic owns the screen: Escape (or Space) skips to the end,
    // every other key is swallowed so nothing can be mined, placed or opened.
    if (this.sleep) {
      e.preventDefault();
      if (k === 'Escape' || k === 'Space' || k === 'KeyE') this._endSleep(true);
      return;
    }

    if (k === 'Escape') {
      e.preventDefault();
      if (ui.isOpen()) { ui.close(); this.requestPointerLock(); }
      else ui.open('pause');
      return;
    }
    if (ui.isOpen()) {
      if (k === 'KeyE' && ui.screen === 'inventory') { ui.close(); this.requestPointerLock(); }
      else if (k === 'KeyC' && ui.screen === 'craft') { ui.close(); this.requestPointerLock(); }
      else if (k === 'KeyM' && ui.screen === 'map') { ui.close(); this.requestPointerLock(); }
      else if (k === 'KeyG' && ui.screen === 'guide') { ui.close(); this.requestPointerLock(); }
      return;
    }
    if (p.dead) return;

    switch (k) {
      case 'KeyE': ui.open('inventory'); document.exitPointerLock(); break;
      case 'KeyC':
        // The 3x3 grid only exists at a real Crafting Table; otherwise fall
        // back to the inventory's personal 2x2 grid.
        ui.open(this.nearBench ? 'craft' : 'inventory');
        document.exitPointerLock();
        break;
      case 'KeyM': ui.open('map'); document.exitPointerLock(); break;
      case 'KeyG': ui.open('guide'); document.exitPointerLock(); break;
      case 'KeyF': this._eatHeld(); break;
      case 'KeyX':
        // swap the main hand and the off hand
        p.swapHands();
        this.audio.click();
        this.ui.toast(p.offhand ? `Off hand: <b>${itemName(p.offhand.id)}</b>` : 'Off hand empty');
        break;
      case 'KeyQ': this._dropHeld(e.shiftKey); break;
      case 'F3': e.preventDefault(); this.showDebug = !this.showDebug; break;
      case 'F5':
      case 'KeyV':
        // MUST preventDefault: F5 is the browser's reload shortcut, so without
        // this the page reloads and the game drops back to the title screen.
        // `V` is offered as an alternative because a few browsers/OSes grab F5
        // before the page ever sees it.
        e.preventDefault();
        this.cameraMode = (this.cameraMode + 1) % 3;
        this.ui.toast(['First person', 'Third person', 'Front view'][this.cameraMode], 'info');
        break;
      case 'KeyR': if (p.creative) this._setFlying(!p.flying); break;
      case 'Space': {
        const now = performance.now();
        if (p.creative && this._lastSpace && now - this._lastSpace < 300) {
          this._setFlying(!p.flying);
          this._lastSpace = 0;   // consume the tap so a 3rd press starts fresh
        } else {
          this._lastSpace = now;
        }
        break;
      }
      default: break;
    }
    const n = k.match(/^Digit([1-9])$/);
    if (n) { p.hotbarIdx = +n[1] - 1; this.audio.click(); }
  }

  _pollInput() {
    const K = this.keys, inp = this.input, p = this.player;
    const blocked = this.ui.isOpen() || p.dead || !!this.sleep;
    inp.forward = !blocked && (K['KeyW'] || K['ArrowUp']) ? 1 : 0;
    inp.back = !blocked && (K['KeyS'] || K['ArrowDown']) ? 1 : 0;
    inp.left = !blocked && (K['KeyA'] || K['ArrowLeft']) ? 1 : 0;
    inp.right = !blocked && (K['KeyD'] || K['ArrowRight']) ? 1 : 0;
    inp.jump = !blocked && K['Space'] ? 1 : 0;
    inp.sneak = !blocked && (K['ShiftLeft'] || K['ShiftRight']) ? 1 : 0;
    p.sneaking = !!inp.sneak && !p.flying;
    p.sprinting = !blocked && (K['ControlLeft'] || K['ControlRight'] || K['KeyZ']);

    // ---- gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const g of pads) if (g && g.connected) { pad = g; break; }
    if (pad) {
      const dz = v => Math.abs(v) < 0.18 ? 0 : v;
      const lx = dz(pad.axes[0] || 0), ly = dz(pad.axes[1] || 0);
      const rx = dz(pad.axes[2] || 0), ry = dz(pad.axes[3] || 0);
      if (!blocked) {
        if (ly < 0) inp.forward = Math.max(inp.forward, -ly);
        if (ly > 0) inp.back = Math.max(inp.back, ly);
        if (lx < 0) inp.left = Math.max(inp.left, -lx);
        if (lx > 0) inp.right = Math.max(inp.right, lx);
        this._applyLookDelta(rx * 25, ry * 25);
      }
      const btn = i => pad.buttons[i] && pad.buttons[i].pressed;
      const pressed = i => { const now = btn(i); const was = this.gpPrev[i]; this.gpPrev[i] = now; return now && !was; };
      if (!blocked) {
        // double-tap A toggles creative flight, mirroring double-tap space
        if (pressed(0) && p.creative) {
          const now = performance.now();
          if (this._lastPadA && now - this._lastPadA < 300) {
            this._setFlying(!p.flying);
            this._lastPadA = 0;
          } else {
            this._lastPadA = now;
          }
        }
        inp.jump = btn(0) ? 1 : inp.jump;
        p.sneaking = btn(1) || p.sneaking;
        p.sprinting = btn(10) || p.sprinting;
        // triggers: RT mine, LT place
        const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
        const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
        this.mouse.left = this.mouse.left || rt > 0.45;
        if (lt > 0.45 && !this._gpPlaceHeld) { this._gpPlaceHeld = true; this._useAction(); }
        if (lt <= 0.45) this._gpPlaceHeld = false;
        if (pressed(4)) p.hotbarIdx = (p.hotbarIdx + HOTBAR - 1) % HOTBAR;
        if (pressed(5)) p.hotbarIdx = (p.hotbarIdx + 1) % HOTBAR;
        if (pressed(2)) this._eatHeld();
        if (pressed(3)) { this.ui.open('inventory'); document.exitPointerLock(); }
        if (pressed(8)) { this.ui.open(this.nearBench ? 'craft' : 'inventory'); document.exitPointerLock(); }
      } else {
        if (pressed(1) || pressed(9)) { this.ui.close(); this.requestPointerLock(); }
      }
      if (pressed(9) && !blocked) this.ui.open('pause');
    }
  }

  requestPointerLock() {
    if (this.ui.isOpen() || this.sleep) return;
    if (this.canvas.requestPointerLock) {
      const r = this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => { });
    }
  }

  // ------------------------------------------------------------------ start
  async start(opts) {
    this.worldName = opts.name || 'Haven';

    // IMPORTANT: read the save BEFORE deriving the seed, so a loaded world
    // regenerates identical terrain instead of a fresh random one.
    const save = opts.load ? this.readSave(opts.slot) : null;

    let seed;
    if (save && save.seed !== undefined) {
      seed = save.seed >>> 0;
      this.seedText = save.seedText || String(seed);
    } else {
      const seedRaw = String(opts.seed ?? '');
      this.seedText = seedRaw || String(Math.floor(Math.random() * 1e9));
      seed = /^\d+$/.test(this.seedText) ? (+this.seedText >>> 0) : hashString(this.seedText);
    }
    this.seed = seed;
    this.gen = new WorldGen(seed);

    this.world = new World(this.scene, seed, this.materials);
    // Chests and lanterns render as animated block entities rather than cubes.
    if (this.chests) this.chests.clear();
    if (this.lanterns) this.lanterns.clear();
    this.chests = new ChestRenderer(this.scene, this.materials, this.materials.texIndex);
    this.lanterns = new LanternRenderer(this.scene);
    this._chestScanT = 0;
    this.player = new Player(this.world, this.audio);
    // XP gains release a trail of bright motes that float up around the
    // player — a cosmetic echo of the instant XP, so mining ore feels
    // rewarding even before the level bar moves.
    const xpPlayer = this.player;
    const origXP = xpPlayer.addXP.bind(xpPlayer);
    xpPlayer.addXP = (n) => {
      if (n > 0 && this.particles) {
        const m = Math.min(6, Math.max(1, Math.round(n)));
        for (let i = 0; i < m; i++) {
          this.particles.spawn(
            xpPlayer.pos.x + (Math.random() - 0.5) * 1.4,
            xpPlayer.pos.y + 0.4 + Math.random() * 1.6,
            xpPlayer.pos.z + (Math.random() - 0.5) * 1.4,
            (Math.random() - 0.5) * 1.1, 1.4 + Math.random(), (Math.random() - 0.5) * 1.1,
            Math.random() < 0.7 ? 0x8ff08a : 0xd8ff8a, 0.045, 0.9, -0.25);
        }
      }
      return origXP(n);
    };
    this.itemDrops = new ItemDrops(this.scene, this.world);
    window.__EVERCRAFT_ITEM = ITEM;

    await this.world.initWorker(this.materials.texIndex, save ? save.edits : null);

    if (save) {
      this.player.load(save.player);
      this.mode = save.mode || (save.player && save.player.creative ? 'creative' : 'survival');
      // never resume a survival world in mid-air with flight still enabled
      if (this.mode !== 'creative') { this.player.creative = false; this.player.flying = false; }
      this.worldTime = save.worldTime ?? this.worldTime;
      this.world.loadContainers(save.containers);
      this.worldName = save.name || this.worldName;
      this.seedText = save.seedText || this.seedText;
      if (save.drops) this._pendingDrops = save.drops;
    } else {
      const sp = findSpawn(this.gen);
      this.player.pos.set(sp.x, sp.y, sp.z);
      this.player.spawnPoint = { x: sp.x, y: sp.y, z: sp.z };
      this.mode = opts.mode === 'creative' ? 'creative' : 'survival';
      this.player.creative = this.mode === 'creative';
      this.worldTime = DAY_LENGTH * 0.30;
      if (!this.player.creative) this.player.flying = false;
      if (!this.player.creative) {
        // survival starter kit
        this.player.inv.add('plank_aspen', 4);
        this.player.inv.add('stick', 4);
        this.player.inv.add('sunberry', 3);
        this.player.inv.add('torch', 4);
      }
      // Creative intentionally starts empty. The tabbed palette supplies any
      // item on demand without cluttering or pre-filling the player's hotbar.
    }
    this.slot = opts.slot ?? 1;
    this._lastLevel = this.player.level;

    this.running = true;
    this.updateFog();
    this._lastT = performance.now();
    requestAnimationFrame(() => this._loop());
    return true;
  }

  updateFog() {
    const d = this.world.renderDist * CHUNK_X;
    this.materials.shared.uFogNear.value = d * 0.55;
    this.materials.shared.uFogFar.value = d * 1.02;
    this.camera.far = Math.max(300, d * 1.5);
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------- loop
  _loop() {
    if (!this.running) return;
    const now = performance.now();
    let dt = (now - this._lastT) / 1000;
    this._lastT = now;
    dt = Math.min(dt, 0.075);
    this.time += dt;
    this.frame++;

    this.fpsAcc += dt; this.fpsCount++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsCount / this.fpsAcc; this.fpsAcc = 0; this.fpsCount = 0; }

    const sleeping = !!this.sleep;
    const dying = !!this.death;
    const active = (!this.ui.isOpen() || this.ui.screen === 'inventory' || this.ui.screen === 'craft'
      || this.ui.screen === 'crate' || this.ui.screen === 'smelter') && !sleeping && !dying;

    // While the sleep cinematic runs, time is driven by the cinematic itself.
    if (active) this.worldTime += dt;
    this._pollInput();
    if (sleeping) this._updateSleep(dt);
    if (dying) this._updateDeath(dt);

    if (!this.player.dead) {
      this.player.update(active ? dt : 0, this.input);
    }

    this.world.update(this.player.pos.x, this.player.pos.z);

    if (sleeping || dying) {
      // the world keeps breathing around the player, but nothing they do can
      // touch it; death drifts in slow motion for a beat
      const sdt = dying ? dt * 0.45 : dt;
      this._updateEntities(sdt);
      this.particles.update(sdt, this.world);
    }

    if (active) {
      this._updateMining(dt);
      this._updateEntities(dt);
      this._updateSmelters(dt);
      this.world.tickFluids(dt);
      this.itemDrops.update(dt, this.player, (id, c) => this._tryPickup(id, c));
      this.projectiles.update(dt, this.world, this.player, this.audio);
      this.particles.update(dt, this.world);
      this._ambientParticles(dt);
    }

    this._updateChests(dt);
    if (this.lanterns) this.lanterns.update(this.time, this.camera.position);
    this._updateAvatar(dt);
    this._updateCamera(dt);
    this._updateLighting();
    this.weather.update(dt, this.camera.position, this.world);
    this.sky.update(this.time, this.camera.position, this.dayFraction());
    this._updateHand(dt);
    this._checkNearBench();

    // Death is a cinematic, not a cut: the camera falls, the world fades to
    // red, and only then does the death screen appear.
    if (this.player.dead && !this.death && !this._deathShown) {
      this._beginDeath(this.player.deathCause || 'The world claimed you.');
    }
    // level-up flourish (this.player — `p` is not defined in the loop body)
    const pl = this.player;
    if (pl.level > this._lastLevel) {
      this._lastLevel = pl.level;
      this.particles.burst(pl.pos.x, pl.pos.y + 1.2, pl.pos.z, 0xffd76a, 24, 2.8, 0.07, 1.1);
      this.particles.burst(pl.pos.x, pl.pos.y + 1.7, pl.pos.z, 0x8ff08a, 12, 1.5, 0.05, 0.8);
    }

    this.materials.shared.uTime.value = this.time;
    this.materials.shared.uCamPos.value.copy(this.camera.position);

    this.ui.updateHUD(dt);
    if (this.showDebug) this._updateDebug();
    else { const el = document.getElementById('perf'); if (el.textContent) el.textContent = ''; }

    // periodic autosave
    if (this.time - this.lastAutosave > 45) { this.lastAutosave = this.time; this.save(true); }

    // audio ambience
    // _updateLighting already sampled the terrain height this frame
    const terrHere = this._terrHere !== undefined
      ? this._terrHere : this.world.heightAt(this.player.pos.x, this.player.pos.z);
    const under = this.player.pos.y < terrHere - 3;
    this.audio.updateAmbient(this.dayFraction(), under, this.weather.intensity * 0.5 + 0.3, dt);
    this.audio.updateMusic(dt, this.dayFraction(), this._nearbyHostiles > 0);

    this._adaptQuality(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._loop());
  }

  // ------------------------------------------------------------------ time
  dayFraction() { return (this.worldTime % DAY_LENGTH) / DAY_LENGTH; }

  /** 0 = midnight, 1 = noon */
  daylight() {
    const t = this.dayFraction();
    // sunrise 0.22, noon 0.5 wait -> use smooth curve
    const ang = (t - 0.25) * Math.PI * 2;
    const s = Math.sin(ang);
    return Math.max(0, Math.min(1, (s + 0.22) / 0.86));
  }

  clockHTML() {
    const t = this.dayFraction();
    const mins = Math.floor(t * 1440);
    const h24 = Math.floor(mins / 60), m = mins % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const ap = h24 < 12 ? 'AM' : 'PM';
    const dl = this.daylight();
    const icon = dl > 0.6 ? '☀' : dl > 0.2 ? '⛅' : '☾';
    const day = Math.floor(this.worldTime / DAY_LENGTH) + 1;
    return `<span class="ico">${icon}</span> ${h12}:${String(m).padStart(2, '0')} ${ap} <em>Day ${day}</em>`;
  }

  biomeName() {
    const b = this.world.biomeAt(this.player.pos.x, this.player.pos.z);
    return (BIOME_INFO[b] || BIOME_INFO[2]).name;
  }

  _updateLighting() {
    const dl = this.daylight();
    const t = this.dayFraction();
    const u = this.materials.shared;

    // Scratch colours, allocated once. This used to build ~12 THREE.Color
    // objects (plus two .clone()s) EVERY frame, which is pure garbage for the
    // collector to sweep and showed up as periodic stutter.
    const C = this._lightC || (this._lightC = {
      sun: new THREE.Color(), warmSun: new THREE.Color(1.0, 0.55, 0.28),
      nightAmb: new THREE.Color(0.055, 0.07, 0.115),
      dayAmb: new THREE.Color(0.16, 0.17, 0.19),
      dayTop: new THREE.Color(0x3f7fd0), dayHor: new THREE.Color(0xc3ddf2),
      nightTop: new THREE.Color(0x080d1c), nightHor: new THREE.Color(0x131f38),
      duskTop: new THREE.Color(0x2f4f8f), duskHor: new THREE.Color(0xf09a52),
      botA: new THREE.Color(0x0d1420), botB: new THREE.Color(0x2c4258),
      top: new THREE.Color(), hor: new THREE.Color(), bottom: new THREE.Color(),
      fog: new THREE.Color(), underground: new THREE.Color(0x0a0c12),
      water: new THREE.Color(0x1b5478), lava: new THREE.Color(0xd6400e),
      death: new THREE.Color(0x4a0c06),
    });

    // sun colour shifts at dawn/dusk
    const dawn = Math.exp(-Math.pow((t - 0.235) / 0.045, 2));
    const dusk = Math.exp(-Math.pow((t - 0.765) / 0.045, 2));
    const warm = Math.min(1, dawn + dusk);

    const sunC = C.sun.setRGB(1, 0.98, 0.94).lerp(C.warmSun, warm * 0.85);
    u.uSunColor.value.copy(sunC).multiplyScalar(0.92);
    u.uDaylight.value = 0.12 + dl * 0.88;
    // lightning: the whole world strobes white for a fraction of a second
    const lFlash = this.weather.flash || 0;
    if (lFlash > 0.01) {
      u.uDaylight.value = Math.min(1.15, u.uDaylight.value + lFlash * 0.95);
      u.uSunColor.value.copy(C.sun.setRGB(1, 0.98, 0.94).lerp(C.warmSun, warm * 0.3));
      u.uAmbient.value.setRGB(0.5, 0.52, 0.56);
      // announce the strike as the rumble arrives (a little after the flash)
      if (this.weather.thunderT > 0 && this.weather.thunderT < 1.1 && !this._thunderPlayed) {
        this._thunderPlayed = true;
        this.audio.thunder();
      }
      if (this.weather.thunderT <= 0) this._thunderPlayed = false;
    } else {
      this._thunderPlayed = false;
    }

    u.uAmbient.value.copy(C.nightAmb).lerp(C.dayAmb, dl);

    // sky colours
    const sk = this.sky.uniforms;
    const top = C.top.copy(C.nightTop).lerp(C.dayTop, dl).lerp(C.duskTop, warm * 0.55);
    const hor = C.hor.copy(C.nightHor).lerp(C.dayHor, dl).lerp(C.duskHor, warm * 0.8);
    sk.uTop.value.copy(top);
    sk.uHorizon.value.copy(hor);
    sk.uBottom.value.copy(C.bottom.copy(C.botA).lerp(C.botB, dl));
    sk.uNight.value = 1 - Math.min(1, dl * 1.7);
    const sunAng = (t - 0.25) * Math.PI * 2;
    sk.uSunDir.value.set(Math.cos(sunAng) * 0.6, Math.sin(sunAng), 0.4).normalize();
    sk.uSunTint.value.copy(sunC);

    // fog matches horizon
    const fog = C.fog.copy(hor).multiplyScalar(0.92);
    // the death veil bleeds into the whole scene, not just the overlay
    if (this.death) fog.lerp(C.death, 0.55);
    const py = this.player.pos.y;
    // heightAt() walks a column; once a frame is fine but cache it for the
    // other systems that ask for the same value.
    const terr = this.world.heightAt(this.player.pos.x, this.player.pos.z);
    this._terrHere = terr;
    const undergroundF = Math.max(0, Math.min(1, (terr - 6 - py) / 22));
    if (undergroundF > 0) fog.lerp(C.underground, undergroundF * 0.92);
    const inLava = this.player.headInLava;
    if (this.player.headInWater) fog.lerp(C.water, 0.85);
    // Submerged in lava you should be nearly blind — a hot opaque glow, not a
    // clear view of the cave around you.
    if (inLava) fog.lerp(C.lava, 0.97);
    u.uFogColor.value.copy(fog);
    this.renderer.setClearColor(fog.getHex());

    const d = this.world.renderDist * CHUNK_X;
    u.uFogNear.value = inLava ? 0.02 : this.player.headInWater ? 0.5 : d * (0.5 - undergroundF * 0.36);
    u.uFogFar.value = inLava ? 0.9 : this.player.headInWater ? 16 : d * (1.02 - undergroundF * 0.72);

    // scene lights for entities
    this.sun.intensity = 0.15 + dl * 1.05;
    this.sun.color.copy(sunC);
    this.sun.position.set(
      this.player.pos.x + Math.cos(sunAng) * 90,
      this.player.pos.y + Math.max(12, Math.sin(sunAng) * 120),
      this.player.pos.z + 60);
    this.sun.target.position.copy(this.player.pos);
    this.sun.target.updateMatrixWorld();
    this.moonLight.intensity = (1 - dl) * 0.22;
    this.hemi.intensity = 0.22 + dl * 0.72 - undergroundF * 0.3;
    this.hemi.color.copy(hor);
    this.hemi.groundColor.setHex(0x3a3f45);

    // 1 = water wobble, 2 = lava (shader tints and kills visibility)
    this.materials.shared.uUnderwater.value = inLava ? 2 : (this.player.headInWater ? 1 : 0);
  }

  /**
   * Build the third-person avatar. Only created the first time the player
   * switches out of first person, so first-person sessions pay nothing.
   * Proportions match the 0.62 x 1.78 collision box.
   */
  _buildAvatar() {
    const px = 1 / 16;
    const g = new THREE.Group();
    const mk = (w, h, d, color, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color }));
      m.position.set(x, y, z);
      return m;
    };
    const limbPivot = (w, h, d, color, x, topY, z) => {
      const pv = new THREE.Group();
      pv.position.set(x, topY, z);
      pv.add(mk(w, h, d, color, 0, -h / 2, 0));
      pv.userData.len = h;
      return pv;
    };
    const LEG = 12 * px, TORSO = 12 * px, HEAD = 8 * px;
    const hipY = LEG, shoulderY = hipY + TORSO;
    const skin = 0xd8a07a, tunic = 0x3f7fa8, trouser = 0x3a4657, boot = 0x2c2f36;

    const torso = mk(8 * px, TORSO, 4 * px, tunic, 0, hipY + TORSO / 2, 0);
    const belt = mk(8.4 * px, 1.6 * px, 4.4 * px, 0x2c2f36, 0, hipY + 1 * px, 0);
    const buckle = mk(1.4 * px, 1.4 * px, 0.6 * px, 0xd8b070, 0, hipY + 1 * px, -2.3 * px);
    const head = mk(HEAD, HEAD, HEAD, skin, 0, shoulderY + HEAD / 2, 0);
    // hair: a cap with a parted fringe in front
    const hair = mk(8.4 * px, 2.6 * px, 8.4 * px, 0x4a3524, 0, shoulderY + HEAD - 0.5 * px, 0);
    const fringeL = mk(1.6 * px, 1.4 * px, 0.7 * px, 0x4a3524, -2.2 * px, shoulderY + HEAD - 1.1 * px, -4.1 * px);
    const fringeR = mk(1.6 * px, 1.4 * px, 0.7 * px, 0x3a2a1c, 2.2 * px, shoulderY + HEAD - 1.1 * px, -4.1 * px);
    const armL = limbPivot(4 * px, TORSO, 4 * px, tunic, -6 * px, shoulderY, 0);
    const armR = limbPivot(4 * px, TORSO, 4 * px, tunic, 6 * px, shoulderY, 0);
    const handL = mk(4.1 * px, 3 * px, 4.1 * px, skin, -6 * px, shoulderY - TORSO + 1.5 * px, 0);
    const handR = mk(4.1 * px, 3 * px, 4.1 * px, skin, 6 * px, shoulderY - TORSO + 1.5 * px, 0);
    const legL = limbPivot(4 * px, LEG, 4 * px, trouser, -2 * px, hipY, 0);
    const legR = limbPivot(4 * px, LEG, 4 * px, trouser, 2 * px, hipY, 0);
    const bootL = mk(4.2 * px, 2 * px, 4.6 * px, boot, -2 * px, 1 * px, -0.2 * px);
    const bootR = mk(4.2 * px, 2 * px, 4.6 * px, boot, 2 * px, 1 * px, -0.2 * px);
    const soleL = mk(4.2 * px, 0.5 * px, 4.6 * px, 0x1c1e24, -2 * px, 0.2 * px, -0.2 * px);
    const soleR = mk(4.2 * px, 0.5 * px, 4.6 * px, 0x1c1e24, 2 * px, 0.2 * px, -0.2 * px);
    // face: pupils, brows and a mouth so the avatar reads at distance. These
    // ride INSIDE the head (and fringe inside the hair) so they rotate along.
    const eyeL = mk(1.6 * px, 1.6 * px, px, 0xf0f2f6, -1.8 * px, shoulderY + 4.6 * px, -4.1 * px);
    const eyeR = mk(1.6 * px, 1.6 * px, px, 0xf0f2f6, 1.8 * px, shoulderY + 4.6 * px, -4.1 * px);
    const pupilL = mk(0.8 * px, 1.0 * px, 0.7 * px, 0x2c3548, -1.8 * px, shoulderY + 4.55 * px, -4.4 * px);
    const pupilR = mk(0.8 * px, 1.0 * px, 0.7 * px, 0x2c3548, 1.8 * px, shoulderY + 4.55 * px, -4.4 * px);
    const browL = mk(1.8 * px, 0.6 * px, 0.6 * px, 0x3a2a1c, -1.8 * px, shoulderY + 5.6 * px, -4.3 * px);
    const browR = mk(1.8 * px, 0.6 * px, 0.6 * px, 0x3a2a1c, 1.8 * px, shoulderY + 5.6 * px, -4.3 * px);
    const mouth = mk(2.2 * px, 0.7 * px, 0.6 * px, 0x9c6a52, 0, shoulderY + 2.6 * px, -4.2 * px);
    head.add(eyeL, eyeR, pupilL, pupilR, browL, browR, mouth);
    hair.add(fringeL, fringeR);
    // the avatar holds whatever the main hand holds (a little cube in the
    // right fist; tools would need a full rig, this reads well at distance)
    const heldItem = mk(3 * px, 3 * px, 3 * px, 0x8a6a45, 0, 0, -1.6 * px);
    heldItem.visible = false;
    handR.add(heldItem);

    g.add(torso, belt, buckle, head, hair, armL, armR, handL, handR,
      legL, legR, bootL, bootR, soleL, soleR);
    g.userData = { arms: [armL, armR], legs: [legL, legR], hands: [handL, handR],
      head, hair, eyes: [eyeL, eyeR], heldItem, shoulderY, TORSO, hipY };
    // YXZ: yaw first, then pitch about the avatar's OWN right axis. With the
    // default XYZ order the swim pitch was applied about the world X axis, so
    // facing east or west made the avatar roll onto its side instead of lying
    // face-down along its heading.
    g.rotation.order = 'YXZ';
    this.scene.add(g);
    return g;
  }

  /** Animate + place the third-person avatar; hidden in first person. */
  _updateAvatar(dt) {
    const p = this.player;
    const show = this.cameraMode !== 0 && !this.sleep;
    if (!show) { if (this.avatar) this.avatar.visible = false; return; }
    if (!this.avatar) this.avatar = this._buildAvatar();
    const a = this.avatar, ud = a.userData;
    a.visible = true;
    a.rotation.order = 'YXZ';
    a.rotation.z = 0;
    a.rotation.y = p.yaw;
    const swimTarget = p.swimPose ? 1 : 0;
    this._avSwim = (this._avSwim || 0) + (swimTarget - (this._avSwim || 0)) *
      (1 - Math.exp(-7 * dt));
    // pitch forward into a prone position about the avatar's own right axis
    a.rotation.x = -1.34 * this._avSwim;
    a.position.set(p.pos.x, p.pos.y + this._avSwim * 0.70, p.pos.z);

    const speed = Math.hypot(p.vel.x, p.vel.z);
    const moving = speed > 0.25;
    this._avGait = (this._avGait || 0) + dt * (4.5 + Math.min(speed, 8) * 1.6);
    const tgt = moving ? Math.min(1, speed / 4.5) : 0;
    this._avAmp = (this._avAmp || 0) + (tgt - (this._avAmp || 0)) * Math.min(1, dt * 9);
    const amp = this._avAmp;
    const sw = Math.sin(this._avGait);

    ud.legs[0].rotation.x = sw * 0.62 * amp;
    ud.legs[1].rotation.x = -sw * 0.62 * amp;
    // arms counter-swing; the swing animation overrides the right arm below
    ud.arms[0].rotation.x = -sw * 0.5 * amp;
    ud.arms[1].rotation.x = sw * 0.5 * amp;

    // mining / placing swing on the right arm
    const swingT = Math.max(0, p.swingT);
    if (swingT > 0) {
      const s = Math.sin(swingT * Math.PI);
      ud.arms[1].rotation.x = 1.5 * s;
      ud.arms[1].rotation.z = -0.35 * s;
    } else {
      ud.arms[1].rotation.z = 0;
    }
    // flying: arms out, legs trailing
    if (p.flying) {
      ud.arms[0].rotation.x = 1.15; ud.arms[1].rotation.x = 1.15;
      ud.legs[0].rotation.x = -0.25; ud.legs[1].rotation.x = -0.18;
    }
    // Sprint-swimming: the body is already prone, so the stroke is a proper
    // front crawl - both arms windmill forward over the head half a cycle
    // apart, and the legs flutter-kick at double the arm rate. The phase is
    // time-based so it keeps a steady cadence instead of stuttering with the
    // ground gait counter.
    if (this._avSwim > 0.02) {
      this._avSwimPhase = (this._avSwimPhase || 0) + dt * (4.6 + Math.min(speed, 8) * 0.35);
      const ph = this._avSwimPhase;
      const sAmp = this._avSwim;
      // arms rotate through a full circle: reach ahead (~-2.4 rad) and pull
      // back past the hip, mirrored between left and right
      ud.arms[0].rotation.x = (-1.15 - Math.cos(ph) * 1.25) * sAmp;
      ud.arms[1].rotation.x = (-1.15 - Math.cos(ph + Math.PI) * 1.25) * sAmp;
      ud.arms[0].rotation.z = (0.10 + Math.sin(ph) * 0.16) * sAmp;
      ud.arms[1].rotation.z = (-0.10 - Math.sin(ph + Math.PI) * 0.16) * sAmp;
      ud.legs[0].rotation.x = Math.sin(ph * 2) * 0.34 * sAmp;
      ud.legs[1].rotation.x = -Math.sin(ph * 2) * 0.34 * sAmp;
      // head lifts a little out of the water on every other stroke
      ud.head.rotation.x = (-0.55 + Math.sin(ph) * 0.18) * sAmp + (-p.pitch * 0.75) * (1 - sAmp);
      ud.hair.rotation.x = ud.head.rotation.x;
    } else {
      this._avSwimPhase = 0;
      ud.arms[0].rotation.z = 0;
    }
    // head follows pitch so the avatar looks where the player looks (the swim
    // pose above already set its own head angle)
    if (this._avSwim <= 0.02) {
      ud.head.rotation.x = -p.pitch * 0.75;
      ud.hair.rotation.x = -p.pitch * 0.75;
    }
    // hands ride with the arms
    const hy = ud.shoulderY - ud.TORSO;
    ud.hands.forEach((h, i) => {
      const rx = ud.arms[i].rotation.x;
      h.position.y = ud.shoulderY - Math.cos(rx) * (ud.TORSO - 1.5 / 16);
      h.position.z = -Math.sin(rx) * (ud.TORSO - 1.5 / 16);
      h.rotation.x = rx;
    });
    // the right fist holds whatever the main hand holds
    if (ud.heldItem) {
      const held = p.held;
      const d = held ? itemDef(held.id) : null;
      ud.heldItem.visible = !!held;
      if (held) {
        const c = d && d.block ? blockColor(d.block) : avatarItemTint(held.id);
        ud.heldItem.material.color.setHex(c);
      }
    }
    // sneak crouch (blended swim height was applied above)
    a.position.y = p.pos.y + this._avSwim * 0.70 - (p.sneaking ? 0.14 : 0);
  }

  /**
   * Enter or leave creative flight. Centralised so the keyboard, the R key and
   * the gamepad all behave identically, and so leaving flight can't strand the
   * player with stale velocity or a phantom fall.
   */
  _setFlying(on) {
    const p = this.player;
    if (!p.creative) { p.flying = false; return; }
    if (p.flying === on) return;
    p.flying = on;
    p.vel.y = 0;
    if (on) {
      // lift very slightly off the floor so the ground probe doesn't
      // immediately re-clamp us and cancel the first ascent
      p.onGround = false;
      p.fallStart = null;
      p.sneaking = false;
    } else {
      // dropping out of flight should be a clean fall, never fall damage for
      // altitude that was gained by flying
      p.fallStart = null;
    }
    if (this.audio && this.audio.click) this.audio.click();
    if (this.ui && this.ui.toast) {
      this.ui.toast(on ? 'Flight <b>on</b>' : 'Flight <b>off</b>');
    }
  }

  _updateCamera(dt) {
    const p = this.player;
    // The death cinematic drives the camera directly: the view sags and rolls
    // while the red veil closes in.
    if (this.death && this._deathCam) {
      const c = this._deathCam;
      this.camera.position.copy(c.pos);
      this.camera.rotation.set(0, 0, 0, 'YXZ');
      this.camera.rotation.y = c.yaw;
      this.camera.rotation.x = c.pitch;
      this.camera.rotation.z = Math.sin(this.time * 0.8) * 0.05;
      this.camera.fov += (this.fov * 1.06 - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
      this.handGroup.visible = false;
      if (this.offhandGroup) this.offhandGroup.visible = false;
      return;
    }
    // The sleep cinematic drives the camera directly.
    if (this.sleep && this._sleepCam) {
      const c = this._sleepCam;
      this.camera.position.copy(c.pos);
      this.camera.rotation.set(0, 0, 0, 'YXZ');
      this.camera.rotation.y = c.yaw;
      this.camera.rotation.x = c.pitch;
      this.camera.fov += (this.fov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
      this.handGroup.visible = false;
      if (this.offhandGroup) this.offhandGroup.visible = false;
      return;
    }
    const eye = p.eyePos();
    // Impact shake: a short-lived jolt whenever damage lands, decaying back to
    // stillness so it never lingers or rattles at a fixed amplitude.
    const justHurt = p.hurtCd > 0 && performance.now() - p.lastDamage < 320;
    const wantShake = justHurt ? 0.30 : 0;
    this._shake = Math.max((this._shake || 0) * Math.exp(-6.5 * dt), wantShake);
    const shk = this._shake;
    // Smooth view bob. The old abs(sin) waveform had a mathematical cusp at
    // every footfall and snapped instantly between walking/sprinting amplitudes.
    // Continuous sine targets plus exponential damping feel weighty at any FPS.
    let targetY = 0, targetX = 0, targetRoll = 0;
    if (!p.flying && p.onGround && Math.hypot(p.vel.x, p.vel.z) > 0.12) {
      const amp = p.sprinting ? 0.046 : 0.029;
      targetY = -Math.cos(p.bobPhase * 3.0) * amp * 0.52;
      targetX = Math.sin(p.bobPhase * 1.5) * amp * 0.52;
      targetRoll = Math.sin(p.bobPhase * 1.5) * (p.sprinting ? 0.009 : 0.006);
    } else if (p.swimming) {
      targetY = Math.sin(this.time * 2.0) * 0.009;
      targetRoll = Math.sin(this.time * 1.35) * 0.004;
    }
    const smooth = 1 - Math.exp(-10 * dt);
    this._camBobY = (this._camBobY || 0) + (targetY - (this._camBobY || 0)) * smooth;
    this._camBobX = (this._camBobX || 0) + (targetX - (this._camBobX || 0)) * smooth;
    this._camRoll = (this._camRoll || 0) + (targetRoll - (this._camRoll || 0)) * smooth;
    const bobY = this._camBobY, bobX = this._camBobX, roll = this._camRoll;
    const dir = new THREE.Vector3(
      -Math.sin(p.yaw) * Math.cos(p.pitch),
      Math.sin(p.pitch),
      -Math.cos(p.yaw) * Math.cos(p.pitch));

    // Camera modes, cycled with F5:
    //   0 = first person
    //   1 = third person, camera BEHIND the player looking the way they face
    //   2 = third person, camera IN FRONT looking back at the player
    // deterministic shake offsets (sines, not per-frame random jitter)
    const shkX = shk > 0.01 ? Math.sin(this.time * 57) * shk * 0.05 : 0;
    const shkY = shk > 0.01 ? Math.cos(this.time * 49) * shk * 0.04 : 0;
    const shkR = shk > 0.01 ? Math.sin(this.time * 43) * shk * 0.02 : 0;
    if (this.cameraMode === 0) {
      this.camera.position.set(eye.x + bobX * 0.3 + shkX, eye.y + bobY + shkY, eye.z);
      // first person drives rotation directly from yaw/pitch (no lookAt), so
      // the view can never roll or drift away from the crosshair
      this.camera.rotation.set(0, 0, 0, 'YXZ');
      this.camera.rotation.y = p.yaw;
      this.camera.rotation.x = p.pitch;
      this.camera.rotation.z = roll + shkR;
    } else {
      const dist = 4.2;
      // mode 1 sits behind (opposite the look direction), mode 2 sits ahead
      const sign = this.cameraMode === 1 ? -1 : 1;
      let cx = eye.x + dir.x * dist * sign;
      let cy = eye.y + dir.y * dist * sign + 0.35;
      let cz = eye.z + dir.z * dist * sign;
      // pull the camera in if terrain is in the way
      const off = new THREE.Vector3(cx - eye.x, cy - eye.y, cz - eye.z);
      const len = off.length();
      if (len > 1e-4) {
        const rc = raycast(this.world, eye, off.clone().normalize(), len, { solidOnly: true });
        if (rc) {
          const f = Math.max(0.35, rc.dist - 0.35) / len;
          cx = eye.x + off.x * f; cy = eye.y + off.y * f; cz = eye.z + off.z * f;
        }
      }
      this.camera.position.set(cx + shkX, cy + shkY, cz);
      // both third-person modes look at the player, so mode 2 faces them
      this.camera.rotation.set(0, 0, 0, 'YXZ');
      this.camera.lookAt(eye.x, eye.y, eye.z);
    }
    // fov kick when sprinting
    const targetFov = this.fov * (p.sprinting && (this.input.forward) ? 1.075 : 1) * (p.headInLava ? 0.90 : p.headInWater ? 0.94 : 1);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
    this.camera.updateProjectionMatrix();
    this.handGroup.visible = this.cameraMode === 0;
  }

  // ---------------------------------------------------------------- hand VM
  _updateHand(dt) {
    const p = this.player;
    const held = p.held;
    const id = held ? held.id : null;
    if (this._handId !== id) {
      this._handId = id;
      if (this._handMesh) { this.handGroup.remove(this._handMesh); this._handMesh = null; }
      this._handMesh = this._makeHandMesh(id);
      if (this._handMesh) this.handGroup.add(this._handMesh);
    }

    // ---- off hand: only ever drawn when it actually holds something, plus
    // while swimming, where the left arm is needed for the stroke.
    const offId = p.offhandId;
    if (this._offhandId !== offId) {
      this._offhandId = offId;
      if (this._offhandMesh) { this.offhandGroup.remove(this._offhandMesh); this._offhandMesh = null; }
      this._offhandMesh = this._makeHandMesh(offId, true);
      if (this._offhandMesh) this.offhandGroup.add(this._offhandMesh);
    }
    const swimming = p.swimPose;
    this.offhandGroup.visible = this.cameraMode === 0 && !this.sleep &&
      (!!offId || swimming);

    // a torch or lantern in either hand casts a warm glint on nearby mobs
    const lit = (i) => i === 'torch' || i === 'torch_item' || i === 'lantern';
    if (lit(id) && !this._handLight) {
      this._handLight = new THREE.PointLight(0xffb648, 0.5, 7, 1.6);
      this._handLight.position.set(0, -0.05, -0.25);
      this.handGroup.add(this._handLight);
    } else if (!lit(id) && this._handLight) {
      this.handGroup.remove(this._handLight);
      this._handLight = null;
    }
    if (lit(offId) && !this._offhandLight) {
      this._offhandLight = new THREE.PointLight(0xffb648, 0.5, 7, 1.6);
      this._offhandLight.position.set(0, -0.05, -0.25);
      this.offhandGroup.add(this._offhandLight);
    } else if (!lit(offId) && this._offhandLight) {
      this.offhandGroup.remove(this._offhandLight);
      this._offhandLight = null;
    }

    if (!this._handMesh) return;
    const sw = Math.max(0, p.swingT);
    const s = Math.sin(sw * Math.PI);
    const m = this._handMesh;
    const om = this._offhandMesh;

    if (swimming) {
      // Front crawl. BOTH arms work: they reach forward over the head, sweep
      // down past the chest and recover, half a cycle apart. Previously only
      // the right arm waved from side to side, which read as flailing.
      this._swimPhase = (this._swimPhase || 0) + dt * 5.4;
      this._poseSwimArm(m, this._swimPhase, 1);
      if (om) this._poseSwimArm(om, this._swimPhase + Math.PI, -1);
      return;
    }
    this._swimPhase = 0;

    const bobY = Math.sin(p.bobPhase * 3.1) * 0.008 * (p.onGround ? 1 : 0);
    const bobX = Math.sin(p.bobPhase * 1.55) * 0.009 * (p.onGround ? 1 : 0);
    // Keep the view model attached to the lower-right edge. An empty arm gets
    // a little more screen presence and extends through the viewport edge,
    // rather than looking like a disconnected floating cuboid.
    const empty = !id;
    const ex = empty ? 0.09 : 0, ey = empty ? -0.055 : 0, ez = empty ? 0.035 : 0;
    m.position.set(0.34 + ex + bobX - s * 0.06, -0.33 + ey + bobY - s * 0.10, -0.62 + ez + s * 0.14);
    m.rotation.set(-0.24 - s * 1.35, 0.40 + s * 0.28, 0.14 + s * 0.3);

    if (om) {
      // Mirror of the resting main-hand pose, with a gentle idle sway.
      const oe = !offId;
      const oex = oe ? 0.09 : 0, oey = oe ? -0.055 : 0, oez = oe ? 0.035 : 0;
      om.position.set(-(0.34 + oex) - bobX, -0.33 + oey + bobY, -0.62 + oez);
      om.rotation.set(-0.24, -(0.40), -0.14);
    }
  }

  /**
   * Pose one first-person arm on the swim stroke.
   * @param {THREE.Object3D} m   the arm / held-item group
   * @param {number} phase       stroke phase in radians
   * @param {number} side        +1 right hand, -1 left hand
   */
  _poseSwimArm(m, phase, side) {
    const reach = Math.sin(phase);        // +1 fully extended ahead
    const lift = Math.cos(phase);         // +1 top of the recovery arc
    m.position.set(
      side * (0.27 + Math.max(0, -reach) * 0.05),
      -0.30 + reach * 0.13 + lift * 0.05,
      -0.60 - Math.max(0, reach) * 0.24);
    m.rotation.set(
      -0.45 - reach * 1.00,
      side * (0.26 - reach * 0.18),
      side * (0.10 + lift * 0.12));
  }

  /**
   * Build the player's forearm: a chunky sleeve + hand, sized so it actually
   * reads on screen. The old "bare fist" was an 0.085-wide sliver that was
   * technically rendering but far too small to notice, which is why first
   * person looked empty-handed.
   */
  _makeArm() {
    const g = new THREE.Group();
    const skin = 0xe0a479, sleeve = 0x4f7fc4;
    // Long enough to continue naturally out through the viewport edge.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.48),
      new THREE.MeshLambertMaterial({ color: sleeve }));
    arm.position.set(0, 0, 0.13);
    g.add(arm);
    // bare hand at the far end
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.16),
      new THREE.MeshLambertMaterial({ color: skin }));
    hand.position.set(0, 0, -0.18);
    g.add(hand);
    return g;
  }

  /** Shared texture cache for held blocks (per tile name). */
  _blockTex(name) {
    if (this._heldTexCache && this._heldTexCache.has(name)) return this._heldTexCache.get(name);
    if (!this._heldTexCache) this._heldTexCache = new Map();
    const c = iconCanvas(name, 4);
    if (!c) return null;
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    this._heldTexCache.set(name, t);
    return t;
  }

  /** Shared Lambert material for held blocks with a given map. */
  _blockMat(map) {
    let m = this._heldMatCache && this._heldMatCache.get(map);
    if (m) return m;
    if (!this._heldMatCache) this._heldMatCache = new Map();
    m = new THREE.MeshLambertMaterial({ map, transparent: true });
    this._heldMatCache.set(map, m);
    return m;
  }

  _makeHandMesh(id, mirrored = false) {
    const def = id ? itemDef(id) : null;
    if (!id) {
      const arm = this._makeArm();       // empty hand: show the arm itself
      if (mirrored) arm.children.forEach(c => { c.position.x = -c.position.x; });
      return arm;
    }
    const grp = new THREE.Group();
    if (id === 'torch' || id === 'torch_item') {
      // torch: stick with a lit ember head (before the block branch, which
      // would wrap the transparent tile on a cube)
      const arm = this._makeArm();
      arm.position.set(-0.01, -0.075, 0.16);
      arm.scale.setScalar(0.92);
      grp.add(arm);
      const stick = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.16), new THREE.MeshLambertMaterial({ color: 0x7a5a38 }));
      stick.position.set(0, 0, -0.02);
      grp.add(stick);
      const flame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.05),
        new THREE.MeshBasicMaterial({ color: 0xffb648 }));
      flame.position.set(0, 0.02, -0.105);
      grp.add(flame);
      return grp;
    }
    if (id === 'lantern') {
      // a tiny hanging lantern, matching the world block entity
      const arm = this._makeArm();
      arm.position.set(-0.01, -0.075, 0.16);
      arm.scale.setScalar(0.92);
      grp.add(arm);
      const iron = new THREE.MeshLambertMaterial({ color: 0x343944 });
      const chain = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.10, 0.03), iron);
      chain.position.set(0, 0.05, -0.14);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.10),
        new THREE.MeshBasicMaterial({ color: 0xffbd45 }));
      body.position.set(0, -0.04, -0.14);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.12), iron);
      cap.position.set(0, 0.01, -0.14);
      grp.add(chain, body, cap);
      return grp;
    }
    if (def && def.block) {
      // held block with its REAL tile art on every face, arm behind it
      const bl = BLOCKS[def.block];
      const topName = typeof bl.tex === 'string' ? bl.tex : (bl.tex.top || bl.tex.side);
      const sideName = typeof bl.tex === 'string' ? bl.tex : (bl.tex.side || bl.tex.top || bl.tex.front);
      const tTop = this._blockTex(topName), tSide = this._blockTex(sideName);
      if (tTop && tSide) {
        const geo = new THREE.BoxGeometry(0.17, 0.17, 0.17);
        const sTop = this._blockMat(tTop), sSide = this._blockMat(tSide);
        const mats = [sSide, sSide, sTop, sSide, sSide, sSide];
        grp.add(new THREE.Mesh(geo, mats));
      } else {
        grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17),
          new THREE.MeshLambertMaterial({ color: blockColor(def.block) })));
      }
      const arm = this._makeArm();
      arm.position.set(-0.02, -0.10, 0.20);
      arm.scale.setScalar(0.9);
      grp.add(arm);
      return grp;
    }
    const arm = this._makeArm();
    arm.position.set(-0.01, -0.075, 0.16);
    arm.scale.setScalar(0.92);
    grp.add(arm);
    const matColor = {
      timber: 0xb08d64, stone: 0x8d8f96, copper: 0xc9743c, iron: 0xd6cdc0, aurorite: 0x5fe0d0,
      hide: 0x9c6b3f,
    };
    const mkey = Object.keys(matColor).find(k => id.includes(k));
    const mat = mkey ? matColor[mkey] : 0xcfc0a1;
    const tool = def && def.tool;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.034, 0.26),
      new THREE.MeshLambertMaterial({ color: 0x8a6a45 }));
    grp.add(handle);
    if (tool === 'pick') {
      // pick: a cross-bar with two prongs curving down at each end
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.038, 0.05), new THREE.MeshLambertMaterial({ color: mat }));
      bar.position.set(0, 0.01, -0.13);
      grp.add(bar);
      for (const s of [-1, 1]) {
        const prong = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.035), new THREE.MeshLambertMaterial({ color: mat }));
        prong.position.set(s * 0.075, -0.045, -0.125);
        prong.rotation.x = s * 0.55;
        grp.add(prong);
      }
    } else if (tool === 'axe') {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.10), new THREE.MeshLambertMaterial({ color: mat }));
      head.position.set(0, 0.02, -0.13);
      head.rotation.x = -0.12;
      grp.add(head);
    } else if (tool === 'shovel') {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.10, 0.045), new THREE.MeshLambertMaterial({ color: mat }));
      head.position.set(0, -0.015, -0.125);
      head.rotation.x = 0.3;
      grp.add(head);
    } else if (tool === 'blade') {
      // sword: long blade, crossguard and pommel
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.26), new THREE.MeshLambertMaterial({ color: mat }));
      blade.position.set(0, 0.01, -0.20);
      grp.add(blade);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.02, 0.025), new THREE.MeshLambertMaterial({ color: 0x6b5638 }));
      guard.position.set(0, 0.01, -0.075);
      grp.add(guard);
    } else if (def && def.food) {
      const foodCol = {
        sunberry: 0xe8563f, raw_meat: 0xd0685f, cooked_meat: 0x9c5a30,
        raw_fowl: 0xe0a898, cooked_fowl: 0xc98a44, berry_pie: 0xd6a860,
        mush_stew: 0x8a5a34,
      }[id] || 0xc08a50;
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09),
        new THREE.MeshLambertMaterial({ color: foodCol }));
      f.position.set(0, 0, -0.10);
      grp.add(f);
    } else if (tool === 'shears') {
      const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.13), new THREE.MeshLambertMaterial({ color: 0xd6cdc0 }));
      s1.position.set(-0.02, 0, -0.08); s1.rotation.z = 0.15;
      const s2 = s1.clone(); s2.position.x = 0.02; s2.rotation.z = -0.15;
      grp.add(s1, s2);
    } else {
      // generic material item: a small lump in the item's colour
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.065, 0.11),
        new THREE.MeshLambertMaterial({ color: avatarItemTint(id) }));
      head.position.z = -0.11;
      grp.add(head);
    }
    return grp;
  }

  // --------------------------------------------------------------- targeting
  _target(maxDist) {
    const p = this.player;
    const eye = p.eyePos();
    const dir = new THREE.Vector3(
      -Math.sin(p.yaw) * Math.cos(p.pitch),
      Math.sin(p.pitch),
      -Math.cos(p.yaw) * Math.cos(p.pitch));
    return { hit: raycast(this.world, eye, dir, maxDist ?? (p.creative ? 8 : 5.2)), eye, dir };
  }

  _targetEntity(maxDist = 3.6) {
    const { eye, dir } = this._target();
    let best = null, bestT = maxDist;
    for (const e of this.entities) {
      if (e.dead) continue;
      const cx = e.pos.x, cy = e.pos.y + e.h / 2, cz = e.pos.z;
      const ox = cx - eye.x, oy = cy - eye.y, oz = cz - eye.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > bestT) continue;
      const px = eye.x + dir.x * t, py = eye.y + dir.y * t, pz = eye.z + dir.z * t;
      const r = Math.max(e.w, e.h * 0.55) * 0.72;
      const d2 = (px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2;
      if (d2 < r * r) { best = e; bestT = t; }
    }
    return best;
  }

  // ----------------------------------------------------------------- mining
  _cancelMining() {
    this.player.mining = null;
    this._creativeBroke = null;   // allow the next click to break again
    this.breakOverlay.hide();
  }

  _updateMining(dt) {
    const p = this.player;
    if (p.dead || this.ui.isOpen() || this.sleep) { this._cancelMining(); return; }

    const { hit } = this._target();

    // hover hint for interactables
    let interact = false;
    if (hit) {
      const bl = BLOCKS[hit.id];
      if (bl && bl.use) {
        interact = true;
        const label = bl.use === 'bench' ? 'Craft' : bl.use === 'smelter' ? 'Open Smelter'
          : bl.use === 'crate' ? 'Open Chest' : bl.use === 'bed' ? 'Sleep / Set Spawn'
            : bl.use === 'door' ? (bl.open ? 'Close Door' : 'Open Door') : 'Open';
        this.ui.hint(`<kbd>RMB</kbd> ${label}`);
      } else this.ui.hint('');
    } else this.ui.hint('');
    // the crosshair warms up when something can be used
    if (interact !== this._interact) {
      this._interact = interact;
      const xh = document.getElementById('crosshair');
      if (xh) xh.classList.toggle('interact', interact);
    }

    if (!this.mouse.left) {
      this.breakOverlay.hide();
      if (hit) this.breakOverlay.show(hit.x, hit.y, hit.z, 0);
      p.mining = null;
      return;
    }

    // attack entity first
    const ent = this._targetEntity();
    if (ent && p.attackCd <= 0) {
      const held = p.held;
      const d = held ? itemDef(held.id) : null;
      const dmg = d && d.dmg ? d.dmg : 1;
      const crit = !p.onGround && p.vel.y < -0.4;
      ent.hurt(dmg * (crit ? 1.5 : 1), p.pos, this);
      p.attackCd = 0.42;
      p.swingT = 1;
      p.exhaustion += 0.1;
      if (d && d.tool) p.damageHeld(1);
      this.particles.burst(ent.pos.x, ent.pos.y + ent.h * 0.6, ent.pos.z, 0xc94a3a, crit ? 14 : 8, 2.2, 0.07, 0.5);
      if (ent.dead) this._onEntityDeath(ent);
      this._cancelMining();
      return;
    }

    if (!hit) { p.mining = null; this.breakOverlay.hide(); return; }
    const bl = BLOCKS[hit.id];
    if (!bl || bl.hard < 0) { this.breakOverlay.show(hit.x, hit.y, hit.z, 0); return; }

    if (!p.mining || p.mining.x !== hit.x || p.mining.y !== hit.y || p.mining.z !== hit.z) {
      p.mining = { x: hit.x, y: hit.y, z: hit.z, progress: 0, id: hit.id, tick: 0 };
    }
    const m = p.mining;
    if (p.creative) {
      // Deliberate 0.18s press plus one block per click. This is still much
      // faster than Survival, but no longer deletes a wall from an accidental
      // tap or bulldozes a line of blocks while the button remains held.
      if (this._creativeBroke) return;
      m.progress += dt / 0.18;
      p.swingT = Math.max(p.swingT, 0.001);
      if (p.swingT <= 0.02) p.swingT = 1;
      this.breakOverlay.show(hit.x, hit.y, hit.z, m.progress);
      if (m.progress >= 1) {
        this._creativeBroke = true;
        p.swingT = 1;
        this.audio.dig(matOf(hit.id), 1);
        this._breakBlock(hit.x, hit.y, hit.z, hit.id);
        p.mining = null;
        this.breakOverlay.hide();
      }
      return;
    }
    const total = miningTime(hit.id, p.heldId);
    m.progress += dt / total;
    m.tick -= dt;
    p.swingT = Math.max(p.swingT, 0.001);
    if (p.swingT <= 0.02) p.swingT = 1;
    if (m.tick <= 0) {
      m.tick = 0.22;
      this.audio.dig(matOf(hit.id), m.progress);
      const c = blockColor(hit.id);
      this.particles.spawn(
        hit.x + 0.5 + hit.nx * 0.52 + (Math.random() - 0.5) * 0.5,
        hit.y + 0.5 + hit.ny * 0.52 + (Math.random() - 0.5) * 0.5,
        hit.z + 0.5 + hit.nz * 0.52 + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 1.2, Math.random() * 1.4, (Math.random() - 0.5) * 1.2,
        c, 0.07, 0.5);
    }
    this.breakOverlay.show(hit.x, hit.y, hit.z, m.progress);

    if (m.progress >= 1) {
      this._breakBlock(hit.x, hit.y, hit.z, hit.id);
      p.mining = null;
    }
  }

  _breakBlock(x, y, z, id) {
    const p = this.player;
    const original = BLOCKS[id];
    // Doors: break both halves for every orientation/open state.
    if (original && original.door) {
      const lowY = original.doorTop ? y - 1 : y;
      this.world.setBlock(x, original.doorTop ? y - 1 : y + 1, z, 0);
      if (original.doorTop) this.world.setBlock(x, y, z, 0);
      y = lowY;
      // resolve drops against this wood's canonical closed lower half
      id = (DOOR_SETS[original.doorWood] || DOOR_SETS.aspen).closedLow[0];
    }
    // Beds: remove the other horizontal half and drop one canonical bed.
    if (original && original.bed) {
      const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const [dx, dz] = dirs[original.bedDir & 3];
      const ox = original.bedHead ? x - dx : x + dx;
      const oz = original.bedHead ? z - dz : z + dz;
      this.world.setBlock(ox, y, oz, 0);
      id = B.BED_FOOT_N;
    }
    // tall grass: breaking either half removes both, and always drops from the base
    if (id === B.TALL_GRASS) this.world.setBlock(x, y + 1, z, 0);
    if (id === B.TALL_GRASS_TOP) { this.world.setBlock(x, y - 1, z, 0); y = y - 1; id = B.TALL_GRASS; }
    // resolve the definition AFTER any half-block remap so drops/xp match the
    // block actually harvested
    const bl = BLOCKS[id];

    // container contents spill
    if (bl && bl.use === 'crate') {
      const c = this.world.removeContainer(x, y, z);
      if (c && c.items) for (const s of c.items) if (s) this.itemDrops.spawn(x + 0.5, y + 0.6, z + 0.5, s.id, s.count);
    }
    if (bl && bl.use === 'smelter') {
      const c = this.world.removeContainer(x, y, z);
      if (c) for (const k of ['input', 'fuel', 'out']) if (c[k]) this.itemDrops.spawn(x + 0.5, y + 0.6, z + 0.5, c[k].id, c[k].count);
    }

    this.world.setBlock(x, y, z, 0);
    p.stats.mined++;
    this.audio.break_(matOf(id));
    this.particles.burst(x + 0.5, y + 0.5, z + 0.5, blockColor(id), 14, 2.6, 0.09, 0.75);

    if (!p.creative) {
      if (canHarvest(id, p.heldId)) {
        let dropId = blockDrop(id);
        // leaves rarely drop saplings/sticks
        if (bl.leaves) {
          if (Math.random() < 0.06) dropId = itemIdForBlock(bl.sapling ?? id);
          else if (Math.random() < 0.10) dropId = 'stick';
          else if (id === B.LEAF_ASPEN && Math.random() < 0.04) dropId = 'sunberry';
          else dropId = null;
          if (p.heldId && itemDef(p.heldId)?.tool === 'shears') dropId = itemIdForBlock(id);
        }
        if (dropId && Math.random() <= (bl.dropChance ?? 1)) {
          const n = bl.dropCount || 1;
          this.itemDrops.spawn(x + 0.5, y + 0.45, z + 0.5, dropId, n);
        }
        if (bl.xp) p.addXP(bl.xp);
      }
      const held = p.held;
      if (held && itemDef(held.id)?.tool) p.damageHeld(1);
      p.exhaustion += 0.02;
    }
  }

  // ----------------------------------------------------------------- placing
  _useAction() {
    const p = this.player;
    if (p.dead || this.ui.isOpen() || this.sleep) return;
    const { hit } = this._target();
    p.swingT = 1;

    // 1) interact with world object
    if (hit) {
      const bl = BLOCKS[hit.id];
      if (bl && bl.use && !this.keys['ShiftLeft']) {
        this._interact(hit, bl);
        return;
      }
    }

    // Right-click prefers the main hand and falls back to the off hand, so a
    // torch or a stack of blocks parked in the left hand is usable without
    // swapping it into the quick bar first.
    const usable = (st) => { const d = st && itemDef(st.id); return !!d && (!!d.block || !!d.food); };
    let held = null, heldSlot = p.hotbarIdx;
    if (usable(p.held)) { held = p.held; heldSlot = p.hotbarIdx; }
    else if (usable(p.offhand)) { held = p.offhand; heldSlot = 'offhand'; }
    else { held = p.held || p.offhand || null; heldSlot = p.held ? p.hotbarIdx : 'offhand'; }

    // 2) shear woolback (either hand may hold the shears)
    const ent = this._targetEntity(3.2);
    const shears = [p.held, p.offhand].find(st => st && itemDef(st.id)?.tool === 'shears');
    if (ent && shears && ent.def.shearable && !ent.sheared) {
      ent.sheared = true;
      this.itemDrops.spawn(ent.pos.x, ent.pos.y + 0.6, ent.pos.z, ent.def.shearable, 1 + ((Math.random() * 2) | 0));
      if (ent.mesh.userData.wool) ent.mesh.userData.wool.forEach(w => w.material = w.material.clone());
      if (ent.mesh.userData.wool) ent.mesh.userData.wool.forEach(w => w.material.color.setHex(0xd8c2a0));
      if (shears === p.held) p.damageHeld(1);
      else if (shears.dur !== undefined && !p.creative) {
        shears.dur -= 1;
        if (shears.dur <= 0) { p.offhand = null; this.audio.break_('metal'); }
      }
      this.audio.break_('wool');
      return;
    }
    // 3) feed / eat
    if (held && itemDef(held.id)?.food) { this._eatHeld(heldSlot); return; }

    // 4) place block
    if (!held) return;
    const def = itemDef(held.id);
    if (!def || !def.block) return;
    if (!hit) return;

    let bx = hit.x + hit.nx, by = hit.y + hit.ny, bz = hit.z + hit.nz;
    const targetBl = BLOCKS[hit.id];
    // replace grass/plants directly
    if (targetBl && (targetBl.render === 2 || hit.id === B.WATER)) { bx = hit.x; by = hit.y; bz = hit.z; }

    const existing = this.world.getBlock(bx, by, bz);
    const exBl = BLOCKS[existing];
    if (existing !== 0 && !(exBl && (exBl.render === 2 || exBl.liquid))) return;

    let placeId = def.block;

    // --- wall mounting for ladders and torches ---------------------------
    // Clicking the SIDE of a solid block mounts the fixture on that face.
    // hit.nx/hit.nz point out of the clicked face, so the wall the fixture
    // clings to is the opposite side of the new cell.
    if (placeId === B.LADDER || placeId === B.TORCH) {
      const horizontal = hit.nx !== 0 || hit.nz !== 0;
      const supportSolid = isSolid(hit.id);
      if (horizontal && supportSolid) {
        //   normal +Z -> the fixture hangs on the cell's -Z wall -> dir 0
        //   normal -X -> hangs on the +X wall -> dir 1
        //   normal -Z -> hangs on the +Z wall -> dir 2
        //   normal +X -> hangs on the -X wall -> dir 3
        let d = 0;
        if (hit.nz > 0) d = 0;
        else if (hit.nx < 0) d = 1;
        else if (hit.nz < 0) d = 2;
        else if (hit.nx > 0) d = 3;
        placeId = (placeId === B.LADDER ? LADDER_DIR : TORCH_DIR)[d];
      } else if (placeId === B.LADDER) {
        // a ladder with no wall behind it can't be placed at all
        const anyWall = [[0, -1, 0], [1, 0, 1], [0, 1, 2], [-1, 0, 3]]
          .find(([dx, dz]) => isSolid(this.world.getBlock(bx + dx, by, bz + dz)));
        if (!anyWall) { this.audio.error(); return; }
        placeId = LADDER_DIR[anyWall[2]];
      }
    }

    // Oriented multi-block furniture.
    const yawQ = ((Math.round(p.yaw / (Math.PI / 2)) % 4) + 4) % 4;
    const facing = [0, 3, 2, 1][yawQ];
    let secondBlock = null;
    const placeDoor = BLOCKS[placeId];
    if (placeDoor && placeDoor.door) placeId = DOOR_SETS[placeDoor.doorWood].closedLow[facing];
    if (placeId === B.BED_FOOT_N) {
      const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const [dx, dz] = dirs[facing];
      const hx = bx + dx, hz = bz + dz;
      const hid = this.world.getBlock(hx, by, hz);
      if (hid !== 0 && !(BLOCKS[hid] && (BLOCKS[hid].render === 2 || BLOCKS[hid].liquid))) {
        this.audio.error(); return;
      }
      placeId = BED_FOOT_DIR[facing];
      secondBlock = { x: hx, y: by, z: hz, id: BED_HEAD_DIR[facing] };
    }
    const placeBl = BLOCKS[placeId];

    // player collision check
    if (!placeBl.noCollide) {
      const pw = 0.31;
      const px0 = p.pos.x - pw, px1 = p.pos.x + pw;
      const pz0 = p.pos.z - pw, pz1 = p.pos.z + pw;
      const py0 = p.pos.y, py1 = p.pos.y + 1.78;
      if (bx + 1 > px0 && bx < px1 && by + 1 > py0 && by < py1 && bz + 1 > pz0 && bz < pz1) {
        this.audio.error();
        return;
      }
      if (secondBlock && secondBlock.x + 1 > px0 && secondBlock.x < px1 &&
        secondBlock.y + 1 > py0 && secondBlock.y < py1 &&
        secondBlock.z + 1 > pz0 && secondBlock.z < pz1) {
        this.audio.error(); return;
      }
      for (const e of this.entities) {
        if (e.dead) continue;
        const ew = e.w / 2;
        if (bx + 1 > e.pos.x - ew && bx < e.pos.x + ew &&
          by + 1 > e.pos.y && by < e.pos.y + e.h &&
          bz + 1 > e.pos.z - ew && bz < e.pos.z + ew) { this.audio.error(); return; }
        if (secondBlock && secondBlock.x + 1 > e.pos.x - ew && secondBlock.x < e.pos.x + ew &&
          secondBlock.y + 1 > e.pos.y && secondBlock.y < e.pos.y + e.h &&
          secondBlock.z + 1 > e.pos.z - ew && secondBlock.z < e.pos.z + ew) {
          this.audio.error(); return;
        }
      }
    }

    // support checks for plants / torches / lanterns
    const below = this.world.getBlock(bx, by - 1, bz);
    if ((placeBl.render === 2 || placeId === B.CACTUS || placeId === B.TORCH || placeId === B.LANTERN) &&
      placeBl.wallDir === undefined &&
      (below === 0 || below === B.WATER || (BLOCKS[below] && BLOCKS[below].noCollide))) {
      this.audio.error();
      return;
    }

    // Doors need vertical headroom; beds need solid support beneath both halves.
    if (placeBl.door && !placeBl.doorTop) {
      const up = this.world.getBlock(bx, by + 1, bz);
      if (up !== 0 && !(BLOCKS[up] && BLOCKS[up].render === 2)) { this.audio.error(); return; }
    }
    if (secondBlock) {
      const underHead = this.world.getBlock(secondBlock.x, by - 1, secondBlock.z);
      if (!isSolid(below) || !isSolid(underHead)) { this.audio.error(); return; }
    }

    if (!this.world.setBlock(bx, by, bz, placeId)) return;
    if (placeBl.door && !placeBl.doorTop)
      this.world.setBlock(bx, by + 1, bz, DOOR_SETS[placeBl.doorWood].closedTop[placeBl.doorDir]);
    if (secondBlock) this.world.setBlock(secondBlock.x, secondBlock.y, secondBlock.z, secondBlock.id);
    if (placeId === B.TALL_GRASS && this.world.getBlock(bx, by + 1, bz) === 0)
      this.world.setBlock(bx, by + 1, bz, B.TALL_GRASS_TOP);
    if (placeBl.use === 'crate') {
      const c = this.world.containerAt(bx, by, bz, true, 'crate', false);
      // face the chest toward the player, like a placed block should
      const yaw = this.player.yaw;
      const q = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
      c.dir = [2, 1, 0, 3][q];
      if (this.chests) { this.chests.remove(bx, by, bz); this.chests.add(bx, by, bz, c.dir); }
    }
    if (placeBl.use === 'smelter') this.world.containerAt(bx, by, bz, true, 'smelter');

    this.audio.place(matOf(placeId));
    this.particles.burst(bx + 0.5, by + 0.2, bz + 0.5, blockColor(placeId), 5, 1.2, 0.06, 0.4);
    p.stats.placed++;
    if (!p.creative) p.consumeSlot(heldSlot, 1);
  }

  _interact(hit, bl) {
    const { x, y, z } = hit;
    switch (bl.use) {
      case 'bench':
        this.ui.open('craft');
        document.exitPointerLock();
        this.audio.open();
        break;
      case 'crate': {
        // A chest with no container record yet is one world generation placed,
        // so it rolls its loot the first time a player opens it.
        const natural = !this.world.containers.has(`${x},${y},${z}`);
        const c = this.world.containerAt(x, y, z, true, 'crate', natural);
        this.ui.open('crate', { container: c, pos: [x, y, z] });
        this._setChestOpen(x, y, z, true);
        this._openChest = [x, y, z];
        document.exitPointerLock();
        this.audio.open();
        break;
      }
      case 'smelter': {
        const c = this.world.containerAt(x, y, z, true, 'smelter');
        this.ui.open('smelter', { container: c, pos: [x, y, z] });
        document.exitPointerLock();
        this.audio.open();
        break;
      }
      case 'door':
        this._toggleDoor(x, y, z);
        break;
      case 'bed':
        this._sleepAt(x, y, z, bl);
        break;
    }
  }

  _toggleDoor(x, y, z) {
    const bl = BLOCKS[this.world.getBlock(x, y, z)];
    if (!bl || !bl.door) return;
    const lowY = bl.doorTop ? y - 1 : y;
    const dir = bl.doorDir & 3;
    const opening = !bl.open;
    const set = DOOR_SETS[bl.doorWood] || DOOR_SETS.aspen;
    this.world.setBlock(x, lowY, z, (opening ? set.openLow : set.closedLow)[dir]);
    this.world.setBlock(x, lowY + 1, z, (opening ? set.openTop : set.closedTop)[dir]);
    this.audio.door(opening);
  }

  _sleepAt(x, y, z, bl) {
    const p = this.player;
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const [dx, dz] = dirs[bl.bedDir & 3];
    const headX = bl.bedHead ? x : x + dx;
    const headZ = bl.bedHead ? z : z + dz;
    // Beds always set a respawn point, even when it is too early to sleep.
    // Prefer a supported two-block-high cell beside the bed; generated beds
    // near a wall must not respawn the player inside that wall.
    const px = dz, pz = -dx;
    const footX = headX - dx, footZ = headZ - dz;
    const spots = [
      [headX + px, headZ + pz], [headX - px, headZ - pz],
      [footX + px, footZ + pz], [footX - px, footZ - pz],
      [headX + dx, headZ + dz],
    ];
    const safe = spots.find(([sx, sz]) => isSolid(this.world.getBlock(sx, y - 1, sz)) &&
      !isSolid(this.world.getBlock(sx, y, sz)) && !isSolid(this.world.getBlock(sx, y + 1, sz)));
    const [spawnX, spawnZ] = safe || spots[0];
    p.spawnPoint = { x: spawnX + 0.5, y: y + 0.05, z: spawnZ + 0.5 };

    const t = this.dayFraction();
    const night = t >= 0.72 || t < 0.235;
    if (!night) {
      this.ui.toast('Respawn point set. You can only sleep at night.', 'info');
      this.audio.click();
      return;
    }
    const danger = this.entities.some(e => !e.dead && !e.def.friendly &&
      e.pos.distanceToSquared(p.pos) < 10 * 10);
    if (danger) {
      this.ui.toast('You cannot sleep while hostile creatures are nearby.', 'bad');
      this.audio.error();
      return;
    }

    this._beginSleep(headX, headZ, y, bl);
  }

  // ------------------------------------------------------------------ sleep
  /**
   * Staged sleep cinematic.
   *
   * Sleeping is not an instant time-skip: the camera lies down on the pillow,
   * the eyelids close, the world fast-forwards through the small hours while
   * the player heals, and the eyes reopen slowly onto the actual sunrise
   * before the player stands up again. Every stage runs off `this.sleep`, and
   * while it exists all player input, mining, placing and menus are paused.
   */
  _beginSleep(headX, headZ, y, bl) {
    if (this.sleep) return;
    const p = this.player;
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const [dx, dz] = dirs[bl.bedDir & 3];
    // lie facing along the bed (head -> foot) and looking up at the ceiling
    const lookYaw = Math.atan2(dx, dz);
    const eye = p.eyePos();

    // Fast-forward target: the next 07:12 morning. We stop just short of dawn
    // while the eyes are shut so the sunrise itself plays out on screen.
    const t = this.dayFraction();
    const day = Math.floor(this.worldTime / DAY_LENGTH);
    const targetDay = day + (t >= 0.30 ? 1 : 0);
    this.sleep = {
      stage: 0, t: 0,
      camFrom: eye.clone(),
      camTo: new THREE.Vector3(headX + 0.5 - dx * 0.18, y + 0.72, headZ + 0.5 - dz * 0.18),
      standTo: null,
      yawFrom: p.yaw, yawTo: lookYaw,
      pitchFrom: p.pitch, pitchTo: 0.92,
      timeFrom: this.worldTime,
      preDawn: targetDay * DAY_LENGTH + DAY_LENGTH * 0.215,
      morning: targetDay * DAY_LENGTH + DAY_LENGTH * 0.30,
      healFrom: p.health,
      lid: 0,
      done: false,
    };
    p.vel.set(0, 0, 0);
    p.mining = null;
    p.sprinting = false;
    this.mouse.left = false; this.mouse.right = false;
    this._cancelMining();
    this.ui.hint('');
    if (this.ui.isOpen()) this.ui.close();
    document.exitPointerLock();
    this.ui.beginSleep();
    this.audio.sleep();
  }

  /** Duration of each cinematic stage, in seconds. */
  static get SLEEP_STAGES() {
    return [
      { key: 'lie', dur: 1.25, cap: 'You lie down\u2026' },
      { key: 'close', dur: 0.95, cap: 'Closing your eyes\u2026' },
      { key: 'rest', dur: 2.60, cap: 'Sleeping\u2026' },
      { key: 'wake', dur: 1.70, cap: 'Sunrise\u2026' },
      { key: 'rise', dur: 1.10, cap: 'Good morning' },
    ];
  }

  get sleeping() { return !!this.sleep; }

  _updateSleep(dt) {
    const sl = this.sleep;
    if (!sl) return;
    const p = this.player;
    const stages = Game.SLEEP_STAGES;
    sl.t += dt;
    let st = stages[sl.stage];
    while (sl.t >= st.dur) {
      sl.t -= st.dur;
      sl.stage++;
      if (sl.stage >= stages.length) { this._endSleep(); return; }
      st = stages[sl.stage];
      if (st.key === 'rise') sl.standTo = p.eyePos().clone();
    }
    const f = Math.min(1, sl.t / st.dur);
    const ease = f * f * (3 - 2 * f);

    // ---- camera: lie down, hold, then sit back up
    const cam = this._sleepCam || (this._sleepCam = {
      pos: new THREE.Vector3(), yaw: 0, pitch: 0,
    });
    const drift = Math.sin(this.time * 0.7) * 0.012;
    if (st.key === 'lie') {
      cam.pos.copy(sl.camFrom).lerp(sl.camTo, ease);
      cam.yaw = sl.yawFrom + shortestAngle(sl.yawFrom, sl.yawTo) * ease;
      cam.pitch = sl.pitchFrom + (sl.pitchTo - sl.pitchFrom) * ease;
    } else if (st.key === 'rise') {
      const up = sl.standTo || sl.camFrom;
      cam.pos.copy(sl.camTo).lerp(up, ease);
      cam.yaw = sl.yawTo;
      cam.pitch = sl.pitchTo + (0.06 - sl.pitchTo) * ease;
    } else {
      cam.pos.copy(sl.camTo);
      cam.pos.y += drift;
      cam.yaw = sl.yawTo + drift * 0.6;
      cam.pitch = sl.pitchTo + drift;
    }

    // ---- eyelids
    let lid = sl.lid;
    if (st.key === 'lie') lid = 0.10 * ease;
    else if (st.key === 'close') lid = 0.10 + 0.90 * ease;
    else if (st.key === 'rest') lid = 1;
    else if (st.key === 'wake') lid = 1 - 0.86 * ease;
    else lid = 0.14 * (1 - ease);
    sl.lid = lid;

    // ---- time: hold until the eyes are shut, race through the night, then
    // let the sunrise play at a watchable pace while the eyes reopen.
    if (st.key === 'rest') {
      this.worldTime = sl.timeFrom + (sl.preDawn - sl.timeFrom) * ease;
    } else if (st.key === 'wake' || st.key === 'rise') {
      // The sunrise itself: most of it plays while the eyelids lift, the
      // remainder as the player sits back up.
      const pgs = st.key === 'wake' ? ease * 0.72 : 0.72 + ease * 0.28;
      this.worldTime = sl.preDawn + (sl.morning - sl.preDawn) * pgs;
    }

    // ---- healing: a full night's rest mends you while you are under
    if (st.key === 'rest' || st.key === 'wake') {
      p.health = Math.min(p.maxHealth, p.health + dt * 2.4);
      p.air = p.maxAir;
      p.exhaustion = Math.max(0, p.exhaustion - dt * 0.8);
      if (p.hurtCd > 0) p.hurtCd = 0;
    }

    // ---- daybreak: undead caught in the open burn away as usual
    if (!sl.burned && (st.key === 'wake')) {
      sl.burned = true;
      for (const e of this.entities) {
        if (!e.dead && e.def.burns && this.world.hasSkyAccess(e.pos.x, e.pos.y + e.h, e.pos.z)) {
          e.dead = true;
          e.despawned = true;  // sunrise cleanup is not a player kill: no loot
        }
      }
    }

    this.ui.updateSleep(sl.lid, st.cap, sl.stage / (stages.length - 1));
  }

  /** Finish the cinematic and hand control back to the player. */
  _endSleep(skipped = false) {
    if (!this.sleep) return;
    const sl = this.sleep;
    this.worldTime = sl.morning;
    for (const e of this.entities) {
      if (!e.dead && e.def.burns && this.world.hasSkyAccess(e.pos.x, e.pos.y + e.h, e.pos.z)) {
        e.dead = true;
        e.despawned = true;
      }
    }
    const p = this.player;
    p.health = Math.min(p.maxHealth, Math.max(p.health, sl.healFrom + 4));
    p.air = p.maxAir;
    p.yaw = sl.yawTo;
    p.pitch = 0.06;
    this.sleep = null;
    this.ui.endSleep();
    this.ui.toast(skipped ? 'You wake with a start. Respawn point set.'
      : 'Good morning. Respawn point set.', 'good');
    this.save(true);
    this.requestPointerLock();
  }

  // ------------------------------------------------------------------ death
  /**
   * Staged death cinematic, in the same spirit as the sleep cinematic: the
   * camera sags and rolls, the world slows, a red veil closes in, and the
   * death screen appears only after the fall. Every input is swallowed while
   * it runs (Escape skips straight to the screen).
   */
  _beginDeath(cause) {
    if (this.death) return;
    const p = this.player;
    // dying in your sleep (a hostile wandered in) ends the sleep cinematic
    if (this.sleep) { this.sleep = null; this.ui.endSleep(); }
    document.exitPointerLock();
    this.ui.close();
    this._cancelMining();
    this.ui.hint('');
    document.body.classList.add('dying');
    const eye = p.eyePos();
    this.death = {
      stage: 0, t: 0, cause,
      camFrom: eye.clone(),
      camTo: new THREE.Vector3(eye.x + 0.14, Math.max(eye.y - 1.5, 0.4), eye.z + 0.1),
      yawFrom: p.yaw, pitchFrom: p.pitch,
      yawTo: p.yaw + Math.PI * 0.42, pitchTo: 1.30,
      done: false,
    };
    this.audio.death();
    this.ui.updateDeathCap('The light fades\u2026');
  }

  /** Duration of each death stage, in seconds. */
  static get DEATH_STAGES() {
    return [
      { key: 'fall', dur: 1.7, cap: 'The light fades\u2026' },
      { key: 'darken', dur: 1.6, cap: 'The world slips away\u2026' },
      { key: 'end', dur: 0.9, cap: '' },
    ];
  }

  _updateDeath(dt) {
    const d = this.death;
    if (!d) return;
    const stages = Game.DEATH_STAGES;
    d.t += dt;
    let st = stages[d.stage];
    while (d.t >= st.dur) {
      d.t -= st.dur;
      d.stage++;
      if (d.stage >= stages.length) { this._finishDeath(); return; }
      st = stages[d.stage];
    }
    const f = Math.min(1, d.t / st.dur);
    const ease = f * f * (3 - 2 * f);
    const cam = this._deathCam || (this._deathCam = {
      pos: new THREE.Vector3(), yaw: 0, pitch: 0,
    });
    if (st.key === 'fall') {
      cam.pos.copy(d.camFrom).lerp(d.camTo, ease);
      cam.yaw = d.yawFrom + shortestAngle(d.yawFrom, d.yawTo) * ease;
      cam.pitch = d.pitchFrom + (d.pitchTo - d.pitchFrom) * ease;
    } else {
      cam.pos.copy(d.camTo);
      if (st.key !== 'end') cam.pos.y += Math.sin(this.time * 0.9) * 0.035;
      cam.yaw = d.yawTo;
      cam.pitch = d.pitchTo;
    }
    // red veil: ramps during the fall, seals during 'darken'
    const veil = st.key === 'fall' ? ease * 0.8 : 0.8 + (st.key === 'darken' ? ease * 0.2 : 0);
    this.ui.updateDeath(veil, st.cap);
  }

  _finishDeath() {
    const d = this.death;
    if (!d) return;
    this.death = null;
    this._deathShown = true;
    const p = this.player;
    this.ui.showDeath(d.cause, {
      day: Math.floor(this.worldTime / DAY_LENGTH) + 1,
      level: p.level, mined: p.stats.mined, placed: p.stats.placed, killed: p.stats.killed,
    });
  }

  _skipDeath() {
    if (!this.death) return;
    this.death.stage = Game.DEATH_STAGES.length;
    this.death.t = 0;
  }

  _pickBlock() {
    const { hit } = this._target();
    if (!hit) return;
    const iid = itemIdForBlock(hit.id);
    if (!iid) return;
    const p = this.player;
    for (let i = 0; i < HOTBAR; i++) {
      if (p.inv.slots[i] && p.inv.slots[i].id === iid) { p.hotbarIdx = i; return; }
    }
    if (p.creative) {
      p.inv.slots[p.hotbarIdx] = mkStack(iid, 64);
      this.audio.click();
    }
  }

  _eatHeld(slot) {
    const p = this.player;
    if (slot === undefined) {
      const use = p.useSlot(st => !!itemDef(st.id)?.food);
      slot = use.slot === null ? p.hotbarIdx : use.slot;
    }
    if (p.eat(slot)) {
      p.swingT = 1;    // the arm raises the food to the mouth
      this.particles.burst(p.pos.x, p.pos.y + 1.4, p.pos.z, 0xd8b070, 6, 1.2, 0.05, 0.5);
    }
  }

  _dropHeld(all) {
    const p = this.player;
    const s = p.held;
    if (!s) return;
    const n = all ? s.count : 1;
    const dir = new THREE.Vector3(-Math.sin(p.yaw), 0.35, -Math.cos(p.yaw));
    this.itemDrops.spawn(p.pos.x + dir.x * 0.6, p.pos.y + 1.3, p.pos.z + dir.z * 0.6, s.id, n,
      dir.x * 5.5, 3.0, dir.z * 5.5);
    s.count -= n;
    if (s.count <= 0) p.inv.slots[p.hotbarIdx] = null;
  }

  _tryPickup(id, count) {
    const p = this.player;
    if (!p.inv.hasSpace(id, count)) return false;
    p.inv.add(id, count);
    this.audio.pickup();
    this.ui.toast(`+${count} ${itemName(id)}`);
    return true;
  }

  // ---------------------------------------------------------------- crafting
  countFor(idOrTag) {
    const p = this.player;
    if (isTag(idOrTag)) {
      let n = 0;
      for (const it of TAGS[idOrTag]) n += p.inv.count(it);
      return n;
    }
    return p.inv.count(idOrTag);
  }

  canCraft(r) {
    if (r.bench && !this.nearBench) return false;
    // Creative recipes are previews/convenience, never resource-gated.
    if (!this.player.creative)
      for (const [id, n] of r.need) if (this.countFor(id) < n) return false;
    return this.player.inv.hasSpace(r.out, r.count);
  }

  craft(r) {
    if (!this.canCraft(r)) { this.audio.error(); return false; }
    const p = this.player;
    if (!p.creative) for (const [id, n] of r.need) {
      if (isTag(id)) {
        let left = n;
        for (const it of TAGS[id]) {
          if (left <= 0) break;
          const have = p.inv.count(it);
          const take = Math.min(have, left);
          if (take > 0) { p.inv.remove(it, take); left -= take; }
        }
      } else p.inv.remove(id, n);
    }
    p.inv.add(r.out, r.count);
    p.stats.crafted += r.count;
    p.addXP(1);
    this.audio.craft();
    return true;
  }

  /**
   * Keep the chest block-entity renderer in sync with the world.
   * Chest blocks are rare, so instead of scanning every frame we sweep the
   * loaded chunks around the player a few times a second and diff against the
   * renderer's registry.
   */
  _updateChests(dt) {
    if (!this.chests) return;
    this._chestScanT -= dt;
    if (this._chestScanT <= 0) {
      this._chestScanT = 0.35;
      this._scanChests();
    }
    this.chests.update(dt, this.camera.position,
      (x, y, z) => this.world.lightProbe(x, y, z));
  }

  _scanChests() {
    const px = this.player.pos.x, pz = this.player.pos.z;
    const R = 5;  // chunk radius
    const pcx = Math.floor(px / CHUNK_X), pcz = Math.floor(pz / CHUNK_Z);
    const seen = new Set();
    const seenLanterns = new Set();

    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const c = this.world.chunks.get(ckey(pcx + dx, pcz + dz));
        if (!c || !c.blocks) continue;

        // A full 32k scan per chunk per sweep would be wasteful, so cache the
        // chest positions found in a chunk and only rescan when it changes.
        if (!c._chestList || !c._lanternList) {
          const chests = [], lanterns = [];
          const b = c.blocks;
          for (let i = 0; i < b.length; i++) {
            if (b[i] !== B.CRATE && b[i] !== B.LANTERN) continue;
            const y = (i / 256) | 0;
            const rem = i - y * 256;
            const lz = (rem / CHUNK_X) | 0;
            const pos = [rem - lz * CHUNK_X, y, lz];
            (b[i] === B.CRATE ? chests : lanterns).push(pos);
          }
          c._chestList = chests;
          c._lanternList = lanterns;
        }

        for (const [lx, y, lz] of c._chestList) {
          const wx = c.cx * CHUNK_X + lx, wz = c.cz * CHUNK_Z + lz;
          if (Math.abs(wx - px) > 80 || Math.abs(wz - pz) > 80) continue;
          seen.add(wx + ',' + y + ',' + wz);
          if (!this.chests.has(wx, y, wz)) {
            const cont = this.world.containers.get(wx + ',' + y + ',' + wz);
            // Player-placed chests store their facing. World-generated ones
            // don't, so derive a sensible one: the front should open into
            // free space, never flat against a wall.
            const dir = (cont && cont.dir !== undefined)
              ? cont.dir : this._chestFacing(wx, y, wz);
            this.chests.add(wx, y, wz, dir);
          }
        }
        for (const [lx, y, lz] of c._lanternList) {
          const wx = c.cx * CHUNK_X + lx, wz = c.cz * CHUNK_Z + lz;
          if (Math.abs(wx - px) > 88 || Math.abs(wz - pz) > 88) continue;
          const key = `${wx},${y},${wz}`;
          seenLanterns.add(key);
          if (this.lanterns && !this.lanterns.has(wx, y, wz)) this.lanterns.add(wx, y, wz);
        }
      }
    }
    // drop fixtures that were broken or streamed out of range
    for (const key of [...this.chests.chests.keys()]) {
      if (seen.has(key)) continue;
      const [x, y, z] = key.split(',').map(Number);
      this.chests.remove(x, y, z);
    }
    if (this.lanterns) for (const key of [...this.lanterns.lanterns.keys()]) {
      if (seenLanterns.has(key)) continue;
      const [x, y, z] = key.split(',').map(Number);
      this.lanterns.remove(x, y, z);
    }
  }

  /**
   * Pick a facing for a chest that world generation placed. Chests should
   * present their latch to open space (ideally the widest open span), so we
   * score each of the four horizontal directions by how much room is in front
   * of it and take the best. Ties fall back to a stable per-position hash so
   * the choice doesn't flicker as chunks reload.
   * dir: 0 = -Z, 1 = +X, 2 = +Z, 3 = -X
   */
  _chestFacing(x, y, z) {
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    let best = -1, bestScore = -1;
    for (let d = 0; d < 4; d++) {
      const [dx, dz] = DIRS[d];
      let score = 0;
      // reward open cells directly ahead, weighted toward the nearest
      for (let step = 1; step <= 3; step++) {
        const id = this.world.getBlock(x + dx * step, y, z + dz * step);
        const bl = BLOCKS[id];
        const open = id === 0 || (bl && bl.noCollide);
        if (!open) break;
        score += 4 - step;
      }
      // strongly prefer having a solid block directly BEHIND (back to a wall)
      const backId = this.world.getBlock(x - dx, y, z - dz);
      const backBl = BLOCKS[backId];
      if (backId !== 0 && backBl && !backBl.noCollide) score += 3;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    if (bestScore <= 0) {
      // fully enclosed: deterministic fallback so it never flickers
      return (Math.abs(Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 0) & 3;
    }
    return best;
  }

  /** Open/close animation + sound for the chest the UI is showing. */
  _setChestOpen(x, y, z, open) {
    if (!this.chests || !this.chests.has(x, y, z)) return;
    const wasOpen = this.chests.isOpen(x, y, z);
    if (wasOpen === open) return;
    this.chests.setOpen(x, y, z, open);
    if (this.audio && this.audio.chest) this.audio.chest(open);
  }

  _checkNearBench() {
    // This scans a 9x4x9 block volume (324 getBlock calls). It only needs to
    // change when the player actually moves to a new block, so skip it while
    // they are standing still and throttle it otherwise.
    const pl = this.player;
    const bx = Math.floor(pl.pos.x), by = Math.floor(pl.pos.y), bz = Math.floor(pl.pos.z);
    this._benchT = (this._benchT || 0) - 1;
    if (this._benchKey === bx + ',' + by + ',' + bz && this._benchT > 0) return;
    this._benchKey = bx + ',' + by + ',' + bz;
    this._benchT = 6;                  // re-check at most every 6 frames

    const p = this.player;
    let near = false;
    const px = Math.floor(p.pos.x), py = Math.floor(p.pos.y), pz = Math.floor(p.pos.z);
    for (let dy = -1; dy <= 2 && !near; dy++)
      for (let dz = -4; dz <= 4 && !near; dz++)
        for (let dx = -4; dx <= 4; dx++) {
          if (this.world.getBlock(px + dx, py + dy, pz + dz) === B.BENCH) { near = true; break; }
        }
    if (near !== this.nearBench) {
      const wasNear = this.nearBench;
      this.nearBench = near;
      // The 3x3 screen belongs to the table itself (the inventory has its own
      // 2x2), so walking out of range closes it and hands back the contents,
      // exactly like stepping away from any container.
      if (this.ui.screen === 'craft' && wasNear && !near) {
        this.ui.close();
        this.requestPointerLock();
      }
    }
  }

  // ---------------------------------------------------------------- smelting
  _updateSmelters(dt) {
    for (const [key, c] of this.world.containers) {
      if (!c || c.kind !== 'smelter') continue;
      const [x, y, z] = key.split(',').map(Number);
      let changed = false;
      const recipe = c.input ? SMELT[c.input.id] : null;
      const canOut = recipe && (!c.out || (c.out.id === recipe[0] && c.out.count + recipe[1] <= stackMax(recipe[0])));

      if (c.burn > 0) {
        c.burn -= dt;
        if (c.burn <= 0) { c.burn = 0; changed = true; }
      }
      if (c.burn <= 0 && recipe && canOut && c.fuel) {
        const f = FUEL[c.fuel.id];
        if (f) {
          c.burnMax = f * 1.6;
          c.burn = c.burnMax;
          c.fuel.count--;
          if (c.fuel.count <= 0) c.fuel = null;
          changed = true;
          this.audio.smelt();
        }
      }
      if (c.burn > 0 && recipe && canOut) {
        c.cook += dt;
        const need = 5.0;
        if (c.cook >= need) {
          c.cook = 0;
          c.input.count--;
          if (c.input.count <= 0) c.input = null;
          if (!c.out) c.out = mkStack(recipe[0], recipe[1]);
          else c.out.count += recipe[1];
          changed = true;
          this.player.addXP(1);
        }
      } else if (c.cook > 0) {
        c.cook = Math.max(0, c.cook - dt * 2);
      }

      // lit visual
      const cur = this.world.getBlock(x, y, z);
      const wantLit = c.burn > 0;
      if (cur === B.SMELTER && wantLit) this.world.setBlock(x, y, z, B.SMELTER_LIT);
      else if (cur === B.SMELTER_LIT && !wantLit) this.world.setBlock(x, y, z, B.SMELTER);

      if (wantLit && Math.random() < dt * 6) {
        this.particles.spawn(x + 0.5 + (Math.random() - 0.5) * 0.4, y + 1.02, z + 0.5 + (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.2, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2,
          0x6a6a72, 0.07, 1.6, 0.06);
      }
      if (changed && this.ui.screen === 'smelter' && this.ui.openContainer === c) this.ui.render();
      else if (this.ui.screen === 'smelter' && this.ui.openContainer === c && this.frame % 12 === 0) this.ui.render();
    }
  }

  // ---------------------------------------------------------------- entities
  _updateEntities(dt) {
    const p = this.player;
    // Reused context object. Rebuilding this literal (and re-creating the
    // spawnProjectile closure) every single frame allocated needlessly.
    const ctx = this._entCtx || (this._entCtx = {
      audio: this.audio,
      daylight: 1,
      particles: this.particles,
      spawnProjectile: (x, y, z, tx, ty, tz, dmg) =>
        this.projectiles.spawn(x, y, z, tx, ty, tz, dmg),
    });
    ctx.daylight = this.daylight();

    // Entities far from the player get a cheaper update cadence: distant AI
    // does not need 60 Hz. They still simulate, just on every 3rd frame with a
    // proportionally larger dt, which keeps movement speed identical.
    const FAR = 48 * 48;
    const slowPhase = this.frame % 3;

    let hostiles = 0;
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      const dsq = e.pos.distanceToSquared(p.pos);
      if (dsq > FAR && !e.dead) {
        if ((i % 3) !== slowPhase) continue;
        e.update(dt * 3, this.world, p, ctx);
      } else {
        e.update(dt, this.world, p, ctx);
      }
      if (!e.def.friendly && dsq < 400) hostiles++;
      if (e.dead) {
        if (!e.despawned) this._onEntityDeath(e);
        this.entityGroup.remove(e.mesh);
        this.entities.splice(i, 1);
      }
    }
    this._nearbyHostiles = hostiles;
    this._spawnEntities(dt);
  }

  _onEntityDeath(e) {
    if (e._dropped) return;
    e._dropped = true;
    const drops = e.rollDrops();
    for (const [id, n] of drops) {
      this.itemDrops.spawn(e.pos.x, e.pos.y + e.h * 0.5, e.pos.z, id, n);
    }
    this.player.addXP(e.def.xp || 1);
    this.player.stats.killed++;
    this.particles.burst(e.pos.x, e.pos.y + e.h * 0.5, e.pos.z, 0xd8d0c0, 18, 2.6, 0.08, 0.9);
    this.audio.crit(e.kind);
  }

  _spawnEntities(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 1.6;

    const p = this.player;
    const dl = this.daylight();
    const cap = 34;
    if (this.entities.length >= cap) return;

    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 18 + Math.random() * 42;
      const x = Math.floor(p.pos.x + Math.cos(ang) * dist);
      const z = Math.floor(p.pos.z + Math.sin(ang) * dist);
      if (!this.world.isLoaded(x, z)) continue;

      const terrainY = this.world.heightAt(x, z);
      const biome = this.world.biomeAt(x, z);
      if (biome === BIOME.OCEAN) continue;

      // decide surface vs cave spawn
      const wantCave = Math.random() < (dl > 0.4 ? 0.75 : 0.45);
      let y = null, underground = false;
      if (wantCave) {
        const lo = 4, hi = Math.min(terrainY - 5, 58);
        for (let t = 0; t < 12 && y === null; t++) {
          const ty = lo + Math.floor(Math.random() * Math.max(1, hi - lo));
          if (this._spawnable(x, ty, z)) { y = ty; underground = true; }
        }
      } else {
        const ty = terrainY + 1;
        if (this._spawnable(x, ty, z)) y = ty;
      }
      if (y === null) continue;

      // light gate: hostiles need darkness
      const dayHere = underground ? 0 : dl;
      const kind = pickSpawnKind(biome, y, dayHere, underground, y < 18);
      if (!kind) continue;
      const def = SPECIES[kind];
      if (def.cave && !underground) continue;
      if (def.deep && y > 24) continue;
      if (!def.friendly && !underground && dl > 0.34) continue;
      if (def.friendly && underground) continue;

      // don't spawn too close
      const d2 = (x - p.pos.x) ** 2 + (z - p.pos.z) ** 2;
      if (d2 < 15 * 15) continue;

      // pack spawning for friendlies
      const packSize = def.friendly ? 1 + ((Math.random() * 3) | 0) : 1;
      for (let k = 0; k < packSize; k++) {
        const ox = k === 0 ? 0 : (Math.random() - 0.5) * 4;
        const oz = k === 0 ? 0 : (Math.random() - 0.5) * 4;
        const sx = x + ox, sz = z + oz;
        if (k > 0 && !this._spawnable(Math.floor(sx), y, Math.floor(sz))) continue;
        const e = new Entity(kind, sx + 0.5, y, sz + 0.5);
        this.entityGroup.add(e.buildMesh());
        this.entities.push(e);
        // a little puff so creatures visibly materialise instead of popping
        this.particles.burst(sx + 0.5, y + 0.3, sz + 0.5, 0xc8c0b0, 5, 1.1, 0.045, 0.35);
        if (this.entities.length >= cap) break;
      }
      break;
    }
  }

  _spawnable(x, y, z) {
    const w = this.world;
    const below = w.getBlock(x, y - 1, z);
    if (below <= 0 || !isSolid(below)) return false;
    const a = w.getBlock(x, y, z), b = w.getBlock(x, y + 1, z);
    if (a !== 0 || b !== 0) return false;
    if (below === B.LAVA) return false;
    return true;
  }

  _ambientParticles(dt) {
    const p = this.player;
    const dl = this.daylight();
    const bioHere = this.world.biomeAt(p.pos.x, p.pos.z);

    // fireflies drift over the woods at night
    const woodsy = bioHere === BIOME.FOREST || bioHere === BIOME.MEADOW ||
      bioHere === BIOME.PLAINS || bioHere === BIOME.MARSH;
    if (dl < 0.24 && woodsy && !p.headInWater && Math.random() < dt * 5) {
      this.particles.spawn(
        p.pos.x + (Math.random() - 0.5) * 16,
        p.pos.y + 0.8 + Math.random() * 4.5,
        p.pos.z + (Math.random() - 0.5) * 16,
        (Math.random() - 0.5) * 0.3, 0.06 + Math.random() * 0.1, (Math.random() - 0.5) * 0.3,
        Math.random() < 0.55 ? 0xd8ff8a : 0xffe98a, 0.032, 2.4 + Math.random() * 1.8, 0);
    }
    // leaves spiral down from the canopy in the woods
    if ((bioHere === BIOME.FOREST || bioHere === BIOME.EMBERWOOD) &&
      Math.random() < dt * 2.2) {
      const leafCol = bioHere === BIOME.EMBERWOOD ? 0xc4533f : 0x6fbe4c;
      this.particles.spawn(
        p.pos.x + (Math.random() - 0.5) * 14,
        p.pos.y + 5 + Math.random() * 6,
        p.pos.z + (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 0.5, -0.5 - Math.random() * 0.7, (Math.random() - 0.5) * 0.5,
        leafCol, 0.035, 3.2 + Math.random() * 1.6, 0.18);
    }
    // dust kicked up by a hard landing
    if (p.landed && !p.inWater) {
      this.particles.burst(p.pos.x, p.pos.y + 0.12, p.pos.z, 0xb9a98c, 7, 1.6, 0.05, 0.5);
    }
    // sprinting scuffs the ground behind you
    if (p.sprinting && p.onGround && !p.inWater && !p.flying && Math.random() < dt * 14) {
      const back = new THREE.Vector3(Math.sin(p.yaw) * 0.7, 0.15, Math.cos(p.yaw) * 0.7);
      this.particles.spawn(p.pos.x + back.x, p.pos.y + 0.1, p.pos.z + back.z,
        (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.8,
        0xa89678, 0.045, 0.5, 0.6);
    }
    // creative flight leaves a soft speed-line trail
    if (p.flying && Math.hypot(p.vel.x, p.vel.z) > 4 && Math.random() < dt * 26) {
      this.particles.spawn(
        p.pos.x - p.vel.x * 0.06 + (Math.random() - 0.5) * 0.5,
        p.pos.y + 0.3 + (Math.random() - 0.5) * 0.6,
        p.pos.z - p.vel.z * 0.06 + (Math.random() - 0.5) * 0.5,
        -p.vel.x * 0.05, -0.1, -p.vel.z * 0.05,
        Math.random() < 0.5 ? 0xd8ecff : 0xbcd8f0, 0.035, 0.5, 0);
    }

    // floating motes near torches / lava
    if (Math.random() < dt * 8) {
      const r = 9;
      const x = Math.floor(p.pos.x + (Math.random() - 0.5) * r * 2);
      const y = Math.floor(p.pos.y + (Math.random() - 0.5) * r);
      const z = Math.floor(p.pos.z + (Math.random() - 0.5) * r * 2);
      const id = this.world.getBlock(x, y, z);
      if (id === B.HEARTH) {
        this.particles.spawn(x + 0.5 + (Math.random() - 0.5) * 0.7, y + 1.02, z + 0.5 + (Math.random() - 0.5) * 0.7,
          (Math.random() - 0.5) * 0.2, 0.8 + Math.random() * 0.5, (Math.random() - 0.5) * 0.2,
          Math.random() < 0.5 ? 0xffb648 : 0xff7a2a, 0.06, 1.2, 0.1);
      } else if (id === B.TORCH || (id >= B.TORCH_N && id <= B.TORCH_W)) {
        this.particles.spawn(x + 0.5 + (Math.random() - 0.5) * 0.15, y + 0.72, z + 0.5 + (Math.random() - 0.5) * 0.15,
          (Math.random() - 0.5) * 0.15, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.15,
          Math.random() < 0.5 ? 0xffb648 : 0xff7a2a, 0.05, 1.0, 0.08);
      } else if (id === B.LAVA) {
        if (Math.random() < 0.3)
          this.particles.spawn(x + 0.5 + (Math.random() - 0.5) * 0.8, y + 1.0, z + 0.5 + (Math.random() - 0.5) * 0.8,
            (Math.random() - 0.5) * 0.5, 1.4 + Math.random(), (Math.random() - 0.5) * 0.5,
            0xff8a3a, 0.09, 1.4, 0.35);
      } else if (id === B.ORE_GLIMMER || id === B.ORE_AURORITE) {
        this.particles.spawn(x + 0.5 + (Math.random() - 0.5) * 0.9, y + 0.5 + (Math.random() - 0.5) * 0.9, z + 0.5 + (Math.random() - 0.5) * 0.9,
          0, 0.12, 0, id === B.ORE_GLIMMER ? 0xe8b8ff : 0xa9fff4, 0.05, 1.6, 0.02);
      }
    }
    // Rain splashes — these must break on the TOPMOST surface, including the
    // surface of water and lava, not on the solid ground beneath a lake.
    if (this.weather.active && this.weather.type === 'rain' && this.weather.intensity > 0.3) {
      for (let i = 0; i < 3; i++) {
        if (Math.random() > dt * 30) continue;
        const x = p.pos.x + (Math.random() - 0.5) * 14;
        const z = p.pos.z + (Math.random() - 0.5) * 14;
        const surf = this.world.splashSurface(x, z);
        if (!surf) continue;
        if (Math.abs(surf.y - p.pos.y) > 14) continue;
        if (surf.liquid === B.LAVA) {
          // rain hitting lava hisses off as steam
          this.particles.spawn(x, surf.y + 0.05, z, (Math.random() - 0.5) * 0.3, 0.7,
            (Math.random() - 0.5) * 0.3, 0xcfd6dc, 0.09, 0.75, -0.15);
        } else if (surf.liquid) {
          // ripple on the water: flatter, slower, lighter than a ground splash
          this.particles.spawn(x, surf.y + 0.02, z, (Math.random() - 0.5) * 0.35, 0.55,
            (Math.random() - 0.5) * 0.35, 0xbcdcf2, 0.05, 0.4, 1.5);
        } else {
          this.particles.spawn(x, surf.y + 0.05, z, (Math.random() - 0.5) * 0.6, 0.9,
            (Math.random() - 0.5) * 0.6, 0x9dc0e0, 0.045, 0.32, 1.2);
        }
      }
    }
  }

  // -------------------------------------------------------------------- map
  drawMap(canvas, legendEl) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#0d1017';
    ctx.fillRect(0, 0, W, H);
    const p = this.player;
    const R = this.world.renderDist + 2;
    const pcx = Math.floor(p.pos.x / CHUNK_X), pcz = Math.floor(p.pos.z / CHUNK_Z);
    const span = (R * 2 + 1) * CHUNK_X;
    const scale = W / span;
    const ox = (pcx - R) * CHUNK_X, oz = (pcz - R) * CHUNK_Z;

    const img = ctx.createImageData(W, H);
    const seen = new Set();
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const wx = Math.floor(ox + px / scale);
        const wz = Math.floor(oz + py / scale);
        const c = this.world.chunks.get(ckey(Math.floor(wx / CHUNK_X), Math.floor(wz / CHUNK_Z)));
        const i4 = (py * W + px) * 4;
        if (!c || !c.heights) { img.data[i4 + 3] = 0; continue; }
        const lx = wx - Math.floor(wx / CHUNK_X) * CHUNK_X;
        const lz = wz - Math.floor(wz / CHUNK_Z) * CHUNK_Z;
        const h = c.heights[lx + lz * CHUNK_X];
        const b = c.biomes[lx + lz * CHUNK_X];
        seen.add(b);
        let col = BIOME_INFO[b] ? BIOME_INFO[b].tint : 0x808080;
        // shade by height
        const shade = 0.55 + Math.min(1, Math.max(0, (h - 30) / 70)) * 0.7;
        let r = ((col >> 16) & 255) * shade;
        let g = ((col >> 8) & 255) * shade;
        let bb = (col & 255) * shade;
        if (h < SEA_LEVEL) { r *= 0.6; g *= 0.7; bb = Math.min(255, bb * 1.25); }
        img.data[i4] = r; img.data[i4 + 1] = g; img.data[i4 + 2] = bb; img.data[i4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= R * 2 + 1; i++) {
      const t = i * CHUNK_X * scale;
      ctx.beginPath(); ctx.moveTo(t, 0); ctx.lineTo(t, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, t); ctx.lineTo(W, t); ctx.stroke();
    }

    // entities
    for (const e of this.entities) {
      const ex = (e.pos.x - ox) * scale, ez = (e.pos.z - oz) * scale;
      ctx.fillStyle = e.def.friendly ? '#7fe08a' : '#ff6a5c';
      ctx.fillRect(ex - 2, ez - 2, 4, 4);
    }
    // spawn point
    if (p.spawnPoint) {
      const sx = (p.spawnPoint.x - ox) * scale, sz = (p.spawnPoint.z - oz) * scale;
      ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sz, 6, 0, 7); ctx.stroke();
    }
    // player arrow
    const px = (p.pos.x - ox) * scale, pz = (p.pos.z - oz) * scale;
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-p.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#12141c'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();

    if (legendEl) {
      legendEl.innerHTML = Array.from(seen).sort().map(b => {
        const i = BIOME_INFO[b];
        if (!i) return '';
        return `<span><i style="background:#${i.tint.toString(16).padStart(6, '0')}"></i>${i.name}</span>`;
      }).join('') + `<span class="coord">You: ${Math.floor(p.pos.x)}, ${Math.floor(p.pos.y)}, ${Math.floor(p.pos.z)}</span>`;
    }
  }

  // ------------------------------------------------------------------ death
  respawn() {
    const sp = this.player.spawnPoint || findSpawn(this.gen);
    // ensure ground
    this.player.respawn(sp);
    this._deathShown = false;
    this.death = null;
    document.body.classList.remove('dying');
    this.ui.hideDeath();
    this.requestPointerLock();
  }

  // ------------------------------------------------------------------- save
  saveKey(slot) { return SAVE_PREFIX + (slot ?? this.slot ?? 1); }

  save(silent) {
    if (!this.world) return;
    try {
      const data = {
        v: 2,
        name: this.worldName,
        mode: this.mode,
        seed: this.seed,
        seedText: this.seedText,
        worldTime: this.worldTime,
        player: this.player.serialize(),
        edits: this.world.serializeEdits(),
        containers: this.world.serializeContainers(),
        drops: this.itemDrops.serialize(),
        savedAt: Date.now(),
      };
      localStorage.setItem(this.saveKey(), JSON.stringify(data));
      if (!silent) this.ui.toast('World saved.', 'good');
    } catch (err) {
      console.error(err);
      this.ui.toast('Save failed: storage full.', 'bad');
    }
  }

  readSave(slot) {
    try {
      const raw = localStorage.getItem(SAVE_PREFIX + (slot ?? 1));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  static listSaves() {
    const out = [];
    for (let i = 1; i <= 3; i++) {
      try {
        const raw = localStorage.getItem(SAVE_PREFIX + i);
        if (!raw) { out.push(null); continue; }
        const d = JSON.parse(raw);
        out.push({
          slot: i, name: d.name, seedText: d.seedText,
          mode: d.mode || (d.player?.creative ? 'creative' : 'survival'),
          savedAt: d.savedAt, day: Math.floor((d.worldTime || 0) / DAY_LENGTH) + 1,
          level: d.player?.level || 0,
        });
      } catch { out.push(null); }
    }
    return out;
  }
  static deleteSave(slot) { localStorage.removeItem(SAVE_PREFIX + slot); }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        vol: this.audio.volume, mus: this.audio.musicVolume,
        sens: this.sensitivity, fov: this.fov, rd: this.world?.renderDist ?? 7,
        autoq: this.autoQuality !== false,
        invertY: this.invertY,
      }));
    } catch { }
  }
  loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (s.vol !== undefined) this.audio.setVolume(s.vol);
      if (s.mus !== undefined) this.audio.setMusicVolume(s.mus);
      if (s.sens) this.sensitivity = s.sens;
      if (s.fov) { this.fov = s.fov; this.camera.fov = s.fov; this.camera.updateProjectionMatrix(); }
      if (s.invertY !== undefined) this.invertY = s.invertY;
      if (s.autoq !== undefined) this.autoQuality = s.autoq;
      this._pendingRD = s.rd;
    } catch { }
  }

  exitToTitle() {
    this.running = false;
    document.exitPointerLock();
    this.ui.close();
    window.location.reload();
  }

  _updateDebug() {
    const p = this.player;
    const el = document.getElementById('perf');
    const mem = performance.memory ? ` · heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB` : '';
    const info = this.renderer.info;
    const day = Math.floor(this.worldTime / DAY_LENGTH) + 1;
    el.innerHTML = `
      <b>EVERCRAFT</b> ${this.fps.toFixed(0)} fps${mem}<br>
      xyz ${p.pos.x.toFixed(2)} / ${p.pos.y.toFixed(2)} / ${p.pos.z.toFixed(2)}<br>
      chunk ${Math.floor(p.pos.x / 16)}, ${Math.floor(p.pos.z / 16)} · loaded ${this.world.chunks.size}<br>
      draws ${info.render.calls} · tris ${(info.render.triangles / 1000).toFixed(1)}k<br>
      entities ${this.entities.length} · drops ${this.itemDrops.items.length}<br>
      biome ${this.biomeName()} · light ${this.daylight().toFixed(2)} · day ${day}<br>
      vel ${p.vel.x.toFixed(1)} ${p.vel.y.toFixed(1)} ${p.vel.z.toFixed(1)} · ground ${p.onGround}
    `;
  }
}

/** Simple colour for non-block items held by the third-person avatar. */
function avatarItemTint(id) {
  const t = {
    stick: 0x8a6a45, coal: 0x2a2a30, torch: 0xffb648, lantern: 0xffbd45,
    raw_copper: 0xc9743c, raw_iron: 0xc4b7a4, raw_gold: 0xf0c04a,
    copper_ingot: 0xc9743c, iron_ingot: 0xd6cdc0, gold_ingot: 0xf0c04a,
    aurorite: 0x5fe0d0, glimmer_shard: 0xc77bf5, sunberry: 0xe8563f,
    raw_meat: 0xd0685f, cooked_meat: 0x9c5a30, raw_fowl: 0xe0a898,
    cooked_fowl: 0xc98a44, berry_pie: 0xd6a860, mush_stew: 0x8a5a34,
    shears: 0xd6cdc0, bucket: 0x8a8c95,
  }[id];
  if (t) return t;
  if (id.startsWith('pick') || id.startsWith('axe') || id.startsWith('shovel') || id.startsWith('blade')) {
    if (id.includes('aurorite')) return 0x5fe0d0;
    if (id.includes('iron')) return 0xd6cdc0;
    if (id.includes('copper')) return 0xc9743c;
    if (id.includes('stone')) return 0x8d8f96;
    return 0xb08d64;
  }
  return 0xb0b0b0;
}

/** Signed shortest delta from angle a to angle b, in radians. */
function shortestAngle(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
