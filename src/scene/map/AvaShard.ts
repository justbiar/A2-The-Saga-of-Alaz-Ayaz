/**
 * AvaShard.ts — Three Ava Shard crystals on the map.
 * Each shard can be captured by the team with the most units nearby.
 * Capturing grants ShardBonus to that team.
 */
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Unit } from '../../ecs/Unit';
import type { ShardBonus } from '../../ecs/types';

export type ShardOwner = 'fire' | 'ice' | 'neutral';

interface ShardData {
    mesh: Mesh;
    indicator: Mesh;    // capture progress ring
    position: Vector3;
    owner: ShardOwner;
    captureProgress: number;  // 0-1 toward next capture
    captureTimer: number;     // seconds held by current captor
    lane: 'left' | 'mid' | 'right';
}

// Shard positions (edge-following lane X values at equator, Y=1, Z=0)
const SHARD_POSITIONS: { lane: 'left' | 'mid' | 'right'; x: number; z: number }[] = [
    { lane: 'left',  x: -29, z: 0 },
    { lane: 'mid',   x:   0, z: 0 },
    { lane: 'right', x:  29, z: 0 },
];

const CAPTURE_RANGE = 8;         // units within this range contribute
const CAPTURE_RATE = 0.04;       // capture progress per second per unit advantage
const CAPTURE_BONUS_THRESHOLD = 60;  // seconds to trigger timeout win

const LANE_COLORS: Record<ShardOwner, Color3> = {
    neutral: new Color3(0.5, 0.5, 0.5),
    fire:    new Color3(1.0, 0.4, 0.0),
    ice:     new Color3(0.2, 0.6, 1.0),
};

export class AvaShardManager {
    private readonly shards: ShardData[] = [];
    private readonly scene: Scene;
    // Accumulated held time per team (for timeout win condition)
    public fireHoldTime = 0;   // seconds all 3 shards held by fire
    public iceHoldTime = 0;

    constructor(scene: Scene) {
        this.scene = scene;
        this.createShards();
    }

    private createShards(): void {
        for (const { lane, x, z } of SHARD_POSITIONS) {
            const pos = new Vector3(x, 1, z);

            // Crystal mesh (diamond shape)
            const crystal = MeshBuilder.CreatePolyhedron(
                `shard_${lane}`,
                { type: 1, size: 1.2 },   // type 1 = octahedron
                this.scene,
            );
            crystal.position = pos.clone();
            crystal.rotation.y = Math.PI / 4;
            const mat = new StandardMaterial(`shardMat_${lane}`, this.scene);
            mat.diffuseColor = LANE_COLORS.neutral.clone();
            mat.emissiveColor = LANE_COLORS.neutral.scale(0.4);
            mat.alpha = 0.85;
            crystal.material = mat;

            // Capture progress ring (görsel olarak gizli — mekanik aktif)
            const ring = MeshBuilder.CreateTorus(
                `shardRing_${lane}`,
                { diameter: 4, thickness: 0.25, tessellation: 32 },
                this.scene,
            );
            ring.position = pos.clone();
            ring.rotation.x = Math.PI / 2;
            const ringMat = new StandardMaterial(`shardRingMat_${lane}`, this.scene);
            ringMat.diffuseColor = LANE_COLORS.neutral.clone();
            ringMat.emissiveColor = LANE_COLORS.neutral.scale(0.3);
            ringMat.alpha = 0.5;
            ring.material = ringMat;
            ring.isVisible = false;

            this.shards.push({
                mesh: crystal,
                indicator: ring,
                position: pos,
                owner: 'neutral',
                captureProgress: 0,
                captureTimer: 0,
                lane,
            });
        }
    }

    /**
     * Called every frame. Checks unit proximity and updates capture state.
     */
    update(dt: number, units: Unit[]): void {
        const alive = units.filter(u => u.state !== 'dead');

        let allFire = true;
        let allIce = true;

        for (const shard of this.shards) {
            this.updateShard(shard, dt, alive);
            if (shard.owner !== 'fire') allFire = false;
            if (shard.owner !== 'ice') allIce = false;
        }

        // Track timeout win condition
        if (allFire) this.fireHoldTime += dt;
        else this.fireHoldTime = 0;

        if (allIce) this.iceHoldTime += dt;
        else this.iceHoldTime = 0;
    }

    private updateShard(shard: ShardData, dt: number, alive: Unit[]): void {
        // Count nearby units per team
        let fireNear = 0;
        let iceNear = 0;
        for (const unit of alive) {
            const dx = unit.mesh.position.x - shard.position.x;
            const dz = unit.mesh.position.z - shard.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < CAPTURE_RANGE) {
                if (unit.team === 'fire') fireNear++;
                else iceNear++;
            }
        }

        const advantage = fireNear - iceNear;
        if (advantage === 0) return;  // contested or empty — no change

        const captor: 'fire' | 'ice' = advantage > 0 ? 'fire' : 'ice';
        const rate = Math.abs(advantage) * CAPTURE_RATE;

        if (shard.owner === captor) {
            // Already owned — count toward timeout
            shard.captureTimer += dt;
        } else {
            // Contesting
            shard.captureProgress += rate * dt;
            if (shard.captureProgress >= 1) {
                shard.owner = captor;
                shard.captureProgress = 0;
                shard.captureTimer = 0;
                this.updateShardVisual(shard);
            }
        }

        // Animate crystal spin
        shard.mesh.rotation.y += dt * 0.8;

        // Update ring progress (scale arc by captureProgress)
        const ringMat = shard.indicator.material as StandardMaterial;
        const color = LANE_COLORS[captor];
        ringMat.diffuseColor = Color3.Lerp(LANE_COLORS.neutral, color, shard.captureProgress);
        ringMat.emissiveColor = ringMat.diffuseColor.scale(0.4);
    }

    private updateShardVisual(shard: ShardData): void {
        const mat = shard.mesh.material as StandardMaterial;
        const color = LANE_COLORS[shard.owner];
        mat.diffuseColor = color.clone();
        mat.emissiveColor = color.scale(0.5);

        const ringMat = shard.indicator.material as StandardMaterial;
        ringMat.diffuseColor = color.clone();
        ringMat.emissiveColor = color.scale(0.4);
    }

    /**
     * Returns the bonus for a given team based on shards owned.
     */
    getBonus(team: 'fire' | 'ice'): ShardBonus {
        const owned = this.shards.filter(s => s.owner === team).length;
        return {
            manaRegen: owned,          // +1 mana per shard held
            attackBonus: owned * 2,    // +2 attack per shard
            speedBonus: owned * 0.5,   // +0.5 speed per shard
        };
    }

    /**
     * Returns current shard ownership for each lane.
     */
    getShardControl(): { left: ShardOwner; mid: ShardOwner; right: ShardOwner } {
        const ctrl = { left: 'neutral' as ShardOwner, mid: 'neutral' as ShardOwner, right: 'neutral' as ShardOwner };
        for (const s of this.shards) ctrl[s.lane] = s.owner;
        return ctrl;
    }

    /** True if timeout win condition met (all 3 shards held for CAPTURE_BONUS_THRESHOLD sec) */
    get fireTimeoutWin(): boolean { return this.fireHoldTime >= CAPTURE_BONUS_THRESHOLD; }
    get iceTimeoutWin(): boolean  { return this.iceHoldTime >= CAPTURE_BONUS_THRESHOLD; }
}
