/**
 * inputSystem.ts — Pointer input: left-click raycasts to ground meshes
 * and tells the MovementSystem where to go.
 *
 * Babylon 7 tree-shakes aggressively — we must import the Ray and
 * picking modules as side-effects or scene.pick() silently fails.
 */
import { Scene } from '@babylonjs/core/scene';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Culling/ray';           // side-effect: enables Ray
import '@babylonjs/core/Collisions/pickingInfo'; // side-effect: enables pick results
import { MovementSystem } from './movementSystem';

export class InputSystem {
    constructor(
        scene: Scene,
        walkableMeshes: Mesh[],
        movement: MovementSystem,
    ) {
        scene.onPointerObservable.add((info) => {
            if (info.type !== PointerEventTypes.POINTERDOWN) return;
            if ((info.event as PointerEvent).button !== 0) return; // left only

            const pick = scene.pick(
                scene.pointerX,
                scene.pointerY,
                (m) => walkableMeshes.includes(m as Mesh),
            );

            if (pick?.hit && pick.pickedPoint) {
                movement.setTarget(pick.pickedPoint);
            }
        });
    }
}
