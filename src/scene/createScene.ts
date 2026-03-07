/**
 * createScene.ts — Scene, lights, shadows, and atmosphere.
 *
 * We import the shadow-generator scene component as a side-effect;
 * Babylon 7 tree-shakes aggressively and will crash without it.
 */
import { Scene } from '@babylonjs/core/scene';
import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';

export interface SceneBundle {
    scene: Scene;
    shadowGenerator: ShadowGenerator;
}

export function createScene(engine: Engine): SceneBundle {
    const scene = new Scene(engine);
    scene.skipPointerMovePicking = true;
    scene.clearColor = new Color4(0.06, 0.06, 0.10, 1);
    scene.ambientColor = new Color3(0.15, 0.15, 0.18);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.008;
    scene.fogColor = new Color3(0.06, 0.06, 0.10);

    // ── hemisphere (ambient fill) ──
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.45;
    hemi.diffuse = new Color3(0.9, 0.85, 0.8);
    hemi.groundColor = new Color3(0.1, 0.1, 0.15);

    // ── directional sun (shadows) ──
    const sun = new DirectionalLight('sun', new Vector3(-1, -2.5, 1.5), scene);
    sun.position = new Vector3(30, 50, -30);
    sun.intensity = 0.85;
    sun.diffuse = new Color3(1, 0.95, 0.85);

    // ── shadows ──
    const sg = new ShadowGenerator(1024, sun);
    sg.useBlurExponentialShadowMap = true;
    sg.blurKernel = 16;
    sg.darkness = 0.35;

    return { scene, shadowGenerator: sg };
}
