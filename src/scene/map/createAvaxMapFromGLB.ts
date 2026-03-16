/**
 * createAvaxMapFromGLB.ts — newmap.glb dosyasından harita yükleme
 *
 * createAvaxMap() ile aynı MapData interface'ini döndürür.
 * GLB'de geometri var, texture'lar burada runtime'da atanır.
 * Dinamik şeyler (particles, glow, lights, sky) de burada eklenir.
 *
 * GLB dosyası: /assets/newmap.glb
 */
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Particles/particleSystemComponent';
import '@babylonjs/loaders/glTF';

import type { MapData } from './createAvaxMap';

const SURF = 0.0;

// ── Mesh isim → bölge eşleştirmesi ──
// "fire" bölgesi: z < 0 olan mesh'ler, lava texture alır
// "ice" bölgesi: z > 0 olan mesh'ler, ice texture alır
const FIRE_MESHES = [
    'fireGround', 'lavaRiv_', 'lavaGlow_', 'lavaP_', 'lavaPMat_',
    'vol_', 'crat_', 'fRk_', 'fBLv_', 'fireBase', 'fireNexus',
    'firePortal', 'firePad_', 'fireBT_', 'fireRing', 'fireCap',
];
const ICE_MESHES = [
    'iceGround', 'iceRiv_', 'iceGlow_', 'icePool_', 'cry_',
    'iceB_', 'iBCr_', 'iceBase', 'iceNexus', 'icePortal',
    'icePad_', 'iceBT_', 'iceRing', 'iceCap',
];

// walkable mesh isimleri
const WALKABLE_PREFIXES = [
    'lane_', 'jpad_', 'tipFill_',
    'fireGround', 'iceGround',
    'fireBase', 'iceBase',
    'firePortal', 'icePortal',
    'firePad_', 'icePad_',
];

function isWalkable(name: string): boolean {
    return WALKABLE_PREFIXES.some(p => name.startsWith(p));
}

function isFireMesh(name: string): boolean {
    return FIRE_MESHES.some(p => name.startsWith(p));
}

function isIceMesh(name: string): boolean {
    return ICE_MESHES.some(p => name.startsWith(p));
}

function isLaneMesh(name: string): boolean {
    return name.startsWith('lane_') || name.startsWith('jpad_') || name.startsWith('tipFill_');
}

export async function createAvaxMapFromGLB(
    scene: Scene,
    _sg: ShadowGenerator,
): Promise<MapData> {
    console.log('[MapGLB] Loading newmap.glb...');

    const result = await SceneLoader.ImportMeshAsync(
        '',
        '/assets/',
        'newmap.glb',
        scene,
    );

    // ── Texture'ları yükle (paylaşımlı — clone yapmıyoruz) ──
    const lavaTex = new Texture('/assets/images/textures/lava.webp', scene);
    lavaTex.uScale = 4; lavaTex.vScale = 4;

    const iceTex = new Texture('/assets/images/textures/ice_color.webp', scene);
    iceTex.uScale = 4; iceTex.vScale = 4;

    // ── Ortak material'lar (tek instance, tüm mesh'ler paylaşır) ──
    const fireMat = new StandardMaterial('fireMat_shared', scene);
    fireMat.diffuseTexture = lavaTex;
    fireMat.emissiveTexture = lavaTex;          // lava.jpg'yi emissive olarak da kullan
    fireMat.emissiveColor = new Color3(.4, .15, .03);
    fireMat.specularColor = new Color3(.1, .05, .02);
    fireMat.backFaceCulling = false;

    const iceMat = new StandardMaterial('iceMat_shared', scene);
    iceMat.diffuseTexture = iceTex;
    iceMat.emissiveTexture = iceTex;            // ice_color.jpg'yi emissive olarak da kullan
    iceMat.emissiveColor = new Color3(.06, .1, .22);
    iceMat.specularColor = new Color3(.2, .2, .35);
    iceMat.backFaceCulling = false;

    const walkable: Mesh[] = [];

    // ── Mesh'lere texture ata ──
    result.meshes.forEach((m: AbstractMesh) => {
        m.receiveShadows = true;
        m.isPickable = false;

        const name = m.name;

        // Fire bölgesi mesh'lerine lava texture
        if (isFireMesh(name) || (isLaneMesh(name) && m.position.z < 0)) {
            m.material = fireMat;
        }
        // Ice bölgesi mesh'lerine ice texture
        else if (isIceMesh(name) || (isLaneMesh(name) && m.position.z >= 0)) {
            m.material = iceMat;
        }

        if (isWalkable(name) && m instanceof Mesh) {
            walkable.push(m);
        }
    });

    console.log(`[MapGLB] Loaded ${result.meshes.length} meshes, ${walkable.length} walkable`);

    // ─── DYNAMIC ELEMENTS ────────────────

    const gl = new GlowLayer('glow', scene, { blurKernelSize: 8 });
    gl.intensity = 0.2;

    buildSky(scene);
    buildVoidGround(scene);
    buildLighting(scene);

    try {
        buildParticles(scene);
    } catch (e) {
        console.warn('[MapGLB] Particles skipped:', e);
    }

    return { walkableMeshes: walkable };
}

/* ═══════════════════════════════════════════════════════════════════════
 * SKY (GLB'de yok — DynamicTexture kullanıyor)
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
 * VOID GROUND
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
 * LIGHTING
 * ═══════════════════════════════════════════════════════════════════════ */
function buildLighting(scene: Scene): void {
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.55;
    hemi.diffuse = new Color3(.9, .85, .8);
    hemi.groundColor = new Color3(.12, .1, .18);

    const lights: { n: string; p: Vector3; c: Color3; i: number; r: number }[] = [
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
    ];

    // Energy node lights
    const energyLights = [
        { z: -48, fire: true }, { z: 48, fire: false },
    ];
    energyLights.forEach(n => {
        const col = n.fire ? new Color3(1, .5, .1) : new Color3(.2, .55, 1);
        const lt = new PointLight(`energyLt_${n.fire ? 'f' : 'i'}`, new Vector3(0, SURF + 4, n.z), scene);
        lt.diffuse = col; lt.intensity = 1.0; lt.range = 16;
    });

    // Lava pool lights
    [{ x: -10, z: -14 }, { x: 10, z: -14 },
     { x: -5, z: -26 }, { x: 5, z: -26 },
     { x: -18, z: -8 }, { x: 18, z: -8 }].forEach((lp, i) => {
        const lt = new PointLight(`lavaLt_${i}`, new Vector3(lp.x, SURF + 2.5, lp.z), scene);
        lt.diffuse = new Color3(1, .5, .05); lt.intensity = .5; lt.range = 12;
    });

    // Ice pool lights
    [{ x: -10, z: 14 }, { x: 10, z: 14 },
     { x: -5, z: 26 }, { x: 5, z: 26 },
     { x: -18, z: 8 }, { x: 18, z: 8 }].forEach((ip, i) => {
        const lt = new PointLight(`icePLt_${i}`, new Vector3(ip.x, SURF + 2.5, ip.z), scene);
        lt.diffuse = new Color3(.3, .55, 1); lt.intensity = .4; lt.range = 12;
    });

    // Crystal lights
    [{ x: -5, z: 20, h: 3.5 }, { x: 5, z: 20, h: 3.8 },
     { x: -4, z: 28, h: 4.0 }, { x: 4, z: 28, h: 3.8 }].forEach((c, i) => {
        const lt = new PointLight(`cryLt_${i}`, new Vector3(c.x, SURF + c.h + 1, c.z), scene);
        lt.diffuse = new Color3(.3, .5, .9); lt.intensity = .25; lt.range = 7;
    });

    lights.forEach(l => {
        const lt = new PointLight(l.n, l.p, scene);
        lt.diffuse = l.c; lt.intensity = l.i; lt.range = l.r;
    });
}

/* ═══════════════════════════════════════════════════════════════════════
 * PARTICLES
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
