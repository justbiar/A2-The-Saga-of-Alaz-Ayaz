/**
 * DefenseFlower.ts — Topçu Kulesi yok eden çiçek sistemi.
 *
 * Alaz çiçeği buz bölgesine, Ayaz çiçeği ateş bölgesine ekilir.
 * 3 AVX ile ekilir. 3 büyüme aşaması (her biri 15s).
 * Olgunlaştıktan sonra en yakın düşman kulesine saldırır:
 *   - Her 3 saniyede bir vuruş
 *   - Her vuruş topun max HP'sinin %33'ünü alır → 3 vuruş = kule öldü
 *   - 45 saniye ömür (düşman bölgede yaşayamaz)
 */
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { t } from '../../i18n';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/loaders/glTF';
import { DracoCompression } from '@babylonjs/core/Meshes/Compression/dracoCompression';
import type { DefenseTower } from './DefenseTower';

// Draco decoder (tower ile paylaşılır ama idempotent)
DracoCompression.Configuration.decoder = {
    wasmUrl: 'https://cdn.babylonjs.com/draco_wasm_wrapper_gltf.js',
    wasmBinaryUrl: 'https://cdn.babylonjs.com/draco_decoder_gltf.wasm',
    fallbackUrl: 'https://cdn.babylonjs.com/draco_decoder_gltf.js',
};

export const FLOWER_AVX_COST = 3;

const GROW_PHASE_DURATION = 15;   // her büyüme aşaması (saniye)
const ATTACK_CD = 3;              // saldırı aralığı (saniye)
const LIFESPAN = 45;              // toplam ömür (saniye) — olgunlaştıktan sonra
const DAMAGE_PER_HIT = 0.022;     // her vuruş = topun max HP'sinin %2.2'si (15 vuruş ≈ %33)
const FLOWER_SCALE = 0.6;
const ATTACK_RANGE = 18;          // menzil

/** Çiçek ekilebilecek slotlar — düşman tower'larının yakını */
export const FLOWER_SLOTS: Record<'fire' | 'ice', Vector3[]> = {
    // Alaz çiçeği buz tarafına ekilir (z > 0)
    fire: [
        new Vector3(-7, 0, 20),
        new Vector3(0, 0, 22),
        new Vector3(7, 0, 20),
    ],
    // Ayaz çiçeği ateş tarafına ekilir (z < 0)
    ice: [
        new Vector3(-7, 0, -20),
        new Vector3(0, 0, -22),
        new Vector3(7, 0, -20),
    ],
};

type GrowthStage = 1 | 2 | 3;

export class DefenseFlower {
    public readonly team: 'fire' | 'ice';
    public readonly position: Vector3;

    private _destroyed = false;
    private _scene: Scene;
    private _root: Mesh | null = null;
    private _stage: GrowthStage = 1;
    private _growTimer = 0;
    private _mature = false;       // 3. aşamaya ulaştı
    private _lifeTimer = 0;        // olgunlaştıktan sonra sayaç
    private _attackTimer = 0;
    private _hpWrap: HTMLElement | null = null;
    private _stageLabel: HTMLElement | null = null;

    constructor(scene: Scene, team: 'fire' | 'ice', position: Vector3) {
        this._scene = scene;
        this.team = team;
        this.position = position.clone();

        // Placeholder
        const ph = MeshBuilder.CreateCylinder(`flower_ph_${team}`, { height: 0.5, diameter: 1 }, scene);
        ph.position = this.position.clone();
        ph.position.y = 0.25;
        const mat = new StandardMaterial(`flower_ph_mat`, scene);
        mat.diffuseColor = team === 'fire' ? new Color3(0.9, 0.4, 0.1) : new Color3(0.2, 0.5, 0.9);
        mat.emissiveColor = team === 'fire' ? new Color3(0.3, 0.1, 0) : new Color3(0, 0.1, 0.3);
        ph.material = mat;
        this._root = ph;

        void this._loadModel(1);
        this._createUI();
    }

    // ── Model yükleme ──────────────────────────────────────────────

    private async _loadModel(stage: GrowthStage): Promise<void> {
        const prefix = this.team === 'fire' ? 'alazcicek' : 'ayazcicek';
        const glbFile = `${prefix}${stage}.glb`;
        const basePath = 'assets/game%20asset/cicekler/';

        try {
            const result = await SceneLoader.ImportMeshAsync('', basePath, glbFile, this._scene);
            this._root?.dispose();

            const glbRoot = result.meshes[0] as Mesh;
            glbRoot.position = this.position.clone();
            // Aşama 1 modeli küçük/farklı pivot — yukarı kaldır
            const yOffset = stage === 1 ? 0.3 : -0.1;
            glbRoot.position.y = yOffset;
            glbRoot.scaling.setAll(FLOWER_SCALE);
            if (glbRoot.rotationQuaternion) glbRoot.rotationQuaternion = null;
            // Ayaz çiçeği GLB dik export edilmiş, X ekseninde yatır
            glbRoot.rotation.set(this.team === 'ice' ? -Math.PI / 2 : 0, 0, 0);
            this._root = glbRoot;
        } catch (err) {
            console.warn(`[Flower] GLB yüklenemedi: ${glbFile}`, err);
        }
    }

    // ── Tick ──────────────────────────────────────────────────────

    tick(dt: number, enemyTowers: (DefenseTower | null)[]): void {
        if (this._destroyed) return;
        this._updateUIPositions();

        // Büyüme aşaması
        if (!this._mature) {
            this._growTimer += dt;
            if (this._growTimer >= GROW_PHASE_DURATION && this._stage < 3) {
                this._stage = (this._stage + 1) as GrowthStage;
                this._growTimer = 0;
                void this._loadModel(this._stage);
                this._updateStageLabel();

                if (this._stage === 3) {
                    this._mature = true;
                }
            }
            return; // büyürken saldırmaz
        }

        // Ömür sayacı
        this._lifeTimer += dt;
        if (this._lifeTimer >= LIFESPAN) {
            this.dispose();
            return;
        }

        // Hedef var mı kontrol (FX yönetimi)
        const hasTarget = enemyTowers.some(t => t && !t.isDestroyed && Vector3.Distance(this.position, t.position) <= ATTACK_RANGE);
        if (hasTarget) {
            this._startAttackFX();
        } else {
            this._stopAttackFX();
        }

        // Saldırı
        this._attackTimer += dt;
        if (this._attackTimer >= ATTACK_CD) {
            this._attackTimer = 0;
            this._attackNearestTower(enemyTowers);
        }
    }

    private _attackNearestTower(towers: (DefenseTower | null)[]): void {
        let nearest: DefenseTower | null = null;
        let nearestDist = Infinity;

        for (const t of towers) {
            if (!t || t.isDestroyed) continue;
            const d = Vector3.Distance(this.position, t.position);
            if (d < nearestDist && d <= ATTACK_RANGE) {
                nearest = t;
                nearestDist = d;
            }
        }

        if (!nearest) return;

        const damage = Math.ceil(nearest.maxHp * DAMAGE_PER_HIT);
        nearest.takeDamage(damage);
    }

    /** Çiçek üstünde sprite sheet animasyonu (8x8 grid, 100x100 frame) */
    private _fxEl: HTMLElement | null = null;
    private _fxRAF: number | null = null;

    private _startAttackFX(): void {
        if (this._fxEl) return; // zaten oynatılıyor

        const pos = this._project(new Vector3(this.position.x, this.position.y + 2.5, this.position.z));
        if (!pos) return;

        const fxSrc = this.team === 'fire'
            ? 'assets/game%20asset/cicekler/alazcicekatak.png'
            : 'assets/game%20asset/cicekler/ayazcicekatack.png';

        const el = document.createElement('div');
        el.style.cssText = `
            position:fixed; pointer-events:none; z-index:140;
            width:100px; height:100px;
            left:${pos.x}px; top:${pos.y}px;
            transform:translate(-50%,-100%);
            background: url('${fxSrc}') no-repeat;
            background-size: 800% 800%;
            image-rendering: pixelated;
        `;
        document.body.appendChild(el);
        this._fxEl = el;

        // 61 frame animasyonu (8x8 grid, son satır 5 frame)
        let frame = 0;
        const totalFrames = 61;
        const fps = 20;
        let lastTime = performance.now();

        const animate = (now: number) => {
            if (!this._fxEl || this._destroyed) { this._stopAttackFX(); return; }
            if (now - lastTime >= 1000 / fps) {
                lastTime = now;
                const col = frame % 8;
                const row = Math.floor(frame / 8);
                this._fxEl.style.backgroundPosition = `${-col * 100}% ${-row * 100}%`;
                // Yeni pozisyon
                const p = this._project(new Vector3(this.position.x, this.position.y + 2.5, this.position.z));
                if (p) {
                    this._fxEl.style.left = p.x + 'px';
                    this._fxEl.style.top = p.y + 'px';
                }
                frame++;
                if (frame >= totalFrames) frame = 0; // loop
            }
            this._fxRAF = requestAnimationFrame(animate);
        };
        this._fxRAF = requestAnimationFrame(animate);
    }

    private _stopAttackFX(): void {
        if (this._fxRAF) { cancelAnimationFrame(this._fxRAF); this._fxRAF = null; }
        this._fxEl?.remove();
        this._fxEl = null;
    }

    // ── UI ──────────────────────────────────────────────────────

    private _createUI(): void {
        const wrap = document.createElement('div');
        wrap.className = 'flower-status-wrap';
        wrap.style.cssText = `
            position:fixed; display:flex; flex-direction:column; align-items:center;
            gap:2px; z-index:170; pointer-events:none;
        `;

        const label = document.createElement('span');
        label.style.cssText = `
            font:bold 10px monospace; padding:1px 6px; border-radius:3px;
            background:rgba(0,0,0,0.6);
            color:${this.team === 'fire' ? '#ff9944' : '#66bbff'};
        `;
        const icon = this.team === 'fire' ? '🌺' : '❄';
        label.textContent = `${icon} ${t('flowerPhase' as any)} 1/3`;

        const bar = document.createElement('div');
        bar.style.cssText = `
            width:50px; height:3px; border-radius:2px; overflow:hidden;
            background:rgba(0,0,0,0.5);
        `;
        const fill = document.createElement('div');
        fill.className = 'flower-life-fill';
        fill.style.cssText = `
            width:100%; height:100%;
            background:${this.team === 'fire' ? 'linear-gradient(90deg,#ff6600,#ffaa00)' : 'linear-gradient(90deg,#0066ff,#66ccff)'};
            transition: width 0.5s;
        `;
        bar.appendChild(fill);

        wrap.appendChild(label);
        wrap.appendChild(bar);
        document.body.appendChild(wrap);
        this._hpWrap = wrap;
        this._stageLabel = label;
    }

    private _updateStageLabel(): void {
        if (!this._stageLabel) return;
        const icon = this.team === 'fire' ? '🌺' : '❄';
        if (this._mature) {
            this._stageLabel.textContent = `${icon} ${t('flowerMature' as any)}`;
        } else {
            this._stageLabel.textContent = `${icon} ${t('flowerPhase' as any)} ${this._stage}/3`;
        }
    }

    private _updateUIPositions(): void {
        if (!this._hpWrap) return;
        const s = this._project(new Vector3(this.position.x, this.position.y + 3, this.position.z));
        if (!s) { this._hpWrap.style.display = 'none'; return; }
        this._hpWrap.style.display = 'flex';
        this._hpWrap.style.left = `${s.x - 25}px`;
        this._hpWrap.style.top = `${s.y}px`;

        // Ömür barı güncelle
        const fill = this._hpWrap.querySelector<HTMLElement>('.flower-life-fill');
        if (fill && this._mature) {
            const ratio = Math.max(0, 1 - this._lifeTimer / LIFESPAN);
            fill.style.width = `${ratio * 100}%`;
        }
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

    // ── Public ──────────────────────────────────────────────────

    get isDestroyed(): boolean { return this._destroyed; }

    dispose(): void {
        if (this._destroyed) return;
        this._destroyed = true;
        this._stopAttackFX();
        this._root?.dispose();
        this._hpWrap?.remove();
        this._hpWrap = null;
        this._stageLabel = null;
    }
}
