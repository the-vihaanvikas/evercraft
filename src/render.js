// VOXHAVEN - materials, sky, particles, item drops, damage overlay.

import * as THREE from '../vendor/three.module.js';
import { TILE, buildTileLayers } from './textures.js';
import { B, BLOCKS, block } from './blocks.js';

// ---------------------------------------------------------------- shaders
const VERT = /* glsl */`
precision highp float;
attribute float layer;
attribute vec2 lt;      // x = sky, y = block light (0..1)
attribute float ao;
varying vec2 vUv;
varying float vLayer;
varying vec2 vLt;
varying float vAo;
varying vec3 vWorld;
varying float vFogDepth;
uniform float uTime;
uniform int uWave;
void main() {
  vUv = uv;
  vLayer = layer;
  vLt = lt;
  vAo = ao;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  if (uWave == 1) {
    wp.y += sin(uTime * 1.7 + wp.x * 0.7 + wp.z * 0.9) * 0.045;
    wp.x += sin(uTime * 1.1 + wp.z * 0.6) * 0.02;
  }
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uTorchColor;
uniform float uDaylight;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlphaTest;
uniform float uOpacity;
uniform float uTime;
uniform vec3 uCamPos;
uniform float uUnderwater;
varying vec2 vUv;
varying float vLayer;
varying vec2 vLt;
varying float vAo;
varying vec3 vWorld;
varying float vFogDepth;

void main() {
  vec4 tex = texture(uAtlas, vec3(vUv, vLayer));
  if (tex.a < uAlphaTest) discard;

  float sky = vLt.x;
  float blk = vLt.y;

  // smooth light curve
  float skyL = pow(sky, 1.35) * uDaylight;
  float blkL = pow(blk, 1.30);

  vec3 light = uSunColor * skyL + uTorchColor * blkL * 1.15 + uAmbient;
  light = min(light, vec3(1.6));

  vec3 col = tex.rgb * light * vAo;

  // subtle distance desaturation into fog
  float fogF = smoothstep(uFogNear, uFogFar, vFogDepth);
  col = mix(col, uFogColor, fogF);

  // Submersion tint. 1 = water (cool, mild), 2 = lava (hot and almost
  // opaque, so being inside lava blinds you instead of showing a clear view).
  if (uUnderwater > 1.5) {
    col = mix(col, vec3(0.85, 0.22, 0.03), 0.86);
    col += vec3(0.30, 0.08, 0.0) * (0.6 + 0.4 * sin(uTime * 3.0 + vWorld.y * 2.0));
  } else if (uUnderwater > 0.5) {
    col = mix(col, vec3(0.11, 0.33, 0.47), 0.34);
  }

  gl_FragColor = vec4(col, tex.a * uOpacity);
}
`;

export function makeMaterials(renderer) {
  const { data, index, count } = buildTileLayers();
  const tex = new THREE.DataArrayTexture(data, TILE, TILE, count);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  tex.anisotropy = Math.min(4, maxAniso);
  tex.needsUpdate = true;

  const uniforms = {
    uAtlas: { value: tex },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uAmbient: { value: new THREE.Color(0.08, 0.09, 0.13) },
    uTorchColor: { value: new THREE.Color(1.0, 0.72, 0.42) },
    uDaylight: { value: 1 },
    uFogColor: { value: new THREE.Color(0.6, 0.75, 0.95) },
    uFogNear: { value: 40 },
    uFogFar: { value: 150 },
    uAlphaTest: { value: 0.5 },
    uOpacity: { value: 1 },
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uUnderwater: { value: 0 },
    uWave: { value: 0 },
  };

  const shared = (over) => {
    const u = {};
    for (const k in uniforms) u[k] = uniforms[k];   // share references
    for (const k in over) u[k] = { value: over[k] };
    return u;
  };

  const solid = new THREE.ShaderMaterial({
    uniforms: shared({ uAlphaTest: 0.5, uOpacity: 1, uWave: 0 }),
    vertexShader: VERT, fragmentShader: FRAG,
    side: THREE.FrontSide,
  });
  const cutout = new THREE.ShaderMaterial({
    uniforms: shared({ uAlphaTest: 0.35, uOpacity: 1, uWave: 0 }),
    vertexShader: VERT, fragmentShader: FRAG,
    side: THREE.DoubleSide, transparent: false,
  });
  const liquid = new THREE.ShaderMaterial({
    uniforms: shared({ uAlphaTest: 0.02, uOpacity: 0.80, uWave: 1 }),
    vertexShader: VERT, fragmentShader: FRAG,
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
  });

  return { solid, cutout, liquid, shared: uniforms, texIndex: index, atlas: tex };
}

// -------------------------------------------------------------------- sky
const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunTint;
uniform float uNight;
uniform float uTime;

// hash for stars
float hash(vec3 p){ p = fract(p*0.3183099+vec3(0.71,0.113,0.419)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }

void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col;
  if (h > 0.0) col = mix(uHorizon, uTop, pow(clamp(h,0.0,1.0), 0.62));
  else col = mix(uHorizon, uBottom, pow(clamp(-h,0.0,1.0), 0.5));

  // ---- sun & moon as chunky pixel-art squares -------------------------
  // A smooth pow() falloff reads as a soft round blob. Instead we project the
  // view direction onto a basis around the body and snap it to a coarse grid,
  // so both are crisp squares built from visible texels.
  vec3 sdir = normalize(uSunDir);
  vec3 sRight = normalize(cross(sdir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 sUp = normalize(cross(sRight, sdir));

  // --- sun
  float facing = dot(d, sdir);
  if (facing > 0.985) {
    vec2 uv = vec2(dot(d, sRight), dot(d, sUp)) / max(facing, 1e-4);
    float R = 0.055;                       // angular half-size of the disc
    vec2 t = uv / R;                       // -1..1 across the sun quad
    float texels = 8.0;                    // sun is 8x8 chunky texels
    vec2 q = floor(t * texels) / texels;   // snap to the texel grid
    if (abs(q.x) < 1.0 && abs(q.y) < 1.0) {
      // nibble the corners so it reads as a rounded pixel disc, not a plain box
      float corner = abs(q.x) + abs(q.y);
      if (corner < 1.72) {
        float ring = step(1.36, corner);   // slightly darker rim texels
        col = mix(uSunTint * 1.9, uSunTint * 1.45, ring);
      }
    }
  }
  col += uSunTint * pow(max(facing, 0.0), 9.0) * 0.30;   // soft bloom halo

  // --- moon (opposite the sun)
  vec3 md = -sdir;
  float mfacing = dot(d, md);
  if (uNight > 0.02 && mfacing > 0.988) {
    vec3 mRight = -sRight, mUp = sUp;
    vec2 uv = vec2(dot(d, mRight), dot(d, mUp)) / max(mfacing, 1e-4);
    float R = 0.042;
    vec2 t = uv / R;
    float texels = 6.0;                    // moon is a 6x6 grid
    vec2 q = floor(t * texels) / texels;
    if (abs(q.x) < 1.0 && abs(q.y) < 1.0) {
      float corner = abs(q.x) + abs(q.y);
      if (corner < 1.68) {
        // a couple of darker craters, chosen on the same snapped grid
        float crater = step(0.62, hash(vec3(q * texels, 7.0)));
        vec3 moonCol = mix(vec3(0.86,0.89,0.97), vec3(0.66,0.70,0.82), crater * 0.7);
        col = moonCol * 1.5 * uNight + col * (1.0 - uNight);
      }
    }
  }
  col += vec3(0.30,0.36,0.55) * pow(max(mfacing, 0.0), 20.0) * 0.16 * uNight;

  // stars
  if (uNight > 0.02 && h > -0.05) {
    vec3 g = floor(d * 190.0);
    float s = hash(g);
    if (s > 0.9965) {
      float tw = 0.65 + 0.35 * sin(uTime * 2.4 + s * 90.0);
      col += vec3(0.9,0.93,1.0) * (s - 0.9965) * 300.0 * uNight * tw;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Minimal geometry merger for non-indexed/indexed BoxGeometry lists.
 * three's mergeGeometries lives in examples/ which we deliberately do not
 * vendor, and all we need is to concatenate position/normal/uv + indices so a
 * whole cloud can be one draw call.
 */
function mergeBoxGeometries(geos) {
  let vTotal = 0, iTotal = 0;
  for (const g of geos) {
    vTotal += g.attributes.position.count;
    iTotal += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vTotal * 3);
  const nor = new Float32Array(vTotal * 3);
  const uv = new Float32Array(vTotal * 2);
  const idx = new Uint32Array(iTotal);
  let vo = 0, io = 0;
  for (const g of geos) {
    const gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv;
    pos.set(gp.array, vo * 3);
    if (gn) nor.set(gn.array, vo * 3);
    if (gu) uv.set(gu.array, vo * 2);
    const n = gp.count;
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      io += gi.length;
    } else {
      for (let i = 0; i < n; i++) idx[io + i] = vo + i;
      io += n;
    }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color(0x4a86d6) },
      uHorizon: { value: new THREE.Color(0xbcd8f0) },
      uBottom: { value: new THREE.Color(0x21324a) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunTint: { value: new THREE.Color(1, 0.96, 0.85) },
      uNight: { value: 0 },
      uTime: { value: 0 },
    };
    const geo = new THREE.SphereGeometry(1, 24, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: true,
      // the vertex shader emits gl_Position.z = w (exactly the far plane), so
      // the test must accept equality or the sky would be discarded entirely
      depthFunc: THREE.LessEqualDepth,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    // Draw the sky LAST, not first. Rendering it first with depthTest off
    // shaded every pixel on screen and then had the entire world painted over
    // the top of it - a full extra screen of fragment work each frame. Drawing
    // it after opaque geometry, with depthTest on and the shader forcing
    // gl_Position.z = w (the far plane), means it only shades the pixels the
    // world did not already cover.
    this.mesh.renderOrder = 999;
    scene.add(this.mesh);

    // cloud layer
    this.clouds = this._buildClouds();
    scene.add(this.clouds);
  }

  _buildClouds() {
    const g = new THREE.Group();
    // Two materials: a bright lit top/side and a shaded underside, which is
    // what actually sells volume. A single flat white material with
    // overlapping transparent boxes just looked like a smudge with seams.
    const lit = new THREE.MeshLambertMaterial({
      color: 0xffffff, transparent: true, opacity: 0.94, depthWrite: true,
      emissive: 0x2a3550, emissiveIntensity: 0.35, fog: true,
    });
    const rnd = (a, b) => a + Math.random() * (b - a);

    // A cloud is a blobby cluster of boxes on a coarse voxel grid. Building it
    // from a small heightfield (rather than random overlapping slabs) gives a
    // silhouette that reads as one solid puffy mass from every angle.
    const makeCloud = () => {
      const cluster = new THREE.Group();
      const CW = 5 + ((Math.random() * 4) | 0);      // cells across
      const CD = 4 + ((Math.random() * 4) | 0);
      const cell = 9;                                 // world units per cell
      const cx = (CW - 1) / 2, cz = (CD - 1) / 2;
      const boxes = [];
      for (let ix = 0; ix < CW; ix++) {
        for (let iz = 0; iz < CD; iz++) {
          // distance from centre, normalised: puffier in the middle
          const dx = (ix - cx) / (cx + 0.6), dz = (iz - cz) / (cz + 0.6);
          const r = Math.sqrt(dx * dx + dz * dz);
          const bias = 1 - r * r;
          if (bias < 0.06 || Math.random() > bias + 0.28) continue;
          // 1-3 stacked layers, tallest at the core
          const layers = Math.max(1, Math.round(bias * 2.6 + rnd(-0.35, 0.45)));
          for (let ly = 0; ly < layers; ly++) {
            const shrink = ly * 0.16;
            boxes.push([
              (ix - cx) * cell, ly * 5.0, (iz - cz) * cell,
              cell * (1.06 - shrink), 5.4, cell * (1.06 - shrink),
            ]);
          }
        }
      }
      // merge into as few meshes as possible - one mesh per cloud
      const geos = boxes.map(([x, y, z, w, h, d]) => {
        const bg = new THREE.BoxGeometry(w, h, d);
        bg.translate(x, y, z);
        return bg;
      });
      if (!geos.length) return null;
      const merged = mergeBoxGeometries(geos);
      geos.forEach(x => x.dispose());
      const m = new THREE.Mesh(merged, lit);
      m.frustumCulled = true;
      cluster.add(m);
      return cluster;
    };

    for (let i = 0; i < 26; i++) {
      const c = makeCloud();
      if (!c) continue;
      c.position.set(rnd(-620, 620), rnd(104, 136), rnd(-620, 620));
      const sc = rnd(0.75, 1.5);
      c.scale.set(sc, rnd(0.7, 1.15) * sc, sc);
      c.rotation.y = rnd(0, Math.PI * 2);
      g.add(c);
    }
    this.cloudMat = lit;
    return g;
  }

  update(t, camPos, dayT) {
    this.mesh.position.copy(camPos);
    this.mesh.scale.setScalar(1);
    this.uniforms.uTime.value = t;
    // clouds drift & follow camera on a wrap
    this.clouds.position.x = camPos.x + Math.sin(t * 0.006) * 40;
    this.clouds.position.z = camPos.z + t * 0.55 % 600 - 300;
    // tint the clouds with the sky so they go warm at dawn/dusk and blue-grey
    // at night instead of staying a flat daylight white
    if (this.cloudMat) {
      const hor = this.uniforms.uHorizon.value;
      const night = this.uniforms.uNight.value;
      this.cloudMat.color.setRGB(
        0.62 + hor.r * 0.38, 0.62 + hor.g * 0.38, 0.64 + hor.b * 0.36
      ).multiplyScalar(1 - night * 0.55);
      this.cloudMat.opacity = 0.90 - night * 0.22;
    }
  }
}

// -------------------------------------------------------------- particles
export class Particles {
  constructor(scene, atlasTex) {
    this.max = 900;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.siz = new Float32Array(this.max);
    this.alp = new Float32Array(this.max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.siz, 1));
    this.geo.setAttribute('palpha', new THREE.BufferAttribute(this.alp, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute vec3 pcolor; attribute float psize; attribute float palpha;
        varying vec3 vC; varying float vA;
        uniform float uScale;
        void main(){
          vC = pcolor; vA = palpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = psize * uScale / max(0.001, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vA;
        void main(){
          if (vA <= 0.001) discard;
          vec2 c = gl_PointCoord - 0.5;
          if (max(abs(c.x), abs(c.y)) > 0.5) discard;
          gl_FragColor = vec4(vC, vA);
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.list = [];
    for (let i = 0; i < this.max; i++) this.list.push({ life: 0 });
    this.cursor = 0;
  }

  spawn(x, y, z, vx, vy, vz, color, size, life, gravity = 1) {
    const p = this.list[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.r = ((color >> 16) & 255) / 255;
    p.g = ((color >> 8) & 255) / 255;
    p.b = (color & 255) / 255;
    p.size = size; p.life = life; p.maxLife = life; p.grav = gravity;
  }

  burst(x, y, z, color, n, spread = 2.4, size = 0.1, life = 0.8) {
    for (let i = 0; i < n; i++) {
      this.spawn(
        x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * spread, Math.random() * spread * 0.7 + 0.6, (Math.random() - 0.5) * spread,
        color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.7));
    }
  }

  update(dt, world) {
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      const p = this.list[i];
      if (p.life <= 0) { this.alp[i] = 0; continue; }
      p.life -= dt;
      if (p.life <= 0) { this.alp[i] = 0; continue; }
      p.vy -= 15 * dt * p.grav;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      // cheap collision
      if (world) {
        const id = world.getBlock(nx, ny, nz);
        if (id > 0 && BLOCKS[id] && !BLOCKS[id].noCollide && !BLOCKS[id].liquid) {
          p.vy = Math.abs(p.vy) * 0.25;
          p.vx *= 0.5; p.vz *= 0.5;
        } else { p.x = nx; p.y = ny; p.z = nz; }
      } else { p.x = nx; p.y = ny; p.z = nz; }
      const i3 = i * 3;
      this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
      this.col[i3] = p.r; this.col[i3 + 1] = p.g; this.col[i3 + 2] = p.b;
      this.siz[i] = p.size;
      this.alp[i] = Math.min(1, p.life / (p.maxLife * 0.4));
      n++;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.psize.needsUpdate = true;
    this.geo.attributes.palpha.needsUpdate = true;
  }
}

/** average colour of a block's texture, used for particles */
const _colCache = new Map();
export function blockColor(id) {
  if (_colCache.has(id)) return _colCache.get(id);
  const b = BLOCKS[id];
  let c = 0x808080;
  const table = {
    [B.GRASS]: 0x5fa83c, [B.DIRT]: 0x7a5638, [B.STONE]: 0x8d8f96, [B.DEEPSTONE]: 0x4a4c55,
    [B.SAND]: 0xe3d09a, [B.RED_SAND]: 0xbf7448, [B.GRAVEL]: 0x7c7d83, [B.CLAY]: 0xa9a3ae,
    [B.SNOW]: 0xf2f7fb, [B.ICE]: 0xa9d8ee, [B.WATER]: 0x2b7fbf, [B.LAVA]: 0xe8622a,
    [B.LOG_ASPEN]: 0xdcd3bd, [B.LOG_EMBER]: 0xa35b3f, [B.LOG_PINE]: 0x6a4a30, [B.LOG_PALM]: 0xa8875c,
    [B.LEAF_ASPEN]: 0x6fbe4c, [B.LEAF_EMBER]: 0xc4533f, [B.LEAF_PINE]: 0x2f7a4f, [B.LEAF_PALM]: 0x5aa83f,
    [B.PLANK_ASPEN]: 0xcfc0a1, [B.PLANK_EMBER]: 0xa55c42, [B.PLANK_PINE]: 0x96714b, [B.PLANK_PALM]: 0xbda079,
    [B.ORE_COAL]: 0x3d3d45, [B.ORE_COPPER]: 0xc9743c, [B.ORE_IRON]: 0xc4b7a4,
    [B.ORE_GOLD]: 0xf0c04a, [B.ORE_AURORITE]: 0x5fe0d0, [B.ORE_GLIMMER]: 0xc77bf5,
    [B.GLASS]: 0xcfe9f5, [B.BRICKS]: 0xb05a45, [B.STONE_BRICKS]: 0x8d8f96, [B.LUMEN]: 0xffe9a8,
    [B.BENCH]: 0x8a6a45, [B.SMELTER]: 0x74767d, [B.CRATE]: 0x96714b,
    [B.TALL_GRASS]: 0x5fa83c, [B.FERN]: 0x4a8a2d, [B.FLOWER_SUN]: 0xf7c948, [B.FLOWER_DUSK]: 0x8a5cc0,
    [B.MUSHROOM]: 0x4fb8d8, [B.BERRY_BUSH]: 0x3d7326, [B.CACTUS]: 0x4f9e5c,
    [B.SANDSTONE]: 0xe3d09a, [B.MOSS_STONE]: 0x6d8a5c, [B.RUBBLE]: 0x74767d, [B.BASALT]: 0x3b3740,
    [B.WOOL_WHITE]: 0xeceff3, [B.WOOL_RED]: 0xc34a45, [B.WOOL_AMBER]: 0xe0a13c,
    [B.WOOL_TEAL]: 0x3fa39a, [B.WOOL_VIOLET]: 0x8a5cc0, [B.WOOL_SLATE]: 0x5a6472,
    [B.TORCH]: 0xff9a3c, [B.LANTERN]: 0xffe9a8, [B.LADDER]: 0x96714b,
    [B.DOOR_LOW]: 0x8a6a45, [B.DOOR_TOP]: 0x8a6a45, [B.PATH]: 0x8a6a4a, [B.DRY_DIRT]: 0x8a6b47,
    [B.PACKED_ICE]: 0x87c2e0, [B.COAL_BLOCK]: 0x2a2a30, [B.COPPER_BLOCK]: 0xc9743c,
    [B.IRON_BLOCK]: 0xd6cdc0, [B.GOLD_BLOCK]: 0xf0c04a, [B.AURORITE_BLOCK]: 0x5fe0d0,
    [B.GLIMMER_BLOCK]: 0xc77bf5, [B.SLAB_STONE]: 0xa3a5ac, [B.CHISELED]: 0x8d8f96,
    [B.TILE_DARK]: 0x4a4c55, [B.BEDROCK]: 0x2a2730,
  };
  c = table[id] ?? 0x808080;
  _colCache.set(id, c);
  return c;
}

// ------------------------------------------------------------- item drops
export class ItemDrops {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.items = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this._geoCache = new Map();
    this._matCache = new Map();
  }

  _visual(itemId) {
    const key = itemId;
    if (this._geoCache.has(key)) return { geo: this._geoCache.get(key), mat: this._matCache.get(key) };
    const def = (window.__VOX_ITEM || {})[itemId];
    let geo, mat;
    if (def && def.block) {
      geo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
      mat = new THREE.MeshLambertMaterial({ color: blockColor(def.block) });
    } else {
      geo = new THREE.BoxGeometry(0.28, 0.28, 0.06);
      mat = new THREE.MeshLambertMaterial({ color: itemTint(itemId) });
    }
    this._geoCache.set(key, geo);
    this._matCache.set(key, mat);
    return { geo, mat };
  }

  spawn(x, y, z, itemId, count = 1, vx = 0, vy = 0, vz = 0) {
    if (this.items.length > 220) {
      const old = this.items.shift();
      this.group.remove(old.mesh);
    }
    const { geo, mat } = this._visual(itemId);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.items.push({
      mesh, id: itemId, count, x, y, z,
      vx: vx || (Math.random() - 0.5) * 1.8,
      vy: vy || 2.6 + Math.random(),
      vz: vz || (Math.random() - 0.5) * 1.8,
      age: 0, onGround: false, pickupDelay: 0.42, bob: Math.random() * 6,
    });
  }

  update(dt, player, onPickup) {
    const w = this.world;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      it.pickupDelay -= dt;
      it.bob += dt;

      it.vy -= 22 * dt;
      const inWater = w.getBlock(it.x, it.y, it.z) === B.WATER;
      if (inWater) { it.vy = Math.max(it.vy, -0.4) + 12 * dt; it.vy = Math.min(it.vy, 1.1); it.vx *= 0.86; it.vz *= 0.86; }

      let nx = it.x + it.vx * dt, ny = it.y + it.vy * dt, nz = it.z + it.vz * dt;
      const solidAt = (x, y, z) => {
        const id = w.getBlock(x, y, z);
        return id > 0 && BLOCKS[id] && !BLOCKS[id].noCollide && !BLOCKS[id].liquid;
      };
      if (solidAt(nx, it.y, it.z)) { nx = it.x; it.vx = 0; }
      if (solidAt(it.x, it.y, nz)) { nz = it.z; it.vz = 0; }
      if (solidAt(nx, ny - 0.12, nz)) {
        ny = Math.floor(ny) + 0.14;
        it.vy = 0; it.onGround = true;
        it.vx *= 0.72; it.vz *= 0.72;
      } else it.onGround = false;
      it.x = nx; it.y = ny; it.z = nz;

      // magnet toward player
      const dx = player.pos.x - it.x, dy = (player.pos.y + 0.9) - it.y, dz = player.pos.z - it.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (it.pickupDelay <= 0 && d2 < 6.2) {
        const d = Math.sqrt(d2) || 1;
        const pull = 8.5 / Math.max(0.55, d);
        it.vx += dx / d * pull * dt * 5;
        it.vy += dy / d * pull * dt * 5;
        it.vz += dz / d * pull * dt * 5;
      }
      if (it.pickupDelay <= 0 && d2 < 0.85) {
        if (onPickup(it.id, it.count)) {
          this.group.remove(it.mesh);
          this.items.splice(i, 1);
          continue;
        }
      }

      if (it.age > 300 || it.y < -8) {
        this.group.remove(it.mesh);
        this.items.splice(i, 1);
        continue;
      }
      it.mesh.position.set(it.x, it.y + Math.sin(it.bob * 2.2) * 0.06 + 0.1, it.z);
      it.mesh.rotation.y += dt * 1.6;
    }
  }

  clear() {
    for (const it of this.items) this.group.remove(it.mesh);
    this.items.length = 0;
  }
  serialize() {
    return this.items.map(i => ({ x: i.x, y: i.y, z: i.z, id: i.id, c: i.count }));
  }
  load(arr) {
    this.clear();
    if (!arr) return;
    for (const a of arr) this.spawn(a.x, a.y, a.z, a.id, a.c, 0, 0.1, 0);
  }
}

function itemTint(id) {
  const t = {
    stick: 0x8a6a45, coal: 0x2a2a30, charcoal: 0x3a3a42,
    raw_copper: 0xc9743c, raw_iron: 0xc4b7a4, raw_gold: 0xf0c04a,
    copper_ingot: 0xc9743c, iron_ingot: 0xd6cdc0, gold_ingot: 0xf0c04a,
    aurorite: 0x5fe0d0, glimmer_shard: 0xc77bf5, clay_lump: 0xa9a3ae, brick: 0xb05a45,
    seeds: 0xc2a76a, feather: 0xe8e8e8, hide: 0x9c6b3f, leather: 0xa8703f,
    bone: 0xece6d4, bone_meal: 0xe0dccc, ember_dust: 0xe8622a, string: 0xe8e4d8,
    sunberry: 0xe8563f, raw_meat: 0xd0685f, cooked_meat: 0x9c5a30,
    raw_fowl: 0xe0a898, cooked_fowl: 0xc98a44, berry_pie: 0xd6a860, mush_stew: 0x8a5a34,
    shears: 0xd6cdc0,
  }[id];
  if (t) return t;
  if (id.includes('aurorite')) return 0x5fe0d0;
  if (id.includes('iron')) return 0xd6cdc0;
  if (id.includes('copper')) return 0xc9743c;
  if (id.includes('stone')) return 0x8d8f96;
  if (id.includes('timber')) return 0xb08d64;
  if (id.includes('hide')) return 0x9c6b3f;
  return 0xb0b0b0;
}

// ------------------------------------------------------- block break overlay
export class BreakOverlay {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.0, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    // wireframe selection box
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
    this.sel = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
      color: 0x101014, transparent: true, opacity: 0.55,
    }));
    this.sel.visible = false;
    this.sel.renderOrder = 4;
    scene.add(this.sel);
  }
  show(x, y, z, progress) {
    this.mesh.visible = progress > 0.02;
    this.mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.mesh.material.opacity = Math.min(0.72, progress * 0.75);
    this.sel.visible = true;
    this.sel.position.set(x + 0.5, y + 0.5, z + 0.5);
  }
  hide() { this.mesh.visible = false; this.sel.visible = false; }
}

// ------------------------------------------------------------------ weather
export class Weather {
  constructor(scene) {
    this.max = 2600;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({
      color: 0xaac8e8, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.points.visible = false;
    this.parts = [];
    for (let i = 0; i < this.max; i++) this.parts.push({ x: 0, y: -999, z: 0, vy: -14, vx: 0 });
    this.active = false;
    this.type = 'rain';
    this.intensity = 0;
    this.timer = 120 + Math.random() * 300;
  }
  start(type) {
    this.active = true; this.type = type; this.points.visible = true;
    this.mat.color.setHex(type === 'snow' ? 0xffffff : 0x9dc0e0);
    this.mat.size = type === 'snow' ? 0.14 : 0.07;
    this.mat.opacity = type === 'snow' ? 0.85 : 0.5;
  }
  stop() { this.active = false; this.points.visible = false; }
  update(dt, camPos, world) {
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.active) { this.stop(); this.timer = 200 + Math.random() * 420; }
      else {
        const cold = world ? world.biomeAt(camPos.x, camPos.z) === 6 : false;
        this.start(cold ? 'snow' : 'rain');
        this.timer = 60 + Math.random() * 140;
      }
    }
    const target = this.active ? 1 : 0;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.5);
    if (this.intensity < 0.01) { this.points.visible = false; return; }
    this.points.visible = true;
    this.mat.opacity = (this.type === 'snow' ? 0.85 : 0.5) * this.intensity;

    const count = Math.floor(this.max * this.intensity);
    const snow = this.type === 'snow';
    this._surfT = (this._surfT || 0) - dt;
    const resample = this._surfT <= 0;
    if (resample) this._surfT = 0.25;

    for (let i = 0; i < this.max; i++) {
      const p = this.parts[i];
      if (i >= count) { this.pos[i * 3 + 1] = -9999; continue; }
      p.y += (snow ? -2.2 : -17) * dt;
      p.x += (snow ? Math.sin(p.y * 0.6) * 0.5 : 1.6) * dt;

      // Each drop caches the height of the surface below it (including water
      // and lava tops) and respawns on contact, so precipitation lands ON a
      // lake rather than sinking through it to the lakebed.
      if (p.surf === undefined || resample) {
        const s = world && world.splashSurface ? world.splashSurface(p.x, p.z) : null;
        p.surf = s ? s.y : -Infinity;
      }
      const spent = p.y <= p.surf;

      if (spent || p.y < camPos.y - 16 ||
          Math.abs(p.x - camPos.x) > 22 || Math.abs(p.z - camPos.z) > 22) {
        p.x = camPos.x + (Math.random() - 0.5) * 40;
        p.z = camPos.z + (Math.random() - 0.5) * 40;
        p.y = camPos.y + 12 + Math.random() * 10;
        const s = world && world.splashSurface ? world.splashSurface(p.x, p.z) : null;
        p.surf = s ? s.y : -Infinity;
      }
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// ------------------------------------------------------------- projectiles
export class Projectiles {
  constructor(scene) {
    this.list = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.geo = new THREE.BoxGeometry(0.16, 0.16, 0.34);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xc77bf5 });
  }
  spawn(x, y, z, tx, ty, tz, dmg) {
    const dx = tx - x, dy = ty - y, dz = tz - z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const sp = 17;
    const m = new THREE.Mesh(this.geo, this.mat);
    m.position.set(x, y, z);
    this.group.add(m);
    this.list.push({ mesh: m, x, y, z, vx: dx / d * sp, vy: dy / d * sp + 1.2, vz: dz / d * sp, life: 3.4, dmg });
  }
  update(dt, world, player, audio) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      p.vy -= 7 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      p.mesh.rotation.z += dt * 8;
      const id = world.getBlock(p.x, p.y, p.z);
      const hitBlock = id > 0 && BLOCKS[id] && !BLOCKS[id].noCollide && !BLOCKS[id].liquid;
      const dx = p.x - player.pos.x, dy = p.y - (player.pos.y + 1.0), dz = p.z - player.pos.z;
      const hitPlayer = (dx * dx + dz * dz) < 0.36 && Math.abs(dy) < 1.0;
      if (hitPlayer) { player.damage(p.dmg, 'shard'); }
      if (hitBlock || hitPlayer || p.life <= 0) {
        this.group.remove(p.mesh);
        this.list.splice(i, 1);
      }
    }
  }
  clear() { for (const p of this.list) this.group.remove(p.mesh); this.list.length = 0; }
}

// ------------------------------------------------------------ chest entity
/**
 * Chests are block entities: the chunk mesher skips them and we draw an
 * articulated 3D model instead, so the lid can swing open like a real chest.
 * Geometry reuses the voxel shader (layer / lt / ao attributes) so chests are
 * lit and fogged exactly like the blocks around them.
 *
 * Local model space has the block centre at the origin and the floor at y=0,
 * with the chest FRONT facing -Z (the same convention the block `dir` uses).
 */
const CHEST_SHADE = [0.80, 0.80, 1.0, 0.55, 0.90, 0.90];

/** One axis-aligned box -> voxel-shader attribute arrays. */
function chestBox(x0, y0, z0, x1, y1, z1, faces, uvRects) {
  const pos = [], uv = [], lay = [], ao = [], idx = [];
  const corners = [
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],   // +X
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],   // -X
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],   // +Y
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],   // -Y
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],   // +Z
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],   // -Z
  ];
  let v = 0;
  for (let f = 0; f < 6; f++) {
    const c = corners[f];
    const r = (uvRects && uvRects[f]) || [0, 0, 1, 1];
    const uvs = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    for (let k = 0; k < 4; k++) {
      pos.push(c[k][0], c[k][1], c[k][2]);
      uv.push(uvs[k][0], uvs[k][1]);
      lay.push(faces[f]);
      ao.push(CHEST_SHADE[f]);
    }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  }
  return { pos, uv, lay, ao, idx };
}

function chestGeometry(parts) {
  const P = [], U = [], L = [], A = [], I = [];
  let base = 0;
  for (const p of parts) {
    P.push(...p.pos); U.push(...p.uv); L.push(...p.lay); A.push(...p.ao);
    for (const i of p.idx) I.push(i + base);
    base += p.pos.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('layer', new THREE.Float32BufferAttribute(L, 1));
  g.setAttribute('ao', new THREE.Float32BufferAttribute(A, 1));
  g.setAttribute('lt', new THREE.Float32BufferAttribute(new Float32Array(P.length / 3 * 2), 2));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

function setChestLight(geo, sky, blk) {
  const lt = geo.getAttribute('lt');
  const a = lt.array;
  for (let i = 0; i < a.length; i += 2) { a[i] = sky; a[i + 1] = blk; }
  lt.needsUpdate = true;
}

export class ChestRenderer {
  constructor(scene, materials, texIndex) {
    this.scene = scene;
    this.material = materials.solid;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chests = new Map();          // "x,y,z" -> record
    const ix = texIndex || {};
    this.lay = {
      top: ix.crate_top ?? 0,
      side: ix.crate_side ?? 0,
      front: ix.crate_front ?? 0,
    };
    this._makeTemplates();
  }

  _makeTemplates() {
    const { top, side, front } = this.lay;
    const m = 1 / 16;
    const hw = 7 * m;                    // 14/16 wide, centred
    const BASE_H = 10 * m, LID_H = 5 * m;

    // ---- base (y 0..10/16). Front is -Z, so face 5 gets the latch tile.
    // UVs sample the LOWER part of the side tiles (v is bottom-up in GL).
    const baseUV = [
      [0, 0, 1, BASE_H * 16 / 16], [0, 0, 1, BASE_H * 16 / 16],
      [0, 0, 1, 1], [0, 0, 1, 1],
      [0, 0, 1, BASE_H * 16 / 16], [0, 0, 1, BASE_H * 16 / 16],
    ];
    this.baseParts = [chestBox(-hw, 0, -hw, hw, BASE_H, hw,
      [side, side, top, top, side, front], baseUV)];

    // ---- lid, authored around a hinge at the BACK-TOP edge of the base.
    // Local origin = hinge, lid body extends forward (-Z) and up.
    const lidUV = [
      [0, BASE_H, 1, 1], [0, BASE_H, 1, 1],
      [0, 0, 1, 1], [0, 0, 1, 1],
      [0, BASE_H, 1, 1], [0, BASE_H, 1, 1],
    ];
    const lid = chestBox(-hw, 0, -14 * m, hw, LID_H, 0,
      [side, side, top, top, side, front], lidUV);
    // ---- latch knob, hanging off the lid front
    const kv = [6 / 16, 4 / 16, 10 / 16, 8 / 16];
    const knobUV = [kv, kv, kv, kv, kv, kv];
    const knob = chestBox(-1.5 * m, -2 * m, -15 * m, 1.5 * m, 2 * m, -14 * m,
      [front, front, front, front, front, front], knobUV);
    this.lidParts = [lid, knob];

    this.HINGE = { y: BASE_H, z: hw };
  }

  add(x, y, z, dir = 0) {
    const k = x + ',' + y + ',' + z;
    let rec = this.chests.get(k);
    if (rec) { rec.dir = dir; rec.root.rotation.y = yawFor(dir); return rec; }

    const root = new THREE.Group();
    root.position.set(x + 0.5, y, z + 0.5);
    root.rotation.y = yawFor(dir);

    // each chest owns its geometry so per-chest light can be baked in
    const baseGeo = chestGeometry(this.baseParts);
    const lidGeo = chestGeometry(this.lidParts);
    const base = new THREE.Mesh(baseGeo, this.material);
    const lid = new THREE.Mesh(lidGeo, this.material);
    base.frustumCulled = false; lid.frustumCulled = false;

    const hinge = new THREE.Group();
    hinge.position.set(0, this.HINGE.y, this.HINGE.z);
    hinge.add(lid);
    root.add(base, hinge);
    this.group.add(root);

    rec = { x, y, z, dir, root, hinge, base, lid, baseGeo, lidGeo,
            open: 0, target: 0, light: -1 };
    this.chests.set(k, rec);
    return rec;
  }

  remove(x, y, z) {
    const k = x + ',' + y + ',' + z;
    const rec = this.chests.get(k);
    if (!rec) return;
    this.group.remove(rec.root);
    rec.baseGeo.dispose(); rec.lidGeo.dispose();
    this.chests.delete(k);
  }

  has(x, y, z) { return this.chests.has(x + ',' + y + ',' + z); }

  setOpen(x, y, z, open) {
    const rec = this.chests.get(x + ',' + y + ',' + z);
    if (!rec) return null;
    rec.target = open ? 1 : 0;
    return rec;
  }

  isOpen(x, y, z) {
    const rec = this.chests.get(x + ',' + y + ',' + z);
    return rec ? rec.target > 0 : false;
  }

  /** Any chest currently mid-animation or open (used for the close sfx). */
  anyOpen() {
    for (const [, r] of this.chests) if (r.target > 0) return true;
    return false;
  }

  clear() {
    for (const [, rec] of this.chests) {
      this.group.remove(rec.root);
      rec.baseGeo.dispose(); rec.lidGeo.dispose();
    }
    this.chests.clear();
  }

  /** @param light (x,y,z) => [sky0..1, block0..1] */
  update(dt, camPos, light) {
    const FAR = 80 * 80;
    for (const [, rec] of this.chests) {
      const dx = rec.x + 0.5 - camPos.x, dz = rec.z + 0.5 - camPos.z;
      const vis = dx * dx + dz * dz < FAR;
      rec.root.visible = vis;
      if (!vis) continue;

      if (rec.open !== rec.target) {
        const sp = rec.target > rec.open ? 7.5 : 6.0;
        rec.open += (rec.target - rec.open) * Math.min(1, dt * sp);
        if (Math.abs(rec.target - rec.open) < 0.002) rec.open = rec.target;
        // ease-out so the lid settles instead of stopping dead
        const e = rec.open * rec.open * (3 - 2 * rec.open);
        // The hinge sits at the BACK-TOP edge and the lid body extends forward
        // (-Z). A POSITIVE rotation.x lifts that front edge up and back, which
        // is how a chest opens; a negative angle would swing it down through
        // the base instead.
        rec.hinge.rotation.x = e * 1.45;   // ~83deg: a natural lid angle (was 97deg, too wide)
      }

      if (light) {
        const l = light(rec.x, rec.y, rec.z);
        const packed = l[0] * 16 + l[1];
        if (Math.abs(packed - rec.light) > 0.01) {
          rec.light = packed;
          setChestLight(rec.baseGeo, l[0], l[1]);
          setChestLight(rec.lidGeo, l[0], l[1]);
        }
      }
    }
  }
}

/** dir 0=-Z 1=+X 2=+Z 3=-X */
function yawFor(dir) {
  return [0, -Math.PI / 2, Math.PI, Math.PI / 2][dir & 3];
}
