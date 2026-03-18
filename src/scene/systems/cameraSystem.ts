/**
 * cameraSystem.ts — ArcRotateCamera + Free Camera (noclip/ghost mode).
 *
 * Normal mod:
 *   Left drag   → Orbit
 *   Right drag  → Pan
 *   Scroll      → Zoom
 *   WASD/Arrows → Pan
 *   Space       → Hero'ya dön
 *
 * Ghost mod (G tuşu):
 *   WASD        → İleri/geri/sağ/sol uçuş
 *   Mouse       → Bakış yönü
 *   Space/Shift → Yukarı/Aşağı
 *   Scroll      → Hız ayarı
 *   G           → Normal moda dön
 */
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { KeyboardEventTypes } from '@babylonjs/core/Events/keyboardEvents';

export class CameraSystem {
    private readonly camera: ArcRotateCamera;
    private readonly target: Mesh;
    private readonly scene: Scene;
    private readonly canvas: HTMLCanvasElement;

    // Pan offset applied on top of hero position
    private panX = 0;
    private panZ = 0;

    // Keyboard state
    private keys: Record<string, boolean> = {};
    private readonly PAN_SPEED = 0.4;

    // ── Ghost (free) camera ──
    private _freeCam: UniversalCamera | null = null;
    private _ghostMode = false;
    private _ghostSpeed = 1.2;
    private _ghostLabel: HTMLElement | null = null;
    private _wheelHandler: ((e: WheelEvent) => void) | null = null;

    constructor(scene: Scene, target: Mesh, canvas: HTMLCanvasElement) {
        this.target = target;
        this.scene = scene;
        this.canvas = canvas;

        // ArcRotateCamera: alpha = yaw, beta = pitch, radius = zoom
        this.camera = new ArcRotateCamera(
            'arcCam',
            -Math.PI / 2,   // alpha: harita tam önden — ateş yakın, buz uzak
            Math.PI / 3,    // beta ~60° — haritanın tamamı görünür
            120,            // radius — diamond Z=-48→+48 toplam 96 ünite, daha geniş açı
            new Vector3(0, 0, 0), // target: harita merkezi
            scene,
        );

        this.camera.lowerRadiusLimit = 12;
        this.camera.upperRadiusLimit = 160;
        this.camera.lowerBetaLimit = 0.15;
        this.camera.upperBetaLimit = Math.PI / 2.05;
        this.camera.wheelDeltaPercentage = 0.05;
        this.camera.minZ = 2;
        this.camera.maxZ = 300;

        scene.activeCamera = this.camera;

        // Full mouse controls: left=orbit, right=pan, scroll=zoom
        this.camera.attachControl(canvas, true);

        // ── Keyboard ──
        scene.onKeyboardObservable.add(info => {
            const key = info.event.code;
            if (info.type === KeyboardEventTypes.KEYDOWN) {
                this.keys[key] = true;
                if (key === 'Space' && !this._ghostMode) { this.panX = 0; this.panZ = 0; }
                if (key === 'KeyG') this._toggleGhostMode();
            }
            if (info.type === KeyboardEventTypes.KEYUP) {
                this.keys[key] = false;
            }
        });
    }

    // ── Ghost mode toggle ────────────────────────────────────────────

    private _toggleGhostMode(): void {
        if (this._ghostMode) {
            this._exitGhostMode();
        } else {
            this._enterGhostMode();
        }
    }

    private _enterGhostMode(): void {
        this._ghostMode = true;

        // ArcRotate'in baktığı noktadan başla
        const arcPos = this.camera.position.clone();

        // ArcRotate kontrollerini kapat
        this.camera.detachControl();

        // Free camera oluştur
        const freeCam = new UniversalCamera('ghostCam', arcPos, this.scene);
        freeCam.minZ = 0.5;
        freeCam.maxZ = 500;
        freeCam.fov = 1.0;

        // ArcRotate'in baktığı yöne doğru bak
        const lookTarget = this.camera.target.clone();
        freeCam.setTarget(lookTarget);

        // Mouse look: pointer lock
        freeCam.attachControl(this.canvas, true);
        freeCam.inputs.clear();
        freeCam.angularSensibility = 400;
        freeCam.inertia = 0;

        // Mouse ile bakış (pointer lock olmadan)
        let isDragging = false;
        let lastX = 0, lastY = 0;
        const sensitivity = 0.003;

        const onDown = (e: PointerEvent) => {
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
        };
        const onMove = (e: PointerEvent) => {
            if (!isDragging) return;
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
            freeCam.rotation.y += dx * sensitivity;
            freeCam.rotation.x += dy * sensitivity;
            // Pitch clamp
            freeCam.rotation.x = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, freeCam.rotation.x));
        };
        const onUp = () => { isDragging = false; };

        this.canvas.addEventListener('pointerdown', onDown);
        this.canvas.addEventListener('pointermove', onMove);
        this.canvas.addEventListener('pointerup', onUp);
        this.canvas.addEventListener('pointerleave', onUp);

        // Scroll → hız ayarı
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            this._ghostSpeed = Math.max(0.2, Math.min(8, this._ghostSpeed - e.deltaY * 0.002));
            this._updateGhostLabel();
        };
        this.canvas.addEventListener('wheel', onWheel, { passive: false });
        this._wheelHandler = onWheel;

        // Cleanup refs — store on cam for removal
        (freeCam as any)._ghostListeners = { onDown, onMove, onUp, onWheel };

        this._freeCam = freeCam;
        this.scene.activeCamera = freeCam;

        // UI label
        this._showGhostLabel();
    }

    private _exitGhostMode(): void {
        this._ghostMode = false;

        if (this._freeCam) {
            // Listener cleanup
            const listeners = (this._freeCam as any)._ghostListeners;
            if (listeners) {
                this.canvas.removeEventListener('pointerdown', listeners.onDown);
                this.canvas.removeEventListener('pointermove', listeners.onMove);
                this.canvas.removeEventListener('pointerup', listeners.onUp);
                this.canvas.removeEventListener('pointerleave', listeners.onUp);
            }
            if (this._wheelHandler) {
                this.canvas.removeEventListener('wheel', this._wheelHandler);
                this._wheelHandler = null;
            }
            this._freeCam.detachControl();
            this._freeCam.dispose();
            this._freeCam = null;
        }

        // ArcRotate geri
        this.scene.activeCamera = this.camera;
        this.camera.attachControl(this.canvas, true);

        // Ghost label kaldır
        this._ghostLabel?.remove();
        this._ghostLabel = null;
    }

    private _showGhostLabel(): void {
        if (this._ghostLabel) return;
        const el = document.createElement('div');
        el.id = 'ghost-cam-label';
        el.style.cssText = `
            position:fixed; top:12px; left:50%; transform:translateX(-50%);
            background:rgba(0,0,0,0.75); color:#0f0; padding:6px 18px;
            border-radius:6px; font:bold 14px monospace; z-index:9999;
            pointer-events:none; letter-spacing:1px;
        `;
        this._updateGhostLabelText(el);
        document.body.appendChild(el);
        this._ghostLabel = el;
    }

    private _updateGhostLabel(): void {
        if (this._ghostLabel) this._updateGhostLabelText(this._ghostLabel);
    }

    private _updateGhostLabelText(el: HTMLElement): void {
        el.textContent = `GHOST CAM [G çık] | Hız: ${this._ghostSpeed.toFixed(1)}x | Mouse: bakış | Yön tuşları: hareket | Q/E: yukarı/aşağı | Scroll: hız`;
    }

    // ── Ghost camera tick ────────────────────────────────────────────

    private _updateGhostCam(): void {
        const cam = this._freeCam;
        if (!cam) return;

        const spd = this._ghostSpeed;
        const fwd = cam.getDirection(Vector3.Forward()).scale(spd);
        const right = cam.getDirection(Vector3.Right()).scale(spd);
        const up = new Vector3(0, spd, 0);

        if (this.keys['ArrowUp']) cam.position.addInPlace(fwd);
        if (this.keys['ArrowDown']) cam.position.subtractInPlace(fwd);
        if (this.keys['ArrowRight']) cam.position.addInPlace(right);
        if (this.keys['ArrowLeft']) cam.position.subtractInPlace(right);
        if (this.keys['KeyQ']) cam.position.addInPlace(up);
        if (this.keys['KeyE']) cam.position.subtractInPlace(up);
    }

    // ── Public API ───────────────────────────────────────────────────

    get isGhostMode(): boolean { return this._ghostMode; }

    playIntroAnimation(team: 'fire' | 'ice'): Promise<void> {
        return new Promise(resolve => {
            this.panX = 0;
            this.panZ = 0;
            const alpha = team === 'fire' ? -Math.PI / 2 : Math.PI / 2;
            // Tepeden başla (neredeyse tam dikey)
            this.camera.alpha = alpha;
            this.camera.beta = this.camera.upperBetaLimit ?? Math.PI / 2.05;
            this.camera.radius = 80;
            this.camera.target.set(0, 0, 0);

            // 500ms bekle, sonra arkaya eğ
            const startBeta = this.camera.beta;
            const endBeta = Math.PI * 0.40;
            const startRadius = 80;
            const endRadius = 100;
            const delay = 500;
            const duration = 1100;

            const startTime = performance.now() + delay;
            const animate = (now: number) => {
                const elapsed = now - startTime;
                if (elapsed < 0) { requestAnimationFrame(animate); return; }
                const t = Math.min(elapsed / duration, 1);
                const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                this.camera.beta = startBeta + (endBeta - startBeta) * ease;
                this.camera.radius = startRadius + (endRadius - startRadius) * ease;
                if (t < 1) { requestAnimationFrame(animate); } else { resolve(); }
            };
            requestAnimationFrame(animate);
        });
    }

    update(): void {
        // Ghost modda free cam tick
        if (this._ghostMode) {
            this._updateGhostCam();
            return;
        }

        // WASD / Arrow key pan
        const fwd = this.camera.alpha; // use camera yaw to pan relative to view
        const right = fwd + Math.PI / 2;

        if (this.keys['KeyW'] || this.keys['ArrowUp']) {
            this.panX += Math.sin(fwd) * this.PAN_SPEED;
            this.panZ += Math.cos(fwd) * this.PAN_SPEED;
        }
        if (this.keys['KeyS'] || this.keys['ArrowDown']) {
            this.panX -= Math.sin(fwd) * this.PAN_SPEED;
            this.panZ -= Math.cos(fwd) * this.PAN_SPEED;
        }
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
            this.panX -= Math.sin(right) * this.PAN_SPEED;
            this.panZ -= Math.cos(right) * this.PAN_SPEED;
        }
        if (this.keys['KeyD'] || this.keys['ArrowRight']) {
            this.panX += Math.sin(right) * this.PAN_SPEED;
            this.panZ += Math.cos(right) * this.PAN_SPEED;
        }

        // Smooth follow hero + pan
        const heroPos = this.target.position;
        const goalX = heroPos.x + this.panX;
        const goalZ = heroPos.z + this.panZ;
        const goalY = heroPos.y;

        // Lerp target toward goal
        const cam = this.camera;
        cam.target.x += (goalX - cam.target.x) * 0.08;
        cam.target.y += (goalY - cam.target.y) * 0.08;
        cam.target.z += (goalZ - cam.target.z) * 0.08;
    }
}
