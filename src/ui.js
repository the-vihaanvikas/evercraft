// EVERCRAFT - HUD & interface screens (DOM based, original styling).

import {
  B, BLOCKS, ITEM, itemDef, itemName, TIER_NAME, ARMOR_SLOTS,
  R_CROSS, R_TORCH, R_LADDER, R_DOOR, R_BED,
} from './blocks.js';
import { RECIPES, SMELT, FUEL, TAGS, isTag, tagMatches, CATS, matchGrid, ingredientMatches } from './recipes.js';
import { CREATIVE_CATS, CREATIVE_PALETTE } from './creative.js';
import { iconDataURL, blockIconDataURL, modelIconDataURL } from './textures.js';
import { mkStack, stackMax, HOTBAR, INV_SIZE } from './player.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const iconCache = new Map();
export function itemIcon(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  const d = itemDef(id);
  let url = '';
  if (d) {
    if (d.block) {
      const bl = BLOCKS[d.block];
      if (bl && bl.tex) {
        if (bl.render === R_CROSS)
          url = modelIconDataURL(id, 'cross', bl.tex, 3);
        else if (bl.render === R_TORCH)
          url = modelIconDataURL(id, 'torch', bl.tex, 3);
        else if (bl.render === R_LADDER)
          url = modelIconDataURL(id, 'ladder', bl.tex, 3);
        else if (bl.render === R_DOOR)
          url = modelIconDataURL(id, 'door', bl.tex, 3);
        else if (bl.render === R_BED)
          url = modelIconDataURL(id, 'bed', bl.tex, 3);
        else if (d.block === B.LANTERN)
          url = modelIconDataURL(id, 'lantern', bl.tex, 3);
        else url = blockIconDataURL(id, bl.tex, 3);
      }
    } else if (d.icon) {
      url = iconDataURL(d.icon, 3);
    } else if (d.place === B.TORCH) {
      url = modelIconDataURL(id, 'torch', 'torch', 3);
    }
  }
  iconCache.set(id, url);
  return url;
}

export function slotHTML(stack, extra = '') {
  if (!stack) return `<div class="slot ${extra}"></div>`;
  const d = itemDef(stack.id);
  const durBar = (stack.dur !== undefined && d && d.dur)
    ? `<div class="dur"><i style="width:${Math.max(0, Math.min(100, stack.dur / d.dur * 100))}%;background:${durColor(stack.dur / d.dur)}"></i></div>` : '';
  const cnt = stack.count > 1 ? `<span class="cnt">${stack.count}</span>` : '';
  return `<div class="slot filled ${extra}"><img src="${itemIcon(stack.id)}" alt="" draggable="false">${cnt}${durBar}</div>`;
}
function durColor(f) {
  const h = Math.round(f * 120);
  return `hsl(${h},72%,48%)`;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.root = $('#ui');
    this.screen = null;         // null | 'inventory' | 'craft' | 'crate' | 'smelter' | 'pause' | 'map' | 'guide'
    this.cursorStack = null;
    this.craftCat = 'basics';
    this.craftFilter = '';
    // shaped crafting grid: 3x3 backing store. The 2x2 inventory grid uses
    // the top-left 2x2 corner of it, so items survive switching screens.
    this.craftGrid = new Array(9).fill(null);
    this.craftResult = null;
    this.showBook = false;   // recipe book lives behind the book icon
    this.creativeCat = 'building';   // active tab of the creative palette
    this.inventoryTab = 'inventory';
    this.creativeFilter = '';
    this.openContainer = null;
    this.openContainerPos = null;
    this.toasts = [];
    this.hotbarFlash = -1;
    this._lastHudKey = '';
    this._build();
  }

  // ------------------------------------------------------------------ build
  _build() {
    this.root.innerHTML = `
      <div id="crosshair"><svg viewBox="0 0 24 24" width="24" height="24">
        <path d="M12 4v6M12 14v6M4 12h6M14 12h6" stroke="rgba(255,255,255,.85)" stroke-width="2" stroke-linecap="round" fill="none"/>
        <circle cx="12" cy="12" r="1.1" fill="rgba(255,255,255,.9)"/></svg></div>

      <div id="hud">
        <div id="stats">
          <div class="statrow" id="healthRow"></div>
          <div class="statrow" id="armorRow"></div>
          <div class="statrow right" id="hungerRow"></div>
          <div class="statrow right" id="airRow"></div>
        </div>
        <div id="xpbar"><i></i><span id="xplvl">0</span></div>
        <div id="hotbar"></div>
        <div id="itemname"></div>
      </div>

      <div id="infoTL">
        <div id="biomeTag"><b></b><i></i></div>
        <div id="clockTag"></div>
      </div>
      <div id="perf"></div>
      <div id="toasts"></div>
      <div id="hint"></div>
      <div id="damageFlash"></div>
      <div id="waterOverlay"></div>
      <div id="sleepFade"></div>
      <div id="vignette"></div>
      <div id="screens"></div>
      <div id="deathScreen" class="hidden">
        <div class="dbox">
          <h1>You Fell</h1>
          <p id="deathCause">The world claimed you.</p>
          <button id="respawnBtn" class="bigbtn">Return to Spawn</button>
        </div>
      </div>
    `;
    this.hotbarEl = $('#hotbar');
    this.screensEl = $('#screens');
    this.toastEl = $('#toasts');

    $('#respawnBtn').onclick = () => this.game.respawn();

    // interactions
    this.screensEl.addEventListener('mousedown', (e) => this._onSlotMouse(e), true);
    this.screensEl.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mousemove', e => {
      this._mx = e.clientX; this._my = e.clientY;
      if (this.cursorStack) this._updateCursorGhost();
    });
  }

  // ------------------------------------------------------------------- HUD
  updateHUD(dt) {
    const p = this.game.player;

    // hearts
    const hp = Math.max(0, p.health);
    const hearts = 10;
    let hh = '';
    for (let i = 0; i < hearts; i++) {
      const v = hp / 2 - i;
      const cls = v >= 1 ? 'full' : v >= 0.5 ? 'half' : 'empty';
      const flash = (performance.now() - p.lastDamage < 320 && cls !== 'empty') ? ' flash' : '';
      hh += `<span class="pip heart ${cls}${flash}"></span>`;
    }
    const hr = $('#healthRow');
    if (hr.dataset.k !== hh.length + ':' + hp) { hr.innerHTML = hh; hr.dataset.k = hh.length + ':' + hp; }

    // hunger
    let hg = '';
    for (let i = 0; i < 10; i++) {
      const v = p.hunger / 2 - i;
      hg += `<span class="pip food ${v >= 1 ? 'full' : v >= 0.5 ? 'half' : 'empty'}"></span>`;
    }
    const hgr = $('#hungerRow');
    if (hgr.dataset.k !== String(p.hunger)) { hgr.innerHTML = hg; hgr.dataset.k = String(p.hunger); }

    // armor
    const ap = p.armorPoints();
    let ar = '';
    const shields = Math.min(10, Math.ceil(ap / 2));
    for (let i = 0; i < 10; i++) {
      if (i < Math.floor(ap / 2)) ar += `<span class="pip shield full"></span>`;
      else if (i === Math.floor(ap / 2) && ap % 2) ar += `<span class="pip shield half"></span>`;
    }
    const arr = $('#armorRow');
    if (arr.dataset.k !== String(ap)) { arr.innerHTML = ar; arr.dataset.k = String(ap); }

    // air
    const airRow = $('#airRow');
    if (p.air < p.maxAir) {
      let a = '';
      const bub = Math.ceil(p.air / p.maxAir * 10);
      for (let i = 0; i < bub; i++) a += `<span class="pip air"></span>`;
      airRow.innerHTML = a;
      airRow.style.display = '';
    } else if (airRow.style.display !== 'none') { airRow.innerHTML = ''; airRow.style.display = 'none'; }

    // xp
    const need = 10 + p.level * 6;
    $('#xpbar i').style.width = `${Math.min(100, p.xp / need * 100)}%`;
    $('#xplvl').textContent = p.level;

    // hotbar
    this._renderHotbar();

    // biome + clock
    const bt = $('#biomeTag');
    const bname = this.game.biomeName();
    if (bt.dataset.k !== bname) {
      bt.dataset.k = bname;
      bt.querySelector('b').textContent = bname;
      bt.classList.remove('pop'); void bt.offsetWidth; bt.classList.add('pop');
    }
    bt.querySelector('i').textContent = `${Math.floor(p.pos.x)}, ${Math.floor(p.pos.y)}, ${Math.floor(p.pos.z)}`;
    $('#clockTag').innerHTML = this.game.clockHTML();

    // damage flash / water overlay
    const df = $('#damageFlash');
    const since = performance.now() - p.lastDamage;
    df.style.opacity = since < 380 ? String(0.42 * (1 - since / 380)) : '0';
    const lowHp = p.health <= 6 && p.health > 0;
    $('#vignette').style.opacity = lowHp ? String(0.28 + Math.sin(performance.now() / 260) * 0.12) : '0';
    $('#waterOverlay').style.opacity = p.headInWater ? '1' : '0';
  }

  _renderHotbar() {
    const p = this.game.player;
    const parts = [];
    for (let i = 0; i < HOTBAR; i++) {
      const s = p.inv.slots[i];
      parts.push(`<div class="hslot ${i === p.hotbarIdx ? 'sel' : ''}">${s ? slotInner(s) : ''}</div>`);
    }
    const key = parts.join('') + p.hotbarIdx;
    if (this._lastHudKey !== key) {
      this._lastHudKey = key;
      this.hotbarEl.innerHTML = parts.join('');
    }
    const held = p.held;
    const el = $('#itemname');
    const name = held ? itemName(held.id) : '';
    if (el.dataset.n !== name) {
      el.dataset.n = name;
      el.textContent = name;
      el.classList.remove('show'); void el.offsetWidth;
      if (name) el.classList.add('show');
    }
  }

  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.innerHTML = text;
    this.toastEl.appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, 2400);
    while (this.toastEl.children.length > 5) this.toastEl.firstChild.remove();
  }

  hint(text) {
    const h = $('#hint');
    h.innerHTML = text || '';
    h.style.opacity = text ? '1' : '0';
  }

  sleepFlash() {
    const el = $('#sleepFade');
    el.classList.remove('play');
    void el.offsetWidth;
    el.classList.add('play');
    setTimeout(() => el.classList.remove('play'), 1250);
  }

  showDeath(cause) {
    $('#deathCause').textContent = cause;
    $('#deathScreen').classList.remove('hidden');
  }
  hideDeath() { $('#deathScreen').classList.add('hidden'); }

  // --------------------------------------------------------------- screens
  isOpen() { return this.screen !== null; }

  open(screen, data) {
    this.screen = screen;
    if (screen === 'crate' || screen === 'smelter') {
      this.openContainer = data.container;
      this.openContainerPos = data.pos;
    }
    this.render(true);          // true = first open, play the panel animation
    document.body.classList.add('modal');
  }

  close() {
    // never swallow items left in either crafting grid (2x2 or 3x3)
    if (this.screen === 'craft' || this.screen === 'inventory') this.clearCraftGrid();
    // swing the chest lid shut on the way out
    if (this.screen === 'crate' && this.openContainerPos && this.game._setChestOpen) {
      const [cx, cy, cz] = this.openContainerPos;
      this.game._setChestOpen(cx, cy, cz, false);
      this.game._openChest = null;
    }
    // return cursor stack to inventory
    if (this.cursorStack) {
      this.game.player.inv.add(this.cursorStack.id, this.cursorStack.count);
      this.cursorStack = null;
      this._updateCursorGhost();
    }
    this.screen = null;
    this.openContainer = null;
    this.openContainerPos = null;
    this.screensEl.innerHTML = '';
    document.body.classList.remove('modal');
  }

  toggle(screen, data) {
    if (this.screen === screen) { this.close(); return false; }
    if (this.screen) this.close();
    this.open(screen, data);
    return true;
  }

  /**
   * Rebuild the current screen.
   *
   * `opening` is true only for the initial open. Subsequent re-renders (a tab
   * click, a slot move, toggling the recipe book) reuse the existing panel
   * element and swap only its inner markup, so the panelIn animation does NOT
   * replay - that replay is what made every click look like the window was
   * closing and reopening. Scroll positions and focus are preserved too.
   */
  render(opening = false) {
    const s = this.screen;
    if (!s) { this.screensEl.innerHTML = ''; return; }
    let html = '';
    switch (s) {
      case 'inventory': html = this._invScreen(); break;
      case 'craft': html = this._craftScreen(); break;
      case 'crate': html = this._crateScreen(); break;
      case 'smelter': html = this._smelterScreen(); break;
      case 'pause': html = this._pauseScreen(); break;
      case 'map': html = this._mapScreen(); break;
      case 'guide': html = this._guideScreen(); break;
    }

    const existing = this.screensEl.querySelector('.panel');
    if (!opening && existing) {
      // remember what the player was looking at / typing in
      const scrolls = [];
      this.screensEl.querySelectorAll('.reclist,.cpalette,.guide').forEach(el => {
        scrolls.push([el.className, el.scrollTop]);
      });
      const active = document.activeElement;
      const focusId = active && active.id ? active.id : null;
      const selStart = active && active.selectionStart;

      // swap in the new panel without touching the backdrop, so no animation
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const fresh = tmp.querySelector('.panel');
      if (fresh) {
        fresh.style.animation = 'none';
        existing.replaceWith(fresh);
        this._wire();
        let i = 0;
        this.screensEl.querySelectorAll('.reclist,.cpalette,.guide').forEach(el => {
          const rec = scrolls[i++];
          if (rec && rec[0] === el.className) el.scrollTop = rec[1];
        });
        if (focusId) {
          const el = document.getElementById(focusId);
          if (el) {
            el.focus();
            if (selStart != null && el.setSelectionRange) {
              try { el.setSelectionRange(selStart, selStart); } catch (_) { /* not a text input */ }
            }
          }
        }
        return;
      }
    }

    this.screensEl.innerHTML = `<div class="backdrop"></div>${html}`;
    this._wire();
  }

  _invGrid(from = 0, to = INV_SIZE, cls = 'inv') {
    const p = this.game.player;
    let h = '';
    for (let i = from; i < to; i++) {
      h += `<div class="slot ${p.inv.slots[i] ? 'filled' : ''}" data-src="inv" data-i="${i}">${p.inv.slots[i] ? slotInner(p.inv.slots[i]) : ''}</div>`;
    }
    return `<div class="grid ${cls}">${h}</div>`;
  }

  _armorPanel() {
    const p = this.game.player;
    const names = { helm: 'Helm', chest: 'Chest', legs: 'Legs', boots: 'Boots' };
    let h = '';
    for (const s of ARMOR_SLOTS) {
      const it = p.armor[s];
      h += `<div class="slot armor ${it ? 'filled' : ''}" data-src="armor" data-i="${s}" title="${names[s]}">
        ${it ? slotInner(it) : `<span class="ghost">${names[s]}</span>`}</div>`;
    }
    return `<div class="armorcol">${h}<div class="apts">Armor ${p.armorPoints()}</div></div>`;
  }

  /**
   * Inline SVG paper-doll of the player, like the inventory portrait in the
   * game this is inspired by. Drawn as flat coloured rects on a 1/16 grid so
   * it matches the blocky art style, tinted by whatever armour is equipped and
   * posed slightly toward the viewer.
   */
  _playerPreview() {
    const p = this.game.player;
    const tierColor = { hide: '#9c6b3f', copper: '#c9743c', iron: '#d6cdc0', aurorite: '#5fe0d0' };
    const armorOf = (slot) => {
      const it = p.armor[slot];
      if (!it) return null;
      const key = Object.keys(tierColor).find(k => String(it.id).includes(k));
      return key ? tierColor[key] : '#9aa6bc';
    };
    const helm = armorOf('helm'), chestA = armorOf('chest');
    const legsA = armorOf('legs'), bootsA = armorOf('boots');

    const SKIN = '#e0a479', SKIN_D = '#c98f66';
    const SHIRT = chestA || '#4f7fc4', SHIRT_D = chestA ? '#00000033' : '#3f68a6';
    const PANTS = legsA || '#3c4a6b', BOOT = bootsA || '#5a4632';
    const HAIR = helm || '#6b4a2f';

    // health/hunger bars under the doll give the portrait a purpose
    const hpPct = Math.max(0, Math.min(1, p.health / p.maxHealth)) * 100;
    const fdPct = Math.max(0, Math.min(1, p.hunger / p.maxHunger)) * 100;

    return `<div class="playerdoll">
      <svg viewBox="0 0 32 52" shape-rendering="crispEdges" aria-label="Player preview">
        <ellipse cx="16" cy="50" rx="10" ry="2" fill="#00000030"/>
        <!-- legs -->
        <rect x="11" y="34" width="4" height="10" fill="${PANTS}"/>
        <rect x="17" y="34" width="4" height="10" fill="${PANTS}"/>
        <rect x="11" y="44" width="4" height="4" fill="${BOOT}"/>
        <rect x="17" y="44" width="4" height="4" fill="${BOOT}"/>
        <!-- arms -->
        <rect x="6"  y="20" width="4" height="13" fill="${SHIRT}"/>
        <rect x="22" y="20" width="4" height="13" fill="${SHIRT}"/>
        <rect x="6"  y="30" width="4" height="3"  fill="${SKIN}"/>
        <rect x="22" y="30" width="4" height="3"  fill="${SKIN}"/>
        <!-- torso -->
        <rect x="10" y="20" width="12" height="14" fill="${SHIRT}"/>
        <rect x="10" y="20" width="12" height="2"  fill="${SHIRT_D}"/>
        <!-- head -->
        <rect x="9"  y="6"  width="14" height="14" fill="${SKIN}"/>
        <rect x="9"  y="6"  width="14" height="3"  fill="${HAIR}"/>
        <rect x="9"  y="6"  width="2"  height="8"  fill="${HAIR}"/>
        <rect x="21" y="6"  width="2"  height="8"  fill="${HAIR}"/>
        <rect x="9"  y="18" width="14" height="2"  fill="${SKIN_D}"/>
        <!-- face -->
        <rect x="12" y="12" width="2" height="2" fill="#2b2f3a"/>
        <rect x="18" y="12" width="2" height="2" fill="#2b2f3a"/>
        <rect x="14" y="16" width="4" height="1" fill="#b87d59"/>
        ${helm ? `<rect x="8" y="5" width="16" height="4" fill="${helm}"/>` : ''}
      </svg>
      <div class="dollbars">
        <div class="dollbar hp"><i style="width:${hpPct}%"></i></div>
        <div class="dollbar fd"><i style="width:${fdPct}%"></i></div>
      </div>
    </div>`;
  }

  _invScreen() {
    const p = this.game.player;
    const creative = this.isCreative();
    if (!creative) this.inventoryTab = 'inventory';
    this.refreshCraftResult();
    const inventoryOpen = this.inventoryTab === 'inventory';
    const tabs = `<div class="inventory-tabs">
      <button class="itab ${inventoryOpen ? 'on' : ''}" data-itab="inventory">Inventory</button>
      ${creative ? CREATIVE_CATS.map(c => `<button class="itab ${this.inventoryTab === c.id ? 'on' : ''}"
        data-itab="${c.id}">${c.n}</button>`).join('') : ''}
    </div>`;
    const inventory = `<div class="inv-layout${this.showBook ? ' withbook' : ''}">
      ${this._armorPanel()}
      <div class="invmain">
        <div class="invtop">
          ${this._playerPreview()}
          <div class="invcraft">
            <div class="secline">Crafting ${this._bookBtn()}</div>
            ${this._craftArea(2)}
            <div class="charstats mini">
              <div><span>Level</span><b>${p.level}</b></div>
              <div><span>Mined</span><b>${p.stats.mined}</b></div>
              <div><span>Placed</span><b>${p.stats.placed}</b></div>
            </div>
          </div>
        </div>
        <div class="secline">Backpack</div>
        ${this._invGrid(HOTBAR, INV_SIZE)}
      </div>
      ${this._recipeBook()}
    </div>`;
    const tabContent = inventoryOpen ? inventory : this._creativePanel();
    return `<div class="panel wide tabbed-panel" id="invPanel">
      <div class="phead"><h2>Inventory &amp; Items</h2><button class="x" data-act="close">✕</button></div>
      <div class="pbody inventory-shell">
        ${tabs}
        <div class="inventory-tab-content">${tabContent}</div>
        <div class="pinned-hotbar"><div class="secline">Quick Bar</div>${this._invGrid(0, HOTBAR, 'hot')}</div>
      </div>
      <div class="pfoot">Left click takes or moves · Right click splits · Shift+click quick-moves · <b>E</b> close</div>
    </div>`;
  }

  /**
   * Grid size for the current screen, exactly like Minecraft:
   *   inventory ('inventory') -> 2x2 personal grid
   *   crafting table ('craft') -> full 3x3 grid
   */
  gridSize() { return this.screen === 'craft' ? 3 : 2; }

  /** true when the active grid may use bench-only recipes */
  benchMode() { return this.screen === 'craft'; }

  /** read the active sub-grid out of the 3x3 backing store */
  gridCells() {
    const n = this.gridSize();
    const out = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push(this.craftGrid[r * 3 + c]);
    return out;
  }
  gridIndex(i) {   // sub-grid index -> backing-store index
    const n = this.gridSize();
    return ((i / n) | 0) * 3 + (i % n);
  }

  /** recompute the output slot from the current grid */
  refreshCraftResult() {
    const n = this.gridSize();
    const rec = matchGrid(this.gridCells(), n, this.benchMode());
    this.craftMatch = rec || null;
    this.craftResult = rec ? mkStack(rec.out, rec.count) : null;
  }

  /** consume one of every ingredient in the grid (after a craft) */
  consumeGrid() {
    for (let i = 0; i < 9; i++) {
      const s = this.craftGrid[i];
      if (!s) continue;
      s.count--;
      if (s.count <= 0) this.craftGrid[i] = null;
    }
    this.refreshCraftResult();
  }

  /**
   * Called when the 3x3 grid shrinks to 2x2 (player left the bench):
   * return any items outside the top-left 2x2 corner to the inventory.
   */
  shrinkCraftGrid() {
    const keep = new Set([0, 1, 3, 4]);   // top-left 2x2 of the 3x3 store
    for (let i = 0; i < 9; i++) {
      if (keep.has(i)) continue;
      const st = this.craftGrid[i];
      if (!st) continue;
      if (st.preview) { this.craftGrid[i] = null; continue; }
      const added = this.game.player.inv.add(st.id, st.count);
      if (added < st.count) {
        const p = this.game.player;
        this.game.itemDrops.spawn(p.pos.x, p.pos.y + 0.6, p.pos.z, st.id, st.count - added);
      }
      this.craftGrid[i] = null;
    }
    this.refreshCraftResult();
  }

  /** return everything in the grid to the inventory (on close) */
  clearCraftGrid() {
    for (let i = 0; i < 9; i++) {
      const s = this.craftGrid[i];
      if (!s) continue;
      if (s.preview) { this.craftGrid[i] = null; continue; }
      const added = this.game.player.inv.add(s.id, s.count);
      if (added < s.count) {
        // no room: drop the remainder at the player's feet
        const p = this.game.player;
        this.game.itemDrops.spawn(p.pos.x, p.pos.y + 0.6, p.pos.z, s.id, s.count - added);
      }
      this.craftGrid[i] = null;
    }
    this.craftResult = null;
    this.craftMatch = null;
  }

  /**
   * Auto-fill the grid from inventory for a recipe clicked in the book.
   * Returns false when the player lacks the materials.
   */
  fillFromRecipe(rec) {
    const n = this.gridSize();
    if (rec.bench && !this.benchMode()) return false;
    // put current grid contents back first
    this.clearCraftGrid();
    const inv = this.game.player.inv;
    const preview = this.isCreative();
    const take = (ing) => {
      if (preview) return isTag(ing) ? TAGS[ing][0] : ing;
      for (let i = 0; i < inv.slots.length; i++) {
        const s = inv.slots[i];
        if (!s || s.dur !== undefined) continue;
        if (!ingredientMatches(ing, s.id)) continue;
        const id = s.id;
        s.count--;
        if (s.count <= 0) inv.slots[i] = null;
        return id;
      }
      return null;
    };
    const placed = [];
    let ok = true;
    if (rec.shaped) {
      // find the trimmed pattern box
      const rows = rec.rows;
      let pMinR = 99, pMinC = 99, pMaxR = -1, pMaxC = -1;
      for (let r = 0; r < rows.length; r++)
        for (let c = 0; c < rows[r].length; c++) {
          if (rows[r][c] === ' ') continue;
          pMinR = Math.min(pMinR, r); pMaxR = Math.max(pMaxR, r);
          pMinC = Math.min(pMinC, c); pMaxC = Math.max(pMaxC, c);
        }
      const ph = pMaxR - pMinR + 1, pw = pMaxC - pMinC + 1;
      if (ph > n || pw > n) ok = false;
      for (let r = 0; ok && r < ph; r++) {
        for (let c = 0; c < pw; c++) {
          const ch = rows[pMinR + r][pMinC + c] || ' ';
          if (ch === ' ') continue;
          const got = take(rec.key[ch]);
          if (!got) { ok = false; break; }
          const gi = r * 3 + c;
          this.craftGrid[gi] = mkStack(got, 1);
          if (preview) this.craftGrid[gi].preview = true;
          placed.push(gi);
        }
      }
    } else {
      let slot = 0;
      outer:
      for (const [ing, cnt] of rec.need) {
        for (let k = 0; k < cnt; k++) {
          if (slot >= n * n) { ok = false; break outer; }
          const got = take(ing);
          if (!got) { ok = false; break outer; }
          const gi = ((slot / n) | 0) * 3 + (slot % n);
          this.craftGrid[gi] = mkStack(got, 1);
          if (preview) this.craftGrid[gi].preview = true;
          placed.push(gi);
          slot++;
        }
      }
    }
    if (!ok) {
      // roll back cleanly
      for (const gi of placed) {
        const s = this.craftGrid[gi];
        if (s && !s.preview) inv.add(s.id, s.count);
        this.craftGrid[gi] = null;
      }
      this.refreshCraftResult();
      return false;
    }
    this.refreshCraftResult();
    return true;
  }

  /** True when the creative item palette should replace the survival crafting UI. */
  isCreative() { return this.game.mode === 'creative' || this.game.player.creative; }

  /**
   * The Creative palette: every block and item in the game, in utility
   * categories. Clicking a tile puts a full stack on the cursor (or straight
   * into the hotbar with shift), so builders can grab anything instantly.
   */
  _creativePanel() {
    const f = this.creativeFilter.toLowerCase();
    if (CREATIVE_PALETTE[this.inventoryTab]) this.creativeCat = this.inventoryTab;
    let ids = CREATIVE_PALETTE[this.creativeCat] || [];
    if (f) {
      // searching looks across every category, like the real thing
      ids = [];
      for (const c of CREATIVE_CATS) {
        for (const id of (CREATIVE_PALETTE[c.id] || [])) {
          if (itemName(id).toLowerCase().includes(f) || id.includes(f)) ids.push(id);
        }
      }
    }
    const cells = ids.map(id =>
      `<div class="slot filled cslot" data-src="creative" data-item="${id}"
        title="${itemName(id)}">${slotInner({ id, count: 1 })}</div>`).join('')
      || `<div class="empty">No items match \u201c${this.creativeFilter}\u201d.</div>`;
    return `<div class="creativebox">
      <div class="chead">
        <b>${f ? 'Search results' : (CREATIVE_CATS.find(c => c.id === this.creativeCat) || {}).n}</b>
        <span class="ccount">${ids.length} items</span>
        <input id="creativeSearch" placeholder="Search all items\u2026" value="${this.creativeFilter}">
      </div>
      <div class="cpalette">${cells}</div>
      <div class="chint">Click for a full stack \u00b7 <b>Shift+click</b> sends it to the quick bar</div>
    </div>`;
  }

  /** Grid + arrow + result slot markup, shared by the inventory 2x2 and table 3x3. */
  _craftArea(n) {
    let cells = '';
    for (let i = 0; i < n * n; i++) {
      const st = this.craftGrid[this.gridIndex(i)];
      cells += `<div class="slot ${st ? 'filled' : ''}" data-src="craft" data-i="${i}">${st ? slotInner(st) : ''}</div>`;
    }
    const res = this.craftResult;
    return `<div class="craftbench">
      <div class="cgrid g${n}">${cells}</div>
      <div class="carrow">\u2192</div>
      <div class="cresult">
        <div class="slot big result ${res ? 'filled' : ''}" data-src="craftout" data-i="0">${res ? slotInner(res) : ''}</div>
        <div class="rlabel">${res ? itemName(res.id) : ''}</div>
      </div>
    </div>`;
  }

  /** The collapsible recipe book, opened by the book icon next to the grid. */
  _recipeBook() {
    if (!this.showBook) return '';
    const bench = this.benchMode();
    const creative = this.isCreative();
    const list = RECIPES
      .filter(r => r.cat === this.craftCat)
      // Survival recipe discovery: one known ingredient reveals a recipe. This
      // keeps the book useful without exposing the entire tech tree on day one.
      .filter(r => creative || r.need.some(([id]) => this.game.countFor(id) > 0))
      .filter(r => !this.craftFilter || itemName(r.out).toLowerCase().includes(this.craftFilter.toLowerCase()));
    const cats = CATS.map(c =>
      `<button class="cat ${c === this.craftCat ? 'on' : ''}" data-cat="${c}">${capitalize(c)}</button>`).join('');
    const rows = list.map(r => {
      const locked = r.bench && !bench;
      const canFill = !locked && (creative || r.need.every(([id, cnt]) => this.game.countFor(id) >= cnt));
      const mini = r.shaped ? recipeMiniGrid(r) : shapelessMini(r);
      const needs = r.need.map(([id, cnt]) => {
        const have = this.game.countFor(id);
        const label = isTag(id) ? tagLabel(id) : itemName(id);
        const enough = creative || have >= cnt;
        return `<span class="ing ${enough ? 'ok' : 'no'}">${label} <b>${creative ? '∞' : have}/${cnt}</b></span>`;
      }).join('');
      return `<div class="recipe ${canFill ? '' : 'dim'}" data-fill="${r.id}" title="Click to auto-fill the grid">
        <div class="rmini">${mini}</div>
        <div class="rinfo">
          <div class="rname">${itemName(r.out)}${r.count > 1 ? ` \u00d7${r.count}` : ''}
            ${locked ? '<em class="lock">table</em>' : ''}${r.shaped ? '' : '<em class="shapeless">shapeless</em>'}</div>
          <div class="ring">${needs}</div>
        </div>
        <div class="ricon">${slotInner({ id: r.out, count: r.count })}</div>
      </div>`;
    }).join('') || `<div class="empty">Nothing here yet \u2014 gather more materials.</div>`;
    return `<div class="craftright">
      <div class="bookhead"><b>Recipe Book</b>
        <input id="craftSearch" placeholder="Search\u2026" value="${this.craftFilter}"></div>
      <div class="cats">${cats}</div>
      <div class="reclist">${rows}</div>
    </div>`;
  }

  /** The little book button that shows/hides the recipe book. */
  _bookBtn() {
    return `<button class="bookbtn ${this.showBook ? 'on' : ''}" data-act="book"
      title="${this.showBook ? 'Hide' : 'Show'} recipe book">\ud83d\udcd6</button>`;
  }

  _craftScreen() {
    this.refreshCraftResult();
    return `<div class="panel wide tabbed-panel" id="craftPanel">
      <div class="phead"><h2>Crafting Table</h2>
        <button class="x" data-act="close">\u2715</button></div>
      <div class="pbody inventory-shell">
        <div class="inventory-tabs"><button class="itab on">Crafting</button></div>
        <div class="inventory-tab-content craft-layout2">
          <div class="craftleft">
            <div class="secline">3 \u00d7 3 Grid</div>
            <div class="craftrow">
              ${this._bookBtn()}
              ${this._craftArea(3)}
            </div>
            <div class="secline">Backpack</div>
            ${this._invGrid(HOTBAR, INV_SIZE)}
          </div>
          ${this._recipeBook()}
        </div>
        <div class="pinned-hotbar"><div class="secline">Quick Bar</div>${this._invGrid(0, HOTBAR, 'hot')}</div>
      </div>
      <div class="pfoot">Left click moves items \u00b7 <b>Shift+click</b> the result crafts all \u00b7 <b>C</b> close</div>
    </div>`;
  }

  _crateScreen() {
    const c = this.openContainer;
    let h = '';
    for (let i = 0; i < c.items.length; i++) {
      h += `<div class="slot ${c.items[i] ? 'filled' : ''}" data-src="cont" data-i="${i}">${c.items[i] ? slotInner(c.items[i]) : ''}</div>`;
    }
    return `<div class="panel" id="cratePanel">
      <div class="phead"><h2>Chest</h2><button class="x" data-act="close">✕</button></div>
      <div class="pbody">
        <div class="grid cont">${h}</div>
        <div class="secline">Satchel</div>
        ${this._invGrid(HOTBAR, INV_SIZE)}
        ${this._invGrid(0, HOTBAR, 'hot')}
      </div>
      <div class="pfoot">Shift+click to quick-transfer · <b>Esc</b> close</div>
    </div>`;
  }

  _smelterScreen() {
    const c = this.openContainer;
    const burnPct = c.burnMax ? (c.burn / c.burnMax) * 100 : 0;
    const cookPct = c.cook ? Math.min(100, c.cook / smeltTime(c) * 100) : 0;
    return `<div class="panel" id="smelterPanel">
      <div class="phead"><h2>Smelter</h2><button class="x" data-act="close">✕</button></div>
      <div class="pbody">
        <div class="smelt">
          <div class="scol">
            <div class="slbl">Input</div>
            <div class="slot ${c.input ? 'filled' : ''}" data-src="smelt" data-i="input">${c.input ? slotInner(c.input) : ''}</div>
            <div class="flame"><i style="height:${burnPct}%"></i></div>
            <div class="slbl">Fuel</div>
            <div class="slot ${c.fuel ? 'filled' : ''}" data-src="smelt" data-i="fuel">${c.fuel ? slotInner(c.fuel) : ''}</div>
          </div>
          <div class="arrowcol">
            <div class="progress"><i style="width:${cookPct}%"></i></div>
            <div class="ptext">${c.burn > 0 ? 'Smelting…' : 'Idle'}</div>
          </div>
          <div class="scol">
            <div class="slbl">Output</div>
            <div class="slot big ${c.out ? 'filled' : ''}" data-src="smelt" data-i="out">${c.out ? slotInner(c.out) : ''}</div>
          </div>
        </div>
        <div class="secline">Satchel</div>
        ${this._invGrid(HOTBAR, INV_SIZE)}
        ${this._invGrid(0, HOTBAR, 'hot')}
      </div>
      <div class="pfoot">Add ore + fuel (coal, charcoal, wood) · <b>Esc</b> close</div>
    </div>`;
  }

  _pauseScreen() {
    const g = this.game;
    return `<div class="panel narrow" id="pausePanel">
      <div class="phead"><h2>Paused</h2></div>
      <div class="pbody menu">
        <button class="bigbtn" data-act="close">Resume</button>
        <button class="bigbtn" data-act="guide">Field Guide</button>
        <button class="bigbtn" data-act="map">World Map</button>
        <button class="bigbtn" data-act="save">Save World</button>
        <div class="opts">
          <label>Render distance <input type="range" min="3" max="12" value="${g.world.renderDist}" data-opt="rd"><b>${g.world.renderDist}</b></label>
          <label>Master volume <input type="range" min="0" max="100" value="${Math.round(g.audio.volume * 100)}" data-opt="vol"><b>${Math.round(g.audio.volume * 100)}</b></label>
          <label>Music <input type="range" min="0" max="100" value="${Math.round(g.audio.musicVolume * 100)}" data-opt="mus"><b>${Math.round(g.audio.musicVolume * 100)}</b></label>
          <label>Sensitivity <input type="range" min="20" max="300" value="${Math.round(g.sensitivity * 100)}" data-opt="sens"><b>${Math.round(g.sensitivity * 100)}</b></label>
          <label>FOV <input type="range" min="60" max="110" value="${g.fov}" data-opt="fov"><b>${g.fov}</b></label>
          <label class="chk"><input type="checkbox" data-opt="creative" ${g.player.creative ? 'checked' : ''}> Creative mode (fly, no damage)</label>
          <label class="chk"><input type="checkbox" data-opt="invert" ${g.invertY ? 'checked' : ''}> Invert vertical look</label>
          <label class="chk"><input type="checkbox" data-opt="autoq" ${g.autoQuality !== false ? 'checked' : ''}> Auto quality (scale resolution to keep frames smooth)</label>
        </div>
        <button class="bigbtn danger" data-act="quit">Save &amp; Exit to Title</button>
      </div>
      <div class="pfoot">Seed <b>${g.seedText}</b> · World "<b>${g.worldName}</b>"</div>
    </div>`;
  }

  _mapScreen() {
    return `<div class="panel wide" id="mapPanel">
      <div class="phead"><h2>World Map</h2><button class="x" data-act="close">✕</button></div>
      <div class="pbody"><canvas id="mapCanvas" width="640" height="640"></canvas>
      <div class="maplegend" id="mapLegend"></div></div>
      <div class="pfoot">Explored terrain within streaming range · <b>M</b> close</div>
    </div>`;
  }

  _guideScreen() {
    return `<div class="panel wide" id="guidePanel">
      <div class="phead"><h2>Field Guide</h2><button class="x" data-act="close">✕</button></div>
      <div class="pbody guide">
        <section><h3>First Minutes</h3>
          <ol>
            <li>Punch <b>trees</b> for logs → craft <b>Planks</b> → <b>Sticks</b>.</li>
            <li>Craft an <b>Crafting Table</b> (4 planks) and place it with right click.</li>
            <li>Make a <b>Timber Pick</b>, mine <b>Stone</b> for Rubble, upgrade to <b>Stone tools</b>.</li>
            <li>Craft <b>Torches</b> (stick + coal) before nightfall — hostiles spawn in the dark.</li>
            <li>Build a shelter or dig in. Sunrise is safe.</li>
          </ol></section>
        <section><h3>Tool Tiers</h3>
          <p>Timber → Stone → Copper → Iron → <b>Aurorite</b>. Each tier mines faster and unlocks
          tougher blocks:</p>
          <ul>
            <li><b>Timber pick</b> → stone, coal</li>
            <li><b>Stone pick</b> → copper</li>
            <li><b>Copper pick</b> → iron</li>
            <li><b>Iron pick</b> → gold, aurorite</li>
            <li><b>Aurorite pick</b> → glimmer clusters</li>
          </ul>
          <p>Use the right tool type too — a pick will not harvest wood, and an axe will not
          harvest ore.</p></section>
        <section><h3>The Deep</h3>
          <p>Below y=26 you'll find Iron and Gold. Below y=14, <b>Aurorite Geodes</b> glow teal and
          <b>Glimmer Clusters</b> shine violet. Lava pools sit near bedrock — bring blocks to bridge.</p></section>
        <section><h3>Creatures</h3>
          <div class="creaturegrid">
            <div><b>Hopper</b><span>Timid forager. Meat + hide.</span></div>
            <div><b>Woolback</b><span>Grazer. Shear for wool.</span></div>
            <div><b>Tusker</b><span>Peaceful until struck. Hits hard.</span></div>
            <div><b>Plume</b><span>Bird. Feathers.</span></div>
            <div class="bad"><b>Husk</b><span>Night walker. Burns at dawn.</span></div>
            <div class="bad"><b>Creeplet</b><span>Lunges from the dark.</span></div>
            <div class="bad"><b>Shardling</b><span>Cave sniper, throws shards.</span></div>
            <div class="bad"><b>Gloom</b><span>Deep floater. Very dangerous.</span></div>
          </div></section>
        <section><h3>Controls</h3>
          <div class="keys">
            <div><kbd>W A S D</kbd> move</div><div><kbd>Space</kbd> jump</div>
            <div><kbd>Shift</kbd> sneak</div><div><kbd>Ctrl</kbd> sprint</div>
            <div><kbd>LMB</kbd> mine / attack</div><div><kbd>RMB</kbd> place / use</div>
            <div><kbd>1–9</kbd> hotbar</div><div><kbd>Wheel</kbd> cycle</div>
            <div><kbd>E</kbd> satchel</div><div><kbd>C</kbd> crafting</div>
            <div><kbd>M</kbd> map</div><div><kbd>F</kbd> eat held food</div>
            <div><kbd>Q</kbd> drop item</div><div><kbd>G</kbd> guide</div>
            <div><kbd>F5</kbd> camera view</div><div><kbd>Esc</kbd> pause</div>
            <div><kbd>Gamepad</kbd> full support</div><div><kbd>F3</kbd> debug stats</div>
          </div></section>
      </div>
      <div class="pfoot"><b>G</b> close</div>
    </div>`;
  }

  // ------------------------------------------------------------- wiring
  _wire() {
    const g = this.game;
    $$('[data-act]', this.screensEl).forEach(b => {
      b.onclick = () => {
        const a = b.dataset.act;
        g.audio.click();
        if (a === 'close') { this.close(); g.requestPointerLock(); }
        else if (a === 'save') { g.save(); this.toast('World saved.', 'good'); }
        else if (a === 'quit') { g.save(); g.exitToTitle(); }
        else if (a === 'guide') { this.close(); this.open('guide'); }
        else if (a === 'map') { this.close(); this.open('map'); }
        else if (a === 'book') { this.showBook = !this.showBook; this.render(); }
      };
    });
    // ---- inventory / creative category tabs
    $$('[data-itab]', this.screensEl).forEach(b => {
      b.onclick = () => {
        this.inventoryTab = b.dataset.itab;
        if (CREATIVE_PALETTE[this.inventoryTab]) this.creativeCat = this.inventoryTab;
        this.showBook = false;
        g.audio.click();
        this.render();
      };
    });
    // legacy creative category controls (kept for compact/mobile layouts)
    $$('[data-ccat]', this.screensEl).forEach(b => {
      b.onclick = () => { this.creativeCat = b.dataset.ccat; g.audio.click(); this.render(); };
    });
    const csearch = $('#creativeSearch', this.screensEl);
    if (csearch) {
      csearch.oninput = () => { this.creativeFilter = csearch.value; this.render(); };
      csearch.onkeydown = (e) => e.stopPropagation();
    }
    $$('.cat', this.screensEl).forEach(b => {
      b.onclick = () => { this.craftCat = b.dataset.cat; g.audio.click(); this.render(); };
    });
    $$('[data-fill]', this.screensEl).forEach(b => {
      b.onclick = () => {
        const r = RECIPES.find(x => x.id === b.dataset.fill);
        if (!r) return;
        if (r.bench && !this.benchMode()) {
          g.audio.error();
          this.toast('This recipe needs a Crafting Table.', 'bad');
        } else if (this.fillFromRecipe(r)) { g.audio.click(); }
        else { g.audio.error(); this.toast('Not enough materials.', 'bad'); }
        this.render();
      };
    });
    const search = $('#craftSearch', this.screensEl);
    if (search) {
      search.oninput = () => { this.craftFilter = search.value; this.render(); };
      search.onkeydown = e => e.stopPropagation();
    }
    $$('[data-opt]', this.screensEl).forEach(inp => {
      const apply = () => {
        const k = inp.dataset.opt;
        if (k === 'rd') { g.world.renderDist = +inp.value; g.updateFog(); }
        else if (k === 'vol') g.audio.setVolume(+inp.value / 100);
        else if (k === 'mus') g.audio.setMusicVolume(+inp.value / 100);
        else if (k === 'sens') g.sensitivity = +inp.value / 100;
        else if (k === 'fov') { g.fov = +inp.value; g.camera.fov = g.fov; g.camera.updateProjectionMatrix(); }
        else if (k === 'creative') { g.player.creative = inp.checked; g.player.flying = inp.checked && g.player.flying; }
        else if (k === 'invert') g.invertY = inp.checked;
        else if (k === 'autoq') {
          g.autoQuality = inp.checked;
          if (!inp.checked) {           // restore full resolution immediately
            g._pixelRatio = g._maxPixelRatio;
            g.renderer.setPixelRatio(g._pixelRatio);
            g._onResize();
          }
        }
        const b = inp.parentElement.querySelector('b');
        if (b) b.textContent = inp.value;
        g.saveSettings();
      };
      inp.oninput = apply;
      inp.onchange = apply;
    });

    if (this.screen === 'map') this.game.drawMap($('#mapCanvas'), $('#mapLegend'));
  }

  _onSlotMouse(e) {
    const slot = e.target.closest('.slot');
    if (!slot || !slot.dataset.src) return;
    e.preventDefault();
    e.stopPropagation();
    const src = slot.dataset.src;
    const idx = slot.dataset.i ?? slot.dataset.item;
    const right = e.button === 2;
    const shift = e.shiftKey;
    this.game.audio.click();
    this._slotClick(src, idx, right, shift);
    this.render();
    this._updateCursorGhost();
  }

  _getSlot(src, idx) {
    const p = this.game.player;
    if (src === 'inv') return p.inv.slots[+idx];
    if (src === 'armor') return p.armor[idx];
    if (src === 'cont') return this.openContainer.items[+idx];
    if (src === 'smelt') return this.openContainer[idx];
    if (src === 'craft') return this.craftGrid[this.gridIndex(+idx)];
    if (src === 'craftout') return this.craftResult;
    return null;
  }
  _setSlot(src, idx, v) {
    const p = this.game.player;
    if (src === 'inv') p.inv.slots[+idx] = v;
    else if (src === 'armor') p.armor[idx] = v;
    else if (src === 'cont') this.openContainer.items[+idx] = v;
    else if (src === 'smelt') this.openContainer[idx] = v;
    else if (src === 'craft') { this.craftGrid[this.gridIndex(+idx)] = v; this.refreshCraftResult(); }
  }

  _slotClick(src, idx, right, shift) {
    const p = this.game.player;

    // Creative catalogue: primary/left click takes a full stack; secondary
    // click takes one. Handling this in the shared mouse-down path avoids the
    // old right-click-only feel and works consistently with touch emulation.
    if (src === 'creative') {
      const id = idx;
      const count = right ? 1 : stackMax(id);
      const stack = mkStack(id, count);
      const d = itemDef(id);
      if (d && d.dur) stack.dur = d.dur;
      if (shift) p.inv.slots[p.hotbarIdx] = stack;
      else if (this.cursorStack && this.cursorStack.id === id && !this.cursorStack.dur)
        this.cursorStack.count = Math.min(stackMax(id), this.cursorStack.count + count);
      else {
        if (this.cursorStack) p.inv.add(this.cursorStack.id, this.cursorStack.count);
        this.cursorStack = stack;
      }
      return;
    }

    let cur = this._getSlot(src, idx);

    // ---- crafting result: take the crafted item, consuming the grid
    if (src === 'craftout') {
      if (!this.craftResult || !this.craftMatch) return;
      const make = () => {
        const out = this.craftResult;
        if (this.cursorStack) {
          if (this.cursorStack.id !== out.id || this.cursorStack.dur !== undefined) return false;
          if (this.cursorStack.count + out.count > stackMax(out.id)) return false;
          this.cursorStack.count += out.count;
        } else {
          this.cursorStack = mkStack(out.id, out.count);
        }
        this.consumeGrid();
        return true;
      };
      if (shift) {
        // craft as many as the grid allows, straight into the inventory
        let made = 0;
        while (this.craftResult && this.craftMatch && made < 512) {
          const out = this.craftResult;
          const added = p.inv.add(out.id, out.count);
          if (added <= 0) break;
          this.consumeGrid();
          made += added;
        }
        if (made) { this.game.audio.craft(); this.game.player.stats.crafted += made; }
        return;
      }
      if (make()) { this.game.audio.craft(); p.stats.crafted++; }
      return;
    }

    // output slot: take only
    if (src === 'smelt' && idx === 'out') {
      if (!cur) return;
      if (this.cursorStack) {
        if (this.cursorStack.id === cur.id) {
          const room = stackMax(cur.id) - this.cursorStack.count;
          const n = Math.min(room, cur.count);
          this.cursorStack.count += n; cur.count -= n;
          if (cur.count <= 0) this._setSlot(src, idx, null);
        }
        return;
      }
      if (shift) { p.inv.add(cur.id, cur.count); this._setSlot(src, idx, null); return; }
      this.cursorStack = cur; this._setSlot(src, idx, null);
      return;
    }

    // shift quick-move
    if (shift && cur) {
      if (src === 'craft') {           // grid -> inventory
        const added = p.inv.add(cur.id, cur.count);
        if (added >= cur.count) this._setSlot(src, idx, null);
        else { cur.count -= added; this.refreshCraftResult(); }
        return;
      }
      if (src === 'inv' && this.screen === 'craft') {   // inventory -> first free grid cell
        const n = this.gridSize();
        for (let i = 0; i < n * n; i++) {
          const gi = this.gridIndex(i);
          if (!this.craftGrid[gi]) {
            this.craftGrid[gi] = mkStack(cur.id, 1, cur.dur);
            cur.count--;
            if (cur.count <= 0) p.inv.slots[+idx] = null;
            this.refreshCraftResult();
            return;
          }
        }
        return;
      }
      if (src === 'inv') {
        if (this.openContainer && this.screen === 'crate') {
          const moved = addToContainer(this.openContainer.items, cur);
          if (moved) this._setSlot(src, idx, cur.count > 0 ? cur : null);
        } else if (this.screen === 'smelter') {
          const c = this.openContainer;
          const isFuel = FUEL[cur.id] !== undefined;
          const target = SMELT[cur.id] ? 'input' : (isFuel ? 'fuel' : null);
          if (target) {
            const t = c[target];
            if (!t) { c[target] = cur; this._setSlot(src, idx, null); }
            else if (t.id === cur.id) {
              const room = stackMax(t.id) - t.count;
              const n = Math.min(room, cur.count);
              t.count += n; cur.count -= n;
              if (cur.count <= 0) this._setSlot(src, idx, null);
            }
          }
        } else {
          // armor auto-equip / hotbar<->backpack
          const d = itemDef(cur.id);
          if (d && d.slot) {
            const prev = p.armor[d.slot];
            p.armor[d.slot] = cur;
            this._setSlot(src, idx, prev || null);
          } else {
            const i = +idx;
            const to = i < HOTBAR ? [HOTBAR, INV_SIZE] : [0, HOTBAR];
            for (let k = to[0]; k < to[1]; k++) {
              const t = p.inv.slots[k];
              if (t && t.id === cur.id && !t.dur && t.count < stackMax(t.id)) {
                const room = stackMax(t.id) - t.count;
                const n = Math.min(room, cur.count);
                t.count += n; cur.count -= n;
                if (cur.count <= 0) { p.inv.slots[i] = null; break; }
              }
            }
            if (cur.count > 0) {
              for (let k = to[0]; k < to[1]; k++) {
                if (!p.inv.slots[k]) { p.inv.slots[k] = cur; p.inv.slots[+idx] = null; break; }
              }
            }
          }
        }
      } else {
        // container -> inventory
        const added = p.inv.add(cur.id, cur.count);
        if (added >= cur.count) this._setSlot(src, idx, null);
        else cur.count -= added;
      }
      return;
    }

    // armor slot validation
    if (src === 'armor' && this.cursorStack) {
      const d = itemDef(this.cursorStack.id);
      if (!d || d.slot !== idx) { this.game.audio.error(); return; }
    }
    // smelter input validation
    if (src === 'smelt' && this.cursorStack) {
      if (idx === 'fuel' && FUEL[this.cursorStack.id] === undefined) { this.game.audio.error(); return; }
      if (idx === 'input' && !SMELT[this.cursorStack.id]) { this.game.audio.error(); return; }
    }

    if (right) {
      if (this.cursorStack) {
        // place one
        if (!cur) { this._setSlot(src, idx, mkStack(this.cursorStack.id, 1, this.cursorStack.dur)); this.cursorStack.count--; }
        else if (cur.id === this.cursorStack.id && cur.count < stackMax(cur.id) && !cur.dur) { cur.count++; this.cursorStack.count--; }
        if (this.cursorStack.count <= 0) this.cursorStack = null;
      } else if (cur) {
        // split half
        const half = Math.ceil(cur.count / 2);
        this.cursorStack = mkStack(cur.id, half, cur.dur);
        cur.count -= half;
        if (cur.count <= 0) this._setSlot(src, idx, null);
      }
      return;
    }

    // left click swap / merge
    if (this.cursorStack && cur && cur.id === this.cursorStack.id && !cur.dur && cur.count < stackMax(cur.id)) {
      const room = stackMax(cur.id) - cur.count;
      const n = Math.min(room, this.cursorStack.count);
      cur.count += n; this.cursorStack.count -= n;
      if (this.cursorStack.count <= 0) this.cursorStack = null;
      return;
    }
    const tmp = this.cursorStack;
    this.cursorStack = cur || null;
    this._setSlot(src, idx, tmp || null);
  }

  _updateCursorGhost() {
    let el = $('#cursorStack');
    if (!this.cursorStack) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'cursorStack';
      document.body.appendChild(el);
    }
    el.innerHTML = slotInner(this.cursorStack);
    el.style.left = (this._mx || 0) + 'px';
    el.style.top = (this._my || 0) + 'px';
  }
}

function slotInner(stack) {
  const d = itemDef(stack.id);
  const durBar = (stack.dur !== undefined && d && d.dur)
    ? `<div class="dur"><i style="width:${Math.max(0, Math.min(100, stack.dur / d.dur * 100))}%;background:${durColor(stack.dur / d.dur)}"></i></div>` : '';
  const cnt = stack.count > 1 ? `<span class="cnt">${stack.count}</span>` : '';
  return `<img src="${itemIcon(stack.id)}" alt="" draggable="false" title="${itemName(stack.id)}">${cnt}${durBar}`;
}

function addToContainer(items, stack) {
  const max = stackMax(stack.id);
  let moved = false;
  for (let i = 0; i < items.length && stack.count > 0; i++) {
    const t = items[i];
    if (t && t.id === stack.id && !t.dur && t.count < max) {
      const n = Math.min(max - t.count, stack.count);
      t.count += n; stack.count -= n; moved = true;
    }
  }
  for (let i = 0; i < items.length && stack.count > 0; i++) {
    if (!items[i]) { items[i] = mkStack(stack.id, stack.count, stack.dur); stack.count = 0; moved = true; }
  }
  return moved;
}

function smeltTime(c) {
  return 5.0;
}
/** small visual of a shaped recipe's pattern, for the recipe book */
function recipeMiniGrid(r) {
  const rows = r.rows;
  let minR = 99, minC = 99, maxR = -1, maxC = -1;
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x] === ' ') continue;
      minR = Math.min(minR, y); maxR = Math.max(maxR, y);
      minC = Math.min(minC, x); maxC = Math.max(maxC, x);
    }
  const h = maxR - minR + 1, w = maxC - minC + 1;
  let out = `<div class="mini" style="grid-template-columns:repeat(${w},1fr)">`;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[minR + y][minC + x] || ' ';
      if (ch === ' ') { out += `<i class="mc empty"></i>`; continue; }
      const ing = r.key[ch];
      const id = isTag(ing) ? TAGS[ing][0] : ing;
      out += `<i class="mc"><img src="${itemIcon(id)}" alt=""></i>`;
    }
  }
  return out + '</div>';
}
/** shapeless recipes just list their ingredients */
function shapelessMini(r) {
  let out = '<div class="mini shapeless-mini">';
  for (const [ing] of r.need) {
    const id = isTag(ing) ? TAGS[ing][0] : ing;
    out += `<i class="mc"><img src="${itemIcon(id)}" alt=""></i>`;
  }
  return out + '</div>';
}

function capitalize(s) { return s[0].toUpperCase() + s.slice(1); }
function tagLabel(tag) {
  return { '#planks': 'Any Planks', '#logs': 'Any Log', '#wool': 'Any Wool', '#stone': 'Stone/Rubble', '#coal': 'Coal' }[tag] || tag;
}

export { addToContainer, smeltTime };
