/**
 * DefenseTower.ts — Topçu Kulesi savunma sistemi.
 * 5 AVX ile kurulur, her 5 AVX'te seviye atlar (max 5).
 * Namlu yönü GLB bounding box'tan otomatik algılanır.
 * Sadece ön yarıküreye (±90°) ateş eder.
 */
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/loaders/glTF';
import { DracoCompression } from '@babylonjs/core/Meshes/Compression/dracoCompression';
import type { Unit } from '../../ecs/Unit';

// Draco decoder CDN (sıkıştırılmış GLB için)
DracoCompression.Configuration.decoder = {
    wasmUrl: 'https://cdn.babylonjs.com/draco_wasm_wrapper_gltf.js',
    wasmBinaryUrl: 'https://cdn.babylonjs.com/draco_decoder_gltf.wasm',
    fallbackUrl: 'https://cdn.babylonjs.com/draco_decoder_gltf.js',
};
import type { BaseBuilding } from '../map/BaseBuilding';

const LEVEL_RANGE  = [0, 14, 20, 28, 36, 52] as const;
const LEVEL_DAMAGE = [0, 22, 30, 40, 52, 65] as const;
/** Seviye atlama maliyeti: Lv1→2 = 5, Lv2→3 = 7, Lv3→4 = 9, Lv4→5 = 11 */
export const UPGRADE_COST = [0, 5, 7, 9, 11] as const;
const BASE_HP      = 220;
const ATTACK_CD    = 1.5;
const ROTATE_SPEED = 5;
const FIRING_ARC   = Math.PI / 2; // ±90° — yanından geçen düşmanı hedef alma

export const TOWER_SLOTS: Record<'fire' | 'ice', [Vector3, Vector3]> = {
    fire: [new Vector3(-5, 0, -25), new Vector3(5, 0, -25)],
    ice:  [new Vector3(-5, 0,  25), new Vector3(5, 0,  25)],
};

export class DefenseTower {
    public hp: number;
    public maxHp: number;
    public level = 1;
    public readonly team: 'fire' | 'ice';
    public readonly slot: 0 | 1;
    public readonly position: Vector3;
    public onUpgradeRequest: (() => void) | null = null;

    private _destroyed = false;
    private _lastAttack = 0;
    private _time = 0;
    private _root: Mesh | null = null;
    private _scene: Scene;
    private _upgradeBtn: HTMLElement | null = null;
    private _hpWrap: HTMLElement | null = null;
    private _rangeIndicator: Mesh | null = null;
    private _pointerObs: any = null;
    private _rangeTimeout: ReturnType<typeof setTimeout> | null = null;

    /** Y=0'daki namlu yönü (atan2). GLB bounding box'tan algılanır. */
    private _barrelAngle = 0;
    /** Mesh mevcut Y rotasyonu */
    private _currentAngle: number;
    /** Düşman üssü yönü (fire→0, ice→π) */
    private readonly _forwardAngle: number;

    constructor(scene: Scene, team: 'fire' | 'ice', slot: 0 | 1) {
        this._scene = scene;
        this.team = team;
        this.slot = slot;
        this.position = TOWER_SLOTS[team][slot].clone();
        this.maxHp = BASE_HP;
        this.hp = BASE_HP;
        this._forwardAngle = team === 'fire' ? 0 : Math.PI;

        this._barrelAngle = 0;
        this._currentAngle = this._forwardAngle - this._barrelAngle;

        const box = MeshBuilder.CreateBox(`tower_ph_${team}_${slot}`, { width: 2.2, height: 4, depth: 2.2 }, scene);
        box.position = this.position.clone();
        box.position.y = 2;
        box.rotationQuaternion = Quaternion.FromEulerAngles(0, this._currentAngle, 0);
        const mat = new StandardMaterial(`tower_mat_${team}_${slot}`, scene);
        mat.diffuseColor = team === 'fire' ? new Color3(0.9, 0.3, 0.1) : new Color3(0.1, 0.5, 0.9);
        mat.emissiveColor = team === 'fire' ? new Color3(0.3, 0.05, 0) : new Color3(0, 0.1, 0.3);
        box.material = mat;
        this._root = box;

        void this._loadModel();
        this._createUI();
        this._setupClickHandler();
    }

    // ── Model yükleme ──────────────────────────────────────────────

    private async _loadModel(): Promise<void> {
        const glbFile = this.team === 'fire' ? 'alaztop.glb' : 'ayaztop.glb';
        try {
            const result = await SceneLoader.ImportMeshAsync('', 'assets/game%20asset/', glbFile, this._scene);
            this._root?.dispose();
            const glbRoot = result.meshes[0] as Mesh;
            glbRoot.position = this.position.clone();
            glbRoot.position.y = 0;
            glbRoot.scaling.setAll(0.18);

            glbRoot.rotationQuaternion = Quaternion.Identity();
            glbRoot.computeWorldMatrix(true);
            for (const child of glbRoot.getChildMeshes()) child.computeWorldMatrix(true);

            this._detectBarrelDirection(glbRoot);

            this._currentAngle = this._forwardAngle - this._barrelAngle;
            glbRoot.rotationQuaternion = Quaternion.FromEulerAngles(0, this._currentAngle, 0);
            this._root = glbRoot as Mesh;
        } catch {
            // placeholder kutu kalır
        }
    }

    private _detectBarrelDirection(glbRoot: Mesh): void {
        try {
            const bb = glbRoot.getHierarchyBoundingVectors(true);
            const pos = glbRoot.position;
            const extents = [
                { label: '+Z', angle: 0,            ext: bb.max.z - pos.z },
                { label: '-Z', angle: Math.PI,      ext: pos.z - bb.min.z },
                { label: '+X', angle: Math.PI / 2,  ext: bb.max.x - pos.x },
                { label: '-X', angle: -Math.PI / 2, ext: pos.x - bb.min.x },
            ];
            extents.sort((a, b) => b.ext - a.ext);
            this._barrelAngle = extents[0].angle;
            console.log(`[Tower ${this.team}#${this.slot}] Barrel → ${extents[0].label} (${(this._barrelAngle * 180 / Math.PI).toFixed(0)}°)`);
        } catch {
            this._barrelAngle = 0;
        }
    }

    // ── Rotation ───────────────────────────────────────────────────

    private _rotateTo(target: Vector3, dt: number): void {
        if (!this._root) return;
        const dx = target.x - this.position.x;
        const dz = target.z - this.position.z;
        const targetAngle = Math.atan2(dx, dz) - this._barrelAngle;
        const raw = targetAngle - this._currentAngle;
        const diff = (((raw + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        this._currentAngle += diff * Math.min(1, dt * ROTATE_SPEED);
        this._root.rotationQuaternion = Quaternion.FromEulerAngles(0, this._currentAngle, 0);
    }

    private _getBarrelWorldAngle(): number {
        return this._currentAngle + this._barrelAngle;
    }

    // ── Ateş arkı (±90°) ──────────────────────────────────────────

    /** Hedef topun ön yarıküresinde mi? (yanından geçenler false) */
    private _isInFiringArc(targetPos: Vector3): boolean {
        const dx = targetPos.x - this.position.x;
        const dz = targetPos.z - this.position.z;
        const angleToTarget = Math.atan2(dx, dz);
        const raw = angleToTarget - this._forwardAngle;
        const diff = (((raw + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        return Math.abs(diff) <= FIRING_ARC;
    }

    // ── Hedef bulma ────────────────────────────────────────────────

    private _findTarget(units: Unit[], enemyTower: DefenseTower | null, enemyBase: BaseBuilding): Vector3 | null {
        const enemyTeam = this.team === 'fire' ? 'ice' : 'fire';

        // Kule ve base sabit — ark kontrolü yok
        if (enemyTower && !enemyTower.isDestroyed) {
            if (Vector3.Distance(this.position, enemyTower.position) <= this.range)
                return enemyTower.position.clone();
        }
        if (Vector3.Distance(this.position, enemyBase.position) <= this.range)
            return enemyBase.position.clone();

        // Birimler: menzil + ark kontrolü
        let nearest: Unit | null = null;
        let nearestDist = Infinity;
        for (const u of units) {
            if (u.team !== enemyTeam || u.state === 'dead') continue;
            if (!this._isInFiringArc(u.mesh.position)) continue;
            const d = Vector3.Distance(this.position, u.mesh.position);
            if (d <= this.range && d < nearestDist) { nearest = u; nearestDist = d; }
        }
        return nearest ? nearest.mesh.position.clone() : null;
    }

    private _findAnyNearestEnemy(units: Unit[]): Vector3 | null {
        const enemyTeam = this.team === 'fire' ? 'ice' : 'fire';
        let nearest: Unit | null = null;
        let nearestDist = Infinity;
        for (const u of units) {
            if (u.team !== enemyTeam || u.state === 'dead') continue;
            if (!this._isInFiringArc(u.mesh.position)) continue;
            const d = Vector3.Distance(this.position, u.mesh.position);
            if (d < nearestDist) { nearest = u; nearestDist = d; }
        }
        return nearest ? nearest.mesh.position.clone() : null;
    }

    // ── Tick ────────────────────────────────────────────────────────

    tick(dt: number, units: Unit[], enemyTower: DefenseTower | null, enemyBase: BaseBuilding): void {
        if (this._destroyed) return;
        this._time += dt;
        this._updateUIPositions();

        const target = this._findTarget(units, enemyTower, enemyBase);
        const lookTarget = target ?? this._findAnyNearestEnemy(units) ?? enemyBase.position;
        this._rotateTo(lookTarget, dt);

        if (this._time - this._lastAttack < ATTACK_CD || !target) return;

        // Namlu hedefe dönmeden ateş etme (25°)
        const barrelDir = this._getBarrelWorldAngle();
        const targetDir = Math.atan2(target.x - this.position.x, target.z - this.position.z);
        const rawAim = barrelDir - targetDir;
        const aimDiff = Math.abs((((rawAim + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
        if (aimDiff > Math.PI / 7.2) return;

        if (enemyTower && !enemyTower.isDestroyed &&
            Vector3.Distance(this.position, enemyTower.position) <= this.range) {
            this._fire(enemyTower.position.clone(), () => {
                if (!enemyTower.isDestroyed) enemyTower.takeDamage(this.damage);
            });
        } else if (Vector3.Distance(this.position, enemyBase.position) <= this.range) {
            this._fire(enemyBase.position.clone(), () => enemyBase.takeDamage(this.damage));
        } else {
            const enemyTeam = this.team === 'fire' ? 'ice' : 'fire';
            let nearest: Unit | null = null;
            let nearestDist = Infinity;
            for (const u of units) {
                if (u.team !== enemyTeam || u.state === 'dead') continue;
                if (!this._isInFiringArc(u.mesh.position)) continue;
                const d = Vector3.Distance(this.position, u.mesh.position);
                if (d <= this.range && d < nearestDist) { nearest = u; nearestDist = d; }
            }
            if (nearest) {
                const t = nearest;
                this._fire(t.mesh.position.clone(), () => { if (t.state !== 'dead') t.hp -= this.damage; });
            } else return;
        }
        this._lastAttack = this._time;
    }

    // ── Ateş sistemi ───────────────────────────────────────────────

    private _getMuzzlePos(): Vector3 {
        const barrelWorld = this._getBarrelWorldAngle();
        return new Vector3(
            this.position.x + Math.sin(barrelWorld) * 2.0,
            this.position.y + 1.2,
            this.position.z + Math.cos(barrelWorld) * 2.0,
        );
    }

    private _fire(target: Vector3, onHit: () => void): void {
        const gifSrc = this.team === 'fire'
            ? 'assets/game%20asset/alaztopfx/meteor_side_medium.gif'
            : 'assets/game%20asset/ayaztopfx/fire_ball_blue_side_small.gif';

        const muzzle = this._getMuzzlePos();
        const src = this._project(muzzle);
        const dst = this._project(new Vector3(target.x, target.y + 1, target.z));
        if (!src || !dst) { setTimeout(onHit, 450); return; }

        const el = document.createElement('img');
        el.src = gifSrc;
        el.className = 'tower-projectile';
        el.style.left = src.x + 'px';
        el.style.top  = src.y + 'px';
        const angle = Math.atan2(dst.y - src.y, dst.x - src.x) * (180 / Math.PI);
        el.style.transform = `translate(-50%,-50%) rotate(${angle}deg)`;
        document.body.appendChild(el);

        requestAnimationFrame(() => {
            el.style.transition = 'left 0.45s linear, top 0.45s linear';
            el.style.left = dst.x + 'px';
            el.style.top  = dst.y + 'px';
        });

        setTimeout(() => { onHit(); el.remove(); }, 450);
    }

    // ── Menzil göstergesi (tıkla → yarım daire) ───────────────────

    private _setupClickHandler(): void {
        this._pointerObs = this._scene.onPointerObservable.add((info) => {
            if (this._destroyed) return;
            if (info.type !== PointerEventTypes.POINTERTAP) return;
            const picked = info.pickInfo?.pickedMesh;
            if (!picked || !this._root) return;
            // GLB child mesh'leri dahil — root veya herhangi bir çocuk
            const allMeshes = [this._root, ...this._root.getChildMeshes()];
            if (allMeshes.some(m => m === picked)) {
                this._toggleRangeIndicator();
            }
        });
    }

    private _toggleRangeIndicator(): void {
        // Kapatma
        if (this._rangeIndicator) {
            this._rangeIndicator.dispose();
            this._rangeIndicator = null;
            if (this._rangeTimeout) { clearTimeout(this._rangeTimeout); this._rangeTimeout = null; }
            return;
        }

        const r = this.range;
        const fwd = this._forwardAngle;
        const segs = 40;
        const y = 0.4;

        // Yarım daire dolgu mesh
        const positions: number[] = [];
        const indices: number[] = [];
        // Merkez nokta (0)
        positions.push(this.position.x, y, this.position.z);
        for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const angle = fwd - FIRING_ARC + t * 2 * FIRING_ARC;
            positions.push(
                this.position.x + Math.sin(angle) * r,
                y,
                this.position.z + Math.cos(angle) * r,
            );
            if (i > 0) indices.push(0, i, i + 1);
        }

        const mesh = new Mesh(`range_${this.team}_${this.slot}`, this._scene);
        const vd = new VertexData();
        vd.positions = positions;
        vd.indices = indices;
        vd.applyToMesh(mesh);

        const mat = new StandardMaterial(`rangeMat_${this.team}_${this.slot}`, this._scene);
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        if (this.team === 'fire') {
            mat.emissiveColor = new Color3(1, 0.4, 0.05);
            mat.diffuseColor = new Color3(1, 0.4, 0.05);
        } else {
            mat.emissiveColor = new Color3(0.2, 0.6, 1);
            mat.diffuseColor = new Color3(0.2, 0.6, 1);
        }
        mat.alpha = 0.25;
        mesh.material = mat;
        mesh.isPickable = false;

        // Kenar çizgisi
        const edgePts: Vector3[] = [];
        edgePts.push(new Vector3(this.position.x, y + 0.05, this.position.z));
        for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const angle = fwd - FIRING_ARC + t * 2 * FIRING_ARC;
            edgePts.push(new Vector3(
                this.position.x + Math.sin(angle) * r,
                y + 0.05,
                this.position.z + Math.cos(angle) * r,
            ));
        }
        edgePts.push(new Vector3(this.position.x, y + 0.05, this.position.z));
        const edge = MeshBuilder.CreateLines(`rangeEdge_${this.team}_${this.slot}`, { points: edgePts }, this._scene);
        edge.color = this.team === 'fire' ? new Color3(1, 0.6, 0.1) : new Color3(0.4, 0.8, 1);
        edge.isPickable = false;
        edge.parent = mesh;

        this._rangeIndicator = mesh;

        // 4s sonra otomatik kapat
        this._rangeTimeout = setTimeout(() => {
            this._rangeIndicator?.dispose();
            this._rangeIndicator = null;
            this._rangeTimeout = null;
        }, 4000);
    }

    // ── UI ──────────────────────────────────────────────────────────

    private _createUI(): void {
        const wrap = document.createElement('div');
        wrap.className = 'tower-hp-wrap';
        wrap.innerHTML = `<div class="tower-hp-fill"></div><span class="tower-lvl">Lv1</span>`;
        document.body.appendChild(wrap);
        this._hpWrap = wrap;

        const btn = document.createElement('div');
        btn.className = 'tower-upgrade-btn';
        btn.dataset.team = this.team;
        btn.textContent = `▲ Lv2 (${UPGRADE_COST[1]} AVX)`;
        btn.addEventListener('click', () => this.onUpgradeRequest?.());
        document.body.appendChild(btn);
        this._upgradeBtn = btn;

        this._syncUIText();
        this._updateHpBar();
    }

    private _syncUIText(): void {
        if (this._upgradeBtn) {
            if (this.level >= 5) {
                this._upgradeBtn.style.display = 'none';
            } else {
                this._upgradeBtn.textContent = `▲ Lv${this.level + 1} (${UPGRADE_COST[this.level]} AVX)`;
            }
        }
        const lvlEl = this._hpWrap?.querySelector<HTMLElement>('.tower-lvl');
        if (lvlEl) lvlEl.textContent = `Lv${this.level}`;
    }

    private _updateHpBar(): void {
        const fill = this._hpWrap?.querySelector<HTMLElement>('.tower-hp-fill');
        if (fill) fill.style.width = `${(this.hp / this.maxHp) * 100}%`;
    }

    private _project(world: Vector3): { x: number; y: number } | null {
        const cam = this._scene.activeCamera;
        const eng = this._scene.getEngine();
        if (!cam || !eng) return null;
        try {
            const canvas = eng.getRenderingCanvas();
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();
            const vm = cam.getViewMatrix();
            const pm = cam.getProjectionMatrix();
            const vPos = Vector3.TransformCoordinates(world, vm);
            const cPos = Vector3.TransformCoordinates(vPos, pm);
            const x = rect.left + ((cPos.x + 1) / 2) * rect.width;
            const y = rect.top + ((1 - cPos.y) / 2) * rect.height;
            if (isNaN(x) || isNaN(y)) return null;
            return { x, y };
        } catch { return null; }
    }

    private _updateUIPositions(): void {
        const s = this._project(new Vector3(this.position.x, this.position.y + 5.5, this.position.z));
        if (!s) {
            if (this._hpWrap) this._hpWrap.style.display = 'none';
            if (this._upgradeBtn) this._upgradeBtn.style.display = 'none';
            return;
        }
        if (this._hpWrap) {
            this._hpWrap.style.display = 'flex';
            this._hpWrap.style.left = `${s.x - 35}px`;
            this._hpWrap.style.top = `${s.y}px`;
        }
        if (this._upgradeBtn && this.level < 5) {
            this._upgradeBtn.style.display = 'block';
            this._upgradeBtn.style.left = `${s.x - 44}px`;
            this._upgradeBtn.style.top = `${s.y + 20}px`;
        }
    }

    // ── Level / stats ──────────────────────────────────────────────

    levelUp(): boolean {
        if (this.level >= 5) return false;
        this.level++;
        const newMax = Math.round(BASE_HP * Math.pow(1.25, this.level - 1));
        const ratio = this.hp / this.maxHp;
        this.maxHp = newMax;
        this.hp = Math.round(newMax * ratio);
        this._syncUIText();
        this._updateHpBar();
        // Menzil değişti — gösterge açıksa yenile
        if (this._rangeIndicator) {
            this._toggleRangeIndicator(); // kapat
            this._toggleRangeIndicator(); // yeni menzille aç
        }
        return true;
    }

    get range(): number { return LEVEL_RANGE[this.level]; }
    get damage(): number { return LEVEL_DAMAGE[this.level]; }
    get isDestroyed(): boolean { return this._destroyed; }

    takeDamage(amount: number): void {
        if (this._destroyed) return;
        this.hp = Math.max(0, this.hp - amount);
        this._updateHpBar();
        if (this.hp === 0) this.dispose();
    }

    dispose(): void {
        if (this._destroyed) return;
        this._destroyed = true;
        this._root?.dispose();
        this._upgradeBtn?.remove();
        this._hpWrap?.remove();
        this._upgradeBtn = null;
        this._hpWrap = null;
        this._rangeIndicator?.dispose();
        this._rangeIndicator = null;
        if (this._rangeTimeout) { clearTimeout(this._rangeTimeout); this._rangeTimeout = null; }
        if (this._pointerObs) {
            this._scene.onPointerObservable.remove(this._pointerObs);
            this._pointerObs = null;
        }
    }
}
