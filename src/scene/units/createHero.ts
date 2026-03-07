/**
 * createHero.ts — Loads the Korhan GLB character model.
 *
 * Falls back to a simple capsule if the GLB fails to load.
 * The returned mesh is the root transform node that movement/camera track.
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
import '@babylonjs/loaders/glTF';  // side-effect: registers GLB/glTF loader

export interface HeroData {
    /** Root mesh used for position/rotation by movement & camera systems. */
    mesh: Mesh;
}

export async function createHero(scene: Scene, sg: ShadowGenerator): Promise<HeroData> {
    // Invisible root mesh — we parent the GLB or fallback under this.
    const root = new Mesh('heroRoot', scene);
    root.position = new Vector3(0, 5, 0);   // harita merkezi (köprü bölgesi)

    try {
        const result = await SceneLoader.ImportMeshAsync(
            '',                                    // names filter (empty = all)
            '/assets/images/gameplay/',            // path
            'korhan.glb',                          // filename
            scene,
        );

        // Parent all loaded meshes under our root
        const loadedRoot = result.meshes[0];
        loadedRoot.parent = root;
        loadedRoot.position = Vector3.Zero();

        // Scale + rotate to face forward
        loadedRoot.scaling = new Vector3(1.5, 1.5, 1.5);
        loadedRoot.rotation = new Vector3(0, Math.PI, 0);

        // Add all meshes to shadow caster
        result.meshes.forEach((m) => {
            if (m instanceof Mesh) {
                sg.addShadowCaster(m);
                m.receiveShadows = true;
            }
        });

        console.log(`✅ Korhan GLB loaded (${result.meshes.length} meshes)`);
    } catch (err) {
        console.warn('⚠️ GLB load failed, using fallback capsule:', err);
        buildFallback(root, scene, sg);
    }

    return { mesh: root };
}

/** Fallback: green capsule with yellow nose. */
function buildFallback(parent: Mesh, scene: Scene, sg: ShadowGenerator): void {
    const body = MeshBuilder.CreateCapsule('heroBody', {
        height: 2.0, radius: 0.5, tessellation: 16, subdivisions: 1,
    }, scene);
    body.parent = parent;
    body.position = new Vector3(0, 1, 0);
    const bm = new StandardMaterial('matHero', scene);
    bm.diffuseColor = new Color3(0.15, 0.75, 0.35);
    body.material = bm;
    sg.addShadowCaster(body);

    const nose = MeshBuilder.CreateBox('heroNose', { size: 0.28 }, scene);
    nose.position = new Vector3(0, 1.4, 0.55);
    nose.parent = parent;
    const nm = new StandardMaterial('matNose', scene);
    nm.diffuseColor = new Color3(1, 0.9, 0.2);
    nm.emissiveColor = new Color3(0.3, 0.25, 0);
    nose.material = nm;
}
