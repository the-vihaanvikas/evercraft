// EVERCRAFT - player state, physics, inventory, survival stats.

import * as THREE from '../vendor/three.module.js';
import {
  B, BLOCKS, block, isSolid, ITEM, itemDef, miningTime, canHarvest, blockDrop,
  WORLD_H, SEA_LEVEL, ARMOR_SLOTS, LEGACY_ITEM_ALIAS,
} from './blocks.js';

export const HOTBAR = 9;
export const INV_ROWS = 3;
export const INV_COLS = 9;
export const INV_SIZE = HOTBAR + INV_ROWS * INV_COLS;

export function mkStack(id, count = 1, dur) {
  const d = itemDef(id);
  const s = { id, count };
  if (d && d.dur) s.dur = dur === undefined ? d.dur : dur;
  return s;
}
export function stackMax(id) { const d = itemDef(id); return d ? (d.stack || 64) : 64; }

export class Inventory {
  constructor(size = INV_SIZE) {
    this.slots = new Array(size).fill(null);
  }
  add(id, count = 1) {
    const max = stackMax(id);
    let left = count;
    // merge existing
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && !s.dur && s.count < max) {
        const c = Math.min(max - s.count, left);
        s.count += c; left -= c;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const c = Math.min(max, left);
        this.slots[i] = mkStack(id, c);
        left -= c;
      }
    }
    return count - left;
  }
  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }
  remove(id, count = 1) {
    let left = count;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const c = Math.min(s.count, left);
        s.count -= c; left -= c;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return count - left;
  }
  hasSpace(id, count = 1) {
    const max = stackMax(id);
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += max;
      else if (s.id === id && !s.dur) room += max - s.count;
      if (room >= count) return true;
    }
    return false;
  }
}

const PW = 0.62, PH = 1.78, EYE = 1.62;
const G = 26.5;

export class Player {
  constructor(world, audio) {
    this.world = world;
    this.audio = audio;
    this.pos = new THREE.Vector3(0, 80, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.inLava = false;
    this.headInLava = false;
    this.onLadder = false;
    this.sprinting = false;
    this.swimming = false;
    this.sneaking = false;
    this.flying = false;
    this.creative = false;
    this.health = 20; this.maxHealth = 20;
    this.hunger = 20; this.maxHunger = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = 300; this.maxAir = 300;
    this.xp = 0; this.level = 0;
    this.inv = new Inventory();
    this.armor = { helm: null, chest: null, legs: null, boots: null };
    // Off hand. Holds one stack that rides in the player's left hand; it is
    // only drawn in first person when something is actually in it.
    this.offhand = null;
    this.hotbarIdx = 0;
    this.invalidPlaceTimer = 0;
    this.mining = null;       // {x,y,z,progress,total}
    this.attackCd = 0;
    this.hurtCd = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.bobPhase = 0;
    this.swingT = 0;
    this.lastDamage = 0;
    this.spawnPoint = null;
    this.deaths = 0;
    this.deathCause = null;
    this.landed = false;       // set for one frame after a hard landing
    this.stats = { mined: 0, placed: 0, crafted: 0, killed: 0, distance: 0, deepest: 999 };
    this.fallStart = null;
    this.dead = false;
  }

  get held() { return this.inv.slots[this.hotbarIdx]; }
  get heldId() { const h = this.held; return h ? h.id : null; }
  get offhandId() { return this.offhand ? this.offhand.id : null; }

  /**
   * True when the player should be animated in a prone swimming pose: either
   * actively sprint-swimming, or simply moving through water off the floor.
   */
  get swimPose() {
    if (this.flying || !this.inWater) return false;
    if (this.swimming) return true;
    return !this.onGround && Math.hypot(this.vel.x, this.vel.z) > 1.4;
  }

  /** Swap the main-hand stack with the off-hand stack. */
  swapHands() {
    const main = this.inv.slots[this.hotbarIdx];
    this.inv.slots[this.hotbarIdx] = this.offhand || null;
    this.offhand = main || null;
  }

  /**
   * The stack an action should use, preferring the main hand and falling back
   * to the off hand. `slot` is the hotbar index or the string 'offhand', so
   * callers can consume from the right place.
   * @param {(stack:object)=>boolean} [want] optional filter
   */
  useSlot(want) {
    const main = this.held;
    if (main && (!want || want(main))) return { stack: main, slot: this.hotbarIdx };
    if (this.offhand && (!want || want(this.offhand))) return { stack: this.offhand, slot: 'offhand' };
    return { stack: null, slot: null };
  }

  /** Remove `n` items from a hotbar index or the off hand. */
  consumeSlot(slot, n = 1) {
    const s = slot === 'offhand' ? this.offhand : this.inv.slots[slot];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) {
      if (slot === 'offhand') this.offhand = null;
      else this.inv.slots[slot] = null;
    }
  }

  eyePos(out) {
    return (out || new THREE.Vector3()).set(this.pos.x, this.pos.y + EYE - (this.sneaking ? 0.22 : 0), this.pos.z);
  }

  aabbBlocked(x, y, z) {
    const w = PW / 2;
    const x0 = Math.floor(x - w), x1 = Math.floor(x + w);
    const y0 = Math.floor(y), y1 = Math.floor(y + PH - 0.001);
    const z0 = Math.floor(z - w), z1 = Math.floor(z + w);
    for (let by = y0; by <= y1; by++)
      for (let bz = z0; bz <= z1; bz++)
        for (let bx = x0; bx <= x1; bx++) {
          const id = this.world.getBlock(bx, by, bz);
          if (id > 0 && isSolid(id)) return true;
          if (id === -1) return true; // unloaded = solid
        }
    return false;
  }

  update(dt, input) {
    if (this.dead) return;
    const w = this.world;
    const feet = w.getBlock(this.pos.x, this.pos.y + 0.1, this.pos.z);
    const head = w.getBlock(this.pos.x, this.pos.y + EYE, this.pos.z);
    const wasInWater = this.inWater;
    this.inWater = feet === B.WATER || w.getBlock(this.pos.x, this.pos.y + 0.9, this.pos.z) === B.WATER;
    this.headInWater = head === B.WATER;
    // Lava is a fluid too: swimming in it must slow you down and blind you.
    this.inLava = feet === B.LAVA || w.getBlock(this.pos.x, this.pos.y + 0.9, this.pos.z) === B.LAVA;
    this.headInLava = head === B.LAVA;

    // Ladder check. Uses the `climb` flag rather than a single id so all four
    // wall-mounted ladder variants work, and checks the feet cell too so you
    // stay attached while stepping on to the bottom rung.
    const climbAt = (yy) => {
      const b = BLOCKS[w.getBlock(this.pos.x, yy, this.pos.z)];
      return !!(b && b.climb);
    };
    this.onLadder = climbAt(this.pos.y + 0.5) || climbAt(this.pos.y + 0.1);

    // -------------------------------------------------------- movement input
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (input.forward) wish.add(fwd);
    if (input.back) wish.sub(fwd);
    if (input.right) wish.add(right);
    if (input.left) wish.sub(right);
    const moving = wish.lengthSq() > 0.0001;
    if (moving) wish.normalize();
    this.swimming = this.inWater && this.sprinting && moving && !this.flying;

    let speed = 4.35;
    if (this.sneaking) speed = 1.5;
    else if (this.sprinting && moving && this.hunger > 6) speed = 6.1;
    if (this.inWater) speed *= 0.55;
    if (this.inLava) speed *= 0.32;
    if (this.flying) speed = this.sprinting ? 18 : 9;

    if (this.flying) {
      // Creative flight: pure velocity control, no gravity. Vertical speed is
      // decoupled from the horizontal sprint boost so ascending doesn't rocket
      // away, and damping is frame-rate independent.
      const k = 1 - Math.exp(-12 * dt);
      const target = wish.multiplyScalar(speed);
      this.vel.x += (target.x - this.vel.x) * k;
      this.vel.z += (target.z - this.vel.z) * k;
      const vSpeed = this.sprinting ? 11 : 6.5;
      let vy = 0;
      if (input.jump) vy += vSpeed;
      if (input.sneak) vy -= vSpeed;
      this.vel.y += (vy - this.vel.y) * k;
      // kill drift so releasing the keys stops you instead of coasting
      if (!input.jump && !input.sneak && Math.abs(this.vel.y) < 0.05) this.vel.y = 0;
      // flying can never leave a pending fall
      this.fallStart = null;
      this.onGround = false;
    } else {
      const accel = this.onGround ? 42 : 12;
      const target = wish.multiplyScalar(speed);
      this.vel.x += (target.x - this.vel.x) * Math.min(1, dt * accel / 6);
      this.vel.z += (target.z - this.vel.z) * Math.min(1, dt * accel / 6);

      if (this.inLava) {
        // lava is viscous: you sink slowly and can barely swim out
        this.vel.y -= G * 0.18 * dt;
        this.vel.y = Math.max(this.vel.y, -1.9);
        if (input.jump) this.vel.y = Math.min(this.vel.y + 16 * dt, 1.9);
      } else if (this.inWater) {
        this.vel.y -= G * 0.28 * dt;
        this.vel.y = Math.max(this.vel.y, -4.2);
        if (this.swimming && input.forward) {
          // Sprint-swimming follows the look direction instead of forcing the
          // player to bunny-hop vertically through water.
          const targetY = Math.sin(this.pitch) * 4.1;
          this.vel.y += (targetY - this.vel.y) * Math.min(1, dt * 5.5);
        }
        if (input.jump) this.vel.y = Math.min(this.vel.y + 30 * dt, 3.4);
      } else if (this.onLadder) {
        this.vel.y = input.jump ? 3.2 : (moving || input.sneak ? (input.sneak ? -2.6 : -1.2) : -0.6);
        if (input.forward) this.vel.y = 3.0;
      } else {
        this.vel.y -= G * dt;
        if (this.vel.y < -60) this.vel.y = -60;
        if (input.jump && this.onGround) {
          this.vel.y = 8.6;
          this.onGround = false;
          this.exhaustion += this.sprinting ? 0.2 : 0.05;
          this.audio.jump();
        }
      }
    }

    // ------------------------------------------------------------- collide
    const prevY = this.pos.y;
    const startPos = this.pos.clone();
    this._moveAxis(dt, 'x');
    this._moveAxis(dt, 'z');
    const wasGround = this.onGround;
    this._moveAxis(dt, 'y');

    // fall damage
    this.landed = false;
    if (!this.onGround && this.vel.y < -0.1 && this.fallStart === null) this.fallStart = prevY;
    if (this.onGround && this.fallStart !== null) {
      const dist = this.fallStart - this.pos.y;
      if (dist > 3.5 && !this.inWater && !this.flying) {
        const dmg = Math.floor(dist - 3.0);
        if (dmg > 0) this.damage(dmg, 'fall');
      }
      if (dist > 0.6) {
        const gid = this.world.getBlock(this.pos.x, this.pos.y - 0.2, this.pos.z);
        this.audio.land(matOf(gid));
        this.landed = true;   // lets the game kick up a dust puff
      }
      this.fallStart = null;
    }
    if (this.flying || this.inWater || this.onLadder) this.fallStart = null;

    // splash
    if (this.inWater && !wasInWater && Math.abs(this.vel.y) > 2) this.audio.splash();

    // -------------------------------------------------------------- stats
    const moved = startPos.distanceTo(this.pos);
    this.stats.distance += moved;
    if (this.pos.y < this.stats.deepest) this.stats.deepest = Math.floor(this.pos.y);
    // Animation phase is visual state and must advance in Creative too.
    if (moving && (this.onGround || this.swimming))
      this.bobPhase += moved * (this.sprinting ? 2.35 : 1.9);

    if (!this.creative) {
      if (moving && this.onGround) {
        this.exhaustion += (this.sprinting ? 0.10 : 0.03) * dt * 4;
        if (Math.sin(this.bobPhase * 3.1) > 0.94) {
          const gid = this.world.getBlock(this.pos.x, this.pos.y - 0.2, this.pos.z);
          this.audio.step(this.inWater ? 'water' : matOf(gid));
        }
      }
      this.exhaustion += dt * 0.012;

      if (this.exhaustion >= 4) {
        this.exhaustion -= 4;
        if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
        else if (this.hunger > 0) this.hunger--;
      }

      // regen / starve
      if (this.hunger >= 18 && this.health < this.maxHealth) {
        this.regenTimer += dt;
        if (this.regenTimer > 3.2) {
          this.regenTimer = 0;
          this.health = Math.min(this.maxHealth, this.health + 1);
          this.exhaustion += 1.2;
        }
      } else this.regenTimer = 0;

      if (this.hunger <= 0) {
        this.starveTimer += dt;
        if (this.starveTimer > 4) { this.starveTimer = 0; this.damage(1, 'starve'); }
      } else this.starveTimer = 0;

      // drowning
      if (this.headInWater) {
        this.air -= dt * 60;
        if (this.air <= 0) { this.air = 0; this.drownTimer = (this.drownTimer || 0) + dt; if (this.drownTimer > 1) { this.drownTimer = 0; this.damage(2, 'drown'); } }
      } else {
        this.air = Math.min(this.maxAir, this.air + dt * 200);
        this.drownTimer = 0;
      }

      // contact damage (lava / cactus)
      const inLava = this.world.getBlock(this.pos.x, this.pos.y + 0.4, this.pos.z) === B.LAVA;
      if (inLava) { this.lavaTimer = (this.lavaTimer || 0) + dt; if (this.lavaTimer > 0.5) { this.lavaTimer = 0; this.damage(4, 'lava'); } }
      else this.lavaTimer = 0;

      const touching = this._touchingHurtBlock();
      if (touching) { this.cactusTimer = (this.cactusTimer || 0) + dt; if (this.cactusTimer > 0.6) { this.cactusTimer = 0; this.damage(touching, 'spike'); } }
      else this.cactusTimer = 0;
    }

    if (this.hurtCd > 0) this.hurtCd -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.swingT > 0) this.swingT -= dt * 3.4;
    if (this.invalidPlaceTimer > 0) this.invalidPlaceTimer -= dt;

    // void
    if (this.pos.y < -6) this.damage(100, 'void');
  }

  _touchingHurtBlock() {
    const w = PW / 2 + 0.06;
    for (const [dx, dz] of [[-w, 0], [w, 0], [0, -w], [0, w]]) {
      for (const dy of [0.2, 1.0, 1.6]) {
        const id = this.world.getBlock(this.pos.x + dx, this.pos.y + dy, this.pos.z + dz);
        const b = BLOCKS[id];
        if (b && b.hurt) return b.hurt;
      }
    }
    return 0;
  }

  _moveAxis(dt, axis) {
    const d = this.vel[axis] * dt;
    if (d === 0) return;
    const step = Math.sign(d) * Math.min(Math.abs(d), 0.2);
    let remaining = d;
    while (Math.abs(remaining) > 1e-6) {
      const move = Math.abs(remaining) > 0.2 ? step : remaining;
      const old = this.pos[axis];
      this.pos[axis] += move;
      if (this.aabbBlocked(this.pos.x, this.pos.y, this.pos.z)) {
        // step-up assist for horizontal movement
        if ((axis === 'x' || axis === 'z') && this.onGround && !this.sneaking) {
          const testY = this.pos.y + 0.6;
          if (!this.aabbBlocked(this.pos.x, testY, this.pos.z)) {
            this.pos.y = testY;
            remaining -= move;
            continue;
          }
        }
        this.pos[axis] = old;
        if (axis === 'y') {
          if (this.vel.y < 0) this.onGround = true;
          this.vel.y = 0;
        } else {
          this.vel[axis] = 0;
        }
        return;
      }
      if (axis === 'y' && this.vel.y !== 0) this.onGround = false;
      remaining -= move;
    }
    if (axis === 'y') {
      // while flying there is no ground contact to detect
      if (this.flying) { this.onGround = false; return; }
      // ground probe
      const probe = 0.06;
      this.pos.y -= probe;
      const hit = this.aabbBlocked(this.pos.x, this.pos.y, this.pos.z);
      this.pos.y += probe;
      if (hit && this.vel.y <= 0.001) this.onGround = true;
      else if (this.vel.y > 0.001) this.onGround = false;
      else if (!hit) this.onGround = false;
    }
  }

  // ------------------------------------------------------------- combat
  armorPoints() {
    let p = 0;
    for (const s of ARMOR_SLOTS) {
      const it = this.armor[s];
      if (it) { const d = itemDef(it.id); if (d) p += d.armor || 0; }
    }
    return p;
  }

  damage(amount, cause = 'hit') {
    if (this.dead || this.creative) return;
    if (this.hurtCd > 0 && cause !== 'void') return;
    const ap = this.armorPoints();
    let dmg = amount;
    if (cause !== 'starve' && cause !== 'drown' && cause !== 'void') {
      dmg = amount * (1 - Math.min(0.72, ap * 0.038));
      // armor durability
      for (const s of ARMOR_SLOTS) {
        const it = this.armor[s];
        if (it && it.dur !== undefined) {
          it.dur -= Math.max(1, Math.round(amount * 0.5));
          if (it.dur <= 0) this.armor[s] = null;
        }
      }
    }
    dmg = Math.max(cause === 'void' ? amount : 0.5, dmg);
    this.health -= dmg;
    this.hurtCd = 0.42;
    this.lastDamage = performance.now();
    this.audio.hurt();
    if (this.health <= 0) { this.health = 0; this.die(cause); }
  }

  die(cause) {
    this.dead = true;
    this.deaths++;
    this.deathCause = cause || this.deathCause || 'The world claimed you.';
  }

  respawn(spawn) {
    this.dead = false;
    this.deathCause = null;
    this.health = this.maxHealth;
    this.hunger = Math.max(6, this.hunger);
    this.saturation = 2;
    this.air = this.maxAir;
    this.vel.set(0, 0, 0);
    const p = this.spawnPoint || spawn;
    this.pos.set(p.x, p.y, p.z);
    this.fallStart = null;
  }

  eat(slotIdx) {
    const s = slotIdx === 'offhand' ? this.offhand : this.inv.slots[slotIdx];
    if (!s) return false;
    const d = itemDef(s.id);
    if (!d || !d.food) return false;
    if (this.hunger >= this.maxHunger && d.food > 0) return false;
    this.hunger = Math.min(this.maxHunger, this.hunger + d.food);
    this.saturation = Math.min(this.hunger, this.saturation + (d.sat || 0));
    s.count--;
    if (s.count <= 0) {
      if (slotIdx === 'offhand') this.offhand = null;
      else this.inv.slots[slotIdx] = null;
    }
    if (s.id === 'mush_stew') this.inv.add('clay_lump', 1);
    this.audio.eat();
    return true;
  }

  addXP(n) {
    this.xp += n;
    const need = () => 10 + this.level * 6;
    let leveled = false;
    while (this.xp >= need()) { this.xp -= need(); this.level++; leveled = true; }
    if (leveled) this.audio.levelUp();
    return leveled;
  }

  damageHeld(n = 1) {
    const h = this.held;
    if (!h || h.dur === undefined) return;
    if (this.creative) return;
    h.dur -= n;
    if (h.dur <= 0) {
      this.inv.slots[this.hotbarIdx] = null;
      this.audio.break_('metal');
    }
  }

  serialize() {
    return {
      pos: [this.pos.x, this.pos.y, this.pos.z],
      yaw: this.yaw, pitch: this.pitch,
      health: this.health, hunger: this.hunger, saturation: this.saturation,
      air: this.air, xp: this.xp, level: this.level,
      inv: this.inv.slots, armor: this.armor, offhand: this.offhand,
      hotbarIdx: this.hotbarIdx,
      creative: this.creative, spawnPoint: this.spawnPoint,
      deaths: this.deaths, stats: this.stats,
    };
  }
  load(d) {
    if (!d) return;
    this.pos.set(d.pos[0], d.pos[1], d.pos[2]);
    this.yaw = d.yaw; this.pitch = d.pitch;
    this.health = d.health; this.hunger = d.hunger; this.saturation = d.saturation || 0;
    this.air = d.air ?? 300; this.xp = d.xp || 0; this.level = d.level || 0;
    this.inv.slots = d.inv || this.inv.slots;
    while (this.inv.slots.length < INV_SIZE) this.inv.slots.push(null);
    this.armor = d.armor || this.armor;
    this.offhand = d.offhand || null;
    // Saves written before an item was renamed (doors gained wood types) still
    // hold the old id; translate rather than dropping the stack.
    const fix = (st) => { if (st && LEGACY_ITEM_ALIAS[st.id]) st.id = LEGACY_ITEM_ALIAS[st.id]; };
    this.inv.slots.forEach(fix);
    fix(this.offhand);
    for (const k in this.armor) fix(this.armor[k]);
    this.hotbarIdx = d.hotbarIdx || 0;
    this.creative = !!d.creative;
    this.spawnPoint = d.spawnPoint || null;
    this.deaths = d.deaths || 0;
    if (d.stats) Object.assign(this.stats, d.stats);
  }
}

export function matOf(id) {
  const b = BLOCKS[id];
  if (!b) return 'dirt';
  switch (id) {
    case B.GRASS: case B.TALL_GRASS: case B.FERN: case B.LEAF_ASPEN:
    case B.LEAF_EMBER: case B.LEAF_PINE: case B.LEAF_PALM:
    case B.SHORT_GRASS: case B.REEDS: case B.DEAD_BUSH: case B.THATCH: return 'grass';
    case B.MUD: return 'dirt';
    case B.SAND: case B.RED_SAND: case B.GRAVEL: return 'sand';
    case B.SNOW: case B.ICE: case B.PACKED_ICE: return 'snow';
    case B.GLASS: return 'glass';
    case B.WATER: return 'water';
    default: break;
  }
  if (b.tool === 'axe' || b.wood || b.fenceWood) return 'wood';
  if (b.tool === 'shovel') return 'dirt';
  if (b.tool === 'shears') return 'wool';
  if (id >= B.ORE_COPPER && id <= B.ORE_GLIMMER) return 'metal';
  if (id === B.IRON_BLOCK || id === B.GOLD_BLOCK || id === B.COPPER_BLOCK) return 'metal';
  return 'stone';
}

/** DDA voxel raycast. Returns {x,y,z,nx,ny,nz,dist,id} or null */
export function raycast(world, origin, dir, maxDist = 6, opts = {}) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = Math.abs(1 / (dir.x || 1e-9));
  const tDeltaY = Math.abs(1 / (dir.y || 1e-9));
  const tDeltaZ = Math.abs(1 / (dir.z || 1e-9));
  const bx = dir.x > 0 ? (x + 1 - origin.x) : (origin.x - x);
  const by = dir.y > 0 ? (y + 1 - origin.y) : (origin.y - y);
  const bz = dir.z > 0 ? (z + 1 - origin.z) : (origin.z - z);
  let tMaxX = tDeltaX * bx, tMaxY = tDeltaY * by, tMaxZ = tDeltaZ * bz;
  let nx = 0, ny = 0, nz = 0;
  let t = 0;
  const wantLiquid = !!opts.liquid;

  for (let i = 0; i < 512 && t <= maxDist; i++) {
    const id = world.getBlock(x, y, z);
    if (id > 0) {
      const b = BLOCKS[id];
      const hittable = b && (wantLiquid ? true : (!b.liquid));
      if (hittable && !(b.render === -1)) {
        if (!(b.noCollide && opts.solidOnly)) {
          return { x, y, z, nx, ny, nz, dist: t, id };
        }
      }
    }
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
    } else {
      if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
    }
    if (y < 0 || y >= WORLD_H) break;
  }
  return null;
}
