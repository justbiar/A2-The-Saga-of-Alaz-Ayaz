/**
 * AvaShard.ts — Three Ava Shard crystals on the map.
 * Each shard can be captured by the team with the most units nearby.
 * Capturing grants ShardBonus to that team.
 *
 * BÖRÜ MECHANIC: When any unit gets close to a crystal, a spirit wolf (Börü)
 * spawns. 2 out of 3 crystals have a "good spirit" (fights for the triggering team),
 * 1 has a "bad spirit" (fights for the enemy team). Assignment is random per game.
 */
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Unit, Team } from '../../ecs/Unit';
import type { UnitManager } from '../../ecs/UnitManager';
import type { ShardBonus } from '../../ecs/types';
import { GameRandom } from '../../utils/Random';

export type ShardOwner = 'fire' | 'ice' | 'neutral';
export type BoruSpirit = 'good' | 'bad';

export interface BoruSpawnEvent {
    lane: 'left' | 'mid' | 'right';
    spirit: BoruSpirit;
    team: Team;           // which team the börü fights for
    triggerTeam: Team;    // which team triggered it
}

interface ShardData {
    mesh: Mesh;
    indicator: Mesh;    // capture progress ring
    position: Vector3;
    owner: ShardOwner;
    captureProgress: number;  // 0-1 toward next capture
    captureTimer: number;     // seconds held by current captor
    lane: 'left' | 'mid' | 'right';
    boruSpirit: BoruSpirit;   // good or bad spirit assigned to this crystal
    boruTriggered: boolean;   // has the börü already been spawned from this crystal?
}

// Shard positions (edge-following lane X values at equator, Y=1, Z=0)
const SHARD_POSITIONS: { lane: 'left' | 'mid' | 'right'; x: number; z: number }[] = [
    { lane: 'left',  x: -29, z: 0 },
    { lane: 'mid',   x:   0, z: 0 },
    { lane: 'right', x:  29, z: 0 },
];

const CAPTURE_RANGE = 8;         // units within this range contribute
const BORU_TRIGGER_RANGE = 6;    // how close a unit must be to trigger börü
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
    private elapsedTime = 0;   // for hover animation
    // Accumulated held time per team (for timeout win condition)
    public fireHoldTime = 0;   // seconds all 3 shards held by fire
    public iceHoldTime = 0;

    /** Callback — main.ts sets this to handle börü spawns and UI */
    public onBoruSpawn: ((event: BoruSpawnEvent) => void) | null = null;

    /** Reference to UnitManager for spawning börü units */
    private um: UnitManager | null = null;

    constructor(scene: Scene) {
        this.scene = scene;
        this.createShards();
    }

    /** Set UnitManager reference (called from main.ts after both are created) */
    setUnitManager(um: UnitManager): void {
        this.um = um;
    }

    private createShards(): void {
        // Randomly assign spirits: 2 good, 1 bad (seeded shuffle for MP sync)
        const spirits: BoruSpirit[] = ['good', 'good', 'bad'];
        GameRandom.shuffle(spirits);

        for (let idx = 0; idx < SHARD_POSITIONS.length; idx++) {
            const { lane, x, z } = SHARD_POSITIONS[idx];
            const pos = new Vector3(x, 5, z);

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
                boruSpirit: spirits[idx],
                boruTriggered: false,
            });
        }
    }

    /**
     * Called every frame. Checks unit proximity, updates capture state,
     * and triggers börü spawns.
     */
    update(dt: number, units: Unit[]): void {
        const alive = units.filter(u => u.state !== 'dead');

        this.elapsedTime += dt;

        let allFire = true;
        let allIce = true;

        for (let i = 0; i < this.shards.length; i++) {
            const shard = this.shards[i];
            // Gentle hover: float up/down ~0.6 units, each crystal offset so they don't sync
            if (!shard.boruTriggered) {
                shard.mesh.position.y = shard.position.y + Math.sin(this.elapsedTime * 1.5 + i * 2.1) * 0.6;
                shard.indicator.position.y = shard.mesh.position.y;
            }
            this.updateShard(shard, dt, alive);
            this.checkBoruTrigger(shard, alive);
            if (shard.owner !== 'fire') allFire = false;
            if (shard.owner !== 'ice') allIce = false;
        }

        // Track timeout win condition
        if (allFire) this.fireHoldTime += dt;
        else this.fireHoldTime = 0;

        if (allIce) this.iceHoldTime += dt;
        else this.iceHoldTime = 0;
    }

    /**
     * Check if any unit is close enough to trigger a börü spawn from this crystal.
     */
    private checkBoruTrigger(shard: ShardData, alive: Unit[]): void {
        if (shard.boruTriggered) return;  // already spawned
        if (!this.um) return;

        for (const unit of alive) {
            // Don't trigger from other börü units
            if (unit.type === 'boru') continue;

            const dx = unit.mesh.position.x - shard.position.x;
            const dz = unit.mesh.position.z - shard.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < BORU_TRIGGER_RANGE) {
                shard.boruTriggered = true;
                this.spawnBoru(shard, unit.team);
                break;
            }
        }
    }

    /**
     * Spawn a börü unit from a crystal shard.
     * Good spirit → fights for the triggering team.
     * Bad spirit → fights for the enemy team.
     */
    private spawnBoru(shard: ShardData, triggerTeam: Team): void {
        if (!this.um) return;

        const boruTeam: Team = shard.boruSpirit === 'good'
            ? triggerTeam
            : (triggerTeam === 'fire' ? 'ice' : 'fire');

        // Map lane to lane index
        const laneMap = { left: 0, mid: 1, right: 2 };
        const laneIdx = laneMap[shard.lane];

        // Spawn at ground level (same Y as normal units)
        const groundPos = new Vector3(shard.position.x, 0, shard.position.z);
        this.um.spawnUnitAt('boru', boruTeam, groundPos, laneIdx);

        // Crystal visual effect — shatter/glow then disappear
        this.crystalShatterEffect(shard, boruTeam);

        // Notify main.ts for UI
        this.onBoruSpawn?.({
            lane: shard.lane,
            spirit: shard.boruSpirit,
            team: boruTeam,
            triggerTeam,
        });

        console.log(`🐺 Börü spawned at ${shard.lane} crystal — ${shard.boruSpirit} spirit → team ${boruTeam}`);
    }

    /**
     * Crystal shatter visual: glow bright, expand, then disappear.
     */
    private crystalShatterEffect(shard: ShardData, team: Team): void {
        const color = team === 'fire'
            ? new Color3(1.0, 0.5, 0.0)
            : new Color3(0.3, 0.6, 1.0);

        const mat = shard.mesh.material as StandardMaterial;
        mat.emissiveColor = color.scale(3);
        mat.alpha = 1.0;

        let t = 0;
        const id = setInterval(() => {
            t += 16;
            const p = Math.min(t / 600, 1);
            if (shard.mesh.isDisposed()) { clearInterval(id); return; }
            shard.mesh.scaling.setAll(1 + p * 1.5);
            mat.alpha = 1 - p;
            shard.indicator.visibility = 1 - p;
            if (p >= 1) {
                clearInterval(id);
                shard.mesh.isVisible = false;
                shard.indicator.isVisible = false;
            }
        }, 16);
    }

    private updateShard(shard: ShardData, dt: number, alive: Unit[]): void {
        // Skip update for triggered (destroyed) crystals
        if (shard.boruTriggered) return;

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
