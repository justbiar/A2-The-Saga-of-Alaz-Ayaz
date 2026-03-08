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
import '@babylonjs/loaders/glTF';
import { Unit, Team, UnitType, STATS_MAP, AI_PROFILES_MAP } from './Unit';
import { SimpleNavGraph } from '../pathfinding/SimpleNavGraph';
import { tickPassives, tickStatusEffects, checkAbilityTrigger, applyStatusEffect, hasStatus } from './abilities/AbilitySystem';
import { UNIT_ABILITY_MAP } from './abilities/characterAbilities';
import type { ShardBonus } from './types';
import type { BaseBuilding } from '../scene/map/BaseBuilding';

let nextId = 1;

interface GLBAnimData {
    walkRoot:    TransformNode;
    attackRoot:  TransformNode;
    dieRoot:     TransformNode | null;   // null = no die GLB (procedural death)
    walkAnims:   AnimationGroup[];
    attackAnims: AnimationGroup[];
    dieAnims:    AnimationGroup[];
    lastState:   'walking' | 'fighting' | 'dead' | null;
    dieStarted:  boolean;
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
    private korhanHammerContainer: AssetContainer | null = null;
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
    /** Shard bonuses — set from main.ts each frame */
    public fireShard: ShardBonus = { manaRegen: 0, attackBonus: 0, speedBonus: 0 };
    public iceShard: ShardBonus = { manaRegen: 0, attackBonus: 0, speedBonus: 0 };
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

        walkInst.animationGroups.forEach(ag => ag.play(true));
        attackInst?.animationGroups.forEach(ag => ag.stop());
        dieInst?.animationGroups.forEach(ag => ag.stop());

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
        const base = '/assets/character%20animation/';
        const load = (file: string) => SceneLoader.LoadAssetContainerAsync(base, file, this.scene);
        let loaded = 0;
        const totalFiles = 25;
        const tryLoad = async (file: string): Promise<AssetContainer | null> => {
            try {
                const timeout = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 30000),
                );
                const result = await Promise.race([load(file), timeout]) as AssetContainer;
                loaded++;
                if (this.onProgress) this.onProgress(loaded, totalFiles);
                return result;
            } catch {
                loaded++;
                if (this.onProgress) this.onProgress(loaded, totalFiles);
                console.warn(`⚠️ ${file} yüklenemedi/timeout`);
                return null;
            }
        };

        // Korhan
        [this.korhanWalkContainer, this.korhanAttackContainer, this.korhanDieContainer] = await Promise.all([
            tryLoad('korhanwalk.glb'), tryLoad('Korhanattack.glb'), tryLoad('korhandie.glb'),
        ]);
        this.korhanHammerContainer = await tryLoad('korhanhammer.glb');

        // Erlik
        [this.erlikWalkContainer, this.erlikAttackContainer, this.erlikDieContainer] = await Promise.all([
            tryLoad('erlik.glb'), tryLoad('erlikattack.glb'), tryLoad('erlikdie.glb'),
        ]);

        // Od
        [this.odWalkContainer, this.odAttackContainer, this.odDieContainer] = await Promise.all([
            tryLoad('odwalk.glb'), tryLoad('odattack.glb'), tryLoad('oddie.glb'),
        ]);

        // Tepegöz
        [this.tepegozWalkContainer, this.tepegozAttackContainer, this.tepegozDieContainer] = await Promise.all([
            tryLoad('tepegozwalk.glb'), tryLoad('tepegozattack.glb'), tryLoad('tepegozdie.glb'),
        ]);

        // Albastı
        [this.albastiWalkContainer, this.albastiAttackContainer, this.albastiDieContainer] = await Promise.all([
            tryLoad('albastiwalk.glb'), tryLoad('albastiattack.glb'), tryLoad('albastidie.glb'),
        ]);

        // Umay
        [this.umayWalkContainer, this.umayAttackContainer, this.umayDieContainer] = await Promise.all([
            tryLoad('umaywalk.glb'), tryLoad('umayattack.glb'), tryLoad('umaydie.glb'),
        ]);

        // Ayaz
        [this.ayazWalkContainer, this.ayazAttackContainer, this.ayazDieContainer] = await Promise.all([
            tryLoad('ayazwalk.glb'), tryLoad('ayazattack.glb'), tryLoad('ayazdie.glb'),
        ]);

        // Tulpar (walk only — dosya adı tulpar.glb)
        this.tulparWalkContainer = await tryLoad('tulpar.glb');

        // Şahmeran
        [this.sahmeranWalkContainer, this.sahmeranAttackContainer, this.sahmeranDieContainer] = await Promise.all([
            tryLoad('sahmeranwalk.glb'), tryLoad('sahmeranattack.glb'), tryLoad('sahmerandie.glb'),
        ]);
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

    private buildLanePath(_from: number, _to: number, lane: number, team: Team): Vector3[] {
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
        return path.map(i => this.nav.nodes[i]);
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
        }

        return root;
    }

    // ─── KORHAN — heavy fire warrior with walk / attack / die + hammer ─
    private buildKorhan(parent: Mesh, team: Team): void {
        // Animated GLB version (preferred)
        if (this.korhanWalkContainer && this.korhanAttackContainer && this.korhanDieContainer && team === 'fire') {
            const unitId = nextId;
            const mk = (prefix: string) => (n: string) => `${prefix}_${unitId}_${n}`;

            const walkInst   = this.korhanWalkContainer.instantiateModelsToScene(mk('kw'), true);
            const attackInst = this.korhanAttackContainer.instantiateModelsToScene(mk('ka'), true);
            const dieInst    = this.korhanDieContainer.instantiateModelsToScene(mk('kd'), true);

            const walkRoot   = walkInst.rootNodes[0]   as TransformNode;
            const attackRoot = attackInst.rootNodes[0] as TransformNode;
            const dieRoot    = dieInst.rootNodes[0]    as TransformNode;

            for (const root of [walkRoot, attackRoot, dieRoot]) {
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
            attackRoot.setEnabled(false);
            dieRoot.setEnabled(false);

            // Start walk loop, stop others
            walkInst.animationGroups.forEach(ag => ag.play(true));
            attackInst.animationGroups.forEach(ag => ag.stop());
            dieInst.animationGroups.forEach(ag => ag.stop());

            // Attach hammer to each pose's right hand bone
            this.attachHammerToHand(walkRoot, parent, unitId, 'walk');
            this.attachHammerToHand(attackRoot, parent, unitId, 'attack');
            this.attachHammerToHand(dieRoot, parent, unitId, 'die');

            this.korhanAnimMap.set(unitId, {
                walkRoot, attackRoot, dieRoot,
                walkAnims:   walkInst.animationGroups,
                attackAnims: attackInst.animationGroups,
                dieAnims:    dieInst.animationGroups,
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

    /** Clone hammer template and attach to a Korhan pose root. */
    private attachHammerToHand(poseRoot: TransformNode, parentMesh: Mesh, unitId: number, tag: string): void {
        if (!this.korhanHammerContainer) return;

        const inst = this.korhanHammerContainer.instantiateModelsToScene(
            (n: string) => `hammer_${tag}_${unitId}_${n}`, false,
        );
        const hammerRoot = inst.rootNodes[0] as TransformNode;

        const allNodes = poseRoot.getChildTransformNodes(false);
        const rightHand = allNodes.find(n => /righthand$/i.test(n.name)) ?? null;
        const spine     = allNodes.find(n => /spine01$/i.test(n.name))   ?? null;

        if (tag === 'walk' || tag === 'die') {
            // ── SIRT pozisyonu: Spine01'e parent, sırtın arkasında dik dursun ──
            const anchor = spine ?? rightHand;
            if (anchor) {
                hammerRoot.parent = anchor;
                (hammerRoot as any).scaling = new Vector3(100, 100, 100);
                // Sırtın arkasında, dik, baş yukarıda
                hammerRoot.rotation = new Vector3(0, Math.PI, 0);
                hammerRoot.position = new Vector3(0, 4, -3);
            } else {
                hammerRoot.parent = parentMesh;
                (hammerRoot as any).scaling = new Vector3(1, 1, 1);
                hammerRoot.position = new Vector3(0, 1.8, -0.3);
                hammerRoot.rotation = new Vector3(0, 0, 0);
            }
        } else {
            // ── ATTACK pozisyonu: RightHand'e parent, iki elle tutar gibi önde ──
            if (rightHand) {
                hammerRoot.parent = rightHand;
                (hammerRoot as any).scaling = new Vector3(100, 100, 100);
                // Sap ele paralel, baş yukarıda öne uzansın
                hammerRoot.rotation = new Vector3(-Math.PI / 2, 0, 0);
                hammerRoot.position = new Vector3(0, 5, 0);
            } else {
                hammerRoot.parent = parentMesh;
                (hammerRoot as any).scaling = new Vector3(1, 1, 1);
                hammerRoot.position = new Vector3(0.3, 1.2, 0.4);
                hammerRoot.rotation = new Vector3(0, 0, 0);
            }
        }

        hammerRoot.getChildMeshes().forEach(m => {
            m.setEnabled(true);
            m.isVisible = true;
            if (m instanceof Mesh) this.sg.addShadowCaster(m);
        });
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

            walkInst.animationGroups.forEach(ag => ag.play(true));

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
        if (!this.tepegozWalkContainer) { this.buildTepegozProcedural(parent); return; }
        this.tepegozAnimMap.set(unitId, this.buildGlbRoots(
            parent, `tw${unitId}`, 2.0,
            this.tepegozWalkContainer, this.tepegozAttackContainer, this.tepegozDieContainer,
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
                const enemy = this.findNearestEnemy(unit, alive);

                // Support units (Tulpar / Od): untargetable, escort allies, heal
                if (unit.type === 'tulpar' || unit.type === 'od') {
                    const nearbyAllies = alive.filter(a =>
                        a.team === unit.team && a.id !== unit.id
                        && !UnitManager.UNTARGETABLE.has(a.type)
                    );

                    if (nearbyAllies.length > 0) {
                        const closest = nearbyAllies.reduce((a, b) =>
                            this.distXZ(unit, a) < this.distXZ(unit, b) ? a : b);
                        const dist = this.distXZ(unit, closest);

                        if (dist > 2.5) {
                            // Move directly toward ally (ignore path)
                            unit.state = 'walking';
                            const dir = closest.mesh.position.subtract(unit.mesh.position);
                            dir.y = 0; dir.normalize();
                            // Use own speed if far, ally speed if close-ish
                            const spd = (dist > 8 ? unit.stats.speed : closest.stats.speed) * speedMult * dt;
                            unit.mesh.position.addInPlace(dir.scale(spd));
                            unit.mesh.rotation.y = Math.atan2(dir.x, dir.z) + (this.isGlbUnit(unit) ? Math.PI : 0);
                            this.applyWalkBob(unit, dt);
                        } else {
                            // Right next to ally — just stay, face same direction
                            unit.state = 'walking';
                            unit.mesh.rotation.y = closest.mesh.rotation.y;
                            this.applyWalkBob(unit, dt);
                        }
                    } else {
                        // No allies — wait at current position
                        unit.state = 'walking';
                        this.applyWalkBob(unit, dt);
                    }

                    // Heal nearby allies every 2s
                    if (this.gameTime - unit.lastAttackTime >= 2.0) {
                        const healRange = 8;
                        const healAmount = 15;
                        const healTargets = alive.filter(a =>
                            a.team === unit.team && a.id !== unit.id
                            && !UnitManager.UNTARGETABLE.has(a.type)
                            && this.distXZ(unit, a) < healRange
                            && a.hp < a.stats.maxHp
                        );
                        if (healTargets.length > 0) {
                            const target = healTargets.reduce((a, b) => (a.hp / a.stats.maxHp) < (b.hp / b.stats.maxHp) ? a : b);
                            target.hp = Math.min(target.stats.maxHp, target.hp + healAmount);
                            unit.lastAttackTime = this.gameTime;
                            this.spawnFloatingText(`+${healAmount}`, target.mesh.position.clone().addInPlaceFromFloats(0, 3.5, 0), new Color3(0.2, 1, 0.4));
                        }
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
                            targetBase.takeDamage(dmg);
                            this.flashAttackPos(unit, targetBase.position);
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
        }

        // ── Unit collision separation — no unit walks through another ──
        this.separateUnits(alive);

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

    private moveUnit(unit: Unit, dt: number, speedMult = 1.0): void {
        if (unit.pathQueue.length === 0) return;
        const target = unit.pathQueue[0];
        const dir = target.subtract(unit.mesh.position); dir.y = 0;
        const dist = dir.length();
        if (dist < 0.5) { unit.pathQueue.shift(); return; }
        dir.normalize();
        // GLB modellerin iç yönü -Z (GLTF standardı); prosedürel meshler simetrik
        unit.mesh.rotation.y = Math.atan2(dir.x, dir.z) + (this.isGlbUnit(unit) ? Math.PI : 0);
        unit.mesh.position.addInPlace(dir.scale(Math.min(unit.stats.speed * speedMult * dt, dist)));
    }

    private applyWalkBob(unit: Unit, dt: number): void {
        unit.walkBobTime += dt * (unit.stats.speed > 7 ? 11 : 7);
        unit.mesh.position.y = unit.baseY + 0.18 * Math.abs(Math.sin(unit.walkBobTime));
    }

    private static UNTARGETABLE: Set<string> = new Set(['tulpar', 'od']);

    private findNearestEnemy(unit: Unit, alive: Unit[]): Unit | null {
        // Support units (tulpar, od) cannot be targeted
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
            || (u.type === 'sahmeran' && !!this.sahmeranWalkContainer);
    }

    private distXZ(a: Unit, b: Unit): number {
        const dx = a.mesh.position.x - b.mesh.position.x;
        const dz = a.mesh.position.z - b.mesh.position.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    private faceTarget(a: Unit, b: Unit): void {
        const dir = b.mesh.position.subtract(a.mesh.position);
        a.mesh.rotation.y = Math.atan2(dir.x, dir.z) + (this.isGlbUnit(a) ? Math.PI : 0);
    }

    private tryAttack(attacker: Unit, target: Unit): void {
        if (this.gameTime - attacker.lastAttackTime < attacker.stats.attackCooldown) return;
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

        this.flashAttack(attacker, target);
        this.showDamageNumber(target, dmg, isCrit);
    }

    private flashAttackPos(attacker: Unit, targetPos: Vector3): void {
        const color = this.unitEmissive(attacker);
        const flash = MeshBuilder.CreateSphere(`fl_${Date.now()}`, { diameter: 2.5, segments: 5 }, this.scene);
        flash.position = targetPos.clone();
        flash.position.y = 5;
        const fm = new StandardMaterial(`flm_${Date.now()}`, this.scene);
        fm.emissiveColor = color; fm.alpha = 0.9; flash.material = fm;

        let t = 0;
        const id = setInterval(() => {
            t += 16;
            const p = t / 300;
            if (p >= 1 || flash.isDisposed()) {
                clearInterval(id);
                try { flash.dispose(); fm.dispose(); } catch { }
                return;
            }
            flash.scaling.setAll(1 + p * 1.5);
            flash.visibility = 1 - p;
        }, 16);
    }

    private flashAttack(attacker: Unit, target: Unit): void {
        const sz = (attacker.type === 'tepegoz' || attacker.type === 'tulpar') ? 2.0 : 1.2;

        const flash = MeshBuilder.CreateSphere(`fl_${Date.now()}`, { diameter: sz, segments: 5 }, this.scene);
        flash.position = attacker.mesh.position.clone(); flash.position.y += 1.5;
        const fm = new StandardMaterial(`flm_${Date.now()}`, this.scene);
        fm.emissiveColor = this.unitEmissive(attacker); fm.alpha = 0.85; flash.material = fm;

        const spark = MeshBuilder.CreateSphere(`sp_${Date.now()}`, { diameter: sz * 0.55, segments: 4 }, this.scene);
        spark.position = target.mesh.position.clone(); spark.position.y += 1.2;
        const sm = new StandardMaterial(`spm_${Date.now()}`, this.scene);
        sm.emissiveColor = this.unitEmissive(attacker); sm.alpha = 0.9; spark.material = sm;

        let t = 0;
        const id = setInterval(() => {
            t += 16;
            const p = t / 200;
            if (p >= 1 || flash.isDisposed() || spark.isDisposed()) {
                clearInterval(id);
                try { flash.dispose(); fm.dispose(); spark.dispose(); sm.dispose(); } catch { }
                return;
            }
            flash.scaling.setAll(1 + p * 0.5); flash.visibility = 1 - p;
            spark.scaling.setAll(1 + p * 0.8); spark.visibility = 1 - p;
        }, 16);
    }

    // ─── GENERIC GLB ANIMATION STATE MACHINE ───────────────────────
    private updateGLBAnim(unit: Unit, animMap: Map<number, GLBAnimData>): void {
        const data = animMap.get(unit.id);
        if (!data || data.dieStarted) return;

        const state = unit.state;
        if (state === data.lastState) return;
        data.lastState = state;

        if (state === 'walking') {
            data.walkRoot.setEnabled(true);
            data.attackRoot.setEnabled(false);
            if (data.dieRoot) data.dieRoot.setEnabled(false);
            data.attackAnims.forEach(ag => ag.stop());
            data.dieAnims.forEach(ag => ag.stop());
            data.walkAnims.forEach(ag => ag.play(true));
        } else if (state === 'fighting') {
            data.walkRoot.setEnabled(false);
            data.attackRoot.setEnabled(true);
            if (data.dieRoot) data.dieRoot.setEnabled(false);
            data.walkAnims.forEach(ag => ag.stop());
            data.dieAnims.forEach(ag => ag.stop());
            data.attackAnims.forEach(ag => ag.play(true));
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
            this.spawnFloatingText(`⚡ KRİTİK! -${rounded}`, pos, new Color3(1, 0.85, 0));
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
        for (const animMap of [this.korhanAnimMap, this.erlikAnimMap, this.odAnimMap, this.tepegozAnimMap, this.albastiAnimMap, this.umayAnimMap, this.sahmeranAnimMap, this.tulparAnimMap, this.ayazAnimMap]) {
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
        data.walkAnims.forEach(ag => ag.stop());
        data.attackAnims.forEach(ag => ag.stop());

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
            [...data.walkAnims, ...data.attackAnims, ...data.dieAnims].forEach(ag => { try { ag.dispose(); } catch { } });
            const roots = [data.walkRoot, data.attackRoot];
            if (data.dieRoot) roots.push(data.dieRoot);
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
