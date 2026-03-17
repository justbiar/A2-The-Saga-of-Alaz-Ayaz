/**
 * cameraSystem.ts — ArcRotateCamera with full orbit, pan & zoom.
 *
 * Controls:
 *   🖱️ Left drag   → Orbit (sağa/sola/yukarı/aşağı döndür)
 *   🖱️ Right drag  → Pan (haritayı sürükle)
 *   🖱️ Scroll      → Zoom
 *   ⌨️ WASD/Arrows → Pan
 *   Space          → Hero'ya dön
 */
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { KeyboardEventTypes } from '@babylonjs/core/Events/keyboardEvents';

export class CameraSystem {
    private readonly camera: ArcRotateCamera;
    private readonly target: Mesh;

    // Pan offset applied on top of hero position
    private panX = 0;
    private panZ = 0;

    // Keyboard state
    private keys: Record<string, boolean> = {};
    private readonly PAN_SPEED = 0.4;

    constructor(scene: Scene, target: Mesh, canvas: HTMLCanvasElement) {
        this.target = target;

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

        // ── Keyboard pan ──────────────────────────────────────────────
        scene.onKeyboardObservable.add(info => {
            const key = info.event.code;
            if (info.type === KeyboardEventTypes.KEYDOWN) {
                this.keys[key] = true;
                // Space → snap back to hero
                if (key === 'Space') { this.panX = 0; this.panZ = 0; }
            }
            if (info.type === KeyboardEventTypes.KEYUP) {
                this.keys[key] = false;
            }
        });
    }

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
