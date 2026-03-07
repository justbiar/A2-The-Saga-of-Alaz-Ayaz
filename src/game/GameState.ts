/**
 * GameState.ts — Pure functions for mana economy, board control, win conditions.
 * No BabylonJS dependencies — purely data-driven logic.
 */
import type { Unit } from '../ecs/Unit';

// ─── MANA ECONOMY ────────────────────────────────────────────────────

/**
 * GDD §1.2 Mana formula: min(12, floor(t/2) + 3)
 * Turn 1→3, Turn 3→4, Turn 5→5, Turn 7→6, Turn 9→7, Turn 11→8, Turn 21→12
 */
export function calcManaGain(turn: number): number {
    return Math.min(12, Math.floor(turn / 2) + 3);
}

/**
 * Mana Pressure Index: how expensive a card is relative to current mana.
 * MPI < 0.5 = efficient, > 0.8 = all-in commitment
 */
export function calcMPI(manaCost: number, turn: number): number {
    const available = calcManaGain(turn);
    return available === 0 ? 1 : manaCost / available;
}

// ─── WIN CONDITIONS ───────────────────────────────────────────────────

export enum WinCondition {
    None = 'none',
    FireDestroysBase = 'fire_destroys_base',
    IceDestroysBase = 'ice_destroys_base',
    FireShardTimeout = 'fire_shard_timeout',
    IceShardTimeout = 'ice_shard_timeout',
    Equilibrium = 'equilibrium',        // all shards held 60s
}

// ─── BOARD CONTROL ────────────────────────────────────────────────────

export interface BoardControl {
    fireScore: number;    // 0-3 based on unit presence in each lane
    iceScore: number;     // 0-3
    equilibrium: number;  // -1 (fire dominant) to +1 (ice dominant)
}

/**
 * Calculate board control from current unit positions.
 * Each lane segment score: more units = more control.
 */
export function calcBoardControl(units: Unit[]): BoardControl {
    const alive = units.filter(u => u.state !== 'dead');
    const fire = alive.filter(u => u.team === 'fire').length;
    const ice = alive.filter(u => u.team === 'ice').length;
    const total = fire + ice;

    if (total === 0) return { fireScore: 0, iceScore: 0, equilibrium: 0 };

    const ratio = (fire - ice) / total;  // -1 to +1
    return {
        fireScore: fire,
        iceScore: ice,
        equilibrium: -ratio,  // negative = fire dominant, positive = ice dominant
    };
}

/**
 * Equilibrium Surge: triggers when one side has > 2x units for 2+ turns.
 * Returns the surge bonus for the weaker side.
 */
export function checkEquilibriumSurge(
    fireUnits: number,
    iceUnits: number,
): { triggered: boolean; beneficiary: 'fire' | 'ice' | null; manaBonus: number } {
    if (fireUnits === 0 && iceUnits === 0) {
        return { triggered: false, beneficiary: null, manaBonus: 0 };
    }

    const dominant = fireUnits > iceUnits * 2
        ? 'ice'   // ice benefits from surge (fire too dominant)
        : iceUnits > fireUnits * 2
            ? 'fire'  // fire benefits from surge (ice too dominant)
            : null;

    if (!dominant) return { triggered: false, beneficiary: null, manaBonus: 0 };

    return {
        triggered: true,
        beneficiary: dominant,
        manaBonus: 2,  // GDD §1.5: surge gives +2 mana to weaker side
    };
}
