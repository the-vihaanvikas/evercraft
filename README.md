# EVERCRAFT — Voxel Survival Sandbox

An open-ended 3D voxel adventure and survival sandbox that runs in the browser.
Explore a large procedurally generated world, mine resources, craft progressively
stronger gear, build freely, and survive the night.

**Everything is original.** All artwork, creatures, sounds, music and UI are
generated procedurally from code in this repository. No third-party game assets,
textures, sprites, audio files, or branding are used anywhere.

## The cinematic title

Booting the game drops you into a short title sequence: the EVERCRAFT wordmark
slams in over black, and the camera then rises through a **real generated
world** — the same worldgen, voxel shaders and chunk streaming the game uses —
spiralling out from grass level to a high vista while the menu fades in over
the flyover. A gentle generative theme plays after your first click. Skip the
sting at any time by clicking.

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
| `X` | Swap main hand ↔ **off hand** |
| `Q` | Drop item (`Shift+Q` whole stack) |
| `F3` | Debug stats · `F5` or `V` cycles camera view |
| `Esc` | Pause / options |

**Controller:** sticks move & look, `RT` mine, `LT` place, `A` jump, `B` sneak,
`X` eat, `Y` satchel, bumpers cycle hotbar, `Start` pause.

### Hands
Besides the nine quick-bar slots the player has an **off hand**: one extra stack
carried in the left hand. It has its own slot under the inventory paper doll,
shows as a small box beside the quick bar, and `X` swaps it with whatever the
main hand holds. Right-click falls through to it, so a torch or a stack of
blocks parked there can be used without touching the quick bar. In first person
the left hand is drawn **only when it is holding something** — and while
swimming, where both arms are needed for the stroke.

### Sleeping
Right-click a bed at night for a staged sleep cinematic: the camera lies down on
the pillow, the eyelids slide shut, the clock races through the small hours
while you heal, the eyes reopen on the real sunrise, and the player sits back
up at 07:12. Interaction — mining, placing, menus, movement — is paused for the
whole sequence (`Esc` skips it). Beds always set your respawn point, even by day.

### Dying
Death is a cinematic too, in the same staged style: the camera sags and rolls,
the world slows to a drift and bleeds red while a veil closes in, and the death
screen — skull, cause and a run summary — appears only after the fall. `Esc`
skips the fall. Your last cause of death is always remembered, from a Husk's
claws to the void.

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
Materials) covering every registered item, with a search box that spans every
category. **Click a tile for a single item, shift-click for a full stack**,
clicking a different tile replaces what the cursor is holding, and clicking the
empty space of the palette throws the held stack away.

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
and context allocations were hoisted out of the main loop. The tile atlas is
built once and shared between the title flyover and the game world.

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
**Plume**, **Fennix** (a swift fox that bolts if you get close) and **Wisp**
(a glow spirit of summer nights that melts away at dawn). Hostile — **Husk**
and **Creeplet** (both burn in daylight), **Shardling** (ranged),
**Emberling** (a living ember from the emberwood grove and the lava pockets
below, always shedding sparks) and **Gloom** (deep caves). Each has its own AI,
model and synthesized voice. Undead caught in open sun at dawn smoke, catch
fire and die within a few seconds; a roof, a tree canopy or a cave mouth keeps
them alive, so night raiders really do clear out when morning comes. Grounded
species obey gravity and stick to the terrain — the Plume is a ground bird
that pecks, scurries and flutters at most a hop off the floor rather than
drifting into the sky.

### Building
Place and break ~80 block types on a grid. Interact with Crafting Tables,
Smelters (real fuel/burn/cook simulation), Chests with animated lids and
loot-bearing ruin variants, swinging Doors, Ladders, Torches, Lanterns and
**wooden Fences** — four woods, connecting posts and rails that join fences
and walls into proper pens.

Ladders and Torches are wall-mountable: aim at the *side* of a block and they
attach to that face, ladders as a flat climbable panel and torches leaning out
of the wall on a bracket. A ladder with nothing behind it will refuse to place.

**Doors come in four woods** — Aspen, Emberwood, Pine and Palm — each crafted
from its own planks, with its own tile art, and each swinging on its own hinge
state (4 facings × open/closed × two halves). Old saves that stored the single
generic door keep working; the item is migrated to the Aspen door on load.

The building palette also includes Mossy and Cracked Stone Bricks, Smooth Stone,
Chiseled Sandstone, Frost Bricks, Clay Roof Tiles, Thatch, Daub Plaster, Timber
Frame, Bookshelves, Mire Mud, the light-emitting **Ember Hearth** and four
woods of **Fence** — plus Dead Bush and River Reeds out in the world.

### Structures
Explore to find ruined outposts, hunters' huts, watchtowers, abandoned
campsites, well shafts dropping into the caves, desert obelisks and frost
cairns — each matched to its biome and often holding a loot chest.

Structures are **painted from the 3×3 chunk neighbourhood**, so a building whose
origin sits in the next chunk still writes the part that overlaps this one:
nothing is sliced off at a chunk border any more, and buildings can sit anywhere
in a chunk. Every site is levelled onto a plinth that backfills to the real
ground rather than floating, and the buildings themselves are properly
detailed — corner pilasters and arched doorways on ruins, timber-framed walls,
ridged and overhanging roofs, chimneys and porches on huts, buttressed bases,
arrow slits, hoarding and crenellations on towers, A-frame tents and stone-ringed
hearths in camps, coped rims and tiled canopies on wells, tiered and banded
obelisks with corner braziers, and lantern-topped frost cairns.

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
  sounds, creature voices, a music-box lullaby for sleeping, a slow descent for
  dying, a generative menu theme, weather ambience and a generative pentatonic
  score that shifts to a minor scale at night or near danger.
* **Block entities** — chests are not plain cubes: the chunk mesher skips them
  and `ChestRenderer` draws an articulated model whose lid swings on a hinge,
  eased open and shut with its own creak-and-latch sound. Chest facing, contents
  and loot state all persist with the save.
* **Creatures** — every species is built from pivoted limbs (hips, shoulders,
  wing shoulders) rather than centre-rotated boxes, so gaits read correctly.
  All eleven models are authored on a 1/16-block pixel grid with humanoid mobs
  on the classic 8x8x8 head / 8x12x4 torso / 4x12x4 limb proportions, and a
  geometric test asserts every model sits on the ground, fits its hitbox,
  reaches its arms forward when chasing and dips its head to graze.
  Stride frequency and amplitude follow the entity's real velocity, quadrupeds
  use diagonal leg pairing, the six-legged Creeplet scuttles on a tripod cycle,
  and idle motion (breathing, head turns, ear flicks, blinking, the fennix's
  tail swish, the emberling's licking flames, the wisp's orbiting motes) keeps
  mobs alive when standing still. The Husk has a torn hood, ribs and clawed
  hands; the Shardling wears a breathing heart-crystal; the Gloom drags cloth
  tatters under its shroud.
* **Music** — a generative score rather than random notes: a looping chord
  progression (I-IV-V-ii by day, i-VI-iv-VII at night, diminished/tritone
  colour when hostiles are near) drives a bass root, a detuned pad and a
  melody constrained to the current chord's tones. Bars are scheduled ahead on
  the WebAudio clock, so timing never drifts, and everything is pitched to
  exact 12-TET semitones.
* **Camera** — `F5` (or `V`) cycles first person, over-the-shoulder and
  front-facing. First person shows the player's arm and held item in real tile
  art (blocks carry their actual textures; picks, axes, shovels and blades are
  proper shapes; torches and lanterns glow), plus the off hand when it holds
  one. Impact shake jolts the view when you take a hit. Third person draws a
  fully animated avatar (walk cycle, tool swing, flight pose, head tracking
  the pitch, a face with pupils and brows, and the held item in its fist) with
  the camera pulled in when terrain would clip it. The swim pose applies its
  pitch about the avatar's *own* right axis (`YXZ` euler order), so the swimmer
  lies face-down along its heading at every yaw instead of rolling onto its
  side, and strokes a real alternating front crawl with a flutter kick.
* **UI scale** — every inventory grid is laid out from a single
  `--slot-size` custom property that tracks viewport height, so the backpack,
  the chest, the crafting grids and the pinned quick bar always share the same
  column pitch and the whole panel fits on screen without scrolling, down to
  short laptop displays.
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
node test/systems.mjs       # 200+ assertions: worldgen, recipes, combat, saves,
                            # textures, perf, mobs, chests, camera, flight, music,
                            # lighting, doors, off hand, sleep, swimming, UI layout
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

Round 6 covers the newer systems: that **breaking** a light source relights the
neighbouring chunks (an emitter's glow used to linger in the chunks around the
socket), that every wood's door opens/drops in kind, that the off hand is drawn
only when filled and survives a save, that the sleep cinematic runs its stages,
pauses interaction, heals and lands on morning, that the swimming avatar never
rolls onto its side at any heading, that the new blocks are textured, craftable
and in the palette, that structures spill across chunk borders deterministically,
and that every inventory grid lines up and fits on screen without scrolling.

Round 7 covers the cinematic layer: the death cinematic is staged with a fall
and a red-out, all four fence woods are registered, textured, craftable and in
the palette with the post-and-rail mesh class, and the new species (Fennix,
Wisp, Emberling) each build multi-part models that pass the geometry audit.

---

## Licence

Game code and all generated assets: free to use and modify.
Bundled dependency: [three.js](https://threejs.org) r160, MIT.
