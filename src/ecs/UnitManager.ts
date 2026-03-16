/**
 * UnitManager.ts — Spawns, animates, and manages combat for all 9 unit types.
 *
 * FIRE:      Korhan (warrior), Erlik (dark mage), Od (fire mage)
 * ICE:       Ayaz (warrior), Tulpar (swift mount), Umay (ice mage)
 * MERCENARY: Albasti (wing spirit), Tepegöz (giant), Şahmeran (serpent)
 */
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import '@babylonjs/loaders/glTF';
import { Unit, Team, UnitType, STATS_MAP, AI_PROFILES_MAP } from './Unit';
import { SimpleNavGraph } from '../pathfinding/SimpleNavGraph';
import { tickPassives, tickStatusEffects, checkAbilityTrigger, applyStatusEffect, hasStatus } from './abilities/AbilitySystem';
import { UNIT_ABILITY_MAP } from './abilities/characterAbilities';
import type { ShardBonus } from './types';
import type { BaseBuilding } from '../scene/map/BaseBuilding';
import { getCachedUrl, waitForCache, getOriginalFileName } from '../glbCache';

let nextId = 1;

interface SpellProjectile {
    mesh: Mesh;
    targetUnit: Unit;
    attacker: Unit;
    speed: number;
    damage: number;
    isHeal: boolean;
    elapsed: number;
    frameTimer: number;
    currentFrame: number;
    totalFrames: number;
}

interface GLBAnimData {
    walkRoot:    TransformNode;
    attackRoot:  TransformNode;
    dieRoot:     TransformNode | null;   // null = no die GLB (procedural death)
    walkAnims:   AnimationGroup[];
    attackAnims: AnimationGroup[];
    dieAnims:    AnimationGroup[];
    lastState:   'walking' | 'fighting' | 'dead' | null;
    dieStarted:  boolean;
    // Boru multi-attack support
    attackRoot2?:  TransformNode;
    attackAnims2?: AnimationGroup[];
    activeAttack?: 1 | 2;
    attackSwitchTimer?: number;
}

export class UnitManager {
    public readonly units: Unit[] = [];
    public onProgress: ((loaded: number, total: number) => void) | null = null;
    public onUnitDeath: ((unit: Unit) => void) | null = null;
    private readonly scene: Scene;
    private readonly sg: ShadowGenerator;
    private readonly nav: SimpleNavGraph;
    private gameTime = 0;
    private korhanTemplate: Mesh | null = null;
    // Korhan animation containers (loaded once, instantiated per unit)
    private korhanWalkContainer:   AssetContainer | null = null;
    private korhanAttackContainer: AssetContainer | null = null;
    private korhanDieContainer:    AssetContainer | null = null;
    private korhanAnimMap = new Map<number, GLBAnimData>();
    // Erlik animation containers
    private erlikWalkContainer:   AssetContainer | null = null;
    private erlikAttackContainer: AssetContainer | null = null;
    private erlikDieContainer:    AssetContainer | null = null;
    private erlikAnimMap = new Map<number, GLBAnimData>();
    // Od animation containers (walk + attack + die)
    private odWalkContainer:   AssetContainer | null = null;
    private odAttackContainer: AssetContainer | null = null;
    private odDieContainer:    AssetContainer | null = null;
    private odAnimMap = new Map<number, GLBAnimData>();
    // Tepegöz animation containers (walk + attack + die)
    private tepegozWalkContainer:   AssetContainer | null = null;
    private tepegozAttackContainer: AssetContainer | null = null;
    private tepegozDieContainer:    AssetContainer | null = null;
    private tepegozAnimMap = new Map<number, GLBAnimData>();
    // Albastı animation containers (walk + attack + die)
    private albastiWalkContainer:   AssetContainer | null = null;
    private albastiAttackContainer: AssetContainer | null = null;
    private albastiDieContainer:    AssetContainer | null = null;
    private albastiAnimMap = new Map<number, GLBAnimData>();
    // Umay animation containers (walk + attack + die)
    private umayWalkContainer:   AssetContainer | null = null;
    private umayAttackContainer: AssetContainer | null = null;
    private umayDieContainer:    AssetContainer | null = null;
    private umayAnimMap = new Map<number, GLBAnimData>();
    // Tulpar animation containers (walk only — trample mechanic)
    private ayazWalkContainer:   AssetContainer | null = null;
    private ayazAttackContainer: AssetContainer | null = null;
    private ayazDieContainer:    AssetContainer | null = null;
    private ayazAnimMap = new Map<number, GLBAnimData>();

    private tulparWalkContainer: AssetContainer | null = null;
    private tulparAnimMap = new Map<number, GLBAnimData>();
    // Şahmeran animation containers (walk + attack + die)
    private sahmeranWalkContainer:   AssetContainer | null = null;
    private sahmeranAttackContainer: AssetContainer | null = null;
    private sahmeranDieContainer:    AssetContainer | null = null;
    private sahmeranAnimMap = new Map<number, GLBAnimData>();
    // Börü animation containers (walk + attack1 + attack2 + die)
    private boruWalkContainer:    AssetContainer | null = null;
    private boruAttackContainer:  AssetContainer | null = null;
    private boruAttackContainer2: AssetContainer | null = null;
    private boruDieContainer:     AssetContainer | null = null;
    private boruAnimMap = new Map<number, GLBAnimData>();
    /** Shard bonuses — set from main.ts each frame */
    public fireShard: ShardBonus = { manaRegen: 0, attackBonus: 0, speedBonus: 0 };
    public iceShard: ShardBonus = { manaRegen: 0, attackBonus: 0, speedBonus: 0 };
    /** Multiplayer: guest'te base hasari devre disi (host otoritif) */
    public skipBaseDamage = false;
    /** Spell projectiles (Od/Tulpar ranged attacks) */
    private spellProjectiles: SpellProjectile[] = [];
    private fireSpellTex: Texture | null = null;
    private iceSpellTex: Texture | null = null;
    /** Base references for unit→base melee attacks */
    private fireBase: BaseBuilding | null = null;
    private iceBase:  BaseBuilding | null = null;
    /** Match stats */
    private stats: Record<string, { team: string; deployed: number; deaths: number; totalPoAI: number; bestPoAI: number }> = {};

    constructor(scene: Scene, sg: ShadowGenerator) {
        this.scene = scene;
        this.sg = sg;
        this.nav = new SimpleNavGraph();
    }

    setBaseRefs(fire: BaseBuilding, ice: BaseBuilding): void {
        this.fireBase = fire;
        this.iceBase  = ice;
    }

    /** Ouroboros — birimi karşı takıma geçir, tüm cache'leri temizle */
    convertUnit(unit: Unit, newTeam: Team): void {
        const oldTeam = unit.team;
        unit.team = newTeam;
        unit.targetUnit = null;
        unit.state = 'walking';
        (unit.abilityState as any)._cachedEnemy = null;
        (unit.abilityState as any)._enemyLockTimer = 0;
        (unit.abilityState as any)._cachedTarget = null;
        (unit.abilityState as any)._targetLockTimer = 0;

        // Yeni takım yönünde path ver
        const curPos = unit.mesh.position;
        const lane = Math.floor(Math.random() * 3);
        const fullPath = this.buildLanePath(0, 24, lane, newTeam);
        const fullQueue = fullPath.map(n => new Vector3(n.x, unit.baseY, n.z));
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < fullQueue.length; i++) {
            const dx = fullQueue[i].x - curPos.x;
            const dz = fullQueue[i].z - curPos.z;
            const d = dx * dx + dz * dz;
            if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        unit.pathQueue = fullQueue.slice(bestIdx);

        // TÜM birimlerin cache'ini temizle (takım değişikliği karışıklık yaratmasın)
        for (const u of this.units) {
            if (u.state === 'dead') continue;
            const st = u.abilityState as any;
            // Bu birimi hedef almış olanları temizle
            if (st._cachedEnemy === unit) { st._cachedEnemy = null; st._enemyLockTimer = 0; }
            if (st._cachedTarget === unit) { st._cachedTarget = null; st._targetLockTimer = 0; }
            if (u.targetUnit === unit) { u.targetUnit = null; }
        }

        // Emissive renk güncelle
        unit.mesh.getChildMeshes().forEach(c => {
            if (c.material && 'emissiveColor' in c.material) {
                (c.material as any).emissiveColor = newTeam === 'fire'
                    ? { r: 0.6, g: 0.15, b: 0.05 }
                    : { r: 0.1, g: 0.3, b: 0.6 };
            }
        });

        console.log(`[OUROBOROS] ${unit.type}#${unit.id} converted: ${oldTeam} → ${newTeam}`);
    }

    /**
     * GLB karakteri instantiate eder. walkContainer zorunlu;
     * attackContainer / dieContainer null olabilir — yoksa walk pose kullanılır.
     */
    private buildGlbRoots(
        parent: Mesh,
        prefix: string,
        scale: number,
        walkC: AssetContainer,
        attackC: AssetContainer | null,
        dieC:    AssetContainer | null,
    ): GLBAnimData {
        const mk = (tag: string) => (n: string) => `${prefix}_${tag}_${n}`;

        const walkInst   = walkC.instantiateModelsToScene(mk('w'), true);
        const attackInst = attackC?.instantiateModelsToScene(mk('a'), true) ?? null;
        const dieInst    = dieC?.instantiateModelsToScene(mk('d'), true)    ?? null;

        // Debug: mesh ve animasyon sayılarını logla
        console.log(`[GLB] ${prefix} — walk: ${walkInst.rootNodes.length} roots, ${walkInst.rootNodes[0]?.getChildMeshes().length ?? 0} meshes, ${walkInst.animationGroups.length} anims`);
        if (attackInst) console.log(`[GLB] ${prefix} — attack: ${attackInst.rootNodes.length} roots, ${attackInst.rootNodes[0]?.getChildMeshes().length ?? 0} meshes, ${attackInst.animationGroups.length} anims`);
        if (dieInst) console.log(`[GLB] ${prefix} — die: ${dieInst.rootNodes.length} roots, ${dieInst.rootNodes[0]?.getChildMeshes().length ?? 0} meshes, ${dieInst.animationGroups.length} anims`);

        const walkRoot   = walkInst.rootNodes[0] as TransformNode;
        const attackRoot = (attackInst?.rootNodes[0] ?? walkRoot) as TransformNode;
        const dieRoot    = dieInst ? dieInst.rootNodes[0] as TransformNode : null;

        const allRoots: TransformNode[] = [walkRoot];
        if (attackInst) allRoots.push(attackRoot);
        if (dieRoot)    allRoots.push(dieRoot);

        for (const root of allRoots) {
            root.parent   = parent;
            root.position = Vector3.Zero();
            root.setEnabled(true);
            (root as any).scaling = new Vector3(scale, scale, scale);
            root.getChildMeshes().forEach(c => {
                c.setEnabled(true);
                c.isVisible = true;
                if (c instanceof Mesh) {
                    this.sg.addShadowCaster(c);
                    if (c.material instanceof PBRMaterial) {
                        c.material.directIntensity      = 1.5;
                        c.material.environmentIntensity = 0.5;
                        c.material.emissiveIntensity    = 0.2;
                    }
                }
            });
        }

        if (attackInst) attackRoot.setEnabled(false);
        if (dieRoot)    dieRoot.setEnabled(false);

        walkInst.animationGroups.forEach(ag => { ag.loopAnimation = true; ag.speedRatio = 1.0; ag.goToFrame(0); ag.play(true); });
        attackInst?.animationGroups.forEach(ag => { ag.loopAnimation = true; ag.stop(); });
        dieInst?.animationGroups.forEach(ag => { ag.loopAnimation = false; ag.stop(); });

        return {
            walkRoot, attackRoot, dieRoot,
            walkAnims:   walkInst.animationGroups,
            attackAnims: attackInst?.animationGroups ?? [],
            dieAnims:    dieInst?.animationGroups    ?? [],
            lastState:   'walking',
            dieStarted:  false,
        };
    }

    getStats() {
        // Also capture still-alive units' poai
        for (const u of this.units) {
            const key = `${u.type}_${u.team}`;
            if (this.stats[key]) {
                this.stats[key].bestPoAI = Math.max(this.stats[key].bestPoAI, u.poaiScore);
                this.stats[key].totalPoAI += u.poaiScore;
            }
        }
        return this.stats;
    }

    async preload(): Promise<void> {
        // Önce warm-cache'in bitmesini bekle (zaten arka planda iniyor)
        console.log('⏳ Warm-cache bekleniyor...');
        await waitForCache();
        console.log('✅ Warm-cache hazır — GLB parse başlıyor');

        // Korhan static template (fallback if animation GLBs fail)
        try {
            const result = await SceneLoader.ImportMeshAsync(
                '', '/assets/images/gameplay/', 'korhan.glb', this.scene,
            );
            this.korhanTemplate = result.meshes[0] as Mesh;
            this.korhanTemplate.setEnabled(false);
            console.log('✅ Korhan template loaded');
        } catch {
            console.warn('⚠️ Korhan GLB not found — using procedural');
        }

        // ── Her dosya bağımsız yüklenir; biri başarısız olursa
        //    diğerleri etkilenmez, walk varsa GLB gösterilir. ──────────
        // Cache'deki objectURL'den yükle — network isteği sıfır.
        const loadCached = (file: string, boru = false) => {
            const url = getCachedUrl(file, boru);
            // objectURL ise: rootUrl=blobURL, filename=orijinal dosya adı → plugin .glb'yi tanır
            if (url.startsWith('blob:')) {
                return SceneLoader.LoadAssetContainerAsync(url, '', this.scene, undefined, '.glb');
            }
            // Fallback: normal URL
            const base = boru
                ? '/assets/character%20animation/Meshy_AI_biped/'
                : '/assets/character%20animation/';
            return SceneLoader.LoadAssetContainerAsync(base, file, this.scene);
        };

        let loaded = 0;
        const totalFiles = 29;
        const TIMEOUT_MS = 30_000; // Cache'den yükleme — 30s yeterli

        type LoadEntry = { file: string; boru?: boolean };
        const tryLoad = async (entry: LoadEntry): Promise<AssetContainer | null> => {
            try {
                const timeout = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS),
                );
                const result = await Promise.race([loadCached(entry.file, entry.boru), timeout]) as AssetContainer;
                loaded++;
                if (this.onProgress) this.onProgress(loaded, totalFiles);
                console.log(`✅ ${entry.file} parse edildi (cache)`);
                return result;
            } catch (err) {
                loaded++;
                if (this.onProgress) this.onProgress(loaded, totalFiles);
                console.error(`❌ ${entry.file} yüklenemedi:`, err);
                return null;
            }
        };

        // Cache'den parse — hepsi bellekte, paralel yükle (network yok)
        const BATCH_SIZE = 6;
        const allEntries: LoadEntry[] = [
            { file: 'korhanwalk.glb' }, { file: 'Korhanattack.glb' }, { file: 'korhandie.glb' },
            { file: 'erlik.glb' }, { file: 'erlikattack.glb' }, { file: 'erlikdie.glb' },
            { file: 'odwalk.glb' }, { file: 'odattack.glb' }, { file: 'oddie.glb' },
            { file: 'tepegozwalk.glb' }, { file: 'tepegozattack.glb' }, { file: 'tepegozdie.glb' },
            { file: 'albastiwalk.glb' }, { file: 'albastiattack.glb' }, { file: 'albastidie.glb' },
            { file: 'umaywalk.glb' }, { file: 'umayattack.glb' }, { file: 'umaydie.glb' },
            { file: 'ayazwalk.glb' }, { file: 'ayazattack.glb' }, { file: 'ayazdie.glb' },
            { file: 'tulpar.glb' },
            { file: 'sahmeranwalk.glb' }, { file: 'sahmeranattack.glb' }, { file: 'sahmerandie.glb' },
            { file: 'boruwalk.glb', boru: true }, { file: 'boruattack.glb', boru: true }, { file: 'boruattack2.glb', boru: true }, { file: 'borudie.glb', boru: true },
        ];

        const results: (AssetContainer | null)[] = [];
        for (let i = 0; i < allEntries.length; i += BATCH_SIZE) {
            const batch = allEntries.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(e => tryLoad(e)));
            results.push(...batchResults);
        }

        const [
            korhanW, korhanA, korhanD,
            erlikW, erlikA, erlikD,
            odW, odA, odD,
            tepegozW, tepegozA, tepegozD,
            albastiW, albastiA, albastiD,
            umayW, umayA, umayD,
            ayazW, ayazA, ayazD,
            tulparW,
            sahmeranW, sahmeranA, sahmeranD,
            boruW, boruA, boruA2, boruD,
        ] = results;

        this.korhanWalkContainer = korhanW; this.korhanAttackContainer = korhanA; this.korhanDieContainer = korhanD;
        this.erlikWalkContainer = erlikW; this.erlikAttackContainer = erlikA; this.erlikDieContainer = erlikD;
        this.odWalkContainer = odW; this.odAttackContainer = odA; this.odDieContainer = odD;
        this.tepegozWalkContainer = tepegozW; this.tepegozAttackContainer = tepegozA; this.tepegozDieContainer = tepegozD;
        this.albastiWalkContainer = albastiW; this.albastiAttackContainer = albastiA; this.albastiDieContainer = albastiD;
        this.umayWalkContainer = umayW; this.umayAttackContainer = umayA; this.umayDieContainer = umayD;
        this.ayazWalkContainer = ayazW; this.ayazAttackContainer = ayazA; this.ayazDieContainer = ayazD;
        this.tulparWalkContainer = tulparW;
        this.sahmeranWalkContainer = sahmeranW; this.sahmeranAttackContainer = sahmeranA; this.sahmeranDieContainer = sahmeranD;
        this.boruWalkContainer = boruW; this.boruAttackContainer = boruA; this.boruAttackContainer2 = boruA2; this.boruDieContainer = boruD;

        // Preload özet log
        const summary = [
            ['Korhan', korhanW, korhanA, korhanD],
            ['Erlik', erlikW, erlikA, erlikD],
            ['Od', odW, odA, odD],
            ['Ayaz', ayazW, ayazA, ayazD],
            ['Tulpar', tulparW, null, null],
            ['Umay', umayW, umayA, umayD],
            ['Albasti', albastiW, albastiA, albastiD],
            ['Tepegöz', tepegozW, tepegozA, tepegozD],
            ['Şahmeran', sahmeranW, sahmeranA, sahmeranD],
            ['Börü', boruW, boruA, boruD],
        ] as const;
        let okCount = 0, failCount = 0;
        for (const [name, w, a, d] of summary) {
            const wOk = !!w, aOk = !!a, dOk = !!d;
            const status = wOk ? '✅' : '❌';
            console.log(`${status} ${name}: walk=${wOk} attack=${aOk} die=${dOk}`);
            if (wOk) okCount++; else failCount++;
        }
        console.log(`📊 Preload sonucu: ${okCount}/10 karakter GLB yüklendi, ${failCount} başarısız`);

        // Spell effect textures (576.png sprite sheet — 14 cols × 9 rows, 64×64 cells)
        try {
            this.fireSpellTex = new Texture('/assets/Effect%20and%20FX%20Pixel%20Part%2012%20Free/576.webp', this.scene, false, true, Texture.NEAREST_SAMPLINGMODE);
            this.fireSpellTex.hasAlpha = true;
            this.iceSpellTex = this.fireSpellTex; // same sheet, different UV row
            console.log('✅ Spell effect texture loaded');
        } catch { console.warn('⚠️ Spell effect texture not found'); }
    }

    spawnUnit(type: UnitType, team: Team, lane?: number): Unit {
        // New map: fire base Z=-38, ice base Z=+38
        const spawnPos = team === 'fire'
            ? new Vector3(0, 0, -38)
            : new Vector3(0, 0, 38);

        const mesh = this.buildUnitMesh(type, team, spawnPos);
        const chosenLane = lane ?? Math.floor(Math.random() * 3);
        // fire: 0→19, ice: 19→0 (reversed)
        const start = team === 'fire' ? 0 : 19;
        const end = team === 'fire' ? 19 : 0;
        const path = this.buildLanePath(start, end, chosenLane, team);
        const Y = spawnPos.y;
        const pathQueue = path.map(n => new Vector3(n.x, Y, n.z));

        const { bg, fill } = this.createHealthBar(mesh, type);
        const stats = { ...STATS_MAP[type] };

        const aiProfile = AI_PROFILES_MAP[type];
        const unit: Unit = {
            id: nextId++,
            team, type, mesh,
            hp: stats.maxHp, stats,
            state: 'walking',
            pathQueue,
            targetUnit: null,
            lastAttackTime: 0,
            walkBobTime: Math.random() * Math.PI * 2,
            baseY: Y,
            healthBarBg: bg,
            healthBarFill: fill,
            aiProfile,
            statusEffects: [],
            poaiScore: 0,
            abilityState: {},
        };
        // Attach ability ID for the AbilitySystem
        (unit as any)._abilityId = UNIT_ABILITY_MAP[type] ?? '';
        // Fire on_deploy trigger
        checkAbilityTrigger('on_deploy', unit);

        this.units.push(unit);
        this.spawnFlash(unit);

        // Stats tracking
        const key = `${type}_${team}`;
        if (!this.stats[key]) this.stats[key] = { team, deployed: 0, deaths: 0, totalPoAI: 0, bestPoAI: 0 };
        this.stats[key].deployed++;

        return unit;
    }

    /**
     * Spawn a unit at a specific position (e.g. from crystal shard).
     * The unit walks toward the enemy base from its spawn point.
     */
    spawnUnitAt(type: UnitType, team: Team, position: Vector3, lane?: number): Unit {
        const mesh = this.buildUnitMesh(type, team, position);
        const chosenLane = lane ?? Math.floor(Math.random() * 3);

        // Build full lane path, then trim to nearest point from spawn position
        const fullPath = this.buildLanePath(0, 24, chosenLane, team);
        const Y = position.y;
        const fullQueue = fullPath.map(n => new Vector3(n.x, Y, n.z));

        // Find the closest waypoint to spawn position and start from there
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < fullQueue.length; i++) {
            const dx = fullQueue[i].x - position.x;
            const dz = fullQueue[i].z - position.z;
            const d = dx * dx + dz * dz;
            if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        const pathQueue = fullQueue.slice(bestIdx);

        const { bg, fill } = this.createHealthBar(mesh, type);
        const stats = { ...STATS_MAP[type] };
        const aiProfile = AI_PROFILES_MAP[type];

        const unit: Unit = {
            id: nextId++,
            team, type, mesh,
            hp: stats.maxHp, stats,
            state: 'walking',
            pathQueue,
            targetUnit: null,
            lastAttackTime: 0,
            walkBobTime: Math.random() * Math.PI * 2,
            baseY: Y,
            healthBarBg: bg,
            healthBarFill: fill,
            aiProfile,
            statusEffects: [],
            poaiScore: 0,
            abilityState: {},
        };
        (unit as any)._abilityId = UNIT_ABILITY_MAP[type] ?? '';
        checkAbilityTrigger('on_deploy', unit);

        // Spawn immunity — kristalden doğan birimler 3 saniye hasar almaz
        unit.abilityState._spawnImmunity = 3.0;

        this.units.push(unit);
        this.spawnFlash(unit);

        const key = `${type}_${team}`;
        if (!this.stats[key]) this.stats[key] = { team, deployed: 0, deaths: 0, totalPoAI: 0, bestPoAI: 0 };
        this.stats[key].deployed++;

        return unit;
    }

    public buildLanePath(_from: number, _to: number, lane: number, team: Team): Vector3[] {
        // lane 0 = SOL  (X: -4→-14→-4, diamond konturunu takip eder)
        // lane 1 = ORTA (X=0, nodes 25 & 26 for mid extensions)
        // lane 2 = SAĞ  (X: +4→+14→+4, diamond konturunu takip eder)
        const laneNodes: Record<number, number[]> = {
            0: [0,  1,  3,  6,  9, 12, 14, 17, 20, 22, 24],  // SOL  lane
            1: [0, 25,  4,  7, 10, 15, 18, 26, 24],           // ORTA lane
            2: [0,  2,  5,  8, 11, 13, 16, 19, 21, 23, 24],  // SAĞ  lane
        };
        let path = laneNodes[lane] ?? laneNodes[1];
        if (team === 'ice') path = [...path].reverse();
        const points = path.map(i => this.nav.nodes[i].clone());
        // Son noktayi base'den 4 birim geri cek (unitler icine girmesin)
        const last = points[points.length - 1];
        const prev = points.length > 1 ? points[points.length - 2] : last;
        const dir = last.subtract(prev);
        if (dir.length() > 0.1) {
            dir.normalize();
            last.subtractInPlace(dir.scale(4));
        }
        return points;
    }

    // ─── MESH DISPATCHER ────────────────────────────────────────────
    private buildUnitMesh(type: UnitType, team: Team, pos: Vector3): Mesh {
        const root = new Mesh(`unit_${nextId}`, this.scene);
        root.position = pos.clone();

        switch (type) {
            // Fire
            case 'korhan': this.buildKorhan(root, team); break;
            case 'erlik':  this.buildErlik(root, team, nextId); break;
            case 'od': this.buildOd(root, team, nextId); break;
            // Ice
            case 'ayaz': this.buildAyaz(root, team); break;
            case 'tulpar': this.buildTulpar(root, team); break;
            case 'umay': this.buildUmay(root, team, nextId); break;
            // Mercenary
            case 'albasti': this.buildAlbasti(root, team, nextId); break;
            case 'tepegoz': this.buildTepegoz(root, team, nextId); break;
            case 'sahmeran': this.buildSahmeran(root, team); break;
            case 'boru': this.buildBoru(root, team, nextId); break;
        }

        return root;
    }

    // ─── KORHAN — heavy fire warrior with walk / attack / die + hammer ─
    private buildKorhan(parent: Mesh, team: Team): void {
        // Animated GLB version (preferred) — sadece walkContainer yeterli
        if (this.korhanWalkContainer && team === 'fire') {
            const unitId = nextId;
            const mk = (prefix: string) => (n: string) => `${prefix}_${unitId}_${n}`;

            const walkInst   = this.korhanWalkContainer.instantiateModelsToScene(mk('kw'), true);
            const attackInst = this.korhanAttackContainer?.instantiateModelsToScene(mk('ka'), true) ?? null;
            const dieInst    = this.korhanDieContainer?.instantiateModelsToScene(mk('kd'), true)    ?? null;

            const walkRoot   = walkInst.rootNodes[0]   as TransformNode;
            const attackRoot = (attackInst?.rootNodes[0] ?? walkRoot) as TransformNode;
            const dieRoot    = dieInst ? dieInst.rootNodes[0] as TransformNode : null;

            const allRoots: TransformNode[] = [walkRoot];
            if (attackInst) allRoots.push(attackRoot);
            if (dieRoot)    allRoots.push(dieRoot);

            for (const root of allRoots) {
                root.parent   = parent;
                root.position = Vector3.Zero();
                root.setEnabled(true);
                (root as any).scaling = new Vector3(1.3, 1.3, 1.3);
                root.getChildMeshes().forEach(c => {
                    c.setEnabled(true);
                    c.isVisible = true;
                    if (c instanceof Mesh) {
                        this.sg.addShadowCaster(c);
                        if (c.material instanceof PBRMaterial) {
                            c.material.directIntensity      = 1.5;
                            c.material.environmentIntensity = 0.5;
                            c.material.emissiveIntensity    = 0.2;
                        }
                    }
                });
            }

            // Only walk visible at start
            if (attackInst) attackRoot.setEnabled(false);
            if (dieRoot)    dieRoot.setEnabled(false);

            // Start walk loop, stop others
            walkInst.animationGroups.forEach(ag => { ag.loopAnimation = true; ag.speedRatio = 1.0; ag.goToFrame(0); ag.play(true); });
            attackInst?.animationGroups.forEach(ag => { ag.loopAnimation = true; ag.stop(); });
            dieInst?.animationGroups.forEach(ag => { ag.loopAnimation = false; ag.stop(); });

            // Korhan attack GLB has extra anims (walk, cast) — keep only Hammer
            const korhanAttackAnims = (attackInst?.animationGroups ?? []).filter(ag => /hammer|attack|swing|hit/i.test(ag.name));
            const finalAttackAnims = korhanAttackAnims.length > 0 ? korhanAttackAnims : (attackInst?.animationGroups ?? []);
            // Stop the filtered-out anims so they don't interfere
            (attackInst?.animationGroups ?? []).forEach(ag => { if (!finalAttackAnims.includes(ag)) { ag.stop(); ag.reset(); } });

            this.korhanAnimMap.set(unitId, {
                walkRoot, attackRoot, dieRoot,
                walkAnims:   walkInst.animationGroups,
                attackAnims: finalAttackAnims,
                dieAnims:    dieInst?.animationGroups    ?? [],
                lastState:   'walking',
                dieStarted:  false,
            });
            return;
        }

        // Static GLB fallback
        if (this.korhanTemplate && team === 'fire') {
            const clone = this.korhanTemplate.clone(`korhan_${nextId}`, parent)!;
            clone.setEnabled(true);
            clone.position = Vector3.Zero();
            clone.scaling = new Vector3(1.3, 1.3, 1.3);
            clone.getChildMeshes().forEach(c => {
                c.setEnabled(true);
                if (c instanceof Mesh) this.sg.addShadowCaster(c);
            });
            return;
        }

        // Procedural fallback
        this.buildWarriorBody(parent, team === 'fire'
            ? new Color3(0.9, 0.25, 0.05)
            : new Color3(0.1, 0.35, 0.9), 'sword');
    }

    // ─── ERLIK — dark GLB warrior with walk / attack / die animations ───
    private buildErlik(parent: Mesh, team: Team, unitId: number): void {
        if (!this.erlikWalkContainer) { this.buildMage(parent, team, 'dark'); return; }
        this.erlikAnimMap.set(unitId, this.buildGlbRoots(
            parent, `ew${unitId}`, 1.3,
            this.erlikWalkContainer, this.erlikAttackContainer, this.erlikDieContainer,
        ));
    }

    // ─── UMAY — ice mage with walk / attack / die animations ──────
    private buildUmay(parent: Mesh, team: Team, unitId: number): void {
        if (!this.umayWalkContainer) { this.buildMage(parent, team, 'ice'); return; }
        this.umayAnimMap.set(unitId, this.buildGlbRoots(
            parent, `uw${unitId}`, 1.3,
            this.umayWalkContainer, this.umayAttackContainer, this.umayDieContainer,
        ));
    }

    // ─── OD — fire mage with walk / attack / die animations ─────────────
    private buildOd(parent: Mesh, team: Team, unitId: number): void {
        if (!this.odWalkContainer) { this.buildMage(parent, team, 'fire'); return; }
        this.odAnimMap.set(unitId, this.buildGlbRoots(
            parent, `ow${unitId}`, 1.3,
            this.odWalkContainer, this.odAttackContainer, this.odDieContainer,
        ));
    }

    // ─── ERLIK / OD / UMAY — mages ──────────────────────────────────
    private buildMage(parent: Mesh, team: Team, style: 'fire' | 'dark' | 'ice'): void {
        const colors: Record<string, [Color3, Color3]> = {
            fire: [new Color3(0.85, 0.3, 0.02), new Color3(0.4, 0.08, 0)],
            dark: [new Color3(0.1, 0.02, 0.15), new Color3(0.3, 0.0, 0.4)],
            ice: [new Color3(0.15, 0.4, 0.9), new Color3(0.02, 0.08, 0.3)],
        };
        const [body, emis] = colors[style];

        const b = MeshBuilder.CreateCapsule(`mb_${nextId}`, { height: 2.1, radius: 0.4, tessellation: 10 }, this.scene);
        b.parent = parent; b.position = new Vector3(0, 1.05, 0);
        const bm = new StandardMaterial(`mbm_${nextId}`, this.scene);
        bm.diffuseColor = body; bm.emissiveColor = emis;
        bm.alpha = 0.95; b.material = bm; this.sg.addShadowCaster(b);

        // Pointed hat / hood
        const hat = MeshBuilder.CreateCylinder(`mh_${nextId}`, { diameterTop: 0, diameterBottom: 0.7, height: 1.0, tessellation: 6 }, this.scene);
        hat.parent = parent; hat.position = new Vector3(0, 2.7, 0);
        const hm = new StandardMaterial(`mhm_${nextId}`, this.scene);
        hm.diffuseColor = body; hm.emissiveColor = emis.scale(1.5); hat.material = hm;

        // Staff / wand
        const staff = MeshBuilder.CreateCylinder(`ms_${nextId}`, { diameter: 0.1, height: 1.8, tessellation: 8 }, this.scene);
        staff.parent = parent; staff.position = new Vector3(0.55, 1.2, 0.1);
        const sm = new StandardMaterial(`msm_${nextId}`, this.scene);
        sm.diffuseColor = new Color3(0.4, 0.3, 0.1);
        sm.emissiveColor = emis.scale(2); staff.material = sm;

        // Orb on staff tip
        const orb = MeshBuilder.CreateSphere(`mo_${nextId}`, { diameter: 0.28, segments: 6 }, this.scene);
        orb.parent = parent; orb.position = new Vector3(0.55, 2.16, 0.1);
        const om = new StandardMaterial(`mom_${nextId}`, this.scene);
        om.diffuseColor = body; om.emissiveColor = emis.scale(3); om.alpha = 0.9; orb.material = om;
    }

    // ─── AYAZ — ice warrior with walk / attack / die animations ──────
    private buildAyaz(parent: Mesh, team: Team): void {
        if (this.ayazWalkContainer) {
            const unitId = nextId;
            this.ayazAnimMap.set(unitId, this.buildGlbRoots(
                parent, `az${unitId}`, 1.3,
                this.ayazWalkContainer, this.ayazAttackContainer, this.ayazDieContainer,
            ));
            return;
        }
        // Procedural fallback
        this.buildWarriorBody(parent,
            team === 'ice' ? new Color3(0.2, 0.5, 0.9) : new Color3(0.8, 0.2, 0.05),
            'shield');
    }

    // ─── TULPAR — swift winged horse (trample: damages while walking) ─
    private buildTulpar(parent: Mesh, _team: Team): void {
        const unitId = nextId;

        if (this.tulparWalkContainer) {
            const mk = (prefix: string) => (n: string) => `${prefix}_${unitId}_${n}`;
            const walkInst = this.tulparWalkContainer.instantiateModelsToScene(mk('tlw'), true);
            const walkRoot = walkInst.rootNodes[0] as TransformNode;

            walkRoot.parent   = parent;
            walkRoot.position = Vector3.Zero();
            walkRoot.setEnabled(true);
            (walkRoot as any).scaling = new Vector3(150, 150, 150);

            const allChildren = walkRoot.getChildMeshes(false);
            allChildren.forEach(c => {
                c.setEnabled(true);
                c.isVisible = true;
                if (c instanceof Mesh) {
                    this.sg.addShadowCaster(c);
                    if (c.material instanceof PBRMaterial) {
                        c.material.albedoColor = new Color3(0.85, 0.82, 0.78);
                        c.material.emissiveColor = new Color3(0.3, 0.28, 0.25);
                        c.material.directIntensity      = 2.0;
                        c.material.environmentIntensity = 1.0;
                        c.material.emissiveIntensity    = 1.0;
                        c.material.alpha = 1;
                        c.material.transparencyMode = 0; // opaque
                    }
                }
            });
            if (allChildren[0] instanceof Mesh) {
                const m = allChildren[0];
                m.refreshBoundingInfo();
                const bb = m.getBoundingInfo().boundingBox;
                console.log('✅ Tulpar GLB: verts:', m.getTotalVertices(),
                    'bbMin:', bb.minimum, 'bbMax:', bb.maximum,
                    'parentPos:', parent.position, 'rootPos:', walkRoot.position,
                    'meshPos:', m.position, 'meshScale:', m.scaling);
            }

            walkInst.animationGroups.forEach(ag => { ag.loopAnimation = true; ag.speedRatio = 1.0; ag.goToFrame(0); ag.play(true); });

            // attackRoot = walkRoot (Tulpar never enters fighting pose)
            this.tulparAnimMap.set(unitId, {
                walkRoot,
                attackRoot:  walkRoot,
                dieRoot:     null,
                walkAnims:   walkInst.animationGroups,
                attackAnims: [],
                dieAnims:    [],
                lastState:   'walking',
                dieStarted:  false,
            });
            return;
        }

        // Procedural fallback
        // Body (horse-like elongated)
        const body = MeshBuilder.CreateCapsule(`tlb_${unitId}`, { height: 3.0, radius: 0.6, tessellation: 10 }, this.scene);
        body.parent = parent; body.position = new Vector3(0, 1.2, 0);
        body.scaling = new Vector3(1, 1, 1.4);
        const bm = new StandardMaterial(`tlbm_${nextId}`, this.scene);
        bm.diffuseColor = new Color3(0.85, 0.82, 0.78);
        bm.emissiveColor = new Color3(0.05, 0.08, 0.18);
        body.material = bm; this.sg.addShadowCaster(body);

        // Wings
        for (const s of [-1, 1]) {
            const w = MeshBuilder.CreateBox(`tlw_${unitId}_${s}`, { width: 0.12, height: 1.2, depth: 2.2 }, this.scene);
            w.parent = parent; w.position = new Vector3(s * 0.9, 1.8, -0.2);
            w.rotation = new Vector3(0, 0, s * 0.3);
            const wm = new StandardMaterial(`tlwm_${unitId}_${s}`, this.scene);
            wm.diffuseColor = new Color3(0.9, 0.88, 0.8);
            wm.alpha = 0.82; w.material = wm;
        }

        // Flowing mane (orange glow)
        const mane = MeshBuilder.CreateCylinder(`tlm_${unitId}`, { diameterTop: 0.1, diameterBottom: 0.3, height: 1.0, tessellation: 6 }, this.scene);
        mane.parent = parent; mane.position = new Vector3(0, 2.2, 0.5);
        mane.rotation = new Vector3(Math.PI * 0.3, 0, 0);
        const mm = new StandardMaterial(`tlmm_${unitId}`, this.scene);
        mm.diffuseColor = new Color3(0.9, 0.5, 0.05);
        mm.emissiveColor = new Color3(0.4, 0.18, 0); mane.material = mm;
    }

    // ─── ALBASTI — winged neutral spirit with walk / attack / die ───
    private buildAlbasti(parent: Mesh, _team: Team, unitId: number): void {
        if (!this.albastiWalkContainer) { this.buildAlbastiProcedural(parent); return; }
        this.albastiAnimMap.set(unitId, this.buildGlbRoots(
            parent, `alw${unitId}`, 1.3,
            this.albastiWalkContainer, this.albastiAttackContainer, this.albastiDieContainer,
        ));
    }

    /** Procedural Albastı mesh (fallback). */
    private buildAlbastiProcedural(parent: Mesh): void {
        const body = MeshBuilder.CreateCapsule(`alb_${nextId}`, { height: 2.2, radius: 0.42, tessellation: 10 }, this.scene);
        body.parent = parent; body.position = new Vector3(0, 1.1, 0);
        const bm = new StandardMaterial(`albm_${nextId}`, this.scene);
        bm.diffuseColor = new Color3(0.7, 0.65, 0.9);
        bm.emissiveColor = new Color3(0.08, 0.06, 0.2);
        bm.alpha = 0.92; body.material = bm; this.sg.addShadowCaster(body);

        for (const s of [-1, 1]) {
            const wing = MeshBuilder.CreateBox(`albw_${nextId}_${s}`, { width: 0.12, height: 2.2, depth: 1.6 }, this.scene);
            wing.parent = parent; wing.position = new Vector3(s * 0.7, 1.8, -0.3);
            wing.rotation = new Vector3(-0.2, 0, s * 0.4);
            const wm = new StandardMaterial(`albwm_${nextId}_${s}`, this.scene);
            wm.diffuseColor = new Color3(0.9, 0.9, 1.0);
            wm.emissiveColor = new Color3(0.1, 0.1, 0.25);
            wm.alpha = 0.75; wing.material = wm;
        }

        const head = MeshBuilder.CreateSphere(`albh_${nextId}`, { diameter: 0.7, segments: 8 }, this.scene);
        head.parent = parent; head.position = new Vector3(0, 2.65, 0);
        const hm = new StandardMaterial(`albhm_${nextId}`, this.scene);
        hm.diffuseColor = new Color3(0.65, 0.6, 0.85);
        hm.emissiveColor = new Color3(0.2, 0.1, 0.4); head.material = hm;
    }

    // ─── TEPEGÖZ — one-eyed giant with walk / attack / die animations ─
    private buildTepegoz(parent: Mesh, _team: Team, unitId: number): void {
        const walkC = this.tepegozWalkContainer;
        const atkC  = this.tepegozAttackContainer;
        const dieC  = this.tepegozDieContainer;
        if (!walkC) { this.buildTepegozProcedural(parent); return; }
        this.tepegozAnimMap.set(unitId, this.buildGlbRoots(
            parent, `tw${unitId}`, 2.0,
            walkC, atkC, dieC,
        ));
    }

    /** Procedural Tepegöz mesh (fallback). */
    private buildTepegozProcedural(parent: Mesh): void {
        // Big box body
        const body = MeshBuilder.CreateBox(`tpb_${nextId}`, { width: 1.7, height: 2.8, depth: 1.2 }, this.scene);
        body.parent = parent; body.position = new Vector3(0, 1.4, 0);
        const bm = new StandardMaterial(`tpbm_${nextId}`, this.scene);
        bm.diffuseColor = new Color3(0.3, 0.2, 0.35);
        bm.emissiveColor = new Color3(0.06, 0.02, 0.1);
        body.material = bm; this.sg.addShadowCaster(body);

        // Big round head
        const head = MeshBuilder.CreateSphere(`tph_${nextId}`, { diameter: 1.2, segments: 8 }, this.scene);
        head.parent = parent; head.position = new Vector3(0, 3.2, 0);
        head.scaling = new Vector3(1, 0.9, 1);
        const hm = new StandardMaterial(`tphm_${nextId}`, this.scene);
        hm.diffuseColor = new Color3(0.32, 0.22, 0.38);
        hm.emissiveColor = new Color3(0.05, 0.02, 0.1); head.material = hm;

        // Single glowing eye (center)
        const eye = MeshBuilder.CreateSphere(`tpe_${nextId}`, { diameter: 0.35, segments: 6 }, this.scene);
        eye.parent = parent; eye.position = new Vector3(0, 3.3, 0.58);
        const em = new StandardMaterial(`tpem_${nextId}`, this.scene);
        em.diffuseColor = new Color3(0.9, 0.2, 0.8);
        em.emissiveColor = new Color3(0.7, 0.0, 0.6); eye.material = em;

        // Arms
        for (const s of [-1, 1]) {
            const arm = MeshBuilder.CreateBox(`tpa_${nextId}_${s}`, { width: 0.6, height: 2.0, depth: 0.5 }, this.scene);
            arm.parent = parent; arm.position = new Vector3(s * 1.3, 1.0, 0);
            arm.material = bm;
        }
    }

    // ─── ŞAHMERAN — snake queen ──────────────────────────────────────
    private buildSahmeran(parent: Mesh, _team: Team): void {
        const unitId = nextId;

        if (this.sahmeranWalkContainer) {
            this.sahmeranAnimMap.set(unitId, this.buildGlbRoots(
                parent, `shw${unitId}`, 1.3,
                this.sahmeranWalkContainer, this.sahmeranAttackContainer, this.sahmeranDieContainer,
            ));
            return;
        }

        // Procedural fallback
        // Human upper body
        const torso = MeshBuilder.CreateCapsule(`shb_${unitId}`, { height: 1.8, radius: 0.38, tessellation: 10 }, this.scene);
        torso.parent = parent; torso.position = new Vector3(0, 2.0, 0);
        const tm = new StandardMaterial(`shbm_${unitId}`, this.scene);
        tm.diffuseColor = new Color3(0.2, 0.55, 0.2);
        tm.emissiveColor = new Color3(0.03, 0.12, 0.03); torso.material = tm; this.sg.addShadowCaster(torso);

        // Snake tail (coiled segments)
        const heights = [1.2, 0.6, 0.3, 0.15];
        const offsets = [0, 0.6, 1.0, 1.3];
        for (let i = 0; i < 4; i++) {
            const seg = MeshBuilder.CreateCylinder(`shs_${unitId}_${i}`, {
                diameterTop: heights[i] * 0.7,
                diameterBottom: heights[i],
                height: 0.8, tessellation: 8,
            }, this.scene);
            seg.parent = parent;
            seg.position = new Vector3(offsets[i] * 0.5, 0.4 + i * 0.1, -offsets[i] * 0.5);
            seg.rotation = new Vector3(Math.PI * 0.2, i * 0.4, 0);
            const sm = new StandardMaterial(`shsm_${unitId}_${i}`, this.scene);
            sm.diffuseColor = new Color3(0.18, 0.5, 0.18);
            sm.emissiveColor = new Color3(0.02, 0.1, 0.02); seg.material = sm;
        }

        // Head crown
        const crown = MeshBuilder.CreateCylinder(`shcr_${unitId}`, { diameterTop: 0.2, diameterBottom: 0.55, height: 0.5, tessellation: 6 }, this.scene);
        crown.parent = parent; crown.position = new Vector3(0, 3.0, 0);
        const crm = new StandardMaterial(`shcrm_${unitId}`, this.scene);
        crm.diffuseColor = new Color3(0.8, 0.7, 0.1);
        crm.emissiveColor = new Color3(0.3, 0.25, 0.0); crown.material = crm;
    }

    // ─── BÖRÜ — spirit wolf from crystal shards ─────────────────────
    private buildBoru(parent: Mesh, _team: Team, unitId: number): void {
        if (!this.boruWalkContainer) { this.buildBoruProcedural(parent); return; }

        const mk = (tag: string) => (n: string) => `bw${unitId}_${tag}_${n}`;
        const walkInst    = this.boruWalkContainer.instantiateModelsToScene(mk('w'), true);
        const attackInst  = this.boruAttackContainer?.instantiateModelsToScene(mk('a'), true) ?? null;
        const attackInst2 = this.boruAttackContainer2?.instantiateModelsToScene(mk('a2'), true) ?? null;
        const dieInst     = this.boruDieContainer?.instantiateModelsToScene(mk('d'), true) ?? null;

        const walkRoot    = walkInst.rootNodes[0] as TransformNode;
        const attackRoot  = (attackInst?.rootNodes[0] ?? walkRoot) as TransformNode;
        const attackRoot2 = (attackInst2?.rootNodes[0] ?? null) as TransformNode | null;
        const dieRoot     = dieInst ? dieInst.rootNodes[0] as TransformNode : null;

        const allRoots: TransformNode[] = [walkRoot];
        if (attackInst)  allRoots.push(attackRoot);
        if (attackRoot2) allRoots.push(attackRoot2);
        if (dieRoot)     allRoots.push(dieRoot);

        const scale = 2.5;
        for (const root of allRoots) {
            root.parent   = parent;
            root.position = Vector3.Zero();
            root.setEnabled(true);
            (root as any).scaling = new Vector3(scale, scale, scale);
            root.getChildMeshes().forEach(c => {
                c.setEnabled(true);
                c.isVisible = true;
                if (c instanceof Mesh) {
                    this.sg.addShadowCaster(c);
                    if (c.material instanceof PBRMaterial) {
                        c.material.directIntensity      = 1.5;
                        c.material.environmentIntensity = 0.5;
                        c.material.emissiveIntensity    = 0.2;
                    }
                }
            });
        }

        if (attackInst)  attackRoot.setEnabled(false);
        if (attackRoot2) attackRoot2.setEnabled(false);
        if (dieRoot)     dieRoot.setEnabled(false);

        walkInst.animationGroups.forEach(ag => { ag.loopAnimation = true; ag.speedRatio = 1.0; ag.goToFrame(0); ag.play(true); });
        attackInst?.animationGroups.forEach(ag => { ag.loopAnimation = true; ag.stop(); });
        attackInst2?.animationGroups.forEach(ag => { ag.loopAnimation = true; ag.stop(); });
        dieInst?.animationGroups.forEach(ag => { ag.loopAnimation = false; ag.stop(); });

        this.boruAnimMap.set(unitId, {
            walkRoot, attackRoot, dieRoot,
            walkAnims:   walkInst.animationGroups,
            attackAnims: attackInst?.animationGroups ?? [],
            dieAnims:    dieInst?.animationGroups    ?? [],
            lastState:   'walking',
            dieStarted:  false,
            // Multi-attack
            attackRoot2:  attackRoot2 ?? undefined,
            attackAnims2: attackInst2?.animationGroups ?? undefined,
            activeAttack: 1,
            attackSwitchTimer: 0,
        });
    }

    /** Procedural Börü mesh (fallback). */
    private buildBoruProcedural(parent: Mesh): void {
        // Wolf body
        const body = MeshBuilder.CreateCapsule(`brb_${nextId}`, { height: 2.0, radius: 0.45, tessellation: 10 }, this.scene);
        body.parent = parent; body.position = new Vector3(0, 1.0, 0);
        body.scaling = new Vector3(1, 1, 1.3);
        const bm = new StandardMaterial(`brbm_${nextId}`, this.scene);
        bm.diffuseColor = new Color3(0.35, 0.35, 0.4);
        bm.emissiveColor = new Color3(0.08, 0.08, 0.15);
        body.material = bm; this.sg.addShadowCaster(body);

        // Head
        const head = MeshBuilder.CreateSphere(`brh_${nextId}`, { diameter: 0.65, segments: 8 }, this.scene);
        head.parent = parent; head.position = new Vector3(0, 2.3, 0.3);
        const hm = new StandardMaterial(`brhm_${nextId}`, this.scene);
        hm.diffuseColor = new Color3(0.3, 0.3, 0.38);
        hm.emissiveColor = new Color3(0.1, 0.1, 0.2); head.material = hm;

        // Glowing eyes
        for (const s of [-0.12, 0.12]) {
            const eye = MeshBuilder.CreateSphere(`bre_${nextId}_${s}`, { diameter: 0.12, segments: 4 }, this.scene);
            eye.parent = parent; eye.position = new Vector3(s, 2.4, 0.58);
            const em = new StandardMaterial(`brem_${nextId}_${s}`, this.scene);
            em.diffuseColor = new Color3(0.8, 0.6, 0.0);
            em.emissiveColor = new Color3(0.9, 0.7, 0.0); eye.material = em;
        }
    }

    // ─── GENERIC WARRIOR BODY ───────────────────────────────────────
    private buildWarriorBody(parent: Mesh, color: Color3, weapon: 'sword' | 'shield'): void {
        const body = MeshBuilder.CreateCapsule(`wb_${nextId}`, { height: 2.4, radius: 0.52, tessellation: 12 }, this.scene);
        body.parent = parent; body.position = new Vector3(0, 1.2, 0);
        const bm = new StandardMaterial(`wbm_${nextId}`, this.scene);
        bm.diffuseColor = color;
        bm.emissiveColor = color.scale(0.3);
        bm.specularColor = new Color3(0.6, 0.6, 0.7);
        body.material = bm; this.sg.addShadowCaster(body);

        const helm = MeshBuilder.CreateCylinder(`wh_${nextId}`, { diameterTop: 0, diameterBottom: 0.7, height: 0.85, tessellation: 4 }, this.scene);
        helm.parent = parent; helm.position = new Vector3(0, 2.8, 0);
        const hm = new StandardMaterial(`whm_${nextId}`, this.scene);
        hm.diffuseColor = color.scale(1.2);
        hm.emissiveColor = color.scale(0.5); helm.material = hm;

        if (weapon === 'sword') {
            const sword = MeshBuilder.CreateBox(`ws_${nextId}`, { width: 0.12, height: 1.3, depth: 0.07 }, this.scene);
            sword.parent = parent; sword.position = new Vector3(0.6, 1.3, 0.1);
            sword.rotation = new Vector3(0, 0, Math.PI * 0.1);
            const sm = new StandardMaterial(`wsm_${nextId}`, this.scene);
            sm.diffuseColor = new Color3(0.7, 0.7, 0.75);
            sm.emissiveColor = color.scale(0.15); sword.material = sm;
        } else {
            const shield = MeshBuilder.CreateBox(`wsh_${nextId}`, { width: 0.14, height: 0.9, depth: 0.65 }, this.scene);
            shield.parent = parent; shield.position = new Vector3(-0.58, 1.2, 0.1);
            const sm = new StandardMaterial(`wshm_${nextId}`, this.scene);
            sm.diffuseColor = color.scale(0.7);
            sm.emissiveColor = color.scale(0.1); shield.material = sm;
        }
    }

    // ─── HEALTH BAR ─────────────────────────────────────────────────
    private createHealthBar(parent: Mesh, type: UnitType): { bg: Mesh; fill: Mesh } {
        const big = type === 'tepegoz' || type === 'tulpar';
        const w = big ? 2.4 : 1.8;
        const barY = big ? 4.6 : 3.6;

        const bg = MeshBuilder.CreatePlane(`hpBg_${nextId}`, { width: w, height: 0.22 }, this.scene);
        bg.parent = parent; bg.position = new Vector3(0, barY, 0);
        bg.billboardMode = Mesh.BILLBOARDMODE_ALL;
        const bgm = new StandardMaterial(`hpBgM_${nextId}`, this.scene);
        bgm.diffuseColor = new Color3(0.08, 0.08, 0.08);
        bgm.emissiveColor = new Color3(0.04, 0.04, 0.04);
        bgm.backFaceCulling = false; bg.material = bgm;

        const fill = MeshBuilder.CreatePlane(`hpFill_${nextId}`, { width: w * 0.92, height: 0.15 }, this.scene);
        fill.parent = parent; fill.position = new Vector3(0, barY, -0.01);
        fill.billboardMode = Mesh.BILLBOARDMODE_ALL;
        const fm = new StandardMaterial(`hpFillM_${nextId}`, this.scene);
        fm.diffuseColor = new Color3(0.15, 0.9, 0.15);
        fm.emissiveColor = new Color3(0.04, 0.35, 0.04);
        fm.backFaceCulling = false; fill.material = fm;

        return { bg, fill };
    }

    // ─── GAME LOOP ──────────────────────────────────────────────────
    update(deltaMs: number): void {
        const dt = deltaMs / 1000;
        this.gameTime += dt;
        const alive = this.units.filter(u => u.state !== 'dead');

        for (const unit of alive) {
            // Tick spawn immunity timer
            if ((unit.abilityState._spawnImmunity as number) > 0) {
                (unit.abilityState._spawnImmunity as number) -= dt;
                if ((unit.abilityState._spawnImmunity as number) <= 0) {
                    unit.abilityState._spawnImmunity = 0;
                }
            }
            // Tick passive abilities and status effects
            tickPassives(unit, dt);
            const dotDamage = tickStatusEffects(unit, dt);
            if (dotDamage > 0) unit.hp -= dotDamage;

            // Apply Umay's pending heal to nearest ally
            if ((unit.abilityState as any).pendingHeal) {
                const healAmount = (unit.abilityState as any).pendingHeal as number;
                delete (unit.abilityState as any).pendingHeal;
                const allies = alive.filter(u => u.team === unit.team && u !== unit);
                if (allies.length > 0) {
                    const target = allies.reduce((a, b) =>
                        this.distXZ(unit, a) < this.distXZ(unit, b) ? a : b);
                    target.hp = Math.min(target.hp + healAmount, target.stats.maxHp);
                }
            }

            // Apply Tepegöz tremor AOE stun
            if ((unit.abilityState as any).pendingTremor) {
                delete (unit.abilityState as any).pendingTremor;
                const enemies = alive.filter(u => u.team !== unit.team);
                for (const e of enemies) {
                    if (this.distXZ(unit, e) < 8) {
                        applyStatusEffect(e, {
                            type: 'stunned',
                            duration: 1.0,
                            magnitude: 1,
                            sourceUnitId: unit.id,
                        });
                    }
                }
            }

            // Apply speed reduction from frozen/slowed status + shard speed bonus
            let speedMult = 1.0;
            const frozenEffect = unit.statusEffects.find(s => s.type === 'frozen');
            if (frozenEffect) speedMult *= (1 - frozenEffect.magnitude);
            const slowedEffect = unit.statusEffects.find(s => s.type === 'slowed');
            if (slowedEffect) speedMult *= (1 - slowedEffect.magnitude);
            // Shard speed bonus
            const shardSpeed = unit.team === 'fire' ? this.fireShard.speedBonus : this.iceShard.speedBonus;
            speedMult *= 1 + (shardSpeed / unit.stats.speed);
            // Prompt card speed boost
            const sb = unit.abilityState as any;
            if (sb.speedBoost && sb.speedBoostTimer > 0) {
                speedMult *= 1 + sb.speedBoost;
                sb.speedBoostTimer -= dt;
                if (sb.speedBoostTimer <= 0) { sb.speedBoost = 0; }
            }

            // Skip movement/attack if stunned
            const stunned = unit.statusEffects.some(s => s.type === 'stunned');

            if (!stunned) {
                // Target hysteresis — mevcut hedef gecerliyse degistirme
                const st = unit.abilityState as any;
                st._enemyLockTimer = (st._enemyLockTimer ?? 0) - dt;
                let enemy: Unit | null = null;
                const prevEnemy = st._cachedEnemy as Unit | null;
                if (prevEnemy && prevEnemy.hp > 0 && prevEnemy.state !== 'dead'
                    && prevEnemy.team !== unit.team
                    && this.distXZ(unit, prevEnemy) < unit.stats.attackRange + 2
                    && st._enemyLockTimer > 0) {
                    enemy = prevEnemy;
                } else {
                    enemy = this.findNearestEnemy(unit, alive);
                    if (prevEnemy && prevEnemy.hp > 0 && prevEnemy.state !== 'dead'
                        && prevEnemy.team !== unit.team
                        && enemy && prevEnemy !== enemy) {
                        const prevD = this.distXZ(unit, prevEnemy);
                        const newD = this.distXZ(unit, enemy);
                        if (prevD - newD < 2 && prevD < unit.stats.attackRange + 2) {
                            enemy = prevEnemy;
                        }
                    }
                    st._cachedEnemy = enemy;
                    st._enemyLockTimer = 0.4;
                }

                // ── OD / TULPAR — Destek: dost heal (öncelik) > düşmana zayıf saldırı > base'e dön ──
                if (unit.type === 'od' || unit.type === 'tulpar') {
                    const spellRange = unit.stats.attackRange; // 12
                    const keepDist = 6;

                    // 1) Dost heal — en düşük HP'li müttefike büyü at
                    const healCandidates = alive.filter(a =>
                        a.team === unit.team && a.id !== unit.id
                        && !UnitManager.UNTARGETABLE.has(a.type)
                        && a.hp < a.stats.maxHp
                        && this.distXZ(unit, a) < spellRange
                    );
                    const healTarget = healCandidates.length > 0
                        ? healCandidates.reduce((a, b) => (a.hp / a.stats.maxHp) < (b.hp / b.stats.maxHp) ? a : b)
                        : null;

                    // 2) Düşman saldırı — target hysteresis ile (0.5s yapış)
                    const st = unit.abilityState as any;
                    st._targetLockTimer = (st._targetLockTimer ?? 0) - dt;
                    let attackTarget: Unit | null = null;
                    // Mevcut hedef hala gecerli mi?
                    const prevTarget = st._cachedTarget as Unit | null;
                    if (prevTarget && prevTarget.hp > 0 && prevTarget.state !== 'dead'
                        && prevTarget.team !== unit.team
                        && this.distXZ(unit, prevTarget) < spellRange + 4
                        && st._targetLockTimer > 0) {
                        attackTarget = prevTarget;
                    } else {
                        attackTarget = this.findNearestEnemy(unit, alive);
                        // Dead zone: sadece yeni hedef 2m+ daha yakinsa degistir
                        if (prevTarget && prevTarget.hp > 0 && prevTarget.state !== 'dead'
                            && prevTarget.team !== unit.team
                            && attackTarget && prevTarget !== attackTarget) {
                            const prevDist = this.distXZ(unit, prevTarget);
                            const newDist = this.distXZ(unit, attackTarget);
                            if (prevDist - newDist < 2 && prevDist < spellRange + 4) {
                                attackTarget = prevTarget;
                            }
                        }
                        st._cachedTarget = attackTarget;
                        st._targetLockTimer = 0.5;
                    }
                    const enemyDist = attackTarget ? this.distXZ(unit, attackTarget) : Infinity;

                    // 3) Tüm dostlar (takip için)
                    const allAllies = alive.filter(a =>
                        a.team === unit.team && a.id !== unit.id
                        && !UnitManager.UNTARGETABLE.has(a.type)
                    );

                    if (healTarget) {
                        // Dost canı eksik — heal projektili at
                        unit.state = 'fighting';
                        this.faceTarget(unit, healTarget);
                        if (this.gameTime - unit.lastAttackTime >= unit.stats.attackCooldown) {
                            unit.lastAttackTime = this.gameTime;
                            this.launchSpellProjectile(unit, healTarget, true);
                        }
                    } else if (attackTarget && enemyDist <= spellRange) {
                        // Kimsenin canı eksik değil ama düşman menzilde — zayıf saldırı
                        unit.state = 'fighting';
                        this.faceTarget(unit, attackTarget);
                        if (enemyDist < keepDist) {
                            const away = unit.mesh.position.subtract(attackTarget.mesh.position);
                            away.y = 0; away.normalize();
                            unit.mesh.position.addInPlace(away.scale(unit.stats.speed * speedMult * dt * 0.5));
                        }
                        if (this.gameTime - unit.lastAttackTime >= unit.stats.attackCooldown) {
                            unit.lastAttackTime = this.gameTime;
                            this.launchSpellProjectile(unit, attackTarget, false);
                        }
                    } else if (allAllies.length > 0) {
                        // Ne heal ne düşman — dostu takip et
                        const closest = allAllies.reduce((a, b) =>
                            this.distXZ(unit, a) < this.distXZ(unit, b) ? a : b);
                        const dist = this.distXZ(unit, closest);
                        if (dist > keepDist) {
                            unit.state = 'walking';
                            const dir = closest.mesh.position.subtract(unit.mesh.position);
                            dir.y = 0; dir.normalize();
                            unit.mesh.position.addInPlace(dir.scale(unit.stats.speed * speedMult * dt));
                            const targetY = Math.atan2(dir.x, dir.z) + (this.isGlbUnit(unit) ? Math.PI : 0);
                            this.smoothRotateY(unit, targetY);
                            this.applyWalkBob(unit, dt);
                        } else {
                            unit.state = 'walking';
                            this.smoothRotateY(unit, closest.mesh.rotation.y);
                        }
                    } else {
                        // Kimse yok — base'e dön
                        unit.state = 'walking';
                        const basePos = unit.team === 'fire'
                            ? new Vector3(0, unit.baseY, -35)
                            : new Vector3(0, unit.baseY, 35);
                        const toBase = basePos.subtract(unit.mesh.position);
                        toBase.y = 0;
                        if (toBase.length() > 3) {
                            toBase.normalize();
                            unit.mesh.position.addInPlace(toBase.scale(unit.stats.speed * speedMult * dt));
                            const targetY = Math.atan2(toBase.x, toBase.z) + (this.isGlbUnit(unit) ? Math.PI : 0);
                            this.smoothRotateY(unit, targetY);
                        }
                        this.applyWalkBob(unit, dt);
                    }
                } else if (enemy && this.distXZ(unit, enemy) < unit.stats.attackRange) {
                    unit.state = 'fighting';
                    unit.targetUnit = enemy;
                    this.faceTarget(unit, enemy);
                    this.tryAttack(unit, enemy);
                    unit.mesh.position.y = unit.baseY;
                } else if (unit.pathQueue.length === 0) {
                    // Unit reached enemy base — attack it directly
                    const targetBase = unit.team === 'fire' ? this.iceBase : this.fireBase;
                    if (targetBase && !targetBase.isDestroyed()) {
                        unit.state = 'fighting';
                        unit.targetUnit = null;
                        if (this.gameTime - unit.lastAttackTime >= unit.stats.attackCooldown) {
                            unit.lastAttackTime = this.gameTime;
                            const dmg = Math.max(1, unit.stats.attack - 5); // bases have light armor
                            if (!this.skipBaseDamage) {
                                targetBase.takeDamage(dmg);
                            }
                            if (unit.type === 'od' || unit.type === 'tulpar') {
                                this.flashAttackPos(unit, targetBase.position);
                            }
                            this.showDamageNumberAt(targetBase.position, dmg);
                        }
                    }
                } else {
                    unit.state = 'walking';
                    unit.targetUnit = null;
                    this.moveUnit(unit, dt, speedMult);
                    this.applyWalkBob(unit, dt);
                }
            }

            this.updateHealthBar(unit);

            // GLB animation state machines
            if (unit.type === 'tulpar')   this.updateGLBAnim(unit, this.tulparAnimMap);
            if (unit.type === 'ayaz')     this.updateGLBAnim(unit, this.ayazAnimMap);
            if (unit.type === 'korhan')   this.updateGLBAnim(unit, this.korhanAnimMap);
            if (unit.type === 'erlik')    this.updateGLBAnim(unit, this.erlikAnimMap);
            if (unit.type === 'od')       this.updateGLBAnim(unit, this.odAnimMap);
            if (unit.type === 'tepegoz')  this.updateGLBAnim(unit, this.tepegozAnimMap);
            if (unit.type === 'albasti')  this.updateGLBAnim(unit, this.albastiAnimMap);
            if (unit.type === 'umay')     this.updateGLBAnim(unit, this.umayAnimMap);
            if (unit.type === 'sahmeran') this.updateGLBAnim(unit, this.sahmeranAnimMap);
            if (unit.type === 'boru')     this.updateBoruAnim(unit, dt);
        }

        // ── Unit collision separation — no unit walks through another ──
        this.separateUnits(alive);

        // ── Spell projectiles (Od / Tulpar) ──
        this.updateSpellProjectiles(dt, alive);

        for (let i = this.units.length - 1; i >= 0; i--) {
            if (this.units[i].hp <= 0 && this.units[i].state !== 'dead') {
                this.killUnit(this.units[i]);
            }
        }
    }

    private separateUnits(alive: Unit[]): void {
        const minDist = 1.8;
        for (let i = 0; i < alive.length; i++) {
            for (let j = i + 1; j < alive.length; j++) {
                const a = alive[i], b = alive[j];
                // Support birimleri dost birimleriyle çakışabilir
                const aSupport = UnitManager.UNTARGETABLE.has(a.type);
                const bSupport = UnitManager.UNTARGETABLE.has(b.type);
                if (aSupport && bSupport) continue; // iki support birbirini itmesin
                if ((aSupport || bSupport) && a.team === b.team) continue; // support + dost itmesin

                const dx = a.mesh.position.x - b.mesh.position.x;
                const dz = a.mesh.position.z - b.mesh.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < minDist && dist > 0.01) {
                    const overlap = (minDist - dist) * 0.3; // yumuşak itme
                    const nx = dx / dist;
                    const nz = dz / dist;
                    a.mesh.position.x += nx * overlap;
                    a.mesh.position.z += nz * overlap;
                    b.mesh.position.x -= nx * overlap;
                    b.mesh.position.z -= nz * overlap;
                }
            }
        }
    }

    private smoothRotateY(unit: Unit, targetY: number): void {
        let diff = targetY - unit.mesh.rotation.y;
        if (diff > Math.PI) diff -= 2 * Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;
        unit.mesh.rotation.y += diff * 0.15;
    }

    private moveUnit(unit: Unit, dt: number, speedMult = 1.0): void {
        if (unit.pathQueue.length === 0) return;
        const target = unit.pathQueue[0];
        const dir = target.subtract(unit.mesh.position); dir.y = 0;
        const dist = dir.length();
        if (dist < 0.5) { unit.pathQueue.shift(); return; }
        dir.normalize();
        const targetY = Math.atan2(dir.x, dir.z) + (this.isGlbUnit(unit) ? Math.PI : 0);
        this.smoothRotateY(unit, targetY);
        unit.mesh.position.addInPlace(dir.scale(Math.min(unit.stats.speed * speedMult * dt, dist)));
    }

    private applyWalkBob(unit: Unit, dt: number): void {
        unit.walkBobTime += dt * (unit.stats.speed > 7 ? 11 : 7);
        unit.mesh.position.y = unit.baseY + 0.18 * Math.abs(Math.sin(unit.walkBobTime));
    }

    private static UNTARGETABLE: Set<string> = new Set(['tulpar', 'od']);

    private findNearestEnemy(unit: Unit, alive: Unit[]): Unit | null {
        // Support units (tulpar, od) cannot be targeted; spawn-immune units skipped
        const enemies = alive.filter(o => o.team !== unit.team && o.state !== 'dead'
            && !UnitManager.UNTARGETABLE.has(o.type));
        const inRange = enemies.filter(o => this.distXZ(unit, o) < 14);
        if (inRange.length === 0) return null;

        const priority = unit.aiProfile?.targetPriority ?? 'nearest';

        switch (priority) {
            case 'lowest_hp':
                return inRange.reduce((a, b) => a.hp < b.hp ? a : b);
            case 'highest_hp':
                return inRange.reduce((a, b) => a.hp > b.hp ? a : b);
            case 'base_focus': {
                // Ignore units if possible (rush through); if blocked, attack nearest
                const blocker = inRange.reduce(
                    (a, b) => this.distXZ(unit, a) < this.distXZ(unit, b) ? a : b,
                );
                return blocker;
            }
            case 'nearest':
            default: {
                let best: Unit | null = null, bestDist = Infinity;
                for (const o of inRange) {
                    const d = this.distXZ(unit, o);
                    if (d < bestDist) { bestDist = d; best = o; }
                }
                return best;
            }
        }
    }

    private isGlbUnit(u: Unit): boolean {
        return (u.type === 'tulpar'   && !!this.tulparWalkContainer)
            || (u.type === 'korhan'   && !!(this.korhanWalkContainer || this.korhanTemplate))
            || (u.type === 'erlik'    && !!this.erlikWalkContainer)
            || (u.type === 'od'       && !!this.odWalkContainer)
            || (u.type === 'ayaz'     && !!this.ayazWalkContainer)
            || (u.type === 'tepegoz'  && !!this.tepegozWalkContainer)
            || (u.type === 'albasti'  && !!this.albastiWalkContainer)
            || (u.type === 'umay'     && !!this.umayWalkContainer)
            || (u.type === 'sahmeran' && !!this.sahmeranWalkContainer)
            || (u.type === 'boru'     && !!this.boruWalkContainer);
    }

    private distXZ(a: Unit, b: Unit): number {
        const dx = a.mesh.position.x - b.mesh.position.x;
        const dz = a.mesh.position.z - b.mesh.position.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    private faceTarget(a: Unit, b: Unit): void {
        const dir = b.mesh.position.subtract(a.mesh.position);
        const targetY = Math.atan2(dir.x, dir.z) + (this.isGlbUnit(a) ? Math.PI : 0);
        // Smooth rotation lerp — en kisa yon
        let diff = targetY - a.mesh.rotation.y;
        if (diff > Math.PI) diff -= 2 * Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;
        a.mesh.rotation.y += diff * 0.15;
    }

    private tryAttack(attacker: Unit, target: Unit): void {
        if (this.gameTime - attacker.lastAttackTime < attacker.stats.attackCooldown) return;
        // Spawn immunity — can't be damaged
        if ((target.abilityState._spawnImmunity as number) > 0) return;
        attacker.lastAttackTime = this.gameTime;

        // GDD §1.6 damage formula
        const factionMod = (attacker.team !== target.team && target.team !== ('earth' as any))
            ? 1.15 : 1.0;
        const confMod = 0.85 + (attacker.poaiScore / 10000) * 0.30;

        // Charge ability: first attack = double damage
        let chargeMult = 1.0;
        if ((attacker.abilityState as any).chargeActive) {
            chargeMult = 2.0;
            (attacker.abilityState as any).chargeActive = false;
        }

        // Shard attack bonus
        const shardAtk = attacker.team === 'fire' ? this.fireShard.attackBonus : this.iceShard.attackBonus;
        // Empowered status bonus
        const empowered = attacker.statusEffects.find(s => s.type === 'empowered');
        const empowerBonus = empowered ? empowered.magnitude : 0;

        let dmg = Math.max(1, (attacker.stats.attack + shardAtk + empowerBonus) - target.stats.armor)
            * factionMod * confMod * chargeMult;

        // Critical hit: %5 chance — instant kill
        const critChance = 0.05;
        let isCrit = false;
        if (Math.random() < critChance) {
            dmg = target.hp;
            isCrit = true;
        }

        // on_hit ability check (e.g. Iron Armor reduction, Od proc)
        if (!isCrit) dmg = checkAbilityTrigger('on_hit', target, attacker, dmg);

        // Shielded status absorbs damage
        const shield = target.statusEffects.find(s => s.type === 'shielded');
        if (shield && !isCrit) {
            if (dmg <= shield.magnitude) {
                shield.magnitude -= dmg;
                dmg = 0;
            } else {
                dmg -= shield.magnitude;
                shield.magnitude = 0;
                shield.duration = 0; // remove shield
            }
        }

        if (isCrit) target.abilityState._critKill = true;
        target.hp -= dmg;

        // on_attack ability check (e.g. Erlik burn, Ayaz freeze, Şahmeran poison)
        checkAbilityTrigger('on_attack', attacker, target);

        // Update poaiScore slightly per attack
        attacker.poaiScore = Math.min(10000, attacker.poaiScore + 10);

        // FX sadece Od ve Tulpar icin (diger unitlerde dandik duruyor)
        if (attacker.type === 'od' || attacker.type === 'tulpar') {
            this.flashAttack(attacker, target);
        }
        this.showDamageNumber(target, dmg, isCrit);
    }

    // ─── SPELL PROJECTILE SYSTEM (Od / Tulpar — heal & attack) ──────────
    private launchSpellProjectile(attacker: Unit, target: Unit, isHeal: boolean): void {
        const isFireSpell = attacker.type === 'od';
        // 576.png: 14 cols × 9 rows, 64×64 cells
        // Row 0 = orange/fire (Od), Row 3 = cyan/ice (Tulpar)
        const cols = 14, rows = 9;
        const row = isFireSpell ? 0 : 3;

        // Create billboard plane for projectile
        const id = `spell_${Date.now()}_${Math.random()}`;
        const plane = MeshBuilder.CreatePlane(id, { width: 2.5, height: 2.5 }, this.scene);
        plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
        plane.position = attacker.mesh.position.clone();
        plane.position.y += 3;

        const mat = new StandardMaterial(`${id}_mat`, this.scene);
        if (this.fireSpellTex) {
            const tex = this.fireSpellTex.clone();
            tex.hasAlpha = true;
            // Show first frame of the correct row
            tex.uScale = 1 / cols;
            tex.vScale = 1 / rows;
            tex.uOffset = 0;
            tex.vOffset = 1 - (row + 1) / rows;
            mat.diffuseTexture = tex;
            mat.opacityTexture = tex;
            mat.emissiveTexture = tex;
        }
        mat.useAlphaFromDiffuseTexture = true;
        mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
        mat.emissiveColor = isFireSpell ? new Color3(1, 0.4, 0) : new Color3(0.2, 0.6, 1);
        mat.backFaceCulling = false;
        mat.disableLighting = true;
        plane.material = mat;

        this.spellProjectiles.push({
            mesh: plane,
            targetUnit: target,
            attacker,
            speed: 18,
            damage: attacker.stats.attack,
            isHeal,
            elapsed: 0,
            frameTimer: 0,
            currentFrame: 0,
            totalFrames: 10,
        });
    }

    private updateSpellProjectiles(dt: number, alive: Unit[]): void {
        const cols = 14, rows = 9;

        for (let i = this.spellProjectiles.length - 1; i >= 0; i--) {
            const proj = this.spellProjectiles[i];
            proj.elapsed += dt;

            // Max lifetime 2s
            if (proj.elapsed > 2 || proj.mesh.isDisposed()) {
                if (!proj.mesh.isDisposed()) { proj.mesh.dispose(); (proj.mesh.material as StandardMaterial)?.dispose(); }
                this.spellProjectiles.splice(i, 1);
                continue;
            }

            // Target dead or disposed?
            const targetAlive = alive.includes(proj.targetUnit) && proj.targetUnit.hp > 0;
            const targetPos = targetAlive
                ? proj.targetUnit.mesh.position.clone().addInPlaceFromFloats(0, 2.5, 0)
                : proj.mesh.position.clone().addInPlaceFromFloats(0, 0, 1); // keep going forward

            // Move toward target
            const dir = targetPos.subtract(proj.mesh.position);
            const dist = dir.length();
            if (dist < 1.5 && targetAlive) {
                if (proj.isHeal) {
                    // Od heal projectile — restore HP
                    const healAmt = 20;
                    proj.targetUnit.hp = Math.min(proj.targetUnit.stats.maxHp, proj.targetUnit.hp + healAmt);
                    this.spawnFloatingText(`+${healAmt}`, proj.targetUnit.mesh.position.clone().addInPlaceFromFloats(0, 3.5, 0), new Color3(1, 0.6, 0.1));
                } else {
                    // Tulpar damage projectile — deal damage
                    this.tryAttack(proj.attacker, proj.targetUnit);
                    this.flashAttackPos(proj.attacker, proj.targetUnit.mesh.position);
                }
                proj.mesh.dispose();
                (proj.mesh.material as StandardMaterial)?.diffuseTexture?.dispose();
                (proj.mesh.material as StandardMaterial)?.dispose();
                this.spellProjectiles.splice(i, 1);
                continue;
            }

            dir.normalize();
            proj.mesh.position.addInPlace(dir.scale(proj.speed * dt));

            // Animate sprite sheet frames
            proj.frameTimer += dt;
            if (proj.frameTimer >= 0.06) { // ~16fps sprite anim
                proj.frameTimer = 0;
                proj.currentFrame = (proj.currentFrame + 1) % proj.totalFrames;
                const tex = (proj.mesh.material as StandardMaterial)?.diffuseTexture as Texture;
                if (tex) {
                    tex.uOffset = proj.currentFrame / cols;
                }
            }
        }
    }

    // 576.png sprite rows: 0=fire, 1=explosion, 2=spark, 3=ice, 4=poison, 5=heal
    private spawnFxBillboard(pos: Vector3, color: Color3, row: number, size = 3.0, duration = 350): void {
        const cols = 14, rows = 9;
        const id = `fx_${Date.now()}_${Math.random()}`;
        const plane = MeshBuilder.CreatePlane(id, { width: size, height: size }, this.scene);
        plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
        plane.position = pos.clone();

        const mat = new StandardMaterial(`${id}_m`, this.scene);
        mat.emissiveColor = color;
        mat.backFaceCulling = false;
        mat.disableLighting = true;
        mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;

        if (this.fireSpellTex) {
            const tex = this.fireSpellTex.clone();
            tex.hasAlpha = true;
            tex.uScale = 1 / cols;
            tex.vScale = 1 / rows;
            tex.uOffset = 0;
            tex.vOffset = 1 - (row + 1) / rows;
            mat.diffuseTexture = tex;
            mat.opacityTexture = tex;
            mat.emissiveTexture = tex;
            mat.useAlphaFromDiffuseTexture = true;
        } else {
            mat.alpha = 0.85;
        }
        plane.material = mat;

        let t = 0;
        let frame = 0;
        const frameInterval = duration / 8;
        const interval = setInterval(() => {
            t += 16;
            const p = t / duration;
            if (p >= 1 || plane.isDisposed()) {
                clearInterval(interval);
                try { plane.dispose(); mat.dispose(); } catch { }
                return;
            }
            // Sprite animasyonu
            frame = Math.min(Math.floor(t / frameInterval), cols - 1);
            if (mat.diffuseTexture) {
                (mat.diffuseTexture as Texture).uOffset = frame / cols;
            }
            plane.scaling.setAll(1 + p * 0.8);
            plane.visibility = 1 - p * p;
        }, 16);
    }

    private getAttackFxRow(attacker: Unit): number {
        if (attacker.team === 'fire') return 0; // fire
        if (attacker.team === 'ice') return 3;  // ice
        return 2; // spark (mercenary)
    }

    private flashAttackPos(attacker: Unit, targetPos: Vector3): void {
        const row = this.getAttackFxRow(attacker);
        const pos = targetPos.clone(); pos.y = 5;
        this.spawnFxBillboard(pos, this.unitEmissive(attacker), row, 3.5, 350);
    }

    private flashAttack(attacker: Unit, target: Unit): void {
        const row = this.getAttackFxRow(attacker);
        const sz = (attacker.type === 'tepegoz' || attacker.type === 'tulpar') ? 3.5 : 2.5;
        // Saldıran tarafta küçük efekt
        const atkPos = attacker.mesh.position.clone(); atkPos.y += 2;
        this.spawnFxBillboard(atkPos, this.unitEmissive(attacker), row, sz * 0.6, 200);
        // Hedefte büyük efekt
        const tgtPos = target.mesh.position.clone(); tgtPos.y += 1.5;
        this.spawnFxBillboard(tgtPos, this.unitEmissive(attacker), row, sz, 300);
    }

    // ─── GENERIC GLB ANIMATION STATE MACHINE ───────────────────────
    private updateGLBAnim(unit: Unit, animMap: Map<number, GLBAnimData>): void {
        const data = animMap.get(unit.id);
        if (!data || data.dieStarted) return;

        const state = unit.state;
        if (state === data.lastState) return;
        data.lastState = state;

        // Od/Tulpar destek birimleri — attack anim yok, her zaman walk anim göster
        const isSupport = unit.type === 'od' || unit.type === 'tulpar';

        if (state === 'walking' || (state === 'fighting' && isSupport)) {
            data.walkRoot.setEnabled(true);
            if (data.attackRoot !== data.walkRoot) data.attackRoot.setEnabled(false);
            if (data.dieRoot) data.dieRoot.setEnabled(false);
            data.attackAnims.forEach(ag => { ag.stop(); ag.reset(); });
            data.dieAnims.forEach(ag => { ag.stop(); ag.reset(); });
            data.walkAnims.forEach(ag => { ag.loopAnimation = true; ag.speedRatio = 1.0; ag.goToFrame(0); ag.play(true); });
        } else if (state === 'fighting') {
            data.walkRoot.setEnabled(false);
            data.attackRoot.setEnabled(true);
            if (data.dieRoot) data.dieRoot.setEnabled(false);
            data.walkAnims.forEach(ag => { ag.stop(); ag.reset(); });
            data.dieAnims.forEach(ag => { ag.stop(); ag.reset(); });
            data.attackAnims.forEach(ag => { ag.loopAnimation = true; ag.speedRatio = 1.0; ag.goToFrame(0); ag.play(true); });
        }
    }

    // ─── BÖRÜ MULTI-ATTACK ANIM ─────────────────────────────────────
    private static readonly BORU_ATTACK_SWITCH_INTERVAL = 1.8; // saniye

    private updateBoruAnim(unit: Unit, dt: number): void {
        const data = this.boruAnimMap.get(unit.id);
        if (!data || data.dieStarted) return;

        const state = unit.state;
        const hasAlt = !!(data.attackRoot2 && data.attackAnims2 && data.attackAnims2.length > 0);

        // State degisti mi?
        if (state !== data.lastState) {
            data.lastState = state;

            if (state === 'walking') {
                data.walkRoot.setEnabled(true);
                if (data.attackRoot !== data.walkRoot) data.attackRoot.setEnabled(false);
                if (data.attackRoot2) data.attackRoot2.setEnabled(false);
                if (data.dieRoot) data.dieRoot.setEnabled(false);
                data.attackAnims.forEach(ag => { ag.stop(); ag.reset(); });
                data.attackAnims2?.forEach(ag => { ag.stop(); ag.reset(); });
                data.dieAnims.forEach(ag => { ag.stop(); ag.reset(); });
                data.walkAnims.forEach(ag => { ag.loopAnimation = true; ag.speedRatio = 1.0; ag.goToFrame(0); ag.play(true); });
                data.activeAttack = 1;
                data.attackSwitchTimer = 0;
            } else if (state === 'fighting') {
                data.walkRoot.setEnabled(false);
                if (data.dieRoot) data.dieRoot.setEnabled(false);
                data.walkAnims.forEach(ag => { ag.stop(); ag.reset(); });
                data.dieAnims.forEach(ag => { ag.stop(); ag.reset(); });
                // Random baslangic
                const pick = hasAlt ? (Math.random() < 0.5 ? 1 : 2) : 1;
                this.activateBoruAttack(data, pick as 1 | 2);
            }
            return;
        }

        // Fighting sirasinda periyodik olarak attack degistir
        if (state === 'fighting' && hasAlt) {
            data.attackSwitchTimer = (data.attackSwitchTimer ?? 0) + dt;
            if (data.attackSwitchTimer! >= UnitManager.BORU_ATTACK_SWITCH_INTERVAL) {
                data.attackSwitchTimer = 0;
                const next = data.activeAttack === 1 ? 2 : 1;
                this.activateBoruAttack(data, next);
            }
        }
    }

    private activateBoruAttack(data: GLBAnimData, which: 1 | 2): void {
        data.activeAttack = which;
        if (which === 1) {
            data.attackRoot.setEnabled(true);
            if (data.attackRoot2) data.attackRoot2.setEnabled(false);
            data.attackAnims2?.forEach(ag => { ag.stop(); ag.reset(); });
            data.attackAnims.forEach(ag => { ag.loopAnimation = true; ag.speedRatio = 1.0; ag.goToFrame(0); ag.play(true); });
        } else {
            data.attackRoot.setEnabled(false);
            if (data.attackRoot2) data.attackRoot2.setEnabled(true);
            data.attackAnims.forEach(ag => { ag.stop(); ag.reset(); });
            data.attackAnims2?.forEach(ag => { ag.loopAnimation = true; ag.speedRatio = 1.0; ag.goToFrame(0); ag.play(true); });
        }
    }

    // ─── SPAWN FLASH ────────────────────────────────────────────────
    private spawnFlash(unit: Unit): void {
        const color = this.unitEmissive(unit);
        // Büyüyen halka
        const ring = MeshBuilder.CreateTorus(`spawn_${unit.id}`, {
            diameter: 4, thickness: 0.5, tessellation: 32,
        }, this.scene);
        ring.position = unit.mesh.position.clone();
        ring.position.y = unit.baseY + 0.15;
        ring.rotation.x = Math.PI / 2;
        const rm = new StandardMaterial(`spawnRm_${unit.id}`, this.scene);
        rm.diffuseColor = color;
        rm.emissiveColor = color;
        rm.alpha = 0.9;
        ring.material = rm;

        // Merkez ışık patlaması
        const burst = MeshBuilder.CreateSphere(`spawn_b_${unit.id}`, { diameter: 1.5, segments: 5 }, this.scene);
        burst.position = unit.mesh.position.clone();
        burst.position.y = unit.baseY + 1.5;
        const bm = new StandardMaterial(`spawnBm_${unit.id}`, this.scene);
        bm.diffuseColor = color;
        bm.emissiveColor = color.scale(2);
        bm.alpha = 1.0;
        burst.material = bm;

        // Birim ölçeklenme animasyonu
        unit.mesh.scaling.setAll(0.1);

        let t = 0;
        const id = setInterval(() => {
            t += 16;
            const p = Math.min(t / 350, 1);
            const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic

            // Halka büyür ve solar
            ring.scaling.setAll(1 + p * 2.5);
            ring.visibility = 1 - p;

            // Patlama küçülür ve solar
            burst.scaling.setAll(1 + p * 1.5);
            burst.visibility = (1 - p) * 0.8;

            // Birim spawn scale
            const unitScale = Math.min(eased * 1.1, 1.0);
            unit.mesh.scaling.setAll(unitScale);

            if (p >= 1) {
                clearInterval(id);
                try { ring.dispose(); rm.dispose(); burst.dispose(); bm.dispose(); } catch {}
                unit.mesh.scaling.setAll(1);
            }
        }, 16);
    }

    private unitEmissive(unit: Unit): Color3 {
        const map: Partial<Record<UnitType, Color3>> = {
            korhan: new Color3(1.0, 0.45, 0.05),
            erlik: new Color3(0.5, 0.0, 0.8),
            od: new Color3(1.0, 0.5, 0.0),
            ayaz: new Color3(0.2, 0.6, 1.0),
            tulpar: new Color3(0.6, 0.85, 1.0),
            umay: new Color3(0.15, 0.9, 1.0),
            albasti: new Color3(0.65, 0.55, 1.0),
            tepegoz: new Color3(0.8, 0.0, 0.75),
            sahmeran: new Color3(0.2, 0.9, 0.2),
            boru: new Color3(0.7, 0.6, 1.0),
        };
        return map[unit.type] ?? new Color3(1, 1, 1);
    }

    private updateHealthBar(unit: Unit): void {
        if (!unit.healthBarFill) return;
        const ratio = Math.max(0, unit.hp / unit.stats.maxHp);
        unit.healthBarFill.scaling.x = ratio;
        const halfW = (unit.type === 'tepegoz' || unit.type === 'tulpar') ? 1.1 : 0.825;
        unit.healthBarFill.position.x = -(1 - ratio) * halfW;
        const mat = unit.healthBarFill.material as StandardMaterial;
        if (ratio > 0.55) { mat.diffuseColor = new Color3(0.15, 0.9, 0.15); mat.emissiveColor = new Color3(0.04, 0.32, 0.04); }
        else if (ratio > 0.25) { mat.diffuseColor = new Color3(0.95, 0.82, 0.08); mat.emissiveColor = new Color3(0.3, 0.25, 0.02); }
        else { mat.diffuseColor = new Color3(0.95, 0.1, 0.08); mat.emissiveColor = new Color3(0.35, 0.03, 0.02); }
    }

    // ─── FLOATING DAMAGE NUMBERS ──────────────────────────────────
    private showDamageNumber(target: Unit, dmg: number, isCrit = false): void {
        const rounded = Math.round(dmg);
        if (rounded <= 0) return;

        const pos = target.mesh.position.clone();
        pos.y += 3.5;
        // Random X offset so numbers don't stack
        pos.x += (Math.random() - 0.5) * 1.5;

        if (isCrit) {
            this.spawnFloatingText(`KRITIK! -${rounded}`, pos, new Color3(1, 0.85, 0));
        } else {
            this.spawnFloatingText(`-${rounded}`, pos, new Color3(1, 0.15, 0.1));
        }
    }

    private showDamageNumberAt(pos: Vector3, dmg: number): void {
        const rounded = Math.round(dmg);
        if (rounded <= 0) return;
        const p = pos.clone();
        p.y += 5;
        this.spawnFloatingText(`-${rounded}`, p, new Color3(1, 0.3, 0.1));
    }

    private spawnFloatingText(text: string, pos: Vector3, color: Color3): void {
        const size = 512;
        const plane = MeshBuilder.CreatePlane(`dmg_${Date.now()}`, { width: 1.8, height: 0.7 }, this.scene);
        plane.position = pos;
        plane.billboardMode = Mesh.BILLBOARDMODE_ALL;

        const tex = new DynamicTexture(`dmgTex_${Date.now()}`, { width: size, height: size / 2.5 }, this.scene, false);
        tex.hasAlpha = true;
        const ctx = tex.getContext() as any as CanvasRenderingContext2D;
        ctx.clearRect(0, 0, size, size / 2.5);
        ctx.font = 'bold 140px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Black outline
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 12;
        ctx.strokeText(text, size / 2, size / 5);
        // Colored fill
        ctx.fillStyle = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`;
        ctx.fillText(text, size / 2, size / 5);
        tex.update();

        const mat = new StandardMaterial(`dmgMat_${Date.now()}`, this.scene);
        mat.diffuseTexture = tex;
        mat.emissiveColor = color.scale(0.5);
        mat.useAlphaFromDiffuseTexture = true;
        mat.backFaceCulling = false;
        mat.disableLighting = true;
        plane.material = mat;

        // Float up and fade out
        const startY = pos.y;
        let t = 0;
        const id = setInterval(() => {
            t += 16;
            const p = Math.min(t / 800, 1);
            if (plane.isDisposed()) { clearInterval(id); return; }
            plane.position.y = startY + p * 3;
            plane.visibility = 1 - p * p;
            plane.scaling.setAll(1 + p * 0.3);
            if (p >= 1) {
                clearInterval(id);
                try { plane.dispose(); mat.dispose(); tex.dispose(); } catch {}
            }
        }, 16);
    }

    private killUnit(unit: Unit): void {
        unit.state = 'dead';
        this.onUnitDeath?.(unit);
        unit.healthBarBg?.setEnabled(false);
        unit.healthBarFill?.setEnabled(false);

        // Stats tracking
        const key = `${unit.type}_${unit.team}`;
        if (this.stats[key]) {
            this.stats[key].deaths++;
            this.stats[key].totalPoAI += unit.poaiScore;
            this.stats[key].bestPoAI = Math.max(this.stats[key].bestPoAI, unit.poaiScore);
        }

        // GLB animated units: play die animation, then dispose
        for (const animMap of [this.korhanAnimMap, this.erlikAnimMap, this.odAnimMap, this.tepegozAnimMap, this.albastiAnimMap, this.umayAnimMap, this.sahmeranAnimMap, this.tulparAnimMap, this.ayazAnimMap, this.boruAnimMap]) {
            const data = animMap.get(unit.id);
            if (data) {
                this.killGLBUnit(unit, data, animMap);
                return;
            }
        }

        // Default procedural kill: tint red, shrink, remove
        unit.mesh.getChildMeshes().forEach(c => {
            if (c instanceof Mesh && c.material instanceof StandardMaterial) {
                c.material.diffuseColor  = new Color3(0.6, 0.04, 0.04);
                c.material.emissiveColor = new Color3(0.25, 0.01, 0.01);
            }
        });

        let t = 0;
        const id = setInterval(() => {
            t += 16;
            const p = Math.min(t / 400, 1);
            if (unit.mesh.isDisposed()) { clearInterval(id); return; }
            unit.mesh.scaling.setAll(1 - p);
            unit.mesh.position.y = unit.baseY - p * 0.8;
            if (p >= 1) {
                clearInterval(id);
                try {
                    unit.healthBarBg?.dispose(); unit.healthBarFill?.dispose();
                    unit.mesh.getChildMeshes().forEach(m => m.dispose());
                    unit.mesh.dispose();
                } catch { }
                const idx = this.units.indexOf(unit);
                if (idx >= 0) this.units.splice(idx, 1);
            }
        }, 16);
    }

    private killGLBUnit(unit: Unit, data: GLBAnimData, animMap: Map<number, GLBAnimData>): void {
        data.dieStarted = true;
        data.walkRoot.setEnabled(false);
        data.attackRoot.setEnabled(false);
        if (data.attackRoot2) data.attackRoot2.setEnabled(false);
        data.walkAnims.forEach(ag => ag.stop());
        data.attackAnims.forEach(ag => ag.stop());
        data.attackAnims2?.forEach(ag => ag.stop());

        if (data.dieRoot) {
            // Has die animation — play it and dispose after
            data.dieRoot.setEnabled(true);
            const dieAnim = data.dieAnims[0] ?? null;
            const durationMs = dieAnim
                ? Math.max(((dieAnim.to - dieAnim.from) / 30) * 1000, 500)
                : 800;
            if (dieAnim) dieAnim.play(false);

            setTimeout(() => this.disposeGLBUnit(unit, data, animMap), durationMs + 200);
        } else {
            // No die GLB — procedural shrink then dispose
            let t = 0;
            const id = setInterval(() => {
                t += 16;
                const p = Math.min(t / 400, 1);
                if (unit.mesh.isDisposed()) { clearInterval(id); return; }
                unit.mesh.scaling.setAll(1 - p);
                unit.mesh.position.y = unit.baseY - p * 0.8;
                if (p >= 1) {
                    clearInterval(id);
                    this.disposeGLBUnit(unit, data, animMap);
                }
            }, 16);
        }
    }

    private disposeGLBUnit(unit: Unit, data: GLBAnimData, animMap: Map<number, GLBAnimData>): void {
        animMap.delete(unit.id);
        try {
            unit.healthBarBg?.dispose();
            unit.healthBarFill?.dispose();
            [...data.walkAnims, ...data.attackAnims, ...(data.attackAnims2 ?? []), ...data.dieAnims].forEach(ag => { try { ag.dispose(); } catch { } });
            const roots = new Set<TransformNode>([data.walkRoot, data.attackRoot]);
            if (data.attackRoot2) roots.add(data.attackRoot2);
            if (data.dieRoot) roots.add(data.dieRoot);
            for (const root of roots) {
                root.getChildMeshes().forEach(m => { try { m.dispose(); } catch { } });
                root.dispose();
            }
            unit.mesh.dispose();
        } catch { }
        const idx = this.units.indexOf(unit);
        if (idx >= 0) this.units.splice(idx, 1);
    }
}
