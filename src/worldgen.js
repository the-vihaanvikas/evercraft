// VOXHAVEN - procedural world generation (worker-safe, no DOM).

import { Noise, mulberry32, clamp, lerp, smoothstep } from './noise.js';
import { B, CHUNK_X, CHUNK_Z, WORLD_H, SEA_LEVEL } from './blocks.js';

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
          case BIOME.MARSH: topBlock = rnd() < 0.25 ? B.CLAY : B.GRASS; subBlock = B.DIRT; subDepth = 4; break;
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
          if (col.temp < -0.34 && SEA_LEVEL - h < 24) set(lx, SEA_LEVEL, lz, B.ICE);
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
              if (r < 0.22) setIfAir(lx, h + 1, lz, B.SHORT_GRASS);
              else if (r < 0.30) tallGrass(lx, h + 1, lz);
              else if (r < 0.36) setIfAir(lx, h + 1, lz, B.FERN);
              else if (r < 0.375) setIfAir(lx, h + 1, lz, B.MUSHROOM);
              break;
            case BIOME.DUNES:
              if (r < 0.012) this.cactus(set, get, lx, h + 1, lz, rnd);
              break;
            case BIOME.RUST_FLATS:
              if (r < 0.010) this.cactus(set, get, lx, h + 1, lz, rnd);
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
    // Two independent hashes: one decides IF a chunk gets a structure, a
    // second decides WHICH, so structure kinds are spread evenly instead of
    // always co-occurring on the same chunk coordinates.
    const sHash = ((cx * 73856093) ^ (cz * 19349663) ^ this.seed) >>> 0;
    const kHash = ((cx * 40503671) ^ (cz * 29986577) ^ (this.seed * 6971)) >>> 0;
    if (sHash % 11 === 0) {
      this.placeStructure(kHash, set, get, heights, biomes, rnd);
    }
  }

  /**
   * Choose and build a structure appropriate to the local biome.
   * Every builder is defensive: it bails out on water, steep ground or the
   * wrong biome rather than carving a floating box into the landscape.
   */
  placeStructure(kHash, set, get, heights, biomes, rnd) {
    const lx = 4 + ((rnd() * 6) | 0), lz = 4 + ((rnd() * 6) | 0);
    const i2 = lx + lz * CHUNK_X;
    const bio = biomes[i2];
    const h = heights[i2];
    if (bio === BIOME.OCEAN) return;
    if (h < SEA_LEVEL + 1) return;

    // reject uneven ground so buildings don't hang off cliffs
    const flat = (r) => {
      let lo = 999, hi = -999;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = lx + dx, zz = lz + dz;
          if (xx < 0 || zz < 0 || xx >= CHUNK_X || zz >= CHUNK_Z) continue;
          const hh = heights[xx + zz * CHUNK_X];
          if (hh < lo) lo = hh;
          if (hh > hi) hi = hh;
        }
      }
      return hi - lo;
    };

    const frost = bio === BIOME.FROST_PEAKS;
    const desert = bio === BIOME.DUNES || bio === BIOME.RUST_FLATS;
    const wooded = bio === BIOME.FOREST || bio === BIOME.PINE_HILLS ||
      bio === BIOME.EMBERWOOD;

    // weighted pick, biased by biome
    const roll = kHash % 100;
    if (desert) {
      if (roll < 40) return this.obelisk(set, get, lx, lz, h, rnd);
      if (roll < 70) return this.wellRuin(set, get, lx, lz, h, rnd, flat);
      return this.ruin(set, get, lx, lz, h, bio, rnd, flat);
    }
    if (frost) {
      if (roll < 55) return this.cairn(set, get, lx, lz, h, rnd);
      return this.watchtower(set, get, lx, lz, h, bio, rnd, flat);
    }
    if (wooded) {
      if (roll < 30) return this.campsite(set, get, lx, lz, h, rnd, flat);
      if (roll < 55) return this.hunterHut(set, get, lx, lz, h, bio, rnd, flat);
      if (roll < 75) return this.watchtower(set, get, lx, lz, h, bio, rnd, flat);
      return this.ruin(set, get, lx, lz, h, bio, rnd, flat);
    }
    // open land
    if (roll < 22) return this.campsite(set, get, lx, lz, h, rnd, flat);
    if (roll < 42) return this.wellRuin(set, get, lx, lz, h, rnd, flat);
    if (roll < 60) return this.watchtower(set, get, lx, lz, h, bio, rnd, flat);
    if (roll < 78) return this.hunterHut(set, get, lx, lz, h, bio, rnd, flat);
    return this.ruin(set, get, lx, lz, h, bio, rnd, flat);
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

  /** small ruined outpost, contains a crate (marked via metadata block) */
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
  /** Clear headroom above a footprint so trees don't grow through a build. */
  _clear(set, x0, z0, w, d, y, hgt) {
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++)
        for (let dy = 0; dy < hgt; dy++) set(x0 + dx, y + dy, z0 + dz, B.AIR);
  }

  /**
   * Ruined outpost — now with three floor plans, optional second storey,
   * rubble, and biome-appropriate masonry.
   */
  ruin(set, get, lx, lz, h, bio, rnd, flat) {
    if (flat && flat(3) > 4) return;
    const variant = (rnd() * 3) | 0;
    const w = variant === 2 ? 6 : 4;
    const d = variant === 1 ? 6 : 4;
    const wallH = variant === 1 ? 4 : 3;
    const stone = bio === BIOME.DUNES || bio === BIOME.RUST_FLATS
      ? B.SANDSTONE : B.STONE_BRICKS;
    const worn = bio === BIOME.FROST_PEAKS ? B.STONE : B.MOSS_STONE;

    this._clear(set, lx - 1, lz - 1, w + 2, d + 2, h + 1, wallH + 2);
    for (let dz = -1; dz <= d; dz++) {
      for (let dx = -1; dx <= w; dx++) {
        set(lx + dx, h, lz + dz, stone);
        for (let dy = 1; dy <= wallH; dy++) {
          const edge = dx === -1 || dz === -1 || dx === w || dz === d;
          if (!edge) continue;
          // higher courses crumble more, giving a natural broken silhouette
          const decay = 0.12 + dy * 0.09;
          if (rnd() < decay) continue;
          set(lx + dx, h + dy, lz + dz, rnd() < 0.3 ? worn : stone);
        }
      }
    }
    // doorway
    const dxDoor = (rnd() * w) | 0;
    set(lx + dxDoor, h + 1, lz - 1, B.AIR);
    set(lx + dxDoor, h + 2, lz - 1, B.AIR);
    // scattered rubble inside
    for (let i = 0; i < 4; i++) {
      const rx = lx + ((rnd() * w) | 0), rz = lz + ((rnd() * d) | 0);
      if (rnd() < 0.5) set(rx, h + 1, rz, B.RUBBLE);
    }
    // chest against the back wall, with open floor in front of it
    set(lx + 1, h + 1, lz + d - 1, B.CRATE);
    set(lx + 1, h + 1, lz + d - 2, B.AIR);
    if (rnd() < 0.55) set(lx + w - 2, h + 1, lz + 1, B.BENCH);
    if (rnd() < 0.35) set(lx + w - 1, h + 1, lz, B.TORCH);
    if (rnd() < 0.25) set(lx + 2, h + 1, lz + 1, B.SMELTER);
    // occasional partial upper floor
    if (variant === 1 && rnd() < 0.5) {
      for (let dz = 0; dz < d; dz++)
        for (let dx = 0; dx < w; dx++)
          if (rnd() < 0.6) set(lx + dx, h + wallH, lz + dz, B.PLANK_PINE);
    }
  }

  /** Small hunter's hut: planks, a pitched roof, a bed of wool and a chest. */
  hunterHut(set, get, lx, lz, h, bio, rnd, flat) {
    if (flat && flat(3) > 3) return;
    const plank = this._plank(bio), log = this._log(bio);
    const w = 5, d = 5;
    this._clear(set, lx - 1, lz - 1, w + 2, d + 2, h + 1, 7);
    for (let dz = -1; dz <= d; dz++)
      for (let dx = -1; dx <= w; dx++) set(lx + dx, h, lz + dz, plank);
    // corner posts + walls
    for (let dy = 1; dy <= 3; dy++) {
      for (let dz = -1; dz <= d; dz++) {
        for (let dx = -1; dx <= w; dx++) {
          const edge = dx === -1 || dz === -1 || dx === w || dz === d;
          if (!edge) continue;
          const corner = (dx === -1 || dx === w) && (dz === -1 || dz === d);
          set(lx + dx, h + dy, lz + dz, corner ? log : plank);
        }
      }
    }
    // window + door
    set(lx + 2, h + 2, lz - 1, B.GLASS);
    set(lx + w, h + 2, lz + 2, B.GLASS);
    set(lx + 2, h + 1, lz - 1, B.AIR);
    set(lx + 2, h + 2, lz - 1, B.AIR);
    // pitched roof
    for (let r = 0; r <= 2; r++) {
      const y = h + 4 + r;
      for (let dz = -1 + r; dz <= d - r; dz++)
        for (let dx = -1 + r; dx <= w - r; dx++)
          set(lx + dx, y, lz + dz, plank);
    }
    // interior
    const wools = [B.WOOL_RED, B.WOOL_TEAL, B.WOOL_AMBER, B.WOOL_VIOLET, B.WOOL_WHITE];
    const wool = wools[(rnd() * wools.length) | 0];
    set(lx, h + 1, lz + d - 1, wool);
    set(lx + 1, h + 1, lz + d - 1, wool);
    set(lx + w - 1, h + 1, lz + 1, B.CRATE);
    set(lx + w - 2, h + 1, lz + 1, B.AIR);
    if (rnd() < 0.7) set(lx + w - 1, h + 1, lz + d - 1, B.BENCH);
    if (rnd() < 0.5) set(lx, h + 1, lz, B.SMELTER);
    set(lx + 2, h + 3, lz + 2, B.LANTERN);
  }

  /** Watchtower: a tall shaft with a ladder and a lit crown. */
  watchtower(set, get, lx, lz, h, bio, rnd, flat) {
    if (flat && flat(2) > 3) return;
    const stone = bio === BIOME.DUNES || bio === BIOME.RUST_FLATS
      ? B.SANDSTONE : B.STONE_BRICKS;
    const hgt = 7 + ((rnd() * 5) | 0);
    this._clear(set, lx - 1, lz - 1, 5, 5, h + 1, hgt + 3);
    for (let dy = 0; dy <= hgt; dy++) {
      for (let dz = 0; dz < 3; dz++) {
        for (let dx = 0; dx < 3; dx++) {
          const edge = dx === 0 || dz === 0 || dx === 2 || dz === 2;
          if (!edge) { set(lx + dx, h + dy, lz + dz, B.AIR); continue; }
          if (dy > 2 && rnd() < 0.06) continue;   // weathered gaps
          set(lx + dx, h + dy, lz + dz, rnd() < 0.22 ? B.MOSS_STONE : stone);
        }
      }
    }
    // interior ladder
    for (let dy = 1; dy < hgt; dy++) set(lx + 1, h + dy, lz + 1, B.LADDER);
    // battlement crown
    for (let dz = -1; dz <= 3; dz++) {
      for (let dx = -1; dx <= 3; dx++) {
        const ring = dx === -1 || dz === -1 || dx === 3 || dz === 3;
        if (ring) set(lx + dx, h + hgt, lz + dz, stone);
        if (ring && (dx + dz) % 2 === 0) set(lx + dx, h + hgt + 1, lz + dz, stone);
      }
    }
    set(lx + 1, h + hgt + 1, lz + 1, rnd() < 0.5 ? B.LANTERN : B.LUMEN);
    if (rnd() < 0.6) set(lx + 1, h + 1, lz + 1, B.CRATE);
  }

  /** Abandoned campsite: fire ring, log seats, a tent of wool. */
  campsite(set, get, lx, lz, h, rnd, flat) {
    if (flat && flat(2) > 3) return;
    this._clear(set, lx - 2, lz - 2, 6, 6, h + 1, 4);
    // fire ring
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        if (dx || dz) set(lx + dx, h + 1, lz + dz, B.RUBBLE);
    set(lx, h + 1, lz, rnd() < 0.6 ? B.TORCH : B.COAL_BLOCK);
    // log seats
    const log = B.LOG_ASPEN;
    set(lx - 2, h + 1, lz, log);
    set(lx + 2, h + 1, lz, log);
    // lean-to tent
    const wools = [B.WOOL_RED, B.WOOL_TEAL, B.WOOL_AMBER, B.WOOL_SLATE];
    const wool = wools[(rnd() * wools.length) | 0];
    for (let dx = -1; dx <= 1; dx++) {
      set(lx + dx, h + 2, lz + 2, wool);
      set(lx + dx, h + 1, lz + 3, wool);
    }
    if (rnd() < 0.8) set(lx + 1, h + 1, lz + 2, B.CRATE);
    if (rnd() < 0.4) set(lx - 1, h + 1, lz + 2, B.BENCH);
  }

  /** Stone well with a shaft dropping toward the caves below. */
  wellRuin(set, get, lx, lz, h, rnd, flat) {
    if (flat && flat(2) > 3) return;
    const stone = B.STONE_BRICKS;
    this._clear(set, lx - 1, lz - 1, 5, 5, h + 1, 5);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const edge = Math.abs(dx) === 1 || Math.abs(dz) === 1;
        if (edge) {
          set(lx + dx, h + 1, lz + dz, stone);
          set(lx + dx, h + 2, lz + dz, rnd() < 0.3 ? B.MOSS_STONE : stone);
        }
      }
    }
    // shaft
    const depth = 6 + ((rnd() * 10) | 0);
    for (let dy = 0; dy < depth; dy++) {
      set(lx, h - dy, lz, B.AIR);
      if (dy % 2 === 0) set(lx, h - dy, lz + 1, B.LADDER);
    }
    // roof posts
    if (rnd() < 0.6) {
      set(lx - 1, h + 3, lz - 1, B.LOG_ASPEN);
      set(lx + 1, h + 3, lz + 1, B.LOG_ASPEN);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++)
          set(lx + dx, h + 4, lz + dz, B.PLANK_ASPEN);
    }
    if (rnd() < 0.5) set(lx + 2, h + 1, lz, B.CRATE);
  }

  /** Desert obelisk: a tapering monument with a glowing capstone. */
  obelisk(set, get, lx, lz, h, rnd) {
    const hgt = 6 + ((rnd() * 6) | 0);
    this._clear(set, lx - 2, lz - 2, 6, 6, h + 1, hgt + 3);
    // stepped base
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++)
        set(lx + dx, h + 1, lz + dz, B.SANDSTONE);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        set(lx + dx, h + 2, lz + dz, B.SANDSTONE);
    // shaft
    for (let dy = 3; dy < hgt; dy++) {
      const r = dy > hgt - 3 ? 0 : 1;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++)
          set(lx + dx, h + dy, lz + dz, rnd() < 0.15 ? B.BASALT : B.SANDSTONE);
    }
    set(lx, h + hgt, lz, B.LUMEN);
    if (rnd() < 0.5) set(lx + 2, h + 2, lz + 2, B.CRATE);
  }

  /** Frost cairn: a stacked stone marker, often with a buried cache. */
  cairn(set, get, lx, lz, h, rnd) {
    const hgt = 3 + ((rnd() * 3) | 0);
    this._clear(set, lx - 1, lz - 1, 4, 4, h + 1, hgt + 2);
    for (let dy = 1; dy <= hgt; dy++) {
      const r = dy < hgt - 1 ? 1 : 0;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (r === 1 && Math.abs(dx) === 1 && Math.abs(dz) === 1 && rnd() < 0.5) continue;
          set(lx + dx, h + dy, lz + dz, rnd() < 0.35 ? B.MOSS_STONE : B.STONE);
        }
    }
    set(lx, h + hgt + 1, lz, B.TORCH);
    if (rnd() < 0.55) set(lx + 2, h + 1, lz, B.CRATE);
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
