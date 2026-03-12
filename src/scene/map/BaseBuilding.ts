/**
 * BaseBuilding.ts — Fire/Ice base buildings with HP and attack range.
 * Each base attacks nearby enemies and can be destroyed (win condition).
 * Uses GLB models: "alev-base.glb" for fire, "ayaz-base.glb" for ice.
 */
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import type { Unit, Team } from '../../ecs/Unit';

const BASE_MAX_HP = 1000;
const BASE_ATTACK_RANGE = 12;
const BASE_ATTACK_DAMAGE = 15;
const BASE_ATTACK_COOLDOWN = 2.0; // seconds

export class BaseBuilding {
    public hp = BASE_MAX_HP;
    public readonly maxHp = BASE_MAX_HP;
    public readonly team: Team;
    public readonly position: Vector3;

    private root: Mesh;
    private glbMeshes: AbstractMesh[] = [];
    private lastAttackTime = 0;
    private gameTime = 0;
    private destroyed = false;

    constructor(scene: Scene, team: Team) {
        this.team = team;
        this.position = team === 'fire'
            ? new Vector3(0, 0, -40)
            : new Vector3(0, 0, 40);

        this.root = new Mesh(`base_${team}`, scene);
        this.root.position = this.position.clone();

        this.loadModel(scene, team);
    }

    private async loadModel(scene: Scene, team: Team): Promise<void> {
        const glbFile = team === 'fire' ? 'alev-base.glb' : 'ayaz-base.glb';
        console.log(`[BaseBuilding] Loading GLB: assets/base/${glbFile} for ${team}`);
        try {
            const result = await SceneLoader.ImportMeshAsync(
                '',
                'assets/base/',
                glbFile,
                scene,
            );
            console.log(`[BaseBuilding] GLB loaded for ${team}, meshes:`, result.meshes.length);

            const scaleFactor = 5;
            for (const mesh of result.meshes) {
                if (!mesh.parent) {
                    mesh.parent = this.root;
                }
            }
            const glbRoot = result.meshes[0];
            glbRoot.scaling.set(scaleFactor, scaleFactor, scaleFactor);
            glbRoot.position.y = 2.5;
            // Fire base kapısını öne çevir
            if (team === 'fire') {
                glbRoot.scaling.z = -glbRoot.scaling.z;
            }

            this.glbMeshes = result.meshes as AbstractMesh[];
        } catch (err) {
            console.warn(`[BaseBuilding] GLB yüklenemedi (${glbFile})`, err);
        }
    }

    update(dt: number, units: Unit[]): void {
        if (this.destroyed) return;
        this.gameTime += dt;

        if (this.gameTime - this.lastAttackTime >= BASE_ATTACK_COOLDOWN) {
            const alive = units.filter(u => u.state !== 'dead');
            const enemies = alive.filter(u => u.team !== this.team);
            let nearest: Unit | null = null;
            let nearestDist = Infinity;

            for (const e of enemies) {
                const dx = e.mesh.position.x - this.position.x;
                const dz = e.mesh.position.z - this.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < BASE_ATTACK_RANGE && dist < nearestDist) {
                    nearest = e;
                    nearestDist = dist;
                }
            }

            if (nearest) {
                this.lastAttackTime = this.gameTime;
                nearest.hp -= BASE_ATTACK_DAMAGE;
            }
        }

    }

    takeDamage(amount: number): void {
        if (this.destroyed) return;
        this.hp = Math.max(0, this.hp - amount);
        if (this.hp === 0) this.onDestroyed();
    }

    isDestroyed(): boolean {
        return this.destroyed;
    }

    private onDestroyed(): void {
        this.destroyed = true;
        const allMeshes = this.glbMeshes.length > 0
            ? this.glbMeshes
            : this.root.getChildMeshes();
        allMeshes.forEach(m => {
            if (m.material && m.material instanceof StandardMaterial) {
                m.material.diffuseColor = new Color3(0.2, 0.05, 0.05);
                m.material.emissiveColor = new Color3(0.05, 0.01, 0.01);
            }
        });
    }

    get hpRatio(): number {
        return this.hp / this.maxHp;
    }
}
