/**
 * createAvaxMap.ts — A2 MOBA 3D Harita (AVAX Logo Silhouette — Mask-first)
 *
 * AVAX logo silüeti: üst üçgen (▲ fire) + alt üçgen (▼ ice) = diamond
 * Diamond denklemi: |x|/DW + |z|/DH ≤ 1   (DW=32, DH=48)
 * Tüm yollar/objeler silüet İÇİNDE. TAŞMA YOK.
 *
 * Side lane'ler diamond kenarına YAPISIK (lane_x = DW*(1-|z|/DH) - 3):
 *   Sol  lane: (0,-38)→(-7,-33)→(-14,-22)→(-19,-15)→(-26,-5)→(-29,0)→(-26,5)→(-19,15)→(-14,22)→(-7,33)→(0,38)
 *   Orta lane: (0,-38)→(0,-28)→(0,-20)→(0,-15)→(0,0)→(0,5)→(0,15)→(0,28)→(0,38)
 *   Sağ  lane: mirror of left
 */
import earcut from 'earcut';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PolygonMeshBuilder } from '@babylonjs/core/Meshes/polygonMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';

export interface MapData { walkableMeshes: Mesh[]; }

/* ═══════════════════════════════════════════════════════════════════════
 * CONSTANTS & MASK
 * ═══════════════════════════════════════════════════════════════════════ */
const DW = 32, DH = 48, SURF = 0.0, TEX = 512;
const ROAD_HALF_W = 2.25;
const BUFFER = ROAD_HALF_W - 0.25; // 2.0 world units (tighter — lanes edge-flush)
const EDGE_LEN = Math.sqrt(DW * DW + DH * DH); // ≈57.69
const INNER_LIMIT = DW * DH - BUFFER * EDGE_LEN; // ≈1391.8

function isInsideLogo(x: number, z: number): boolean {
    return Math.abs(x) / DW + Math.abs(z) / DH <= 1.0;
}
function isInsideInner(x: number, z: number): boolean {
    return DH * Math.abs(x) + DW * Math.abs(z) <= INNER_LIMIT;
}
function clampToInner(x: number, z: number): [number, number] {
    if (isInsideInner(x, z)) return [x, z];
    const ax = Math.abs(x), az = Math.abs(z);
    const sx = x >= 0 ? 1 : -1, sz = z >= 0 ? 1 : -1;
    const val = DH * ax + DW * az;
    const scale = INNER_LIMIT / val;
    return [sx * ax * scale, sz * az * scale];
}

function validateWaypoints(): void {
    const ALL = [...LEFT_PTS, ...MID_PTS, ...RIGHT_PTS];
    let logoOut = 0, innerOut = 0;
    ALL.forEach(([x, z]) => {
        if (!isInsideLogo(x, z)) { logoOut++; console.warn(`[Mask] LOGO-OUTSIDE: (${x},${z})`); }
        if (!isInsideInner(x, z)) {
            innerOut++;
            const [cx, cz] = clampToInner(x, z);
            console.warn(`[Mask] INNER-CLAMP: (${x},${z})→(${cx.toFixed(1)},${cz.toFixed(1)})`);
        }
    });
    console.log(`[AVAX Mask] DW=${DW} DH=${DH} BUFFER=${BUFFER} | waypoints=${ALL.length} | logo_overflow=${logoOut} | inner_overflow=${innerOut}`);
}

/* ═══════════════════════════════════════════════════════════════════════
 * NOISE
 * ═══════════════════════════════════════════════════════════════════════ */
function hash(x: number, y: number, s: number): number {
    let h = s + x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return (h ^ (h >> 16) & 0x7fffffff) / 0x7fffffff;
}
function sn(x: number, y: number, s: number): number {
    const ix = ~~x, iy = ~~y, fx = x - ix, fy = y - iy;
    const a = hash(ix, iy, s), b = hash(ix + 1, iy, s);
    const c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, s: number, o = 4): number {
    let v = 0, a = .5, f = 1;
    for (let i = 0; i < o; i++) { v += a * sn(x * f, y * f, s + i * 100); a *= .5; f *= 2; }
    return v;
}

/* ═══════════════════════════════════════════════════════════════════════
 * TEXTURES — real files for lava & ice, procedural for rock/stone
 * ═══════════════════════════════════════════════════════════════════════ */
function genLava(sc: Scene): Texture {
    const t = new Texture('/assets/images/textures/lava_color.png', sc);
    t.uScale = 4; t.vScale = 4;
    return t;
}
function genLavaEmissive(sc: Scene): Texture {
    const t = new Texture('/assets/images/textures/lava_emissive.png', sc);
    t.uScale = 4; t.vScale = 4;
    return t;
}
function genIce(sc: Scene): Texture {
    const t = new Texture('/assets/images/textures/ice_color.jpg', sc);
    t.uScale = 4; t.vScale = 4;
    return t;
}
function genRock(sc: Scene): DynamicTexture {
    const dt = new DynamicTexture('rockTex', TEX, sc, true), ctx = dt.getContext();
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
        const nx = x / TEX * 8, ny = y / TEX * 8, n = fbm(nx, ny, 7);
        const cr = Math.abs(sn(nx * 3, ny * 3, 55) - .5) < .04 ? .7 : 0;
        const b = 25 + n * 50;
        ctx.fillStyle = `rgb(${Math.min(255, b * 1.1 + cr * 180 | 0)},${Math.min(255, b * .6 + cr * 60 | 0)},${Math.min(255, b * .4 + cr * 10 | 0)})`;
        ctx.fillRect(x, y, 1, 1);
    }
    dt.update(); return dt;
}
function genFrozen(sc: Scene): DynamicTexture {
    const dt = new DynamicTexture('frozenTex', TEX, sc, true), ctx = dt.getContext();
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
        const nx = x / TEX * 8, ny = y / TEX * 8, n = fbm(nx, ny, 300);
        const v = Math.abs(sn(nx * 4, ny * 4, 350) - .5) < .03 ? .8 : 0;
        const b = 20 + n * 40;
        ctx.fillStyle = `rgb(${Math.min(255, b * .5 + v * 100 | 0)},${Math.min(255, b * .7 + v * 140 | 0)},${Math.min(255, b * 1.6 + v * 200 | 0)})`;
        ctx.fillRect(x, y, 1, 1);
    }
    dt.update(); return dt;
}
function genStone(sc: Scene): DynamicTexture {
    const dt = new DynamicTexture('stoneTex', 256, sc, true), ctx = dt.getContext();
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const n = fbm(x / 256 * 10, y / 256 * 10, 500), v = 60 + n * 80 | 0;
        ctx.fillStyle = `rgb(${v},${v * .9 | 0},${v * .75 | 0})`;
        ctx.fillRect(x, y, 1, 1);
    }
    dt.update(); return dt;
}

/* ═══════════════════════════════════════════════════════════════════════
 * MATERIAL HELPERS
 * ═══════════════════════════════════════════════════════════════════════ */
function tMat(nm: string, tex: BaseTexture, sc: Scene, o?: {
    em?: Color3; emTex?: BaseTexture; a?: number; sp?: Color3; us?: number; vs?: number;
}): StandardMaterial {
    const m = new StandardMaterial(nm, sc);
    m.diffuseTexture = tex;
    if (o?.us) (tex as Texture).uScale = o.us;
    if (o?.vs) (tex as Texture).vScale = o.vs;
    if (o?.emTex) {
        m.emissiveTexture = o.emTex;
        if (o?.us) (o.emTex as Texture).uScale = o.us;
        if (o?.vs) (o.emTex as Texture).vScale = o.vs;
    }
    m.emissiveColor = o?.em ?? Color3.Black();
    m.specularColor = o?.sp ?? new Color3(.05, .05, .05);
    m.alpha = o?.a ?? 1;
    m.backFaceCulling = false;
    return m;
}
function cMat(nm: string, d: Color3, e: Color3, a = 1, sc: Scene): StandardMaterial {
    const m = new StandardMaterial(nm, sc);
    m.diffuseColor = d; m.emissiveColor = e;
    m.specularColor = Color3.Black(); m.alpha = a; m.backFaceCulling = false;
    return m;
}

/* ═══════════════════════════════════════════════════════════════════════
 * LANE WAYPOINTS (SimpleNavGraph ile eşleşir)
 * Lane'ler diamond konturunu takip eder — kıvrılarak gider
 * ═══════════════════════════════════════════════════════════════════════ */
const LEFT_PTS: [number, number][] = [[0, -38], [-7, -33], [-14, -22], [-19, -15], [-26, -5], [-29, 0], [-26, 5], [-19, 15], [-14, 22], [-7, 33], [0, 38]];
const MID_PTS: [number, number][] = [[0, -38], [0, -28], [0, -20], [0, -15], [0, 0], [0, 5], [0, 15], [0, 28], [0, 38]];
const RIGHT_PTS: [number, number][] = [[0, -38], [7, -33], [14, -22], [19, -15], [26, -5], [29, 0], [26, 5], [19, 15], [14, 22], [7, 33], [0, 38]];

/* ═══════════════════════════════════════════════════════════════════════
 * MAIN
 * ═══════════════════════════════════════════════════════════════════════ */
export function createAvaxMap(scene: Scene, _sg: ShadowGenerator): MapData {
    validateWaypoints();

    const walkable: Mesh[] = [];

    const gl = new GlowLayer('glow', scene, { blurKernelSize: 8 });
    gl.intensity = 0.2;

    const lavaTex = genLava(scene);
    const lavaEmissTex = genLavaEmissive(scene);
    const rockTex = genRock(scene);
    const iceTex = genIce(scene);
    const frozenTex = genFrozen(scene);
    const stoneTex = genStone(scene);

    buildSky(scene);
    buildVoidGround(scene);
    buildDiamond(scene, walkable, lavaTex, lavaEmissTex, iceTex, rockTex, frozenTex);
    buildTriangleEdges(scene);
    buildEnergyNodes(scene);
    buildLanePaths(scene, walkable, lavaTex, iceTex);
    buildLaneVeins(scene);
    buildBridge(scene, walkable, stoneTex);
    buildLavaFeatures(scene, lavaTex, lavaEmissTex, rockTex);
    buildIceFeatures(scene, iceTex);
    // buildSurfaceVeins(scene); — zigzag çizgiler kaldırıldı
    buildBases(scene, walkable, lavaTex, iceTex);
    buildLighting(scene);
    try { buildParticles(scene); } catch (e) { console.warn('Particles skipped:', e); }

    return { walkableMeshes: walkable };
}

/* ═══════════════════════════════════════════════════════════════════════
 * GÖKYÜZÜ
 * ═══════════════════════════════════════════════════════════════════════ */
function buildSky(scene: Scene): void {
    scene.clearColor = new Color4(0.04, 0.04, 0.08, 1);
    const sky = MeshBuilder.CreateSphere('skySphere', { diameter: 500, segments: 16 }, scene);
    sky.scaling.x = -1;
    const skyTex = new DynamicTexture('skyTex', 512, scene, true);
    const ctx = skyTex.getContext();
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#06060f');
    grad.addColorStop(0.25, '#0a0a20');
    grad.addColorStop(0.5, '#101030');
    grad.addColorStop(0.7, '#180f20');
    grad.addColorStop(0.85, '#200e10');
    grad.addColorStop(1.0, '#150808');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 350; i++) {
        const sx = Math.random() * 512, sy = Math.random() * 400;
        const br = 130 + (Math.random() * 125 | 0);
        ctx.fillStyle = `rgb(${br},${br},${Math.min(255, br + 40)})`;
        ctx.fillRect(sx, sy, Math.random() < .08 ? 2 : 1, 1);
    }
    skyTex.update();
    const skyMat = new StandardMaterial('skyMat', scene);
    skyMat.emissiveTexture = skyTex;
    skyMat.disableLighting = true;
    skyMat.backFaceCulling = true;
    skyMat.specularColor = Color3.Black();
    sky.material = skyMat;
    sky.isPickable = false;
    sky.infiniteDistance = true;
}

/* ═══════════════════════════════════════════════════════════════════════
 * VOID GROUND (logo dışı karanlık)
 * ═══════════════════════════════════════════════════════════════════════ */
function buildVoidGround(scene: Scene): void {
    const voidPlane = MeshBuilder.CreateGround('voidGround', { width: 180, height: 180 }, scene);
    voidPlane.position.y = SURF - 0.15;
    const vm = new StandardMaterial('voidMat', scene);
    vm.diffuseColor = new Color3(0.02, 0.02, 0.04);
    vm.emissiveColor = new Color3(0.01, 0.01, 0.02);
    vm.specularColor = Color3.Black();
    voidPlane.material = vm;
    voidPlane.isPickable = false;
}

/* ═══════════════════════════════════════════════════════════════════════
 * DIAMOND GROUND (fire ▲ + ice ▼)
 * ═══════════════════════════════════════════════════════════════════════ */
function buildDiamond(scene: Scene, w: Mesh[], lavaTex: BaseTexture, lavaEmissTex: BaseTexture, iceTex: BaseTexture, rockTex: DynamicTexture, frozenTex: DynamicTexture): void {
    // Fire üçgen — LAVA ZEMİN
    const fireShape = [new Vector2(-DW, 0), new Vector2(0, -DH), new Vector2(DW, 0)];
    const fpmb = new PolygonMeshBuilder('fireGround', fireShape, scene, earcut);
    const fm = fpmb.build(false, 0.1);
    fm.position.y = SURF + 0.01;
    fm.material = tMat('fireGroundMat', lavaTex, scene, { emTex: lavaEmissTex });
    fm.receiveShadows = true;
    w.push(fm);

    // Ice üçgen — BUZ ZEMİN
    const iceShape = [new Vector2(-DW, 0), new Vector2(DW, 0), new Vector2(0, DH)];
    const ipmb = new PolygonMeshBuilder('iceGround', iceShape, scene, earcut);
    const im = ipmb.build(false, 0.1);
    im.position.y = SURF + 0.01;
    im.material = tMat('iceGroundMat', iceTex, scene, {
        em: new Color3(.04, .07, .18), sp: new Color3(.15, .15, .25),
    });
    im.receiveShadows = true;
    w.push(im);

    // Equator çizgisi
    const eq = MeshBuilder.CreateGround('equator', { width: DW * 2, height: 1.2 }, scene);
    eq.position.set(0, SURF + 0.08, 0);
    eq.material = cMat('eqMat', new Color3(.7, .6, .2), new Color3(.35, .28, .08), .75, scene);

    // Equator glow band
    const eqGlow = MeshBuilder.CreateGround('equatorGlow', { width: DW * 2, height: 3 }, scene);
    eqGlow.position.set(0, SURF + 0.05, 0);
    eqGlow.material = cMat('eqGlowMat', new Color3(.5, .4, .15), new Color3(.2, .15, .04), .25, scene);
}

/* ═══════════════════════════════════════════════════════════════════════
 * TRIANGLE EDGE GLOW (4 kenar — parlak neon silüet)
 * ═══════════════════════════════════════════════════════════════════════ */
function buildTriangleEdges(scene: Scene): void {
    const edges: { from: [number, number]; to: [number, number]; fire: boolean; name: string }[] = [
        { from: [-DW, 0], to: [0, -DH], fire: true, name: 'TL' },
        { from: [DW, 0], to: [0, -DH], fire: true, name: 'TR' },
        { from: [-DW, 0], to: [0, DH], fire: false, name: 'BL' },
        { from: [DW, 0], to: [0, DH], fire: false, name: 'BR' },
    ];

    // lava.jpg texture — ateş kenarları için
    const lavaTex = new Texture('/assets/images/textures/lava.jpg', scene);
    lavaTex.uScale = 6; lavaTex.vScale = 1;

    edges.forEach(e => {
        const dx = e.to[0] - e.from[0], dz = e.to[1] - e.from[1];
        const len = Math.sqrt(dx * dx + dz * dz);
        const cx = (e.from[0] + e.to[0]) / 2, cz = (e.from[1] + e.to[1]) / 2;
        const angle = Math.atan2(dx, dz);

        const col = e.fire ? new Color3(1, .45, .08) : new Color3(.15, .55, 1);
        const emCol = e.fire ? new Color3(.7, .3, .04) : new Color3(.1, .35, .8);

        // Ana parlak kenar
        const edge = MeshBuilder.CreateBox(`triEdge_${e.name}`, { width: 0.5, height: 0.3, depth: len }, scene);
        edge.position.set(cx, SURF + 0.18, cz);
        edge.rotation.y = angle;
        if (e.fire) {
            edge.material = tMat(`triEdgeMat_${e.name}`, lavaTex, scene, {
                em: new Color3(.6, .25, .02), a: 0.95,
            });
        } else {
            edge.material = cMat(`triEdgeMat_${e.name}`, col, emCol, 0.9, scene);
        }

        // Geniş glow halo
        const glow = MeshBuilder.CreateBox(`triGlow_${e.name}`, { width: 1.5, height: 0.08, depth: len }, scene);
        glow.position.set(cx, SURF + 0.14, cz);
        glow.rotation.y = angle;
        glow.material = cMat(`triGlowMat_${e.name}`, col, emCol.scale(1.5), 0.3, scene);

        // Ultra-geniş ambient
        const amb = MeshBuilder.CreateBox(`triAmb_${e.name}`, { width: 3, height: 0.04, depth: len }, scene);
        amb.position.set(cx, SURF + 0.1, cz);
        amb.rotation.y = angle;
        amb.material = cMat(`triAmbMat_${e.name}`, col, emCol.scale(.7), 0.12, scene);
    });
}

/* ═══════════════════════════════════════════════════════════════════════
 * ENERGY NODES (4 köşe)
 * ═══════════════════════════════════════════════════════════════════════ */
function buildEnergyNodes(scene: Scene): void {
    // Fire & Ice tip
    [{ z: -DH, fire: true }, { z: DH, fire: false }].forEach(n => {
        const col = n.fire ? new Color3(1, .5, .1) : new Color3(.2, .55, 1);
        const emCol = n.fire ? new Color3(.8, .35, .06) : new Color3(.12, .4, .85);

        const torus = MeshBuilder.CreateTorus(`energyTorus_${n.fire ? 'f' : 'i'}`, {
            diameter: 8, thickness: 0.6, tessellation: 32,
        }, scene);
        torus.position.set(0, SURF + 0.5, n.z);
        torus.rotation.x = Math.PI / 2;
        torus.material = cMat(`energyTorusMat_${n.fire ? 'f' : 'i'}`, col, emCol, 0.75, scene);

        const disc = MeshBuilder.CreateDisc(`energyDisc_${n.fire ? 'f' : 'i'}`, { radius: 3.5, tessellation: 24 }, scene);
        disc.position.set(0, SURF + 0.2, n.z);
        disc.rotation.x = Math.PI / 2;
        disc.material = cMat(`energyDiscMat_${n.fire ? 'f' : 'i'}`, col.scale(.4), emCol.scale(.6), 0.35, scene);

        const outer = MeshBuilder.CreateTorus(`energyOuter_${n.fire ? 'f' : 'i'}`, {
            diameter: 12, thickness: 0.3, tessellation: 32,
        }, scene);
        outer.position.set(0, SURF + 0.3, n.z);
        outer.rotation.x = Math.PI / 2;
        outer.material = cMat(`energyOuterMat_${n.fire ? 'f' : 'i'}`, col, emCol.scale(.4), 0.25, scene);

        const lt = new PointLight(`energyLt_${n.fire ? 'f' : 'i'}`, new Vector3(0, SURF + 4, n.z), scene);
        lt.diffuse = col; lt.intensity = 1.0; lt.range = 16;
    });

    // Equator köşeleri — kaldırıldı
}

/* ═══════════════════════════════════════════════════════════════════════
 * LANE VEINS (tip'lerden lane başlarına)
 * ═══════════════════════════════════════════════════════════════════════ */
function buildLaneVeins(scene: Scene): void {
    const fireTargets: [number, number][] = [[-7, -33], [0, -28], [7, -33]];
    const iceTargets: [number, number][] = [[-7, 33], [0, 28], [7, 33]];

    // lava.jpg — ateş damarları için
    const lavaTex = new Texture('/assets/images/textures/lava.jpg', scene);
    lavaTex.uScale = 4; lavaTex.vScale = 1;

    function veins(origin: [number, number], targets: [number, number][], fire: boolean) {
        const col = fire ? new Color3(1, .5, .1) : new Color3(.2, .5, 1);
        const emCol = fire ? new Color3(.55, .22, .04) : new Color3(.1, .28, .65);
        const tag = fire ? 'f' : 'i';
        targets.forEach((t, i) => {
            const dx = t[0] - origin[0], dz = t[1] - origin[1];
            const len = Math.sqrt(dx * dx + dz * dz);
            const cx = (origin[0] + t[0]) / 2, cz = (origin[1] + t[1]) / 2;
            const angle = Math.atan2(dx, dz);

            const vein = MeshBuilder.CreateBox(`laneVein_${tag}_${i}`, { width: 0.5, height: 0.06, depth: len }, scene);
            vein.position.set(cx, SURF + 0.1, cz);
            vein.rotation.y = angle;
            if (fire) {
                vein.material = tMat(`laneVeinMat_${tag}_${i}`, lavaTex, scene, {
                    em: new Color3(.5, .2, .02), a: 0.8,
                });
            } else {
                vein.material = cMat(`laneVeinMat_${tag}_${i}`, col, emCol, 0.65, scene);
            }

            const halo = MeshBuilder.CreateBox(`laneVeinHalo_${tag}_${i}`, { width: 1.5, height: 0.03, depth: len }, scene);
            halo.position.set(cx, SURF + 0.08, cz);
            halo.rotation.y = angle;
            halo.material = cMat(`laneVeinHaloMat_${tag}_${i}`, col, emCol.scale(.5), 0.2, scene);
        });
    }
    veins([0, -DH], fireTargets, true);
    veins([0, DH], iceTargets, false);
}

/* ═══════════════════════════════════════════════════════════════════════
 * SURFACE VEINS (tip'den kenarlara yüzey damarları)
 * ═══════════════════════════════════════════════════════════════════════ */
function buildSurfaceVeins(scene: Scene): void {
    // Fire: (0,-48) → edge noktaları (tümü diamond içinde)
    const fireV: [number, number][] = [
        [-24, -8], [-16, -22], [-8, -34],
        [8, -34], [16, -22], [24, -8],
        [-20, -14], [20, -14],
    ];
    fireV.forEach((to, i) => {
        const dx = to[0], dz = to[1] - (-DH);
        const len = Math.sqrt(dx * dx + dz * dz);
        const cx = to[0] / 2, cz = (-DH + to[1]) / 2;
        const angle = Math.atan2(dx, dz);
        const w = 0.2 + hash(i, 0, 777) * 0.25;
        const vein = MeshBuilder.CreateBox(`sfV_${i}`, {
            width: w, height: 0.04, depth: len * (0.4 + hash(i, 1, 888) * 0.5),
        }, scene);
        vein.position.set(cx, SURF + 0.06, cz);
        vein.rotation.y = angle;
        vein.material = cMat(`sfVM_${i}`, new Color3(.85, .35, .06), new Color3(.5, .18, .03), 0.45, scene);
    });

    // Ice: (0,+48) → edge noktaları
    const iceV: [number, number][] = [
        [-24, 8], [-16, 22], [-8, 34],
        [8, 34], [16, 22], [24, 8],
        [-20, 14], [20, 14],
    ];
    iceV.forEach((to, i) => {
        const dx = to[0], dz = to[1] - DH;
        const len = Math.sqrt(dx * dx + dz * dz);
        const cx = to[0] / 2, cz = (DH + to[1]) / 2;
        const angle = Math.atan2(dx, dz);
        const w = 0.18 + hash(i, 2, 999) * 0.2;
        const vein = MeshBuilder.CreateBox(`siV_${i}`, {
            width: w, height: 0.04, depth: len * (0.4 + hash(i, 3, 1111) * 0.5),
        }, scene);
        vein.position.set(cx, SURF + 0.06, cz);
        vein.rotation.y = angle;
        vein.material = cMat(`siVM_${i}`, new Color3(.18, .45, .9), new Color3(.08, .22, .6), 0.4, scene);
    });
}

/* ═══════════════════════════════════════════════════════════════════════
 * LANE YOLLARI (kıvrılan, diamond konturunu takip eden)
 * ═══════════════════════════════════════════════════════════════════════ */
function buildLanePaths(scene: Scene, w: Mesh[], lavaTex: BaseTexture, iceTex: BaseTexture): void {
    const LANE_W = 4.5;

    function buildLane(pts: [number, number][], name: string) {
        for (let i = 0; i < pts.length - 1; i++) {
            const [x1, z1] = pts[i];
            const [x2, z2] = pts[i + 1];
            const dx = x2 - x1, dz = z2 - z1;
            const len = Math.sqrt(dx * dx + dz * dz);
            const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
            const angle = Math.atan2(dx, dz);

            const isFire = cz < 0;
            const tex = isFire ? lavaTex : iceTex;
            const emCol = isFire ? new Color3(.1, .04, .01) : new Color3(.03, .05, .1);

            const seg = MeshBuilder.CreateGround(`lane_${name}_${i}`, {
                width: LANE_W, height: len, subdivisions: 1,
            }, scene);
            seg.position.set(cx, SURF + 0.07, cz);
            seg.rotation.y = angle;
            seg.material = tMat(`laneMat_${name}_${i}`, tex, scene, {
                a: 0.55, em: emCol, us: 1, vs: Math.max(1, len / 5),
            });
            seg.receiveShadows = true;
            w.push(seg);

            // Kenar çizgileri
            const edgeCol = isFire ? new Color3(.6, .28, .06) : new Color3(.18, .35, .6);
            for (const side of [-1, 1]) {
                const edge = MeshBuilder.CreateBox(`edge_${name}_${i}_${side}`, {
                    width: 0.2, height: 0.1, depth: len,
                }, scene);
                const offX = side * (LANE_W / 2);
                const wx = cx + offX * Math.cos(angle);
                const wz = cz - offX * Math.sin(angle);
                edge.position.set(wx, SURF + 0.12, wz);
                edge.rotation.y = angle;
                edge.material = cMat(`edgeMat_${name}_${i}_${side}`, edgeCol, edgeCol.scale(.2), .7, scene);
            }
        }
    }

    buildLane(LEFT_PTS, 'L');
    buildLane(MID_PTS, 'M');
    buildLane(RIGHT_PTS, 'R');
}

/* ═══════════════════════════════════════════════════════════════════════
 * KÖPRÜ (AVAX Crossbar)
 * ═══════════════════════════════════════════════════════════════════════ */
function buildBridge(scene: Scene, w: Mesh[], stoneTex: DynamicTexture): void {
    const BW = 62; // edge-flush lane'leri kapsayacak genişlik (x=±29 + yol genişliği)

    const bridge = MeshBuilder.CreateBox('centerBridge', { width: BW, height: 0.4, depth: 6 }, scene);
    bridge.position.set(0, SURF + 0.24, 0);
    bridge.material = tMat('bridgeMat', stoneTex, scene, { us: 5, vs: 1 });
    bridge.receiveShadows = true;
    w.push(bridge);

    const bTop = MeshBuilder.CreateGround('bridgeTop', { width: BW - 2, height: 5.5, subdivisions: 4 }, scene);
    bTop.position.set(0, SURF + 0.45, 0);
    bTop.material = tMat('bridgeTopMat', stoneTex, scene, { us: 6, vs: 1 });
    w.push(bTop);

    // Üçgensel crossbar kenarları
    const CB = BW / 2 - 2;
    const crossEdges: { from: [number, number]; to: [number, number]; fire: boolean; nm: string }[] = [
        { from: [-CB, 0], to: [0, -4], fire: true, nm: 'cTL' },
        { from: [CB, 0], to: [0, -4], fire: true, nm: 'cTR' },
        { from: [-CB, 0], to: [0, 4], fire: false, nm: 'cBL' },
        { from: [CB, 0], to: [0, 4], fire: false, nm: 'cBR' },
    ];
    crossEdges.forEach(e => {
        const dx = e.to[0] - e.from[0], dz = e.to[1] - e.from[1];
        const len = Math.sqrt(dx * dx + dz * dz);
        const cx = (e.from[0] + e.to[0]) / 2, cz = (e.from[1] + e.to[1]) / 2;
        const angle = Math.atan2(dx, dz);
        const col = e.fire ? new Color3(.85, .4, .06) : new Color3(.18, .45, .85);
        const emCol = e.fire ? new Color3(.55, .2, .03) : new Color3(.1, .25, .6);

        const bar = MeshBuilder.CreateBox(`crossbar_${e.nm}`, { width: 0.45, height: 0.3, depth: len }, scene);
        bar.position.set(cx, SURF + 0.52, cz);
        bar.rotation.y = angle;
        bar.material = cMat(`crossbarMat_${e.nm}`, col, emCol, 0.85, scene);

        const halo = MeshBuilder.CreateBox(`crossHalo_${e.nm}`, { width: 1.2, height: 0.06, depth: len }, scene);
        halo.position.set(cx, SURF + 0.5, cz);
        halo.rotation.y = angle;
        halo.material = cMat(`crossHaloMat_${e.nm}`, col, emCol.scale(.7), 0.25, scene);
    });

    // Crossbar merkez — kaldırıldı

    // Ledge'ler
    const lF = MeshBuilder.CreateBox('ledgeF', { width: BW, height: .24, depth: .4 }, scene);
    lF.position.set(0, SURF + .48, -3);
    lF.material = cMat('ledgeFMat', new Color3(.55, .2, .04), new Color3(.2, .08, .02), .85, scene);
    const lI = MeshBuilder.CreateBox('ledgeI', { width: BW, height: .24, depth: .4 }, scene);
    lI.position.set(0, SURF + .48, 3);
    lI.material = cMat('ledgeIMat', new Color3(.14, .28, .55), new Color3(.05, .12, .3), .85, scene);

    // Lane geçiş noktaları (equator'da x=±29) — diskler ve postlar kaldırıldı
}

/* ═══════════════════════════════════════════════════════════════════════
 * LAVA RIVERS & FEATURES (fire bölgesi)
 * Referans: lava ırmakları base'den equator'a doğru akıyor,
 * lane'ler arası alanı dolduruyor, equator'a yaklaştıkça genişliyor.
 * ═══════════════════════════════════════════════════════════════════════ */
function buildLavaFeatures(scene: Scene, lavaTex: BaseTexture, lavaEmissTex: BaseTexture, rockTex: DynamicTexture): void {
    // ── GENİŞ LAVA IRMAKLARI ──
    // Lane arası alanı dolduran ırmak segmentleri (fire base → equator)
    // Her Z bandında genişlik = side_lane_x - mid_lane_edge
    const sideX = (z: number) => DW * (1 - Math.abs(z) / DH) - 3;

    const bands: { z1: number; z2: number }[] = [
        { z1: -36, z2: -28 },
        { z1: -28, z2: -19 },
        { z1: -19, z2: -10 },
        { z1: -10, z2: -1 },
    ];

    for (const side of [-1, 1]) {
        bands.forEach((b, i) => {
            const zc = (b.z1 + b.z2) / 2;
            const len = b.z2 - b.z1;
            const sx = sideX(zc) * side;   // side lane center X
            const mx = 3 * side;            // mid lane outer edge
            const cx = (mx + sx) / 2;
            const w = Math.abs(sx - mx);    // full width — no margin
            if (w < 1) return;

            const tag = side < 0 ? 'L' : 'R';
            // Ana lava yüzeyi
            const r = MeshBuilder.CreateGround(`lavaRiv_${tag}_${i}`, {
                width: w, height: len + 1, subdivisions: 4,
            }, scene);
            r.position.set(cx, SURF + 0.06, zc);
            r.material = tMat(`lavaRivM_${tag}_${i}`, lavaTex, scene, {
                emTex: lavaEmissTex, em: new Color3(.08, .03, .0), a: 1,
            });

            // Alt hafif glow katmanı
            const g = MeshBuilder.CreateGround(`lavaGlow_${tag}_${i}`, {
                width: w + 4, height: len + 3, subdivisions: 1,
            }, scene);
            g.position.set(cx, SURF + 0.03, zc);
            g.material = cMat(`lavaGlowM_${tag}_${i}`,
                new Color3(.8, .3, .04), new Color3(.35, .12, .01), 0.18, scene);
        });
    }

    // ── LAVA HAVUZLARI (ırmak genişleme noktaları) ──
    [{ x: -10, z: -14, r: 3 }, { x: 10, z: -14, r: 3 },
    { x: -5, z: -26, r: 2 }, { x: 5, z: -26, r: 2 },
    { x: -18, z: -8, r: 3.5 }, { x: 18, z: -8, r: 3.5 }].forEach((lp, i) => {
        const p = MeshBuilder.CreateDisc(`lavaP_${i}`, { radius: lp.r, tessellation: 20 }, scene);
        p.position.set(lp.x, SURF + .06, lp.z); p.rotation.x = Math.PI / 2;
        p.material = tMat(`lavaPMat_${i}`, lavaTex, scene, { emTex: lavaEmissTex, em: new Color3(.06, .02, .0) });
        const lt = new PointLight(`lavaLt_${i}`, new Vector3(lp.x, SURF + 2.5, lp.z), scene);
        lt.diffuse = new Color3(1, .5, .05); lt.intensity = .5; lt.range = 12;
    });

    // ── VOLKANLAR (base yakını, ırmak kaynağı) ──
    [{ x: 0, z: -40, s: .7 },
    { x: -3, z: -36, s: .6 }, { x: 3, z: -36, s: .6 },
    { x: -6, z: -28, s: .5 }, { x: 6, z: -28, s: .5 }].forEach((v, i) => {
        const c = MeshBuilder.CreateCylinder(`vol_${i}`, {
            diameterTop: 1.2 * v.s, diameterBottom: 5 * v.s, height: 4 * v.s, tessellation: 7,
        }, scene);
        c.position.set(v.x, SURF + 2 * v.s, v.z);
        c.material = tMat(`volMat_${i}`, rockTex, scene, { em: new Color3(.04, .02, .0), us: 2, vs: 2 });
        const cr = MeshBuilder.CreateCylinder(`crat_${i}`, {
            diameter: 1.3 * v.s, height: .4 * v.s, tessellation: 7,
        }, scene);
        cr.position.set(v.x, SURF + 4.2 * v.s, v.z);
        cr.material = tMat(`cratMat_${i}`, lavaTex, scene, { em: new Color3(.45, .18, .0) });
    });

    // ── KAYALAR (ırmak kenarı) ──
    [{ x: -4, z: -22, s: .75 }, { x: 4, z: -22, s: .75 },
    { x: -8, z: -16, s: .65 }, { x: 8, z: -16, s: .65 },
    { x: -15, z: -10, s: .8 }, { x: 15, z: -10, s: .8 },
    { x: -2, z: -32, s: .55 }, { x: 2, z: -32, s: .55 }].forEach((r, i) => {
        const rk = MeshBuilder.CreateBox(`fRk_${i}`, {
            width: 1.8 * r.s, height: 1.4 * r.s, depth: 1.6 * r.s,
        }, scene);
        rk.position.set(r.x, SURF + .7 * r.s, r.z);
        rk.rotation.y = i * 1.3; rk.rotation.x = .12;
        rk.material = tMat(`fRkM_${i}`, rockTex, scene, { us: 1.5, vs: 1.5 });
    });
}

/* ═══════════════════════════════════════════════════════════════════════
 * ICE RIVERS & FEATURES (ice bölgesi)
 * Referans: buz/su ırmakları ice base'den equator'a doğru akıyor,
 * lane'ler arası alanı dolduruyor, equator'a yaklaştıkça genişliyor.
 * ═══════════════════════════════════════════════════════════════════════ */
function buildIceFeatures(scene: Scene, iceTex: BaseTexture): void {
    // ── GENİŞ BUZ IRMAKLARI ──
    const sideX = (z: number) => DW * (1 - Math.abs(z) / DH) - 3;

    const bands: { z1: number; z2: number }[] = [
        { z1: 1, z2: 10 },
        { z1: 10, z2: 19 },
        { z1: 19, z2: 28 },
        { z1: 28, z2: 36 },
    ];

    for (const side of [-1, 1]) {
        bands.forEach((b, i) => {
            const zc = (b.z1 + b.z2) / 2;
            const len = b.z2 - b.z1;
            const sx = sideX(zc) * side;
            const mx = 3 * side;
            const cx = (mx + sx) / 2;
            const w = Math.abs(sx - mx);
            if (w < 1) return;

            const tag = side < 0 ? 'L' : 'R';
            // Ana buz/su yüzeyi
            const r = MeshBuilder.CreateGround(`iceRiv_${tag}_${i}`, {
                width: w, height: len + 1, subdivisions: 4,
            }, scene);
            r.position.set(cx, SURF + 0.06, zc);
            r.material = tMat(`iceRivM_${tag}_${i}`, iceTex, scene, {
                em: new Color3(.03, .06, .15), a: 1,
                sp: new Color3(.3, .3, .45),
            });

            // Alt hafif glow katmanı
            const g = MeshBuilder.CreateGround(`iceGlow_${tag}_${i}`, {
                width: w + 4, height: len + 3, subdivisions: 1,
            }, scene);
            g.position.set(cx, SURF + 0.03, zc);
            g.material = cMat(`iceGlowM_${tag}_${i}`,
                new Color3(.15, .4, .85), new Color3(.06, .18, .5), 0.18, scene);
        });
    }

    // ── BUZ HAVUZLARI (ırmak genişleme noktaları) ──
    [{ x: -10, z: 14, r: 3 }, { x: 10, z: 14, r: 3 },
    { x: -5, z: 26, r: 2 }, { x: 5, z: 26, r: 2 },
    { x: -18, z: 8, r: 3.5 }, { x: 18, z: 8, r: 3.5 }].forEach((ip, i) => {
        const p = MeshBuilder.CreateDisc(`icePool_${i}`, { radius: ip.r, tessellation: 20 }, scene);
        p.position.set(ip.x, SURF + .05, ip.z); p.rotation.x = Math.PI / 2;
        p.material = tMat(`icePoolM_${i}`, iceTex, scene, {
            em: new Color3(.06, .12, .25), a: .75, sp: new Color3(.4, .4, .6),
        });
        const lt = new PointLight(`icePLt_${i}`, new Vector3(ip.x, SURF + 2.5, ip.z), scene);
        lt.diffuse = new Color3(.3, .55, 1); lt.intensity = .4; lt.range = 12;
    });

    // ── KRİSTALLER (ırmak kenarı, buz base yakını) ──
    [{ x: -5, z: 20, h: 3.5, d: 1.8 }, { x: 5, z: 20, h: 3.8, d: 2.0 },
    { x: -3, z: 34, h: 3.2, d: 1.4 }, { x: 3, z: 34, h: 3.0, d: 1.3 },
    { x: -1, z: 40, h: 2.2, d: 1.0 }, { x: 1, z: 40, h: 2.5, d: 1.1 },
    { x: -4, z: 28, h: 4.0, d: 2.0 }, { x: 4, z: 28, h: 3.8, d: 1.8 },
    { x: 0, z: 32, h: 3.0, d: 1.5 }].forEach((c, i) => {
        const cr = MeshBuilder.CreateCylinder(`cry_${i}`, {
            diameterTop: .1, diameterBottom: c.d, height: c.h, tessellation: 5,
        }, scene);
        cr.position.set(c.x, SURF + c.h / 2, c.z);
        cr.rotation.y = i * .7; cr.rotation.z = (i % 3 - 1) * .1;
        cr.material = tMat(`cryM_${i}`, iceTex, scene, {
            a: .78, sp: new Color3(.5, .5, .7), em: new Color3(.03, .05, .12),
        });
        if (c.h >= 3.5) {
            const lt = new PointLight(`cryLt_${i}`, new Vector3(c.x, SURF + c.h + 1, c.z), scene);
            lt.diffuse = new Color3(.3, .5, .9); lt.intensity = .25; lt.range = 7;
        }
    });

    // ── BUZ BLOKLARI (ırmak üstünde yüzen) ──
    [{ x: -8, z: 12, s: 1.6 }, { x: 8, z: 12, s: 1.6 },
    { x: -12, z: 16, s: 1.3 }, { x: 12, z: 16, s: 1.3 },
    { x: -4, z: 24, s: 1.1 }, { x: 4, z: 24, s: 1.1 }].forEach((ib, i) => {
        const b = MeshBuilder.CreateBox(`iceB_${i}`, {
            width: ib.s * 1.3, height: ib.s * .5, depth: ib.s * 1.3,
        }, scene);
        b.position.set(ib.x, SURF + ib.s * .25, ib.z);
        b.rotation.y = i * .5;
        b.material = tMat(`iceBM_${i}`, iceTex, scene, { a: .5, sp: new Color3(.4, .4, .5) });
    });
}

/* ═══════════════════════════════════════════════════════════════════════
 * BAZALAR (base diameter 11'e düşürüldü — diamond tip'e sığması için)
 * ═══════════════════════════════════════════════════════════════════════ */
function buildBases(scene: Scene, w: Mesh[], lavaTex: BaseTexture, iceTex: BaseTexture): void {
    bBase(scene, w, -40, 'fire', lavaTex, new Color3(.7, .3, 0), new Color3(.2, .08, .0));
    bBase(scene, w, 40, 'ice', iceTex, new Color3(.2, .4, .7), new Color3(.04, .1, .25));
}

function bBase(sc: Scene, w: Mesh[], z: number, side: string, tex: BaseTexture, col: Color3, em: Color3): void {
    const base = MeshBuilder.CreateCylinder(`${side}Base`, { diameter: 10, height: .8, tessellation: 24 }, sc);
    base.position.set(0, SURF + .4, z);
    base.material = tMat(`${side}BaseMat`, tex, sc, { em: em.scale(.5), us: 2, vs: 2 });
    base.receiveShadows = true;
    w.push(base);

    const ring = MeshBuilder.CreateTorus(`${side}Ring`, { diameter: 9.5, thickness: .45, tessellation: 36 }, sc);
    ring.position.set(0, SURF + .85, z); ring.rotation.x = Math.PI / 2;
    ring.material = cMat(`${side}RingMat`, col, em.scale(.7), .65, sc);

    const tower = MeshBuilder.CreateCylinder(`${side}Nexus`, { diameter: 3.5, height: 5, tessellation: 16 }, sc);
    tower.position.set(0, SURF + 3.2, z);
    tower.material = tMat(`${side}NexusMat`, tex, sc, { em: em.scale(1.2), us: 2, vs: 3 });

    const cap = MeshBuilder.CreateCylinder(`${side}Cap`, { diameterTop: 0, diameterBottom: 4, height: 2, tessellation: 16 }, sc);
    cap.position.set(0, SURF + 6.5, z);
    cap.material = cMat(`${side}CapMat`, col, em.scale(.9), 1, sc);

    const portal = MeshBuilder.CreateGround(`${side}Portal`, { width: 8, height: 8 }, sc);
    portal.position.set(0, SURF + .82, z);
    portal.material = tMat(`${side}PortalMat`, tex, sc, { a: .45, em: em.scale(.4) });
    w.push(portal);

    // Lane pad'ler — base yakınında lane'ler x=±7'de, mid x=0
    [-7, 0, 7].forEach((x, i) => {
        const dz = side === 'fire' ? 3 : -3;
        const pad = MeshBuilder.CreateGround(`${side}Pad_${i}`, { width: 4.5, height: 5 }, sc);
        pad.position.set(x, SURF + .03, z + dz);
        pad.material = tMat(`${side}PadMat_${i}`, tex, sc, { em: em.scale(.25) });
        w.push(pad);
    });

    [Math.PI / 5, -Math.PI / 5, Math.PI * 4 / 5, -Math.PI * 4 / 5].forEach((angle, i) => {
        const tx = Math.cos(angle) * 4, tz = Math.sin(angle) * 4;
        const bt = MeshBuilder.CreateBox(`${side}BT_${i}`, { width: 1.4, height: 3.8, depth: 1.4 }, sc);
        bt.position.set(tx, SURF + 2.6, z + tz);
        bt.material = tMat(`${side}BTMat_${i}`, tex, sc, { em: em.scale(.6) });
    });

    if (side === 'fire') {
        [{ dx: -2.5, dz: 3.5, r: 1 }, { dx: 2.5, dz: 3.5, r: 1 }].forEach((lp, li) => {
            const p = MeshBuilder.CreateDisc(`fBLv_${li}`, { radius: lp.r, tessellation: 16 }, sc);
            p.position.set(lp.dx, SURF + .05, z + lp.dz); p.rotation.x = Math.PI / 2;
            p.material = tMat(`fBLvM_${li}`, tex, sc, { em: new Color3(.3, .1, .0), a: .7 });
        });
    } else {
        [{ dx: -2.5, dz: -3.5, h: 2 }, { dx: 2.5, dz: -3.5, h: 2.3 }].forEach((bc, ci) => {
            const cr = MeshBuilder.CreateCylinder(`iBCr_${ci}`, {
                diameterTop: .05, diameterBottom: .9, height: bc.h, tessellation: 5,
            }, sc);
            cr.position.set(bc.dx, SURF + bc.h / 2, z + bc.dz); cr.rotation.y = ci * .9;
            cr.material = tMat(`iBCrM_${ci}`, tex, sc, { a: .75, sp: new Color3(.4, .4, .5) });
        });
    }
}

/* ═══════════════════════════════════════════════════════════════════════
 * IŞIKLANDIRMA
 * ═══════════════════════════════════════════════════════════════════════ */
function buildLighting(scene: Scene): void {
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.55;
    hemi.diffuse = new Color3(.9, .85, .8);
    hemi.groundColor = new Color3(.12, .1, .18);

    [
        { n: 'fireMain', p: new Vector3(0, 22, -24), c: new Color3(1, .5, .08), i: 1.5, r: 65 },
        { n: 'iceMain', p: new Vector3(0, 22, 24), c: new Color3(.3, .6, 1), i: 1.5, r: 65 },
        { n: 'midLight', p: new Vector3(0, 16, 0), c: new Color3(.9, .85, .6), i: 0.8, r: 40 },
        { n: 'laneL', p: new Vector3(-12, 12, 0), c: new Color3(.8, .45, .1), i: 0.5, r: 35 },
        { n: 'laneR', p: new Vector3(12, 12, 0), c: new Color3(.2, .5, .9), i: 0.5, r: 35 },
        { n: 'fireBase', p: new Vector3(0, 14, -40), c: new Color3(1, .45, .0), i: 1.0, r: 30 },
        { n: 'iceBase', p: new Vector3(0, 14, 40), c: new Color3(.3, .65, 1), i: 1.0, r: 30 },
        { n: 'lavaZ1', p: new Vector3(-6, 8, -15), c: new Color3(.9, .35, .0), i: 0.4, r: 18 },
        { n: 'lavaZ2', p: new Vector3(6, 8, -15), c: new Color3(.9, .35, .0), i: 0.4, r: 18 },
        { n: 'iceZ1', p: new Vector3(-6, 8, 15), c: new Color3(.2, .45, .85), i: 0.4, r: 18 },
        { n: 'iceZ2', p: new Vector3(6, 8, 15), c: new Color3(.2, .45, .85), i: 0.4, r: 18 },
        { n: 'edgeFireL', p: new Vector3(-18, 5, -18), c: new Color3(.8, .3, .02), i: 0.3, r: 15 },
        { n: 'edgeFireR', p: new Vector3(18, 5, -18), c: new Color3(.8, .3, .02), i: 0.3, r: 15 },
        { n: 'edgeIceL', p: new Vector3(-18, 5, 18), c: new Color3(.15, .35, .8), i: 0.3, r: 15 },
        { n: 'edgeIceR', p: new Vector3(18, 5, 18), c: new Color3(.15, .35, .8), i: 0.3, r: 15 },
    ].forEach(l => {
        const lt = new PointLight(l.n, l.p, scene);
        lt.diffuse = l.c; lt.intensity = l.i; lt.range = l.r;
    });
}

/* ═══════════════════════════════════════════════════════════════════════
 * PARTİKÜLLER
 * ═══════════════════════════════════════════════════════════════════════ */
function buildParticles(scene: Scene): void {
    const fire = new ParticleSystem('fireSp', 100, scene);
    fire.emitter = new Vector3(0, .5, -18);
    fire.minEmitBox = new Vector3(-10, 0, -8);
    fire.maxEmitBox = new Vector3(10, 1, 8);
    fire.minSize = .05; fire.maxSize = .15;
    fire.minLifeTime = 1; fire.maxLifeTime = 2.5;
    fire.emitRate = 18;
    fire.color1 = new Color4(1, .5, .1, .7);
    fire.color2 = new Color4(1, .3, 0, .5);
    fire.colorDead = new Color4(.3, .1, 0, 0);
    fire.minEmitPower = .3; fire.maxEmitPower = 1.5;
    fire.gravity = new Vector3(0, .5, 0);
    fire.direction1 = new Vector3(-.5, 1, -.5);
    fire.direction2 = new Vector3(.5, 3, .5);
    fire.updateSpeed = .01;
    fire.blendMode = ParticleSystem.BLENDMODE_ADD;
    fire.start();

    const snow = new ParticleSystem('snow', 100, scene);
    snow.emitter = new Vector3(0, 12, 18);
    snow.minEmitBox = new Vector3(-10, -2, -8);
    snow.maxEmitBox = new Vector3(10, 2, 8);
    snow.minSize = .06; snow.maxSize = .2;
    snow.minLifeTime = 3; snow.maxLifeTime = 6;
    snow.emitRate = 16;
    snow.color1 = new Color4(.85, .9, 1, .6);
    snow.color2 = new Color4(.7, .8, .95, .4);
    snow.colorDead = new Color4(.5, .6, .8, 0);
    snow.minEmitPower = .05; snow.maxEmitPower = .3;
    snow.gravity = new Vector3(0, -.6, 0);
    snow.direction1 = new Vector3(-.2, -1, -.2);
    snow.direction2 = new Vector3(.2, -.3, .2);
    snow.updateSpeed = .006;
    snow.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    snow.start();

    [new Vector3(-8, .5, -14), new Vector3(8, .5, -14)].forEach((pos, i) => {
        const ps = new ParticleSystem(`lvSp_${i}`, 25, scene);
        ps.emitter = pos;
        ps.minEmitBox = new Vector3(-1, 0, -1);
        ps.maxEmitBox = new Vector3(1, .5, 1);
        ps.minSize = .03; ps.maxSize = .1;
        ps.minLifeTime = .5; ps.maxLifeTime = 1.2;
        ps.emitRate = 5;
        ps.color1 = new Color4(1, .6, .1, .8);
        ps.color2 = new Color4(1, .35, 0, .6);
        ps.colorDead = new Color4(.4, .1, 0, 0);
        ps.minEmitPower = .8; ps.maxEmitPower = 2.5;
        ps.gravity = new Vector3(0, 1.5, 0);
        ps.direction1 = new Vector3(-.3, 2, -.3);
        ps.direction2 = new Vector3(.3, 4, .3);
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.start();
    });
}
