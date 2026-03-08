/**
 * CharacterViewer.ts
 * Renders a GLB character model with walk animation on a transparent canvas
 * for the character select screen.
 */
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import '@babylonjs/loaders/glTF';

// ─── GLB file map ──────────────────────────────────────────────────────
// Priority: walk > base file. If neither exists, fall back to PNG.
const GLB_MAP: Record<string, string> = {
    korhan:   '/assets/character animation/korhanwalk.glb',
    erlik:    '/assets/character animation/erlik.glb',
    od:       '/assets/character animation/odwalk.glb',
    ayaz:     '/assets/character animation/ayazwalk.glb',
    tulpar:   '/assets/character animation/tulpar.glb',
    umay:     '/assets/character animation/umaywalk.glb',
    albasti:  '/assets/character animation/albastiwalk.glb',
    tepegoz:  '/assets/character animation/tepegozwalk.glb',
    sahmeran: '/assets/character animation/sahmeranwalk.glb',
};

// Per-character camera adjustments (alpha, beta, radius, target Y)
const CAM_PRESETS: Record<string, { alpha: number; beta: number; radius: number; targetY: number }> = {
    korhan:   { alpha: -Math.PI / 2, beta: 1.2, radius: 4.5, targetY: 1.0 },
    erlik:    { alpha: -Math.PI / 2, beta: 1.2, radius: 4.5, targetY: 1.0 },
    od:       { alpha: -Math.PI / 2, beta: 1.2, radius: 4.5, targetY: 1.0 },
    ayaz:     { alpha: -Math.PI / 2, beta: 1.2, radius: 4.5, targetY: 1.0 },
    tulpar:   { alpha: -Math.PI / 2, beta: 1.1, radius: 6.0, targetY: 1.2 },
    umay:     { alpha: -Math.PI / 2, beta: 1.2, radius: 4.5, targetY: 1.0 },
    albasti:  { alpha: -Math.PI / 2, beta: 1.2, radius: 4.5, targetY: 1.0 },
    tepegoz:  { alpha: -Math.PI / 2, beta: 1.1, radius: 6.5, targetY: 1.5 },
    sahmeran: { alpha: -Math.PI / 2, beta: 1.2, radius: 4.5, targetY: 1.0 },
};

export class CharacterViewer {
    private engine: Engine;
    private scene: Scene | null = null;
    private currentChar: string = '';
    private animGroup: AnimationGroup | null = null;
    private loadingId: number = 0; // cancels stale loads

    constructor(private canvas: HTMLCanvasElement) {
        this.engine = new Engine(canvas, true, {
            alpha: true,
            preserveDrawingBuffer: true,
            stencil: false,
        });
        this.engine.runRenderLoop(() => {
            if (this.scene && this.scene.activeCamera) {
                this.scene.render();
            }
        });
        window.addEventListener('resize', () => this.engine.resize());
    }

    /** Load (or reload) character model. Returns true if 3D loaded successfully. */
    async loadCharacter(charId: string): Promise<boolean> {
        if (this.currentChar === charId) return true;
        this.currentChar = charId;

        const glbPath = GLB_MAP[charId];
        if (!glbPath) return false;

        // Increment load ID so stale promises bail out
        const myId = ++this.loadingId;

        // Dispose old scene
        if (this.scene) {
            this.scene.dispose();
            this.scene = null;
            this.animGroup = null;
        }

        // Build new scene with transparent bg
        const scene = new Scene(this.engine);
        scene.clearColor = new Color4(0, 0, 0, 0);

        // Camera
        const preset = CAM_PRESETS[charId] ?? CAM_PRESETS.korhan;
        const cam = new ArcRotateCamera('cam', preset.alpha, preset.beta, preset.radius, new Vector3(0, preset.targetY, 0), scene);
        cam.lowerRadiusLimit = preset.radius;
        cam.upperRadiusLimit = preset.radius;
        cam.lowerBetaLimit = preset.beta;
        cam.upperBetaLimit = preset.beta;
        // Slow auto-rotate
        cam.useAutoRotationBehavior = true;
        if (cam.autoRotationBehavior) {
            cam.autoRotationBehavior.idleRotationSpeed = 0.3;
        }

        // Lights
        const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
        hemi.intensity = 1.2;
        hemi.diffuse = new Color3(1, 1, 1);
        hemi.groundColor = new Color3(0.3, 0.3, 0.4);

        const dir = new DirectionalLight('dir', new Vector3(-1, -2, -1), scene);
        dir.intensity = 0.6;

        this.scene = scene;

        try {
            const result = await SceneLoader.ImportMeshAsync('', '', glbPath, scene);

            // Bail if a newer load started
            if (myId !== this.loadingId) {
                scene.dispose();
                return false;
            }

            // Auto-scale: fit model in a ~2 unit bounding box
            const meshes = result.meshes.filter(m => m.getTotalVertices() > 0);
            if (meshes.length > 0) {
                let min = new Vector3(Infinity, Infinity, Infinity);
                let max = new Vector3(-Infinity, -Infinity, -Infinity);
                meshes.forEach(m => {
                    const bi = m.getHierarchyBoundingVectors();
                    min = Vector3.Minimize(min, bi.min);
                    max = Vector3.Maximize(max, bi.max);
                });
                const size = max.subtract(min);
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 2.0 / maxDim;
                result.meshes[0].scaling = new Vector3(scale, scale, scale);
                // Center vertically
                const center = min.add(max).scale(0.5 * scale);
                result.meshes[0].position.y = -center.y + preset.targetY * 0.3;
            }

            // Play first animation (walk)
            if (result.animationGroups.length > 0) {
                this.animGroup = result.animationGroups[0];
                this.animGroup.start(true); // loop
            }

            return true;
        } catch (err) {
            console.warn(`[CharacterViewer] GLB load failed for ${charId}:`, err);
            return false;
        }
    }

    /** Show/hide canvas */
    setVisible(visible: boolean): void {
        this.canvas.style.opacity = visible ? '1' : '0';
        this.canvas.style.pointerEvents = visible ? 'none' : 'none';
    }

    dispose(): void {
        this.scene?.dispose();
        this.engine.dispose();
    }
}
