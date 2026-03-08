/**
 * types.ts — Shared type definitions for A2 GDD systems.
 * StatusEffects, AI profiles, Kite AI, Prompt Cards, Shard state.
 */

// ─── STATUS EFFECTS ──────────────────────────────────────────────────

export type StatusEffectType =
    | 'frozen'       // slowed, reduced attack speed
    | 'burning'      // DoT fire damage per second
    | 'poisoned'     // DoT nature damage per second
    | 'stunned'      // cannot move or attack
    | 'shielded'     // absorbs incoming damage
    | 'empowered'    // increased attack damage
    | 'slowed';      // movement speed reduced

export interface StatusEffect {
    type: StatusEffectType;
    duration: number;        // remaining seconds
    magnitude: number;       // strength (e.g. slow factor, DoT amount)
    sourceUnitId: number;    // who applied this
}

// ─── AI PROFILES ─────────────────────────────────────────────────────

export type TargetPriority =
    | 'nearest'       // default: closest enemy
    | 'lowest_hp'     // finish off weak targets
    | 'highest_hp'    // focus tanks
    | 'base_focus';   // ignore units, rush enemy base

export type AITraitProfile = 'aggressive' | 'defensive' | 'tactical' | 'adaptive';

export interface AIProfile {
    trait: AITraitProfile;
    targetPriority: TargetPriority;
    retreatThreshold: number;   // HP ratio (0-1) at which unit tries to retreat
    aggressionRadius: number;   // distance at which unit switches to attack mode
}

// ─── KITE AI INTERFACE TYPES ─────────────────────────────────────────

export type KiteActionType =
    | 'deploy'        // spawn a unit
    | 'target_swap'   // change current target
    | 'ability'       // trigger an active ability
    | 'hold';         // do nothing this tick

export interface KiteAction {
    type: KiteActionType;
    unitId?: number;      // target unit for target_swap/ability
    unitType?: string;    // for deploy actions
    abilityId?: string;   // for ability actions
    lane?: number;        // 0=left, 1=mid, 2=right
}

export interface ActionQueue {
    actions: KiteAction[];
    confidence: number;   // 0-1, used for poaiScore calculation
    reasoning?: string;   // optional explanation
}

// ─── BOARD STATE (passed to KiteAI) ──────────────────────────────────

export interface BoardState {
    turn: number;
    playerMana: number;
    enemyMana: number;
    fireUnits: number;
    iceUnits: number;
    shardControl: ShardControl;
    fireBaseHp: number;
    iceBaseHp: number;
    equilibriumScore: number;  // -1 (fire dominant) to +1 (ice dominant)
}

export interface ShardControl {
    left: 'fire' | 'ice' | 'neutral';
    mid: 'fire' | 'ice' | 'neutral';
    right: 'fire' | 'ice' | 'neutral';
}

// ─── SHARD STATE ─────────────────────────────────────────────────────

export interface ShardBonus {
    manaRegen: number;        // extra mana per turn (per shard held)
    attackBonus: number;      // flat attack bonus to all units
    speedBonus: number;       // flat speed bonus to all units
}

// ─── PROMPT CARDS ─────────────────────────────────────────────────────

export type PromptEffectType =
    | 'mana_fill'         // instantly fill mana
    | 'mana_freeze'       // mana doesn't decrease for 5 seconds
    | 'ouroboros'         // convert an enemy unit to fight for you
    | 'autocollect'       // auto-collect AVX coins for 30 seconds
    | 'bancollect';       // block enemy AVX collection for 45 seconds

export interface PromptCardDef {
    id: string;
    name: string;
    description: string;
    manaCost: number;
    effectType: PromptEffectType;
    magnitude: number;
    duration: number;           // seconds
    targetTeam: 'self' | 'enemy' | 'both';
    imagePath: string;
}
