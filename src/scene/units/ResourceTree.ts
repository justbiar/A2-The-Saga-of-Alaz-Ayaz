/**
 * ResourceTree.ts — Mana / AVX ureten agac sistemi.
 *
 * Oyuncu oyun basinda Mana Agaci veya AVX Agaci secer (ikisi birlikte YASAK).
 * En fazla 2 agac dikilebilir, kendi base tarafina.
 * 5 seviye: dikildikten 15s sonra aktif, L1'de her 15s bir uretim.
 * Her seviye atlamada 10s cooldown + secim: Hiz mi Miktar mi?
 *   - Hiz: uretim suresi azalir (-2.5s)
 *   - Miktar: uretim miktari artar (+1)
 * L5 full hiz: 5s'de 1 | L5 full miktar: 15s'de 5
 */
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/loaders/glTF';
import { DracoCompression } from '@babylonjs/core/Meshes/Compression/dracoCompression';

DracoCompression.Configuration.decoder = {
    wasmUrl: 'https://cdn.babylonjs.com/draco_wasm_wrapper_gltf.js',
    wasmBinaryUrl: 'https://cdn.babylonjs.com/draco_decoder_gltf.wasm',
    fallbackUrl: 'https://cdn.babylonjs.com/draco_decoder_gltf.js',
};

export type TreeType = 'mana' | 'avx';

export const TREE_PLANT_COST = 5;       // dikim maliyeti (AVX)
export const TREE_UPGRADE_COST = [0, 3, 4, 5, 6]; // L1 bedava, L2=3 AVX ...

const ACTIVATION_TIME = 15;              // dikimden sonra aktif olma suresi
const BASE_INTERVAL = 15;               // L1 uretim araligi (s)
const BASE_AMOUNT = 1;                  // L1 uretim miktari
const SPEED_REDUCTION = 2.5;            // her hiz seciminde azalan sure
const AMOUNT_INCREASE = 1;              // her miktar seciminde artan uretim
const UPGRADE_COOLDOWN = 10;            // seviye atlama sonrasi bekleme (s)
const TREE_SCALE = 1.2;

/** Agac dikilebilecek slotlar — kendi base tarafinda */
export const TREE_SLOTS: Record<'fire' | 'ice', Vector3[]> = {
    fire: [
        new Vector3(-7, 0, -15),
        new Vector3(7, 0, -15),
    ],
    ice: [
        new Vector3(-7, 0, 15),
        new Vector3(7, 0, 15),
    ],
};

export class ResourceTree {
    public readonly team: 'fire' | 'ice';
    public readonly treeType: TreeType;
    public readonly position: Vector3;

    private _destroyed = false;
    private _scene: Scene;
    private _root: Mesh | null = null;
    private _level = 1;
    private _interval = BASE_INTERVAL;
    private _amount = BASE_AMOUNT;

    // Timers
    private _activating = true;
    private _activationTimer = 0;
    private _productionTimer = 0;
    private _upgrading = false;
    private _upgradeCooldownTimer = 0;
    private _pendingChoice = false;

    // UI
    private _wrap: HTMLElement | null = null;
    private _levelLabel: HTMLElement | null = null;
    private _barFill: HTMLElement | null = null;
    private _upgradeBtn: HTMLElement | null = null;

    // Callbacks
    public onUpgradeChoice: ((tree: ResourceTree) => void) | null = null;
    public onUpgradeRequest: (() => void) | null = null;

    constructor(scene: Scene, team: 'fire' | 'ice', treeType: TreeType, position: Vector3) {
        this._scene = scene;
        this.team = team;
        this.treeType = treeType;
        this.position = position.clone();

        // Placeholder mesh
        const ph = MeshBuilder.CreateCylinder(`tree_ph_${treeType}`, { height: 1, diameter: 1.5 }, scene);
        ph.position = this.position.clone();
        ph.position.y = 0.5;
        const mat = new StandardMaterial(`tree_ph_mat_${treeType}`, scene);
        mat.diffuseColor = treeType === 'mana' ? new Color3(0.6, 0.2, 0.8) : new Color3(0.8, 0.5, 0.2);
        mat.emissiveColor = treeType === 'mana' ? new Color3(0.2, 0.05, 0.3) : new Color3(0.3, 0.15, 0.05);
        ph.material = mat;
        this._root = ph;

        void this._loadModel();
        this._createUI();
    }

    // ── Model ────────────────────────────────────────────────────────

    private async _loadModel(): Promise<void> {
        const glbFile = this.treeType === 'mana' ? 'manaagaci.glb' : 'avxagaci.glb';
        const basePath = 'assets/game%20asset/cicekler/';
        try {
            const result = await SceneLoader.ImportMeshAsync('', basePath, glbFile, this._scene);
            this._root?.dispose();
            const glbRoot = result.meshes[0] as Mesh;
            glbRoot.position = this.position.clone();
            glbRoot.position.y = this.treeType === 'mana' ? 1.0 : 0;
            glbRoot.scaling.setAll(TREE_SCALE);
            this._root = glbRoot;
        } catch (err) {
            console.warn(`[Tree] GLB yuklenemedi: ${glbFile}`, err);
        }
    }

    // ── Tick ─────────────────────────────────────────────────────────

    /** Returns produced resource or null */
    tick(dt: number): { type: TreeType; amount: number } | null {
        if (this._destroyed) return null;
        this._updateUIPositions();

        // Aktivasyon beklemesi
        if (this._activating) {
            this._activationTimer += dt;
            this._updateBar(this._activationTimer / ACTIVATION_TIME, '#aaa');
            if (this._activationTimer >= ACTIVATION_TIME) {
                this._activating = false;
                this._productionTimer = 0;
                this._updateLevelLabel();
            }
            return null;
        }

        // Seviye atlama cooldown'u
        if (this._upgrading) {
            this._upgradeCooldownTimer += dt;
            this._updateBar(this._upgradeCooldownTimer / UPGRADE_COOLDOWN, '#ffaa00');
            if (this._upgradeCooldownTimer >= UPGRADE_COOLDOWN) {
                this._upgrading = false;
                this._pendingChoice = true;
                this._updateLevelLabel();
                // Secim popup'i goster
                this.onUpgradeChoice?.(this);
            }
            return null;
        }

        // Secim bekleniyor
        if (this._pendingChoice) return null;

        // Uretim
        this._productionTimer += dt;
        this._updateBar(this._productionTimer / this._interval,
            this.treeType === 'mana' ? '#aa44ff' : '#ff8800');

        if (this._productionTimer >= this._interval) {
            this._productionTimer = 0;
            return { type: this.treeType, amount: this._amount };
        }
        return null;
    }

    // ── Level Up ─────────────────────────────────────────────────────

    get level(): number { return this._level; }
    get interval(): number { return this._interval; }
    get amount(): number { return this._amount; }
    get isPendingChoice(): boolean { return this._pendingChoice; }
    get isUpgrading(): boolean { return this._upgrading; }
    get isActive(): boolean { return !this._activating && !this._upgrading && !this._pendingChoice; }

    /** Seviye atlatmayi baslat (10s cooldown sonra secim gelir) */
    startUpgrade(): boolean {
        if (this._level >= 5) return false;
        if (this._upgrading || this._pendingChoice || this._activating) return false;
        this._level++;
        this._upgrading = true;
        this._upgradeCooldownTimer = 0;
        this._updateLevelLabel();
        this._updateScale();
        return true;
    }

    /** Seviyeye göre ağaç boyutunu büyüt: L1=1.2x → L5=2.0x */
    private _updateScale(): void {
        if (!this._root) return;
        const scale = TREE_SCALE + (this._level - 1) * 0.2; // 1.2, 1.4, 1.6, 1.8, 2.0
        this._root.scaling.setAll(scale);
    }

    /** Secim sonucu: hiz veya miktar */
    applyChoice(choice: 'speed' | 'amount'): void {
        if (!this._pendingChoice) return;
        this._pendingChoice = false;
        if (choice === 'speed') {
            this._interval = Math.max(5, this._interval - SPEED_REDUCTION);
        } else {
            this._amount += AMOUNT_INCREASE;
        }
        this._productionTimer = 0;
        this._updateLevelLabel();
    }

    // ── UI ───────────────────────────────────────────────────────────

    private _createUI(): void {
        const wrap = document.createElement('div');
        wrap.className = 'tree-status-wrap';
        wrap.style.cssText = `
            position:fixed; display:flex; flex-direction:column; align-items:center;
            gap:2px; z-index:170; pointer-events:none;
        `;

        const label = document.createElement('span');
        label.style.cssText = `
            font:bold 10px monospace; padding:1px 6px; border-radius:3px;
            background:rgba(0,0,0,0.6);
            color:${this.treeType === 'mana' ? '#cc88ff' : '#ffaa44'};
        `;
        label.textContent = this.treeType === 'mana' ? 'Mana L1' : 'AVX L1';

        const bar = document.createElement('div');
        bar.style.cssText = `
            width:50px; height:4px; border-radius:2px; overflow:hidden;
            background:rgba(0,0,0,0.5);
        `;
        const fill = document.createElement('div');
        fill.className = 'tree-bar-fill';
        fill.style.cssText = `
            width:0%; height:100%; border-radius:2px;
            background:${this.treeType === 'mana' ? '#aa44ff' : '#ff8800'};
            transition: width 0.3s;
        `;
        bar.appendChild(fill);

        const upgradeBtn = document.createElement('div');
        const costCurrency = this.treeType === 'mana' ? 'AVX' : 'Mana';
        upgradeBtn.style.cssText = `
            font:bold 9px 'Cinzel',serif; padding:3px 8px; border-radius:4px;
            background:${this.treeType === 'mana' ? 'rgba(170,68,255,0.2)' : 'rgba(255,136,0,0.2)'};
            border:1px solid ${this.treeType === 'mana' ? 'rgba(170,68,255,0.5)' : 'rgba(255,136,0,0.5)'};
            color:${this.treeType === 'mana' ? '#cc88ff' : '#ffaa44'};
            cursor:pointer; pointer-events:auto; letter-spacing:0.5px;
            display:none;
        `;
        upgradeBtn.textContent = `▲ L2 (${TREE_UPGRADE_COST[1]} ${costCurrency})`;
        upgradeBtn.addEventListener('click', () => this.onUpgradeRequest?.());

        wrap.appendChild(label);
        wrap.appendChild(bar);
        wrap.appendChild(upgradeBtn);
        document.body.appendChild(wrap);
        this._wrap = wrap;
        this._levelLabel = label;
        this._upgradeBtn = upgradeBtn;
        this._barFill = fill;
    }

    private _updateLevelLabel(): void {
        if (!this._levelLabel) return;
        const prefix = this.treeType === 'mana' ? 'Mana' : 'AVX';
        let suffix = `L${this._level}`;
        if (this._activating) suffix += ' ...';
        else if (this._upgrading) suffix += ' UP';
        else if (this._pendingChoice) suffix += ' ?';
        else suffix += ` (${this._interval.toFixed(1)}s x${this._amount})`;
        this._levelLabel.textContent = `${prefix} ${suffix}`;

        // Upgrade butonu guncelle
        if (this._upgradeBtn) {
            const canUpgrade = !this._activating && !this._upgrading && !this._pendingChoice && this._level < 5;
            this._upgradeBtn.style.display = canUpgrade ? 'block' : 'none';
            if (canUpgrade) {
                const nextCost = TREE_UPGRADE_COST[this._level] ?? 99;
                const currency = this.treeType === 'mana' ? 'AVX' : 'Mana';
                this._upgradeBtn.textContent = `▲ L${this._level + 1} (${nextCost} ${currency})`;
            }
        }
    }

    private _updateBar(ratio: number, color: string): void {
        if (!this._barFill) return;
        this._barFill.style.width = `${Math.min(1, ratio) * 100}%`;
        this._barFill.style.background = color;
    }

    private _updateUIPositions(): void {
        if (!this._wrap) return;
        const s = this._project(new Vector3(this.position.x, this.position.y + 3.5, this.position.z));
        if (!s) { this._wrap.style.display = 'none'; return; }
        this._wrap.style.display = 'flex';
        this._wrap.style.left = `${s.x - 25}px`;
        this._wrap.style.top = `${s.y}px`;
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

    /** Ağacın üstünde kaynak üretim popup'ı göster */
    showProducePopup(amount: number): void {
        const pos = this._project(new Vector3(this.position.x, this.position.y + 2.5, this.position.z));
        if (!pos) return;

        const el = document.createElement('div');
        const isMana = this.treeType === 'mana';
        el.innerHTML = isMana
            ? `<span style="color:#cc88ff;font-size:11px;">&#9830;</span> <span>+${amount} Mana</span>`
            : `<img src="/favicon.ico" style="width:14px;height:14px;vertical-align:middle;"> <span>+${amount} AVX</span>`;
        el.style.cssText = `
            position:fixed; z-index:200; pointer-events:none;
            left:${pos.x}px; top:${pos.y}px;
            transform:translate(-50%,0);
            font:bold 13px 'Cinzel',serif;
            color:${isMana ? '#cc88ff' : '#ffc94d'};
            text-shadow:0 0 8px ${isMana ? 'rgba(170,68,255,0.6)' : 'rgba(255,185,50,0.6)'};
            display:flex; align-items:center; gap:4px;
            animation:treePopup 1.2s ease-out forwards;
        `;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1300);
    }

    // ── Public ────────────────────────────────────────────────────────

    get isDestroyed(): boolean { return this._destroyed; }

    dispose(): void {
        if (this._destroyed) return;
        this._destroyed = true;
        this._root?.dispose();
        this._wrap?.remove();
        this._wrap = null;
        this._levelLabel = null;
        this._barFill = null;
    }
}
