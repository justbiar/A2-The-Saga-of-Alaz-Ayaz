/**
 * movementSystem.ts — Moves the hero along a waypoint path.
 *
 * When the player clicks, inputSystem calls setTarget().  This:
 *   1. Finds the closest waypoint to the hero.
 *   2. Finds the closest waypoint to the clicked point.
 *   3. BFS-shortest-paths between them.
 *   4. Appends the exact clicked position as the final goal.
 *
 * Each frame, update() moves the hero toward the next waypoint in the
 * queue, rotating to face the direction of travel.
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { SimpleNavGraph } from '../../pathfinding/SimpleNavGraph';

export class MovementSystem {
    /** Last click target for the debug UI. */
    public targetPosition: Vector3 | null = null;
    /** Current path the hero is following. */
    public activePath: Vector3[] = [];

    private readonly mesh: Mesh;
    private readonly nav: SimpleNavGraph;
    private readonly speed = 8;

    constructor(mesh: Mesh) {
        this.mesh = mesh;
        this.nav = new SimpleNavGraph();
    }

    /** Called by inputSystem when the user clicks a walkable surface. */
    setTarget(worldPos: Vector3): void {
        this.targetPosition = worldPos;

        const heroFlat = new Vector3(this.mesh.position.x, 0, this.mesh.position.z);
        const startIdx = this.nav.closestNode(heroFlat);

        const goalFlat = new Vector3(worldPos.x, 0, worldPos.z);
        const endIdx = this.nav.closestNode(goalFlat);

        const nodePath = this.nav.findPath(startIdx, endIdx);

        // Build the actual movement queue at the hero's current Y height.
        const heroY = this.mesh.position.y;
        this.activePath = nodePath.map(n => new Vector3(n.x, heroY, n.z));
        // Append the exact click point as the final destination.
        this.activePath.push(new Vector3(worldPos.x, heroY, worldPos.z));
    }

    /** Call every frame.  deltaTime is in milliseconds. */
    update(deltaMs: number): void {
        if (this.activePath.length === 0) return;

        const dt = deltaMs / 1000;
        const target = this.activePath[0];
        const dir = target.subtract(this.mesh.position);
        dir.y = 0; // keep movement horizontal
        const dist = dir.length();

        if (dist < 0.25) {
            // Reached this waypoint — pop it.
            this.activePath.shift();
            if (this.activePath.length === 0) {
                this.targetPosition = null;
            }
            return;
        }

        dir.normalize();

        // Rotate toward movement direction
        this.mesh.rotation.y = Math.atan2(dir.x, dir.z);

        // Move
        const step = Math.min(this.speed * dt, dist);
        this.mesh.position.addInPlace(dir.scale(step));
    }
}
