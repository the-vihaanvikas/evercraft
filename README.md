# EVERCRAFT — Voxel Survival Sandbox

An open-ended 3D voxel adventure and survival sandbox that runs in the browser.
Explore a large procedurally generated world, mine resources, craft progressively
stronger gear, build freely, and survive the night.

**Everything is original.** All artwork, creatures, sounds, music and UI are
generated procedurally from code in this repository. No third-party game assets,
textures, sprites, audio files, or branding are used anywhere.

---

## Running

The game is plain ES modules — it only needs a static file server (module
workers and `import.meta.url` don't work from `file://`).

```bash
cd evercraft
python3 -m http.server 8080
# open http://localhost:8080
```

Requires a browser with **WebGL2** (Chrome, Edge, Firefox, Safari 15+).

---

## Controls

| Input | Action |
|---|---|
| `W A S D` | Move |
| `Space` | Jump · double-tap to fly (creative) |
| `Shift` | Sneak (won't walk off ledges) |
| `Ctrl` / `Z` | Sprint |
| Mouse | Look |
| **LMB** | Mine / attack (hold to break) |
| **RMB** | Place block / use object / eat |
| **MMB** | Pick block |
| `1`–`9`, Wheel | Select hotbar slot |
| `E` | Satchel (inventory + armor) |
| `C` | Crafting (2x2 in the satchel, 3x3 at a Crafting Table) |
| `M` | World map |
| `G` | Field guide |
| `F` | Eat held food |
| `Q` | Drop item (`Shift+Q` whole stack) |
| `F3` | Debug stats · `F5` or `V` cycles camera view |
| `Esc` | Pause / options |

**Controller:** sticks move & look, `RT` mine, `LT` place, `A` jump, `B` sneak,
`X` eat, `Y` satchel, bumpers cycle hotbar, `Start` pause.

---

## Gameplay

### World
Infinite chunk-streamed terrain with 11 biomes — Open Sea, Shoreline, Verdant
Plains, Bloommeadow, Aspen Woods, Emberwood Grove, Pinecrest Hills, Frostspire
Peaks, Golden Dunes, Rustflats Mesa and Mirefen — plus rivers, oceans, layered
cave systems, deep lava lakes and rare ruined outposts.

### Game modes
Chosen on the title screen when creating a world, and remembered in the save.

| Mode | Description |
|---|---|
| **Survival** | Health, hunger and hostiles. Gather resources and earn every upgrade. |
| **Creative** | Fly (double-tap Space or `R`), no damage, instant mining, and a categorised palette of every block and item in the game. |

### Crafting
Crafting is grid-based and pattern-sensitive. The satchel (`E`) carries a
personal **2x2** grid for basics such as planks, sticks, torches and the
Crafting Table itself; placing a **Crafting Table** and right-clicking it opens
the full **3x3** grid for tools, armour, containers and everything else.
Recipes are both shaped (the layout matters, and mirrored layouts are accepted)
and shapeless. A **recipe book** sits behind the book icon beside either grid —
click a recipe there to auto-fill the grid from your inventory.

In Creative the crafting grid is replaced by the item palette: eight utility
categories (Building Blocks, Nature, Decoration, Utility, Tools, Combat, Food,
Materials) covering all 138 registered items, with a search box that spans every
category. Click a tile for a full stack, shift-click to drop it straight into
the quick bar, right-click for a single item.

### Liquids
Water and lava flow: a source block spreads outward losing one level per step
(water reaches 7 blocks, lava 3), falls straight down at full strength when
unsupported, pools when it lands, and drains again when its supply is cut.
Lava that meets water hardens into stone or basalt. Swimming in lava is slow,
near-blinding and hot; rain and snow now splash on the surface of water rather
than sinking through it.

### Performance
The renderer targets a steady frame rate rather than a fixed resolution.
Chunk geometry is built in a worker and adopted on the main thread without
copying; chunk bounding spheres are derived from each mesh's vertical extent so
frustum culling can reject them cheaply; the sky is drawn after opaque geometry
so it only shades pixels the world did not already cover; and per-frame colour
and context allocations were hoisted out of the main loop.

**Auto quality** (Settings, on by default) watches a smoothed frame time and
scales the internal resolution between 1.5x and 0.6x, pulling render distance
in only if resolution alone is not enough. Turn it off to lock full resolution.
Distant creatures update on a staggered cadence with a proportionally larger
timestep, so their movement speed is unchanged.

### Progression
Survival starts with a few planks, sticks, berries and torches; Creative gives
you the whole item palette from the start.

```
Timber pick  → stone, coal
Stone pick   → copper
Copper pick  → iron
Iron pick    → gold, aurorite
Aurorite pick→ glimmer clusters
```

Ores are depth-banded: copper and coal are shallow, iron and gold sit deeper,
and **Aurorite** (teal, glowing) and **Glimmer** (violet) hide in the dangerous
deep below y=26. Craft 5 tool tiers × 4 tool types and 4 armor sets.

### Survival
Health, hunger, saturation, breath, armor, fall damage, drowning, lava, XP and
levels. Eat to regenerate; starve and you'll take damage. Armor reduces incoming
damage and wears out.

### Creatures
Friendly — **Hopper**, **Woolback** (shearable), **Tusker** (retaliates),
**Plume**. Hostile — **Husk** and **Creeplet** (both burn in daylight),
**Shardling** (ranged), **Gloom** (deep caves). Each has its own AI, model and
synthesized voice. Undead caught in open sun at dawn smoke, catch fire and die
within a few seconds; a roof, a tree canopy or a cave mouth keeps them alive,
so night raiders really do clear out when morning comes. Grounded species obey gravity and stick to the terrain —
the Plume is a ground bird that pecks, scurries and flutters at most a hop off
the floor rather than drifting into the sky.

### Building
Place and break ~70 block types on a grid. Interact with Crafting Tables,
Smelters (real fuel/burn/cook simulation), Chests with animated lids and
loot-bearing ruin variants, swinging Doors, Ladders, Torches and Lanterns.

Ladders and Torches are wall-mountable: aim at the *side* of a block and they
attach to that face, ladders as a flat climbable panel and torches leaning out
of the wall on a bracket. A ladder with nothing behind it will refuse to place.

### Structures
Explore to find ruined outposts, hunters' huts, watchtowers, abandoned
campsites, well shafts dropping into the caves, desert obelisks and frost
cairns — each matched to its biome and often holding a loot chest.

---

## Technical notes

* **Rendering** — custom GLSL voxel shader over a `DataArrayTexture` atlas, so
  the whole world draws with 3 materials (solid / cutout / liquid) and one draw
  call per chunk section. Per-vertex smooth lighting with ambient occlusion and
  quad-flipping to avoid AO gradient artefacts.
* **Threading** — terrain generation, flood-fill lighting (sky + block light)
  and mesh building all run in a Web Worker; geometry is handed back as
  transferable `ArrayBuffer`s so the main thread never blocks.
* **Streaming** — chunks load/unload in a spiral around the player with a
  configurable render distance (3–12) and inflight-request budget.
* **Textures** — every 16×16 tile and item icon is drawn pixel-by-pixel at
  startup by `src/textures.js`; block inventory icons are composited into
  isometric cubes on a 2D canvas.
* **Audio** — 100% WebAudio synthesis: material-specific mining/step/break
  sounds, creature voices, weather ambience and a generative pentatonic score
  that shifts to a minor scale at night or near danger.
* **Block entities** — chests are not plain cubes: the chunk mesher skips them
  and `ChestRenderer` draws an articulated model whose lid swings on a hinge,
  eased open and shut with its own creak-and-latch sound. Chest facing, contents
  and loot state all persist with the save.
* **Creatures** — every species is built from pivoted limbs (hips, shoulders,
  wing shoulders) rather than centre-rotated boxes, so gaits read correctly.
  All eight models are authored on a 1/16-block pixel grid with humanoid mobs
  on the classic 8x8x8 head / 8x12x4 torso / 4x12x4 limb proportions, and a
  geometric test asserts every model sits on the ground, fits its hitbox,
  reaches its arms forward when chasing and dips its head to graze.
  Stride frequency and amplitude follow the entity's real velocity, quadrupeds
  use diagonal leg pairing, the six-legged Creeplet scuttles on a tripod cycle,
  and idle motion (breathing, head turns, ear flicks, blinking) keeps mobs alive
  when standing still.
* **Music** — a generative score rather than random notes: a looping chord
  progression (I-IV-V-ii by day, i-VI-iv-VII at night, diminished/tritone
  colour when hostiles are near) drives a bass root, a detuned pad and a
  melody constrained to the current chord's tones. Bars are scheduled ahead on
  the WebAudio clock, so timing never drifts, and everything is pitched to
  exact 12-TET semitones.
* **Camera** — `F5` (or `V`) cycles first person, over-the-shoulder and
  front-facing. First person shows the player's arm and held item.
  Third person draws a fully animated avatar (walk cycle, tool swing, flight
  pose, head tracking the pitch) with the camera pulled in when terrain would
  clip it.
* **Structures** — seven hand-written generators (ruined outpost with three
  floor plans, hunter's hut, watchtower, campsite, well shaft, desert obelisk,
  frost cairn) chosen by a biome-aware weighted roll, each using local wood and
  stone and rejecting ground that is too steep.
* **Persistence** — three save slots in `localStorage`, storing the seed, only
  the blocks you changed (sparse edits), container contents, dropped items and
  full player state. Autosaves every 45 s.

### Layout

```
index.html         shell, title screen
style.css          all UI styling
vendor/            three.js r160 (MIT)
src/
  main.js          bootstrap, title, loading
  game.js          game loop, interaction, saves
  world.js         chunk manager, edits, streaming
  worker.js        worker entry (gen + mesh)
  worldgen.js      biomes, caves, ores, trees, structures
  mesher.js        lighting flood-fill + mesh building
  blocks.js        block & item registry
  recipes.js       crafting / smelting / fuel tables
  creative.js      creative-mode item palette, categorised
  player.js        physics, inventory, survival stats
  entities.js      creature models & AI
  loot.js          balanced chest loot tables
  render.js        shaders, sky, particles, weather, drops,
                   animated chest block entities
  textures.js      procedural pixel-art generation
  audio.js         WebAudio synthesis
  ui.js            HUD and all interface screens
test/              puppeteer test suites
```

---

## Tests

```bash
npm install                 # puppeteer
python3 -m http.server 8080 &
node test/systems.mjs       # 110 assertions: worldgen, recipes, combat, saves,
                            # textures, perf, mobs, chests, camera, flight, music
node test/smoke.mjs         # boot + play + reload, asserts zero console errors
node test/visual.mjs        # screenshots of world, caves, UI
node test/gallery.mjs       # title, night, inventory, smelter, guide
node test/mobaudit.mjs      # per-species limb/pose geometry report
```

`systems.mjs` covers seed determinism, ore distribution, cave carving, tier
gating, the full crafting chain, smelting, containers, entity combat and loot,
hunger/regen/starvation, armor mitigation, fall damage, XP, the day/night cycle,
and save→reload fidelity of terrain edits, inventory and position.

It also asserts the pixel-art invariants that are easy to regress: that
`grass_side` has turf on top and dirt below, that the torch flame sits at the
top of its tile, that grass blades are rooted at the tile floor, that the two
halves of tall grass break together, and that placing a torch does not inflate
chunk relight cost.

---

## Licence

Game code and all generated assets: free to use and modify.
Bundled dependency: [three.js](https://threejs.org) r160, MIT.
