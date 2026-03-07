/**
 * BaseBuilding.ts — Fire/Ice base buildings with HP and attack range.
 * Each base attacks nearby enemies and can be destroyed (win condition).
 */
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
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

    private readonly mesh: Mesh;
    private readonly hpBarBg: Mesh;
    private readonly hpBarFill: Mesh;
    private lastAttackTime = 0;
    private gameTime = 0;
    private destroyed = false;

    constructor(scene: Scene, team: Team) {
        this.team = team;
        // Fire base at Z=-42, Ice base at Z=+42 (beyond the map edge)
        this.position = team === 'fire'
            ? new Vector3(0, 0, -42)
            : new Vector3(0, 0, 42);

        this.mesh = this.buildMesh(scene, team);
        const { bg, fill } = this.buildHpBar(scene, team);
        this.hpBarBg = bg;
        this.hpBarFill = fill;
    }

    private buildMesh(scene: Scene, team: Team): Mesh {
        const root = new Mesh(`base_${team}`, scene);
        root.position = this.position.clone();

        const isfire = team === 'fire';
        const col = isfire ? new Color3(0.8, 0.2, 0.0) : new Color3(0.1, 0.3, 0.9);

        // Main tower
        const tower = MeshBuilder.CreateCylinder(
            `baseTower_${team}`,
            { diameterTop: 3.5, diameterBottom: 5, height: 8, tessellation: 6 },
            scene,
        );
        tower.parent = root;
        tower.position = new Vector3(0, 4, 0);
        const tMat = new StandardMaterial(`baseTowerMat_${team}`, scene);
        tMat.diffuseColor = col;
        tMat.emissiveColor = col.scale(0.3);
        tower.material = tMat;

        // Battlements
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const merlon = MeshBuilder.CreateBox(
                `merlon_${team}_${i}`,
                { width: 1, height: 1.5, depth: 1 },
                scene,
            );
            merlon.parent = root;
            merlon.position = new Vector3(
                Math.cos(angle) * 1.8,
                8.75,
                Math.sin(angle) * 1.8,
            );
            merlon.material = tMat;
        }

        // Glowing core (fire/ice crystal on top)
        const core = MeshBuilder.CreatePolyhedron(
            `baseCore_${team}`,
            { type: 1, size: 1.0 },
            scene,
        );
        core.parent = root;
        core.position = new Vector3(0, 10, 0);
        const cMat = new StandardMaterial(`baseCoreMat_${team}`, scene);
        cMat.diffuseColor = col.scale(1.5);
        cMat.emissiveColor = col.scale(0.8);
        cMat.alpha = 0.9;
        core.material = cMat;

        return root;
    }

    private buildHpBar(scene: Scene, team: Team): { bg: Mesh; fill: Mesh } {
        const isfire = team === 'fire';
        const label = isfire ? 'ATEŞ' : 'BUZ';
        void label; // used in DOM, not in 3D

        const bg = MeshBuilder.CreatePlane(`baseHpBg_${team}`, { width: 7, height: 0.5 }, scene);
        bg.position = this.position.clone();
        bg.position.y = 12;
        bg.billboardMode = Mesh.BILLBOARDMODE_ALL;
        const bgMat = new StandardMaterial(`baseHpBgMat_${team}`, scene);
        bgMat.diffuseColor = new Color3(0.1, 0.1, 0.1);
        bgMat.emissiveColor = new Color3(0.05, 0.05, 0.05);
        bgMat.backFaceCulling = false;
        bg.material = bgMat;

        const fill = MeshBuilder.CreatePlane(`baseHpFill_${team}`, { width: 6.5, height: 0.36 }, scene);
        fill.position = this.position.clone();
        fill.position.y = 12;
        fill.position.z += 0.01 * (isfire ? 1 : -1);
        fill.billboardMode = Mesh.BILLBOARDMODE_ALL;
        const fillMat = new StandardMaterial(`baseHpFillMat_${team}`, scene);
        const barColor = isfire ? new Color3(0.9, 0.3, 0.0) : new Color3(0.1, 0.5, 1.0);
        fillMat.diffuseColor = barColor;
        fillMat.emissiveColor = barColor.scale(0.4);
        fillMat.backFaceCulling = false;
        fill.material = fillMat;

        return { bg, fill };
    }

    /**
     * Called every frame. Attacks nearby enemies and updates HP bar.
     */
    update(dt: number, units: Unit[]): void {
        if (this.destroyed) return;
        this.gameTime += dt;

        // Attack closest enemy in range
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

        this.updateHpBar();
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
        // Turn mesh dark
        this.mesh.getChildMeshes().forEach(m => {
            if (m.material instanceof StandardMaterial) {
                m.material.diffuseColor = new Color3(0.2, 0.05, 0.05);
                m.material.emissiveColor = new Color3(0.05, 0.01, 0.01);
            }
        });
        this.hpBarBg.setEnabled(false);
        this.hpBarFill.setEnabled(false);
    }

    private updateHpBar(): void {
        const ratio = Math.max(0, this.hp / this.maxHp);
        this.hpBarFill.scaling.x = ratio;
        // Shift left edge so bar shrinks from the right
        this.hpBarFill.position.x = -(1 - ratio) * 3.25;
    }

    /** HP ratio 0-1 for DOM display */
    get hpRatio(): number {
        return this.hp / this.maxHp;
    }
}
