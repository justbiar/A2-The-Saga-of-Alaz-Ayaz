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
const BUFFER = ROAD_HALF_W - 0.25;
const EDGE_LEN = Math.sqrt(DW * DW + DH * DH);
const INNER_LIMIT = DW * DH - BUFFER * EDGE_LEN;

// Z-fighting önleme: her katman kesin ayrı y'de (minimum 0.10 fark)
const Y_GROUND  = SURF + 0.00;  // diamond zemin
const Y_FEATURE = SURF + 0.15;  // lava/ice feature'lar
const Y_PAD     = SURF + 0.25;  // junction pad'ler (lane'den ALTTA)
const Y_LANE    = SURF + 0.40;  // lane yüzeyleri (en üstte)

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
    const t = new Texture('/assets/images/textures/lava.jpg', sc);
    t.uScale = 2; t.vScale = 2;
    return t;
}
function genLavaEmissive(sc: Scene): Texture {
    const t = new Texture('/assets/images/textures/lava.jpg', sc);
    t.uScale = 2; t.vScale = 2;
    return t;
}
function genIce(sc: Scene): Texture {
    const t = new Texture('/assets/images/textures/ice_color.jpg', sc);
    t.uScale = 2; t.vScale = 2;
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
/* ═══════════════════════════════════════════════════════════════════════
 * MATERIAL HELPERS
 * ═══════════════════════════════════════════════════════════════════════ */
function tMat(nm: string, tex: BaseTexture, sc: Scene, o?: {
    em?: Color3; emTex?: BaseTexture; a?: number; sp?: Color3; us?: number; vs?: number;
    zOffset?: number;
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
    m.zOffset = o?.zOffset ?? 0;
    return m;
}
function cMat(nm: string, d: Color3, e: Color3, a = 1, sc: Scene, zOffset = 0): StandardMaterial {
    const m = new StandardMaterial(nm, sc);
    m.diffuseColor = d; m.emissiveColor = e;
    m.specularColor = Color3.Black(); m.alpha = a; m.backFaceCulling = false;
    m.zOffset = zOffset;
    return m;
}

/* ═══════════════════════════════════════════════════════════════════════
 * LANE WAYPOINTS (SimpleNavGraph ile eşleşir)
 * Lane'ler diamond konturunu takip eder — kıvrılarak gider
 * ═══════════════════════════════════════════════════════════════════════ */
const LEFT_PTS:  [number, number][] = [[0, -40], [-7, -33], [-14, -22], [-19, -15], [-26, -5], [-29, 0], [-26, 5], [-19, 15], [-14, 22], [-7, 33], [0, 40]];
const MID_PTS:   [number, number][] = [[0, -40], [0, -28], [0, -20], [0, -15], [0, 0], [0, 5], [0, 15], [0, 28], [0, 40]];
const RIGHT_PTS: [number, number][] = [[0, -40], [7, -33], [14, -22], [19, -15], [26, -5], [29, 0], [26, 5], [19, 15], [14, 22], [7, 33], [0, 40]];

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

    buildSky(scene);
    buildVoidGround(scene);
    buildDiamond(scene, walkable, lavaTex, lavaEmissTex, iceTex);
    buildTriangleEdges(scene);
    buildLanePaths(scene, walkable, lavaTex, iceTex);
    buildLavaFeatures(scene, lavaTex, lavaEmissTex, rockTex);
    buildIceFeatures(scene, iceTex);
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
    voidPlane.position.y = SURF - 0.5;
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
function buildDiamond(scene: Scene, w: Mesh[], lavaTex: BaseTexture, lavaEmissTex: BaseTexture, iceTex: BaseTexture): void {
    // Fire üçgen — LAVA ZEMİN  (katman 0 → y=SURF)
    const fireShape = [new Vector2(-DW, 0), new Vector2(0, -DH), new Vector2(DW, 0)];
    const fpmb = new PolygonMeshBuilder('fireGround', fireShape, scene, earcut);
    const fm = fpmb.build(false, 0.01);
    fm.position.y = SURF - 0.05;
    fm.material = tMat('fireGroundMat', lavaTex, scene, { emTex: lavaEmissTex, zOffset: 2 });
    fm.receiveShadows = true;
    w.push(fm);

    // Ice üçgen — BUZ ZEMİN  (fire'dan biraz altta, equator z-fight önlenir)
    const iceShape = [new Vector2(-DW, 0), new Vector2(DW, 0), new Vector2(0, DH)];
    const ipmb = new PolygonMeshBuilder('iceGround', iceShape, scene, earcut);
    const im = ipmb.build(false, 0.01);
    im.position.y = SURF - 0.08;
    im.material = tMat('iceGroundMat', iceTex, scene, {
        em: new Color3(.04, .07, .18), sp: new Color3(.15, .15, .25), zOffset: 3,
    });
    im.receiveShadows = true;
    w.push(im);

    // Equator çizgisi kaldırıldı — diamond ground ile z-fighting yapıyordu
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

    // ice_color.jpg texture — buz kenarları için
    const iceTex = new Texture('/assets/images/textures/ice_color.jpg', scene);
    iceTex.uScale = 6; iceTex.vScale = 1;

    edges.forEach(e => {
        const dx = e.to[0] - e.from[0], dz = e.to[1] - e.from[1];
        const len = Math.sqrt(dx * dx + dz * dz);
        const cx = (e.from[0] + e.to[0]) / 2, cz = (e.from[1] + e.to[1]) / 2;
        const angle = Math.atan2(dx, dz);

        const col = e.fire ? new Color3(1, .45, .08) : new Color3(.15, .55, 1);
        const emCol = e.fire ? new Color3(.7, .3, .04) : new Color3(.1, .35, .8);

        // Ana parlak kenar
        const edge = MeshBuilder.CreateBox(`triEdge_${e.name}`, { width: 0.5, height: 0.3, depth: len }, scene);
        edge.position.set(cx, SURF + 0.35, cz);
        edge.rotation.y = angle;
        if (e.fire) {
            edge.material = tMat(`triEdgeMat_${e.name}`, lavaTex, scene, {
                em: new Color3(.6, .25, .02), a: 0.95,
            });
        } else {
            edge.material = tMat(`triEdgeMat_${e.name}`, iceTex, scene, {
                em: new Color3(.05, .2, .55), a: 0.95,
            });
        }
    });
}

/* ═══════════════════════════════════════════════════════════════════════
 * LANE ŞERİTLERİ — yolun kenarlarında ince çizgiler (yol şeridi)
 *
 * Yol yüzeyi yok — diamond ground zaten zemin.
 * Sadece her lane'in sol ve sağ kenarına ince parlak şerit çekilir.
 * Fire tarafı turuncu, ice tarafı mavi, equator bölgesi mor.
 * Diamond dışına taşan şeritler otomatik kesilir.
 * ═══════════════════════════════════════════════════════════════════════ */
function buildLanePaths(scene: Scene, _w: Mesh[], _lavaTex: BaseTexture, _iceTex: BaseTexture): void {
    const LANE_W    = 4.5;          // lane genişliği (şeritler arası mesafe)
    const STRIPE_W  = 0.22;         // şerit kalınlığı
    const STRIPE_H  = 0.2;          // şerit yüksekliği
    const STRIPE_Y  = SURF + 0.10;  // zeminin üstü
    const DOT_R     = 0.45;         // dönüş noktası bağlantı disk yarıçapı

    // Rock texture ile şerit materyalleri
    const rockTex = new Texture('/assets/images/textures/rock.avif', scene);
    rockTex.uScale = 2; rockTex.vScale = 2;

    const fireStripe = tMat('fireStripe', rockTex, scene, { em: new Color3(.7, .25, .02), us: 2, vs: 2, zOffset: -3 });
    const iceStripe  = tMat('iceStripe',  rockTex, scene, { em: new Color3(.1, .35, .8),  us: 2, vs: 2, zOffset: -3 });
    const eqStripe   = tMat('eqStripe',   rockTex, scene, { em: new Color3(.35, .18, .4), us: 2, vs: 2, zOffset: -3 });

    /** Bir waypoint'in fire/ice/equator materyalini döndür */
    function matForZ(z: number): StandardMaterial {
        if (z < -2) return fireStripe;
        if (z > 2)  return iceStripe;
        return eqStripe;
    }

    function buildLaneStripes(pts: [number, number][], name: string) {
        const isSideLane = (name === 'L' || name === 'R');

        // ── 1) Her segment için uçtan uca kesintisiz şerit ──
        for (let i = 0; i < pts.length - 1; i++) {
            const [x1, z1] = pts[i];
            const [x2, z2] = pts[i + 1];
            const dx = x2 - x1, dz = z2 - z1;
            const segLen = Math.sqrt(dx * dx + dz * dz);
            if (segLen < 0.01) continue;

            const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
            const angle = Math.atan2(dx, dz);
            // Dik yön (normal) — şeritleri yolun sağ/soluna offset etmek için
            const nx = Math.cos(angle), nz = -Math.sin(angle);

            const mat = matForZ(cz);

            const isFirstSeg = (i === 0);
            const isLastSeg  = (i === pts.length - 2);

            // Sadece iç şerit (dış şerit kaldırıldı)
            for (const side of [-1, 1]) {
                // Side lane: sadece iç şeridi çiz, dış şeridi atla
                if (isSideLane) {
                    const innerSide = name === 'L' ? 1 : -1;
                    if (side !== innerSide) continue;
                    // Uç segmentlerde iç şeridi de atla (base'e yakın)
                    if (isFirstSeg || isLastSeg) continue;
                    // Equator dönüş segmentlerinde atla (üst üste binmesin)
                    if (Math.abs(z1) <= 3 || Math.abs(z2) <= 3) continue;
                }
                // Mid lane uç segmentlerinde: şeritleri atla (base pad'e bırak)
                if (!isSideLane && (isFirstSeg || isLastSeg)) continue;

                const offset = side * (LANE_W / 2);
                const stripeX = cx + nx * offset;
                const stripeZ = cz + nz * offset;

                // Diamond dışına taşıyorsa atla
                if (!isInsideLogo(stripeX, stripeZ)) continue;

                const stripe = MeshBuilder.CreateBox(`str_${name}_${i}_${side}`, {
                    width: STRIPE_W, height: STRIPE_H, depth: segLen,
                }, scene);
                stripe.position.set(stripeX, STRIPE_Y, stripeZ);
                stripe.rotation.y = angle;
                stripe.material = mat;
                stripe.isPickable = false;
            }
        }

        // ── 2) Dönüş noktalarına küçük bağlantı diskleri (gap kapatıcı) ──
        // İlk ve son waypoint (base noktaları) hariç, ara waypoint'lere eklenir
        for (let i = 1; i < pts.length - 1; i++) {
            const [px, pz] = pts[i];
            const isFirstSeg = (i === 1);           // base'e komşu ilk ara nokta
            const isLastSeg  = (i === pts.length - 2); // base'e komşu son ara nokta

            // Önceki ve sonraki segmentin açılarından normal hesapla
            const [x0, z0] = pts[i - 1];
            const [x2, z2] = pts[i + 1];

            const angle1 = Math.atan2(px - x0, pz - z0);
            const angle2 = Math.atan2(x2 - px, z2 - pz);
            const n1x = Math.cos(angle1), n1z = -Math.sin(angle1);
            const n2x = Math.cos(angle2), n2z = -Math.sin(angle2);

            const mat = matForZ(pz);

            for (const side of [-1, 1]) {
                // Side lane: sadece iç şerit disklerini çiz
                if (isSideLane) {
                    const innerSide = name === 'L' ? 1 : -1;
                    if (side !== innerSide) continue;
                    if (isFirstSeg || isLastSeg) continue;
                    // Equator dönüş noktasında atla
                    if (Math.abs(pz) <= 3) continue;
                }
                if (!isSideLane && (isFirstSeg || isLastSeg)) continue;

                const offset = side * (LANE_W / 2);
                // İki segment normalinin ortalaması ile pozisyon
                const avgNx = (n1x + n2x) / 2, avgNz = (n1z + n2z) / 2;
                const dotX = px + avgNx * offset;
                const dotZ = pz + avgNz * offset;

                if (!isInsideLogo(dotX, dotZ)) continue;

                const dot = MeshBuilder.CreateDisc(`jdot_${name}_${i}_${side}`, {
                    radius: DOT_R, tessellation: 8,
                }, scene);
                dot.position.set(dotX, STRIPE_Y + 0.005, dotZ);
                dot.rotation.x = Math.PI / 2;   // yatay yap
                dot.material = mat;
                dot.isPickable = false;
            }
        }
    }

    buildLaneStripes(LEFT_PTS, 'L');
    buildLaneStripes(MID_PTS, 'M');
    buildLaneStripes(RIGHT_PTS, 'R');
}

/* ═══════════════════════════════════════════════════════════════════════
 * LAVA RIVERS & FEATURES (fire bölgesi)
 * Referans: lava ırmakları base'den equator'a doğru akıyor,
 * lane'ler arası alanı dolduruyor, equator'a yaklaştıkça genişliyor.
 * ═══════════════════════════════════════════════════════════════════════ */
function buildLavaFeatures(scene: Scene, lavaTex: BaseTexture, lavaEmissTex: BaseTexture, rockTex: DynamicTexture): void {
    // Lava river ground plane'ler kaldırıldı — diamond ground zaten lava texture'lı,
    // üst üste plane Z-fighting yapıyordu.

    // Lava havuzları (lavaP_ disc'ler) kaldırıldı — ground'a yakın z-fighting yapıyordu.

    // Volkanlar kaldırıldı — base'ler artık GLB model (BaseBuilding.ts)

    // ── KAYALAR (ırmak kenarı) ──
    [{ x: -4, z: -22, s: .75 }, { x: 4, z: -22, s: .75 },
    { x: -8, z: -16, s: .65 }, { x: 8, z: -16, s: .65 },
    { x: -15, z: -10, s: .8 }, { x: 15, z: -10, s: .8 },
    { x: -2, z: -32, s: .55 }, { x: 2, z: -32, s: .55 }].forEach((r, i) => {
        const rk = MeshBuilder.CreateBox(`fRk_${i}`, {
            width: 1.8 * r.s, height: 1.4 * r.s, depth: 1.6 * r.s,
        }, scene);
        rk.position.set(r.x, SURF + 1.0 * r.s, r.z);
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
    // Ice river ground plane'ler kaldırıldı — diamond ground zaten ice texture'lı,
    // üst üste plane Z-fighting yapıyordu.

    // Buz havuzları (icePool_ disc'ler) kaldırıldı — ground'a yakın z-fighting yapıyordu.

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
        b.position.set(ib.x, SURF + ib.s * .5, ib.z);
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

function bBase(_sc: Scene, _w: Mesh[], _z: number, _side: string, _tex: BaseTexture, _col: Color3, _em: Color3): void {
    // Kaldırıldı — GLB modelin kendi platformu var (BaseBuilding.ts)
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
