// EVERCRAFT - procedural world generation (worker-safe, no DOM).

import { Noise, mulberry32, clamp, lerp, smoothstep } from './noise.js';
import {
  B, CHUNK_X, CHUNK_Z, WORLD_H, SEA_LEVEL, DOOR_SETS, BED_FOOT_DIR, BED_HEAD_DIR,
} from './blocks.js';

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, EMBERWOOD: 4,
  PINE_HILLS: 5, FROST_PEAKS: 6, DUNES: 7, RUST_FLATS: 8, MEADOW: 9, MARSH: 10,
};

export const BIOME_INFO = {
  [BIOME.OCEAN]: { name: 'Open Sea', tint: 0x2f6f9c },
  [BIOME.BEACH]: { name: 'Shoreline', tint: 0xd9c78f },
  [BIOME.PLAINS]: { name: 'Verdant Plains', tint: 0x6fb84a },
  [BIOME.FOREST]: { name: 'Aspen Woods', tint: 0x59a83c },
  [BIOME.EMBERWOOD]: { name: 'Emberwood Grove', tint: 0xb5563a },
  [BIOME.PINE_HILLS]: { name: 'Pinecrest Hills', tint: 0x3f7d55 },
  [BIOME.FROST_PEAKS]: { name: 'Frostspire Peaks', tint: 0xdfeaf5 },
  [BIOME.DUNES]: { name: 'Golden Dunes', tint: 0xe0cb90 },
  [BIOME.RUST_FLATS]: { name: 'Rustflats Mesa', tint: 0xbc7448 },
  [BIOME.MEADOW]: { name: 'Bloommeadow', tint: 0x86c95a },
  [BIOME.MARSH]: { name: 'Mirefen', tint: 0x5c7a44 },
};

export class WorldGen {
  constructor(seed) {
    this.seed = seed >>> 0;
    const s = this.seed;
    this.nCont = new Noise(s + 1);
    this.nErode = new Noise(s + 2);
    this.nPeaks = new Noise(s + 3);
    this.nTemp = new Noise(s + 4);
    this.nHumid = new Noise(s + 5);
    this.nRiver = new Noise(s + 6);
    this.nCaveA = new Noise(s + 7);
    this.nCaveB = new Noise(s + 8);
    this.nCheese = new Noise(s + 9);
    this.nOre = new Noise(s + 10);
    this.nDetail = new Noise(s + 11);
    this.nTree = new Noise(s + 12);
    this.nBoulder = new Noise(s + 13);
  }

  // ---------------------------------------------------------- climate maps
  continent(x, z) {
    // large scale land mass
    return this.nCont.fbm2(x * 0.0011, z * 0.0011, 4, 2.1, 0.5);
  }
  erosion(x, z) {
    return this.nErode.fbm2(x * 0.0026, z * 0.0026, 3, 2, 0.5);
  }
  peaks(x, z) {
    return this.nPeaks.ridged2(x * 0.0055, z * 0.0055, 4);
  }
  temperature(x, z) {
    return this.nTemp.fbm2(x * 0.00085, z * 0.00085, 3, 2, 0.55);
  }
  humidity(x, z) {
    return this.nHumid.fbm2(x * 0.00105 + 90, z * 0.00105 - 40, 3, 2, 0.55);
  }
  riverField(x, z) {
    const v = this.nRiver.fbm2(x * 0.0016, z * 0.0016, 2, 2, 0.5);
    return Math.abs(v); // near 0 = river channel
  }

  /** surface height + biome for a column */
  column(x, z) {
    const cont = this.continent(x, z);
    const ero = this.erosion(x, z);
    const pk = this.peaks(x, z);
    const detail = this.nDetail.fbm2(x * 0.018, z * 0.018, 3, 2, 0.5);

    // base land shape
    let land = smoothstep(clamp((cont + 0.16) / 0.5, 0, 1)); // 0 ocean -> 1 inland
    let h = SEA_LEVEL - 16 + land * 20;

    // hills modulated by erosion (low erosion = flat, high = rugged)
    const rug = clamp((ero + 0.35) / 0.9, 0, 1);
    h += detail * 6 * (0.4 + rug);

    // mountains
    const mtnMask = clamp((cont - 0.22) / 0.42, 0, 1) * clamp((ero - 0.02) / 0.5, 0, 1);
    h += pk * 56 * mtnMask;

    // plateau flattening in mid ranges
    if (land > 0.55 && mtnMask < 0.16) {
      const flat = SEA_LEVEL + 6 + detail * 3;
      h = lerp(h, flat, 0.42);
    }

    let biome;
    const temp = this.temperature(x, z);
    const hum = this.humidity(x, z);

    // rivers carve toward sea level (only on land, not high peaks)
    const rv = this.riverField(x, z);
    let river = 0;
    if (rv < 0.035 && land > 0.35) {
      const t = 1 - rv / 0.035;
      river = smoothstep(t);
      const target = SEA_LEVEL - 2 - river * 2;
      h = lerp(h, target, river * clamp(1 - mtnMask * 1.6, 0, 1) * 0.92);
    }

    h = Math.round(h);

    // ---- biome selection
    const elev = h - SEA_LEVEL;
    if (h < SEA_LEVEL - 1) biome = BIOME.OCEAN;
    else if (h <= SEA_LEVEL + 2 && land < 0.92 && river < 0.2) biome = BIOME.BEACH;
    else if (elev > 34 || (elev > 24 && temp < -0.05)) biome = BIOME.FROST_PEAKS;
    else if (temp > 0.30 && hum < -0.05) biome = (hum < -0.28 ? BIOME.RUST_FLATS : BIOME.DUNES);
    else if (temp < -0.24) biome = BIOME.PINE_HILLS;
    else if (hum > 0.30 && elev < 8) biome = BIOME.MARSH;
    else if (hum > 0.16 && temp > 0.12) biome = BIOME.EMBERWOOD;
    else if (hum > 0.02) biome = BIOME.FOREST;
    else if (hum > -0.16) biome = BIOME.MEADOW;
    else biome = BIOME.PLAINS;

    if (elev > 20 && biome !== BIOME.FROST_PEAKS && temp < 0.12) biome = BIOME.PINE_HILLS;
    if (river > 0.35 && h <= SEA_LEVEL + 1 && biome !== BIOME.OCEAN) biome = BIOME.BEACH;

    return { h: clamp(h, 4, WORLD_H - 12), biome, temp, hum, land, mtn: mtnMask, river };
  }

  /** cave density: true = carve */
  isCave(x, y, z) {
    if (y < 3 || y > WORLD_H - 20) return false;
    // tunnel worms: intersection of two ridged fields
    const sx = x * 0.021, sy = y * 0.036, sz = z * 0.021;
    const a = Math.abs(this.nCaveA.noise3(sx, sy, sz));
    const b = Math.abs(this.nCaveB.noise3(sx + 41.3, sy - 17.7, sz + 8.1));
    const thr = 0.062 + (y > 60 ? 0.02 : 0);
    if (a < thr && b < thr) return true;
    // cheese caverns deeper down
    if (y < 44) {
      const c = this.nCheese.fbm3(x * 0.028, y * 0.05, z * 0.028, 3, 2, 0.5);
      const bias = 0.44 - (44 - y) * 0.0042;
      if (c > bias) return true;
    }
    return false;
  }

  oreAt(x, y, z, rnd) {
    // depth-banded ore placement using a scatter field
    const n = this.nOre.noise3(x * 0.09, y * 0.09, z * 0.09);
    if (n < 0.62) return 0;
    const r = rnd();
    if (y < 14) {
      if (r < 0.14) return B.ORE_GLIMMER;
      if (r < 0.34) return B.ORE_AURORITE;
      if (r < 0.52) return B.ORE_GOLD;
      if (r < 0.78) return B.ORE_IRON;
      return B.ORE_COAL;
    }
    if (y < 26) {
      if (r < 0.05) return B.ORE_AURORITE;
      if (r < 0.20) return B.ORE_GOLD;
      if (r < 0.58) return B.ORE_IRON;
      if (r < 0.78) return B.ORE_COPPER;
      return B.ORE_COAL;
    }
    if (y < 46) {
      if (r < 0.30) return B.ORE_IRON;
      if (r < 0.62) return B.ORE_COPPER;
      return B.ORE_COAL;
    }
    if (r < 0.34) return B.ORE_COPPER;
    return B.ORE_COAL;
  }

  // ------------------------------------------------------------- chunk gen
  /**
   * Generates one chunk column stack.
   * Returns { blocks: Uint8Array(CHUNK_X*CHUNK_Z*WORLD_H), heights: Uint8Array, biomes: Uint8Array }
   * Index order: x + z*CHUNK_X + y*CHUNK_X*CHUNK_Z
   */
  generateChunk(cx, cz) {
    const XZ = CHUNK_X * CHUNK_Z;
    const blocks = new Uint8Array(XZ * WORLD_H);
    const heights = new Uint8Array(XZ);
    const biomes = new Uint8Array(XZ);
    const surf = new Int16Array(XZ);
    const rnd = mulberry32((cx * 341873128 + cz * 132897987 + this.seed) >>> 0);

    const set = (x, y, z, id) => { blocks[x + z * CHUNK_X + y * XZ] = id; };
    const get = (x, y, z) => blocks[x + z * CHUNK_X + y * XZ];

    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const wx = cx * CHUNK_X + lx, wz = cz * CHUNK_Z + lz;
        const col = this.column(wx, wz);
        const i2 = lx + lz * CHUNK_X;
        heights[i2] = clamp(col.h, 0, 255);
        biomes[i2] = col.biome;
        surf[i2] = col.h;

        const bio = col.biome;
        // surface material selection
        let topBlock = B.GRASS, subBlock = B.DIRT, subDepth = 3 + ((rnd() * 2) | 0);
        switch (bio) {
          case BIOME.OCEAN: topBlock = rnd() < 0.35 ? B.GRAVEL : B.SAND; subBlock = B.SAND; break;
          case BIOME.BEACH: topBlock = B.SAND; subBlock = B.SAND; subDepth = 4; break;
          case BIOME.DUNES: topBlock = B.SAND; subBlock = B.SANDSTONE; subDepth = 5; break;
          case BIOME.RUST_FLATS: topBlock = B.RED_SAND; subBlock = B.SANDSTONE; subDepth = 5; break;
          case BIOME.FROST_PEAKS: topBlock = B.SNOW; subBlock = B.STONE; subDepth = 2; break;
          case BIOME.PINE_HILLS: topBlock = B.GRASS; subBlock = B.DIRT; break;
          case BIOME.MARSH: {
            const mr = rnd();
            topBlock = mr < 0.22 ? B.CLAY : mr < 0.48 ? B.MUD : B.GRASS;
            subBlock = B.DIRT; subDepth = 4; break;
          }
          default: break;
        }
        if (col.mtn > 0.5 && col.h > SEA_LEVEL + 22 && bio !== BIOME.FROST_PEAKS) {
          topBlock = rnd() < 0.6 ? B.STONE : B.GRAVEL; subBlock = B.STONE;
        }

        const h = col.h;
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = B.BEDROCK;
          else if (y < 3 && rnd() < 0.55) id = B.BEDROCK;
          else if (y === h) id = topBlock;
          else if (y > h - subDepth) id = subBlock;
          else if (y < 22) id = B.DEEPSTONE;
          else id = B.STONE;

          // basalt intrusions deep down
          if (id === B.DEEPSTONE && y < 18 && this.nDetail.noise3(wx * 0.05, y * 0.05, wz * 0.05) > 0.55) id = B.BASALT;

          set(lx, y, lz, id);
        }

        // water / ice fill
        if (h < SEA_LEVEL) {
          for (let y = h + 1; y <= SEA_LEVEL; y++) set(lx, y, lz, B.WATER);
          // Ice only forms in a broad, genuinely frigid inland depression.
          // A single cold noise sample used to sprinkle lone ice in forest
          // ponds and even build huge random sheets across the open ocean.
          const frozenInland = col.land > 0.72 && col.temp < -0.48 &&
            this.temperature(wx + 12, wz) < -0.40 && this.temperature(wx - 12, wz) < -0.40 &&
            this.temperature(wx, wz + 12) < -0.40 && this.temperature(wx, wz - 12) < -0.40;
          if (frozenInland && SEA_LEVEL - h <= 5) set(lx, SEA_LEVEL, lz, B.ICE);
        }
      }
    }

    // ---- carve caves & place ores
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const wx = cx * CHUNK_X + lx, wz = cz * CHUNK_Z + lz;
        const i2 = lx + lz * CHUNK_X;
        const h = surf[i2];
        const maxY = Math.min(h, WORLD_H - 1);
        for (let y = 1; y <= maxY; y++) {
          const id = get(lx, y, lz);
          if (id === B.AIR || id === B.BEDROCK || id === B.WATER) continue;
          if (this.isCave(wx, y, wz)) {
            // don't breach into ocean floor thinly
            if (h < SEA_LEVEL + 1 && y > h - 4) continue;
            set(lx, y, lz, y < 9 && this.nCheese.noise3(wx * 0.03, y * 0.1, wz * 0.03) > 0.3 ? B.LAVA : B.AIR);
            continue;
          }
          if (id === B.STONE || id === B.DEEPSTONE) {
            const o = this.oreAt(wx, y, wz, rnd);
            if (o) set(lx, y, lz, o);
          }
        }
        // lava pools at the very bottom
        for (let y = 1; y < 7; y++) if (get(lx, y, lz) === B.AIR) set(lx, y, lz, B.LAVA);
      }
    }

    // ---- surface decoration
    this.decorate(blocks, heights, biomes, cx, cz, rnd, surf);

    return { blocks, heights, biomes };
  }

  /**
   * Deterministic tree scattering with guaranteed spacing.
   * The world is divided into `cell`-sized tiles; each tile hosts at most one
   * trunk, at a hash-jittered position. This keeps forests dense-looking while
   * preventing trunks from merging into walls.
   */
  treeSlot(wx, wz, cell) {
    const gx = Math.floor(wx / cell), gz = Math.floor(wz / cell);
    let h = (gx * 73856093) ^ (gz * 19349663) ^ (this.seed * 83492791);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    const ox = h % cell;
    const oz = ((h / cell) | 0) % cell;
    // second hash gives a per-tile "should there be a tree" roll
    let r = Math.imul(h ^ 0x9e3779b9, 2246822519);
    r = ((r ^ (r >>> 15)) >>> 0) / 4294967296;
    return { hit: (wx - gx * cell) === ox && (wz - gz * cell) === oz, roll: r };
  }

  /**
   * Tree config for a biome: [kind, cell size, base chance] or null.
   * Cell size must exceed the species' canopy diameter or crowns fuse into a
   * solid roof (aspen ~5 wide, ember ~7, pine ~7, palm ~7).
   */
  treeConfig(bio, h) {
    switch (bio) {
      case BIOME.FOREST: return ['aspen', 6, 0.95];
      case BIOME.EMBERWOOD: return ['ember', 8, 0.90];
      case BIOME.PINE_HILLS: return ['pine', 7, 0.92];
      case BIOME.MARSH: return ['pine', 11, 0.45];
      case BIOME.PLAINS: return ['aspen', 16, 0.38];
      case BIOME.MEADOW: return ['aspen', 12, 0.42];
      case BIOME.DUNES: return ['palm', 14, 0.30];
      case BIOME.BEACH: return ['palm', 12, 0.34];
      case BIOME.FROST_PEAKS: return h < SEA_LEVEL + 34 ? ['pine', 10, 0.45] : null;
      default: return null;
    }
  }

  /** decide (deterministically, position-only) whether a trunk stands here */
  _treeHere(wx, wz, bio, h) {
    const TC = this.treeConfig(bio, h);
    if (!TC) return false;
    const [, cell, chance] = TC;
    const slot = this.treeSlot(wx, wz, cell);
    if (!slot.hit) return false;
    const density = this.nTree.noise2(wx * 0.012, wz * 0.012) * 0.5 + 0.5;
    return slot.roll < chance * (0.35 + density);
  }

  decorate(blocks, heights, biomes, cx, cz, rnd, surf) {
    const XZ = CHUNK_X * CHUNK_Z;
    const set = (x, y, z, id) => {
      if (x < 0 || z < 0 || x >= CHUNK_X || z >= CHUNK_Z || y < 0 || y >= WORLD_H) return;
      blocks[x + z * CHUNK_X + y * XZ] = id;
    };
    const get = (x, y, z) => {
      if (x < 0 || z < 0 || x >= CHUNK_X || z >= CHUNK_Z || y < 0 || y >= WORLD_H) return B.AIR;
      return blocks[x + z * CHUNK_X + y * XZ];
    };
    const setIfAir = (x, y, z, id) => { if (get(x, y, z) === B.AIR) set(x, y, z, id); };
    // two-block tall grass: only place the top half when there is room for it
    const tallGrass = (x, y, z) => {
      if (get(x, y, z) !== B.AIR) return;
      set(x, y, z, B.TALL_GRASS);
      if (get(x, y + 1, z) === B.AIR) set(x, y + 1, z, B.TALL_GRASS_TOP);
    };

    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const i2 = lx + lz * CHUNK_X;
        const bio = biomes[i2];
        const h = surf[i2];
        const wx = cx * CHUNK_X + lx, wz = cz * CHUNK_Z + lz;
        const top = get(lx, h, lz);
        const above = get(lx, h + 1, lz);
        if (above !== B.AIR) continue; // submerged or occupied
        if (top === B.WATER || top === B.ICE) continue;

        const r = rnd();
        // trunks are emitted in the overscan pass below; here we only need to
        // know whether this column is occupied so we skip ground clutter.
        const placedTree = this._treeHere(wx, wz, bio, h);

        if (!placedTree) {
          switch (bio) {
            case BIOME.FOREST:
              if (r < 0.20) setIfAir(lx, h + 1, lz, B.SHORT_GRASS);
              else if (r < 0.26) tallGrass(lx, h + 1, lz);
              else if (r < 0.32) setIfAir(lx, h + 1, lz, B.FERN);
              else if (r < 0.335) setIfAir(lx, h + 1, lz, B.BERRY_BUSH);
              break;
            case BIOME.EMBERWOOD:
              if (r < 0.22) setIfAir(lx, h + 1, lz, B.SHORT_GRASS);
              else if (r < 0.28) tallGrass(lx, h + 1, lz);
              else if (r < 0.33) setIfAir(lx, h + 1, lz, B.FLOWER_DUSK);
              break;
            case BIOME.PINE_HILLS:
              if (r < 0.22) setIfAir(lx, h + 1, lz, B.FERN);
              else if (r < 0.245) setIfAir(lx, h + 1, lz, B.MUSHROOM);
              else if (r < 0.27) setIfAir(lx, h + 1, lz, B.SHORT_GRASS);
              break;
            case BIOME.PLAINS:
              if (r < 0.26) setIfAir(lx, h + 1, lz, B.SHORT_GRASS);
              else if (r < 0.34) tallGrass(lx, h + 1, lz);
              else if (r < 0.37) setIfAir(lx, h + 1, lz, B.FLOWER_SUN);
              break;
            case BIOME.MEADOW:
              if (r < 0.32) setIfAir(lx, h + 1, lz, B.SHORT_GRASS);
              else if (r < 0.44) tallGrass(lx, h + 1, lz);
              else if (r < 0.52) setIfAir(lx, h + 1, lz, r < 0.48 ? B.FLOWER_SUN : B.FLOWER_DUSK);
              else if (r < 0.535) setIfAir(lx, h + 1, lz, B.BERRY_BUSH);
              break;
            case BIOME.MARSH:
              if (r < 0.18) setIfAir(lx, h + 1, lz, B.SHORT_GRASS);
              else if (r < 0.26) tallGrass(lx, h + 1, lz);
              else if (r < 0.32) setIfAir(lx, h + 1, lz, B.FERN);
              // reeds crowd the water's edge
              else if (r < 0.44 && h <= SEA_LEVEL + 2) setIfAir(lx, h + 1, lz, B.REEDS);
              else if (r < 0.455) setIfAir(lx, h + 1, lz, B.MUSHROOM);
              break;
            case BIOME.BEACH:
              if (r < 0.05 && h <= SEA_LEVEL + 1) setIfAir(lx, h + 1, lz, B.REEDS);
              break;
            case BIOME.DUNES:
              if (r < 0.012) this.cactus(set, get, lx, h + 1, lz, rnd);
              else if (r < 0.045) setIfAir(lx, h + 1, lz, B.DEAD_BUSH);
              break;
            case BIOME.RUST_FLATS:
              if (r < 0.010) this.cactus(set, get, lx, h + 1, lz, rnd);
              else if (r < 0.050) setIfAir(lx, h + 1, lz, B.DEAD_BUSH);
              break;
            default: break;
          }
        }

        // scattered boulders
        if (this.nBoulder.noise2(wx * 0.14, wz * 0.14) > 0.72 && r < 0.10 && bio !== BIOME.OCEAN) {
          const rad = 1 + ((rnd() * 2) | 0);
          for (let dy = 0; dy <= rad; dy++)
            for (let dz = -rad; dz <= rad; dz++)
              for (let dx = -rad; dx <= rad; dx++)
                if (dx * dx + dy * dy + dz * dz <= rad * rad + 1)
                  setIfAir(lx + dx, h + dy, lz + dz, rnd() < 0.2 ? B.MOSS_STONE : B.STONE);
        }
      }
    }

    // ---- trees: iterate an overscanned area so canopies that originate in a
    // neighbouring chunk still write their leaves into this one. Placement is a
    // pure function of world position, so both chunks agree on every trunk.
    const MARGIN = 6;   // >= widest canopy radius + palm frond reach
    for (let ez = -MARGIN; ez < CHUNK_Z + MARGIN; ez++) {
      for (let ex = -MARGIN; ex < CHUNK_X + MARGIN; ex++) {
        const wx = cx * CHUNK_X + ex, wz = cz * CHUNK_Z + ez;
        let th, tbio;
        if (ex >= 0 && ez >= 0 && ex < CHUNK_X && ez < CHUNK_Z) {
          const i2 = ex + ez * CHUNK_X;
          th = surf[i2]; tbio = biomes[i2];
        } else {
          const col = this.column(wx, wz);   // recompute for out-of-chunk trunks
          th = col.h; tbio = col.biome;
        }
        if (th < SEA_LEVEL) continue;
        if (!this._treeHere(wx, wz, tbio, th)) continue;
        const TC = this.treeConfig(tbio, th);
        if (!TC) continue;
        // deterministic per-trunk RNG so shape matches from either chunk
        const tr = mulberry32((wx * 374761393 + wz * 668265263 + this.seed) >>> 0);
        this.tree(set, get, ex, th + 1, ez, TC[0], tr);
      }
    }

    // cave shrooms in dark pockets
    for (let k = 0; k < 26; k++) {
      const lx = (rnd() * CHUNK_X) | 0, lz = (rnd() * CHUNK_Z) | 0;
      const y = 6 + ((rnd() * 40) | 0);
      if (get(lx, y, lz) === B.AIR) {
        const below = get(lx, y - 1, lz);
        if (below === B.STONE || below === B.DEEPSTONE || below === B.DIRT) {
          set(lx, y, lz, rnd() < 0.25 ? B.MUSHROOM : B.MUSHROOM);
        }
      }
    }

    // ---- structures -------------------------------------------------
    // Painted from a 3x3 neighbourhood so a building whose origin sits in an
    // adjacent chunk still writes the part of itself that overlaps this one.
    // Without this, anything wider than the gap to the chunk border was sliced
    // clean off - the single biggest thing wrong with the old structures.
    this.paintStructures(cx, cz, set, get);
  }

  // ------------------------------------------------------------ structures
  /**
   * Deterministic description of the structure a chunk hosts, or null.
   *
   * Everything here is a pure function of (chunk coords, seed) so that all
   * nine chunks around a building agree on its position, kind, size and every
   * random detail. That is what lets `paintStructures` draw the overlapping
   * slice of a neighbour's building instead of chopping it at the border.
   */
  structureAt(cx, cz) {
    const sHash = ((cx * 73856093) ^ (cz * 19349663) ^ this.seed) >>> 0;
    if (sHash % 11 !== 0) return null;
    // dedicated RNG stream: independent of whatever the chunk decorator drew
    const rnd = mulberry32((sHash ^ 0x5bf03635) >>> 0);
    // Anywhere in the chunk: `paintStructures` paints whatever spills over the
    // border from a neighbour, so a building no longer has to be shoved into
    // the middle of its own chunk to avoid being sliced in half.
    const lx = 1 + ((rnd() * 14) | 0), lz = 1 + ((rnd() * 14) | 0);
    const wx = cx * CHUNK_X + lx, wz = cz * CHUNK_Z + lz;
    const col = this.column(wx, wz);
    if (col.biome === BIOME.OCEAN) return null;
    if (col.h < SEA_LEVEL + 1) return null;
    const kHash = ((cx * 40503671) ^ (cz * 29986577) ^ (this.seed * 6971)) >>> 0;
    const kind = this._structureKind(kHash % 100, col.biome);
    return { lx, lz, wx, wz, h: col.h, bio: col.biome, kind, rnd };
  }

  /** Biome-weighted choice of which building goes up. */
  _structureKind(roll, bio) {
    const frost = bio === BIOME.FROST_PEAKS;
    const desert = bio === BIOME.DUNES || bio === BIOME.RUST_FLATS;
    const wooded = bio === BIOME.FOREST || bio === BIOME.PINE_HILLS ||
      bio === BIOME.EMBERWOOD;
    if (desert) {
      if (roll < 40) return 'obelisk';
      if (roll < 70) return 'wellRuin';
      return 'ruin';
    }
    if (frost) {
      if (roll < 55) return 'cairn';
      return 'watchtower';
    }
    if (wooded) {
      if (roll < 30) return 'campsite';
      if (roll < 55) return 'hunterHut';
      if (roll < 75) return 'watchtower';
      return 'ruin';
    }
    if (roll < 22) return 'campsite';
    if (roll < 42) return 'wellRuin';
    if (roll < 60) return 'watchtower';
    if (roll < 78) return 'hunterHut';
    return 'ruin';
  }

  /**
   * Draw every structure that reaches into this chunk.
   * `set`/`get` clip to the chunk, so painting a neighbour's building simply
   * writes the cells that land inside us.
   */
  paintStructures(cx, cz, set, get) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const st = this.structureAt(cx + dx, cz + dz);
        if (!st) continue;
        const ox = dx * CHUNK_X, oz = dz * CHUNK_Z;
        const sset = (x, y, z, id) => set(x + ox, y, z + oz, id);
        const sget = (x, y, z) => get(x + ox, y, z + oz);
        this.buildStructure(st, sset, sget);
      }
    }
  }

  /** Dispatch to the right builder with a flatness helper bound to the site. */
  buildStructure(st, set, get) {
    const { lx, lz, h, bio, rnd, kind } = st;
    // Ground roughness around the site, measured from the height field rather
    // than the chunk's own array so every neighbour agrees.
    const flat = (r) => {
      let lo = 999, hi = -999;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const hh = this.column(st.wx + dx, st.wz + dz).h;
          if (hh < lo) lo = hh;
          if (hh > hi) hi = hh;
        }
      }
      return hi - lo;
    };
    switch (kind) {
      case 'ruin': return this.ruin(set, get, lx, lz, h, bio, rnd, flat);
      case 'hunterHut': return this.hunterHut(set, get, lx, lz, h, bio, rnd, flat);
      case 'watchtower': return this.watchtower(set, get, lx, lz, h, bio, rnd, flat);
      case 'campsite': return this.campsite(set, get, lx, lz, h, rnd, flat);
      case 'wellRuin': return this.wellRuin(set, get, lx, lz, h, rnd, flat);
      case 'obelisk': return this.obelisk(set, get, lx, lz, h, rnd);
      case 'cairn': return this.cairn(set, get, lx, lz, h, rnd);
      default: return undefined;
    }
  }

  tree(set, get, x, y, z, kind, rnd) {
    // Trunks whose base lies outside this chunk read as AIR; that's expected —
    // the owning chunk validates the ground, we only need to paint the overlap.
    const inside = x >= 0 && z >= 0 && x < CHUNK_X && z < CHUNK_Z;
    if (inside) {
      const base = get(x, y - 1, z);
      if (base !== B.GRASS && base !== B.DIRT && base !== B.SAND && base !== B.SNOW && base !== B.RED_SAND) return;
      if (get(x, y, z) !== B.AIR) return;
    }

    if (kind === 'aspen') {
      const hgt = 5 + ((rnd() * 3) | 0);
      for (let i = 0; i < hgt; i++) set(x, y + i, z, B.LOG_ASPEN);
      const cy = y + hgt - 1;
      for (let dy = -2; dy <= 2; dy++) {
        const rad = dy <= -1 ? 2 : dy === 0 ? 2 : dy === 1 ? 1 : 1;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && rnd() < 0.65) continue;
          if (dx === 0 && dz === 0 && dy < 1) continue;
          if (get(x + dx, cy + dy, z + dz) === B.AIR) set(x + dx, cy + dy, z + dz, B.LEAF_ASPEN);
        }
      }
      set(x, cy + 2, z, B.LEAF_ASPEN);
    } else if (kind === 'ember') {
      const hgt = 6 + ((rnd() * 4) | 0);
      for (let i = 0; i < hgt; i++) set(x, y + i, z, B.LOG_EMBER);
      const cy = y + hgt - 1;
      for (let dy = -3; dy <= 2; dy++) {
        const rad = dy < 0 ? 3 : dy === 0 ? 2 : 1;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          const d = dx * dx + dz * dz;
          if (d > rad * rad + 1) continue;
          if (d > rad * rad - 1 && rnd() < 0.5) continue;
          if (dx === 0 && dz === 0 && dy < 1) continue;
          if (get(x + dx, cy + dy, z + dz) === B.AIR) set(x + dx, cy + dy, z + dz, B.LEAF_EMBER);
        }
      }
    } else if (kind === 'pine') {
      // conical conifer: bare lower trunk, alternating wide/narrow skirts.
      // NOTE: `ay` below is an ABSOLUTE world y (not an offset from y).
      const hgt = 6 + ((rnd() * 4) | 0);
      for (let i = 0; i < hgt; i++) set(x, y + i, z, B.LOG_PINE);
      const bare = 1 + ((rnd() * 2) | 0);        // clear trunk at the bottom
      const topY = y + hgt - 1;
      for (let ay = topY; ay >= y + bare; ay--) {
        const depth = topY - ay;                 // 0 at the tip
        // radius widens toward the ground, alternating for a layered skirt
        const rad = depth === 0 ? 1 : (depth % 2 === 1 ? 2 : 1) + Math.min(1, (depth / 5) | 0);
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (dx === 0 && dz === 0) continue;
          const d2 = dx * dx + dz * dz;
          if (d2 > rad * rad + 1) continue;
          if (d2 >= rad * rad && rnd() < 0.45) continue;   // ragged edge
          if (get(x + dx, ay, z + dz) === B.AIR) set(x + dx, ay, z + dz, B.LEAF_PINE);
        }
      }
      // pointed crown
      set(x, y + hgt, z, B.LEAF_PINE);
      if (rnd() < 0.6) set(x, y + hgt + 1, z, B.LEAF_PINE);
    } else {
      // palm: leaning trunk with frond crown
      const hgt = 6 + ((rnd() * 3) | 0);
      const lean = rnd() < 0.5 ? 1 : -1;
      let px = x, pz = z;
      for (let i = 0; i < hgt; i++) {
        if (i > 2 && i % 3 === 0) { if (rnd() < 0.5) px += lean; else pz += lean; }
        set(px, y + i, pz, B.LOG_PALM);
      }
      const cy = y + hgt;
      set(px, cy, pz, B.LEAF_PALM);
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
      for (const [dx, dz] of dirs) {
        set(px + dx, cy, pz + dz, B.LEAF_PALM);
        set(px + dx * 2, cy - 1, pz + dz * 2, B.LEAF_PALM);
        if (rnd() < 0.5) set(px + dx * 3, cy - 1, pz + dz * 3, B.LEAF_PALM);
      }
    }
  }

  cactus(set, get, x, y, z, rnd) {
    const hgt = 2 + ((rnd() * 3) | 0);
    for (let i = 0; i < hgt; i++) {
      if (get(x, y + i, z) !== B.AIR) break;
      set(x, y + i, z, B.CACTUS);
    }
  }

  // -------------------------------------------------------- build palettes
  /** Wood palette that suits the local biome. */
  _plank(bio) {
    if (bio === BIOME.EMBERWOOD) return B.PLANK_EMBER;
    if (bio === BIOME.PINE_HILLS || bio === BIOME.FROST_PEAKS) return B.PLANK_PINE;
    if (bio === BIOME.DUNES || bio === BIOME.RUST_FLATS) return B.PLANK_PALM;
    return B.PLANK_ASPEN;
  }
  _log(bio) {
    if (bio === BIOME.EMBERWOOD) return B.LOG_EMBER;
    if (bio === BIOME.PINE_HILLS || bio === BIOME.FROST_PEAKS) return B.LOG_PINE;
    if (bio === BIOME.DUNES || bio === BIOME.RUST_FLATS) return B.LOG_PALM;
    return B.LOG_ASPEN;
  }
  /** Door for the local wood, as a [lower, upper] id pair facing `dir`. */
  _door(bio, dir) {
    const wood = bio === BIOME.EMBERWOOD ? 'ember'
      : (bio === BIOME.PINE_HILLS || bio === BIOME.FROST_PEAKS) ? 'pine'
        : (bio === BIOME.DUNES || bio === BIOME.RUST_FLATS) ? 'palm' : 'aspen';
    const set = DOOR_SETS[wood];
    return [set.closedLow[dir & 3], set.closedTop[dir & 3]];
  }
  /** Masonry palette: [main course, weathered accent, trim]. */
  _masonry(bio, rnd) {
    if (bio === BIOME.DUNES || bio === BIOME.RUST_FLATS)
      return [B.SANDSTONE, B.CHISELED_SANDSTONE, B.SANDSTONE];
    if (bio === BIOME.FROST_PEAKS) return [B.STONE_BRICKS, B.FROST_BRICK, B.SMOOTH_STONE];
    return [B.STONE_BRICKS, rnd() < 0.5 ? B.MOSSY_BRICKS : B.CRACKED_BRICKS, B.SMOOTH_STONE];
  }
  /** Roofing that matches the climate. */
  _roof(bio) {
    if (bio === BIOME.DUNES || bio === BIOME.RUST_FLATS) return B.THATCH;
    if (bio === BIOME.FROST_PEAKS || bio === BIOME.PINE_HILLS) return B.ROOF_TILE;
    return B.ROOF_TILE;
  }

  /** Clear headroom above a footprint so trees don't grow through a build. */
  _clear(set, x0, z0, w, d, y, hgt) {
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++)
        for (let dy = 0; dy < hgt; dy++) set(x0 + dx, y + dy, z0 + dz, B.AIR);
  }

  /**
   * Level a site and give it a plinth.
   * Buildings used to sit on whatever the terrain happened to be doing, so a
   * one-block dip left a hole under the wall. This lays a foundation course
   * and backfills every column down to the real ground, which is what makes a
   * building read as *built* rather than pasted on.
   */
  _foundation(set, x0, z0, w, d, y, mat, fill, depth = 4) {
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        set(x0 + dx, y, z0 + dz, mat);
        for (let k = 1; k <= depth; k++) set(x0 + dx, y - k, z0 + dz, fill);
      }
    }
  }

  /** Rectangular wall course with optional gaps, one block high. */
  _wallRing(set, x0, z0, w, d, y, mat, accent, rnd, decay = 0) {
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const edge = dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1;
        if (!edge) continue;
        if (decay && rnd() < decay) continue;
        set(x0 + dx, y, z0 + dz, rnd() < 0.22 ? accent : mat);
      }
    }
  }

  /**
   * Ruined outpost.
   * Three floor plans, a proper plinth, corner pilasters, arched window
   * openings, a rubble-strewn interior with shelving and a hearth, and an
   * optional upper floor reached by a ladder.
   */
  ruin(set, get, lx, lz, h, bio, rnd, flat) {
    if (flat && flat(3) > 4) return;
    const variant = (rnd() * 3) | 0;
    const w = variant === 2 ? 8 : 6;         // outer footprint incl. walls
    const d = variant === 1 ? 8 : 6;
    const wallH = variant === 1 ? 5 : 4;
    const [stone, worn, trim] = this._masonry(bio, rnd);
    const x0 = lx - 1, z0 = lz - 1;

    this._clear(set, x0 - 1, z0 - 1, w + 2, d + 2, h + 1, wallH + 3);
    this._foundation(set, x0, z0, w, d, h, trim, stone, 4);
    // interior floor: tiled, with the odd cracked slab
    for (let dz = 1; dz < d - 1; dz++)
      for (let dx = 1; dx < w - 1; dx++)
        set(x0 + dx, h, z0 + dz, rnd() < 0.25 ? worn : B.TILE_DARK);
    // a step up to the doorway so the plinth reads from outside
    for (let dx = 2; dx < w - 2; dx++) set(x0 + dx, h - 1, z0 - 1, trim);

    // walls: crumble more the higher they go, and leave window openings
    for (let dy = 1; dy <= wallH; dy++) {
      const decay = Math.max(0, (dy - 2) * 0.18);
      this._wallRing(set, x0, z0, w, d, h + dy, stone, worn, rnd, decay);
      // window band
      if (dy === 2 || dy === 3) {
        for (let dx = 2; dx < w - 2; dx += 2) {
          set(x0 + dx, h + dy, z0, B.AIR);
          set(x0 + dx, h + dy, z0 + d - 1, B.AIR);
        }
      }
    }
    // corner pilasters run the full height and are capped with chiseled stone
    for (const [px, pz] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]]) {
      for (let dy = 1; dy <= wallH; dy++) set(x0 + px, h + dy, z0 + pz, stone);
      set(x0 + px, h + wallH + 1, z0 + pz, rnd() < 0.6 ? B.CHISELED : trim);
    }
    // arched doorway in the south wall
    const dxDoor = 2 + ((rnd() * (w - 4)) | 0);
    set(x0 + dxDoor, h + 1, z0, B.AIR);
    set(x0 + dxDoor, h + 2, z0, B.AIR);
    set(x0 + dxDoor - 1, h + 3, z0, trim);
    set(x0 + dxDoor, h + 3, z0, B.CHISELED);
    set(x0 + dxDoor + 1, h + 3, z0, trim);

    // interior fittings
    set(x0 + 1, h + 1, z0 + d - 2, B.CRATE);
    set(x0 + 1, h + 1, z0 + d - 3, B.AIR);
    if (rnd() < 0.6) set(x0 + w - 2, h + 1, z0 + 1, B.BENCH);
    if (rnd() < 0.5) set(x0 + w - 2, h + 1, z0 + d - 2, B.BOOKSHELF);
    if (rnd() < 0.45) set(x0 + 2, h + 1, z0 + 1, B.HEARTH);
    else if (rnd() < 0.4) set(x0 + 2, h + 1, z0 + 1, B.SMELTER);
    // wall torches actually mounted on the walls
    set(x0 + 1, h + 3, z0 + 1, B.TORCH_N);
    if (rnd() < 0.6) set(x0 + w - 2, h + 3, z0 + d - 2, B.TORCH_S);
    // scattered rubble + moss creep
    for (let i = 0; i < 6; i++) {
      const rx = x0 + 1 + ((rnd() * (w - 2)) | 0), rz = z0 + 1 + ((rnd() * (d - 2)) | 0);
      if (rnd() < 0.5) set(rx, h + 1, rz, rnd() < 0.5 ? B.RUBBLE : worn);
    }
    // partial upper floor with a ladder up to it
    if (variant === 1 && rnd() < 0.6) {
      const plank = this._plank(bio);
      for (let dz = 1; dz < d - 1; dz++)
        for (let dx = 1; dx < w - 1; dx++)
          if (rnd() < 0.62) set(x0 + dx, h + wallH, z0 + dz, plank);
      set(x0 + 1, h + wallH, z0 + 1, B.AIR);
      for (let dy = 1; dy < wallH; dy++) set(x0 + 1, h + dy, z0 + 1, B.LADDER_N);
    }
  }

  /**
   * Hunter's hut.
   * Stone plinth, timber-framed plaster walls between corner posts, glazed
   * windows with sills, a porch, a ridged and overhanging roof, a chimney and
   * a furnished interior.
   */
  hunterHut(set, get, lx, lz, h, bio, rnd, flat) {
    if (flat && flat(3) > 3) return;
    const plank = this._plank(bio), log = this._log(bio);
    const [stone, worn, trim] = this._masonry(bio, rnd);
    const roof = this._roof(bio);
    const w = 7, d = 7;                    // outer footprint
    const x0 = lx - 1, z0 = lz - 1;
    const wallH = 3;

    this._clear(set, x0 - 2, z0 - 2, w + 4, d + 4, h + 1, wallH + 6);
    // plinth one block proud of the walls, then a plank floor inside
    this._foundation(set, x0 - 1, z0 - 1, w + 2, d + 2, h, trim, stone, 4);
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++) set(x0 + dx, h, z0 + dz, plank);

    // walls: corner posts of log, panels of timber frame / plaster
    for (let dy = 1; dy <= wallH; dy++) {
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          const edge = dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1;
          if (!edge) continue;
          const corner = (dx === 0 || dx === w - 1) && (dz === 0 || dz === d - 1);
          if (corner) { set(x0 + dx, h + dy, z0 + dz, log); continue; }
          set(x0 + dx, h + dy, z0 + dz, dy === wallH ? B.TIMBER_FRAME
            : (rnd() < 0.25 ? B.TIMBER_FRAME : B.PLASTER));
        }
      }
    }
    // glazed windows with sills, centred on three walls
    const mid = (w / 2) | 0;
    for (const [wx, wz] of [[mid, 0], [0, mid], [w - 1, mid], [mid, d - 1]]) {
      set(x0 + wx, h + 2, z0 + wz, B.GLASS);
      set(x0 + wx, h + 1, z0 + wz, B.TIMBER_FRAME);
    }
    // door in the south wall (offset from the window) + porch
    const doorX = mid - 2 < 1 ? 1 : mid - 2;
    const [dLow, dTop] = this._door(bio, 0);
    set(x0 + doorX, h + 1, z0, dLow);
    set(x0 + doorX, h + 2, z0, dTop);
    set(x0 + doorX, h + 3, z0, B.TIMBER_FRAME);
    for (let dx = doorX - 1; dx <= doorX + 1; dx++) set(x0 + dx, h, z0 - 1, plank);
    set(x0 + doorX - 1, h + 1, z0 - 1, log);
    set(x0 + doorX + 1, h + 1, z0 - 1, log);
    set(x0 + doorX - 1, h + 2, z0 - 1, log);
    set(x0 + doorX + 1, h + 2, z0 - 1, log);
    for (let dx = doorX - 1; dx <= doorX + 1; dx++) set(x0 + dx, h + 3, z0 - 1, roof);

    // Ridged roof running along X, with a one-block overhang on all sides.
    // The loop runs one course past the halfway point so the final ridge row
    // is laid; stopping earlier left a one-block slot open to the sky.
    const ridgeY = h + wallH + 1;
    for (let r = 0; r <= 4; r++) {
      const y = ridgeY + r;
      const inset = r - 1;                 // r=0 is the overhanging eaves course
      const zA = z0 + inset, zB = z0 + d - 1 - inset;
      if (zA > zB) break;
      for (let dx = -1; dx < w + 1; dx++) {
        set(x0 + dx, y, zA, roof);
        set(x0 + dx, y, zB, roof);
        if (zA === zB) continue;
        // close the gable ends so the loft is not open to the sky
        if (dx === -1 || dx === w) {
          for (let z = zA + 1; z < zB; z++) set(x0 + dx, y, z, plank);
        }
      }
    }
    // chimney rising out of the roof over the hearth
    for (let dy = 1; dy <= wallH + 4; dy++) set(x0 + w - 2, h + dy, z0 + 1, stone);
    set(x0 + w - 2, h + wallH + 5, z0 + 1, worn);
    set(x0 + w - 2, h + 1, z0 + 1, B.HEARTH);

    // interior: bed, chest, bench, shelving and a hanging lantern
    const bedDir = 1;                       // head toward +X
    set(x0 + 1, h + 1, z0 + d - 2, BED_FOOT_DIR[bedDir]);
    set(x0 + 2, h + 1, z0 + d - 2, BED_HEAD_DIR[bedDir]);
    set(x0 + w - 2, h + 1, z0 + d - 2, B.CRATE);
    set(x0 + w - 3, h + 1, z0 + d - 2, B.AIR);
    if (rnd() < 0.8) set(x0 + 1, h + 1, z0 + 1, B.BENCH);
    if (rnd() < 0.6) set(x0 + w - 2, h + 1, z0 + 3, B.BOOKSHELF);
    set(x0 + mid, h + 3, z0 + mid, B.LANTERN);
    // a small woodpile and a drying rack outside
    for (let i = 0; i < 3; i++) set(x0 + w, h + 1, z0 + 2 + i, log);
    set(x0 - 1, h + 1, z0 + d - 2, B.CRATE);
  }

  /**
   * Watchtower.
   * A battered plinth and buttressed base taper into a 3x3 shaft with arrow
   * slits, a hoarding of timber under the parapet, a proper crenellated deck
   * and a lit chest at the top.
   */
  watchtower(set, get, lx, lz, h, bio, rnd, flat) {
    if (flat && flat(2) > 3) return;
    const [stone, worn, trim] = this._masonry(bio, rnd);
    const plank = this._plank(bio);
    const hgt = 9 + ((rnd() * 5) | 0);
    this._clear(set, lx - 2, lz - 2, 7, 7, h + 1, hgt + 5);

    // stepped plinth: 5x5, then 4x4, then the shaft
    this._foundation(set, lx - 1, lz - 1, 5, 5, h, trim, stone, 4);
    for (let dz = -1; dz <= 3; dz++) for (let dx = -1; dx <= 3; dx++) {
      const ring = dx === -1 || dz === -1 || dx === 3 || dz === 3;
      if (ring) set(lx + dx, h + 1, lz + dz, rnd() < 0.2 ? worn : stone);
    }
    // corner buttresses climbing the first third of the shaft
    for (const [bx, bz] of [[-1, -1], [3, -1], [-1, 3], [3, 3]]) {
      const bh = 2 + ((rnd() * 3) | 0);
      for (let dy = 2; dy <= bh; dy++) set(lx + bx, h + dy, lz + bz, stone);
    }

    // 3x3 hollow shaft with arrow slits every third course
    for (let dy = 1; dy < hgt; dy++) {
      for (let dz = 0; dz < 3; dz++) {
        for (let dx = 0; dx < 3; dx++) {
          const edge = dx === 0 || dz === 0 || dx === 2 || dz === 2;
          if (!edge) { set(lx + dx, h + dy, lz + dz, B.AIR); continue; }
          const corner = (dx === 0 || dx === 2) && (dz === 0 || dz === 2);
          const slit = !corner && dy > 3 && dy % 3 === 0;
          if (slit) { set(lx + dx, h + dy, lz + dz, B.AIR); continue; }
          if (dy > 4 && rnd() < 0.04) continue;      // weathered gap
          set(lx + dx, h + dy, lz + dz, rnd() < 0.22 ? worn : stone);
        }
      }
    }

    // ground-floor doorway to the south + solid inner floor
    set(lx + 1, h, lz + 1, trim);
    set(lx + 1, h + 1, lz + 2, B.AIR);
    set(lx + 1, h + 2, lz + 2, B.AIR);
    set(lx + 1, h + 3, lz + 2, B.CHISELED);
    // ladder all the way up the north wall of the shaft
    for (let dy = 1; dy <= hgt; dy++) set(lx + 1, h + dy, lz + 1, B.LADDER_N);
    // torch-lit landing halfway up
    set(lx + 2, h + ((hgt / 2) | 0), lz + 1, B.TORCH_E);

    // timber hoarding just below the deck
    for (let dz = -1; dz <= 3; dz++) for (let dx = -1; dx <= 3; dx++) {
      const ring = dx === -1 || dz === -1 || dx === 3 || dz === 3;
      if (ring) set(lx + dx, h + hgt - 1, lz + dz, plank);
    }
    // deck with a central hatch
    for (let dz = -1; dz <= 3; dz++) for (let dx = -1; dx <= 3; dx++)
      set(lx + dx, h + hgt, lz + dz, (dx === 1 && dz === 1) ? B.LADDER_N : trim);
    // crenellations: merlons on alternating cells, two blocks at the corners
    for (let dz = -1; dz <= 3; dz++) for (let dx = -1; dx <= 3; dx++) {
      const ring = dx === -1 || dz === -1 || dx === 3 || dz === 3;
      if (!ring) continue;
      const corner = (dx === -1 || dx === 3) && (dz === -1 || dz === 3);
      if (corner) {
        set(lx + dx, h + hgt + 1, lz + dz, stone);
        set(lx + dx, h + hgt + 2, lz + dz, worn);
      } else if (((dx + dz) & 1) === 0) {
        set(lx + dx, h + hgt + 1, lz + dz, stone);
      }
    }
    // banner, brazier and the reward for the climb
    const wools = [B.WOOL_RED, B.WOOL_TEAL, B.WOOL_VIOLET, B.WOOL_AMBER];
    const wool = wools[(rnd() * wools.length) | 0];
    set(lx + 3, h + hgt + 1, lz + 1, wool);
    set(lx + 3, h + hgt + 2, lz + 1, wool);
    set(lx + 2, h + hgt + 1, lz + 1, B.CRATE);
    set(lx + 2, h + hgt + 1, lz, B.AIR);
    set(lx, h + hgt + 1, lz + 1, B.LANTERN);
  }

  /**
   * Abandoned campsite.
   * A stone-ringed hearth, log benches around it, a real A-frame tent on a
   * plank floor, a drying rack and a supply crate.
   */
  campsite(set, get, lx, lz, h, rnd, flat) {
    if (flat && flat(3) > 3) return;
    const log = B.LOG_ASPEN, plank = B.PLANK_ASPEN;
    this._clear(set, lx - 3, lz - 3, 8, 8, h + 1, 5);

    // trodden ground around the camp
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++)
        if (Math.abs(dx) + Math.abs(dz) <= 3) set(lx + dx, h, lz + dz, B.PATH);

    // fire pit: sunken hearth inside a ring of stones
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        set(lx + dx, h + 1, lz + dz, rnd() < 0.4 ? B.MOSSY_BRICKS : B.RUBBLE);
      }
    set(lx, h + 1, lz, B.HEARTH);
    // spit over the fire
    set(lx - 1, h + 2, lz, log);
    set(lx + 1, h + 2, lz, log);

    // log benches on two sides
    for (let dx = -1; dx <= 1; dx++) {
      set(lx + dx, h + 1, lz - 2, log);
      set(lx + dx, h + 1, lz + 2, log);
    }

    // A-frame tent to the east, on its own plank floor
    const tx = lx + 3;
    const wools = [B.WOOL_RED, B.WOOL_TEAL, B.WOOL_AMBER, B.WOOL_SLATE];
    const wool = wools[(rnd() * wools.length) | 0];
    for (let dz = -1; dz <= 1; dz++) for (let dx = 0; dx <= 2; dx++)
      set(tx + dx, h, lz + dz, plank);
    for (let dx = 0; dx <= 2; dx++) {
      set(tx + dx, h + 1, lz - 1, wool);
      set(tx + dx, h + 1, lz + 1, wool);
      set(tx + dx, h + 2, lz, wool);
    }
    // ridge pole and pegs
    set(tx - 1, h + 2, lz, log);
    set(tx + 3, h + 2, lz, log);
    if (rnd() < 0.7) {
      set(tx + 1, h + 1, lz, BED_FOOT_DIR[1]);
      set(tx + 2, h + 1, lz, BED_HEAD_DIR[1]);
    }

    // drying rack west of the fire
    set(lx - 3, h + 1, lz - 1, log);
    set(lx - 3, h + 2, lz - 1, log);
    set(lx - 3, h + 1, lz + 1, log);
    set(lx - 3, h + 2, lz + 1, log);
    set(lx - 3, h + 2, lz, log);
    if (rnd() < 0.5) set(lx - 3, h + 1, lz, B.CRATE);

    if (rnd() < 0.85) set(lx + 1, h + 1, lz - 3, B.CRATE);
    if (rnd() < 0.5) set(lx - 1, h + 1, lz - 3, B.BENCH);
    set(lx + 2, h + 1, lz - 2, B.TORCH);
  }

  /**
   * Well.
   * A proper coped rim, four posts, a tiled canopy with a ridge, a winch beam
   * with a bucket, and a laddered shaft dropping toward the caves.
   */
  wellRuin(set, get, lx, lz, h, rnd, flat) {
    if (flat && flat(2) > 3) return;
    const stone = B.STONE_BRICKS, worn = B.MOSSY_BRICKS, trim = B.SMOOTH_STONE;
    this._clear(set, lx - 2, lz - 2, 6, 6, h + 1, 7);

    // paved apron
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
      set(lx + dx, h, lz + dz, rnd() < 0.3 ? worn : trim);
    }
    // rim: two courses, coped with smooth stone
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const edge = Math.abs(dx) === 1 || Math.abs(dz) === 1;
        if (!edge) continue;
        set(lx + dx, h + 1, lz + dz, rnd() < 0.3 ? worn : stone);
        set(lx + dx, h + 2, lz + dz, trim);
      }
    }
    // shaft with a continuous ladder on its +Z wall, water at the bottom
    const depth = 7 + ((rnd() * 10) | 0);
    for (let dy = 0; dy < depth; dy++) {
      set(lx, h - dy, lz, B.LADDER_S);
      set(lx, h - dy, lz + 1, stone);
    }
    set(lx, h - depth, lz, B.WATER);

    // four posts and a ridged canopy
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      set(lx + px, h + 3, lz + pz, B.LOG_ASPEN);
      set(lx + px, h + 4, lz + pz, B.LOG_ASPEN);
    }
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
      set(lx + dx, h + 5, lz + dz, B.ROOF_TILE);
    }
    for (let dx = -1; dx <= 1; dx++) set(lx + dx, h + 6, lz, B.ROOF_TILE);
    // winch beam + bucket on a rope
    set(lx - 1, h + 4, lz, B.LOG_ASPEN);
    set(lx + 1, h + 4, lz, B.LOG_ASPEN);
    set(lx, h + 4, lz, B.LOG_ASPEN);
    set(lx, h + 3, lz, B.LADDER_S);
    if (rnd() < 0.6) set(lx + 2, h + 1, lz, B.CRATE);
    if (rnd() < 0.5) set(lx - 2, h + 1, lz + 1, B.MOSSY_BRICKS);
    set(lx + 1, h + 3, lz + 1, B.LANTERN);
  }

  /**
   * Desert obelisk.
   * A three-tier stepped base, a tapering shaft banded with carved sandstone,
   * corner braziers and a glowing capstone.
   */
  obelisk(set, get, lx, lz, h, rnd) {
    const hgt = 8 + ((rnd() * 6) | 0);
    this._clear(set, lx - 3, lz - 3, 8, 8, h + 1, hgt + 4);
    // stepped base: 7x7 -> 5x5 -> 3x3
    this._foundation(set, lx - 3, lz - 3, 7, 7, h, B.SANDSTONE, B.SANDSTONE, 3);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++)
      set(lx + dx, h + 1, lz + dz, rnd() < 0.12 ? B.CHISELED_SANDSTONE : B.SANDSTONE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++)
      set(lx + dx, h + 2, lz + dz, B.SANDSTONE);
    // corner braziers on the first step
    for (const [bx, bz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      set(lx + bx, h + 2, lz + bz, B.CHISELED_SANDSTONE);
      if (rnd() < 0.75) set(lx + bx, h + 3, lz + bz, B.HEARTH);
    }
    // shaft: 3x3 with carved bands, tapering to 1x1 near the top
    for (let dy = 3; dy < hgt; dy++) {
      const r = dy > hgt - 3 ? 0 : 1;
      const band = dy % 4 === 0;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++)
          set(lx + dx, h + dy, lz + dz,
            band ? B.CHISELED_SANDSTONE : (rnd() < 0.12 ? B.BASALT : B.SANDSTONE));
    }
    set(lx, h + hgt, lz, B.LUMEN);
    set(lx, h + hgt + 1, lz, B.CHISELED_SANDSTONE);
    if (rnd() < 0.6) set(lx + 2, h + 2, lz + 2, B.CRATE);
    // a couple of dead bushes at the foot of the monument
    for (let i = 0; i < 3; i++) {
      const bx = lx - 3 + ((rnd() * 7) | 0), bz = lz - 3 + ((rnd() * 7) | 0);
      if (get(bx, h + 1, bz) === B.AIR && rnd() < 0.6) set(bx, h + 1, bz, B.DEAD_BUSH);
    }
  }

  /**
   * Frost cairn.
   * A ringed plinth, a tapering stack of frost brick and stone, a lantern-lit
   * marker post and a buried cache.
   */
  cairn(set, get, lx, lz, h, rnd) {
    const hgt = 5 + ((rnd() * 3) | 0);
    this._clear(set, lx - 2, lz - 2, 6, 6, h + 1, hgt + 3);
    // ring of set stones around the base
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dz)) === 2;
      if (ring && rnd() < 0.55) set(lx + dx, h + 1, lz + dz, rnd() < 0.4 ? B.FROST_BRICK : B.STONE);
      if (Math.max(Math.abs(dx), Math.abs(dz)) <= 1) set(lx + dx, h, lz + dz, B.SMOOTH_STONE);
    }
    // stack: 3x3 base tapering to a single capstone
    for (let dy = 1; dy <= hgt; dy++) {
      const r = dy <= 2 ? 1 : (dy <= hgt - 2 ? 1 : 0);
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (r === 1 && Math.abs(dx) === 1 && Math.abs(dz) === 1 && dy > 2 && rnd() < 0.45) continue;
          set(lx + dx, h + dy, lz + dz,
            rnd() < 0.3 ? B.MOSS_STONE : (rnd() < 0.35 ? B.FROST_BRICK : B.STONE));
        }
    }
    set(lx, h + hgt + 1, lz, B.LANTERN);
    // marker post with a banner
    set(lx + 2, h + 1, lz, B.LOG_PINE);
    set(lx + 2, h + 2, lz, B.LOG_PINE);
    set(lx + 2, h + 3, lz, B.WOOL_TEAL);
    set(lx + 2, h + 4, lz, B.WOOL_WHITE);
    set(lx - 2, h + 1, lz + 1, B.TORCH);
    if (rnd() < 0.65) set(lx - 2, h + 1, lz - 1, B.CRATE);
  }
}

/** Spawn search: find a comfortable dry surface near origin */
export function findSpawn(gen) {
  for (let r = 0; r < 160; r += 4) {
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2 + r * 0.31;
      const x = Math.round(Math.cos(ang) * r);
      const z = Math.round(Math.sin(ang) * r);
      const c = gen.column(x, z);
      if (c.h > SEA_LEVEL + 2 && c.h < SEA_LEVEL + 22 &&
        c.biome !== BIOME.OCEAN && c.biome !== BIOME.FROST_PEAKS && c.biome !== BIOME.DUNES) {
        return { x: x + 0.5, y: c.h + 2.2, z: z + 0.5 };
      }
    }
  }
  return { x: 0.5, y: SEA_LEVEL + 12, z: 0.5 };
}
