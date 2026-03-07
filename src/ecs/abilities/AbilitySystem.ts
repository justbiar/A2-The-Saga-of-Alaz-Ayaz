/**
 * AbilitySystem.ts — Passive ability ticking and trigger checks.
 * Active abilities are triggered by Prompt Cards in main.ts.
 */
import type { Unit } from '../Unit';
import type { StatusEffect } from '../types';

// ─── ABILITY DEFINITION ───────────────────────────────────────────────

export type AbilityTrigger = 'passive' | 'on_attack' | 'on_hit' | 'on_kill' | 'on_deploy';

export interface AbilityDef {
    id: string;
    name: string;
    trigger: AbilityTrigger;
    /** Called every frame for passive abilities */
    onTick?: (unit: Unit, dt: number) => void;
    /** Called when unit attacks */
    onAttack?: (attacker: Unit, target: Unit) => void;
    /** Called when unit takes a hit */
    onHit?: (unit: Unit, attacker: Unit, damage: number) => number;  // returns modified damage
    /** Called when unit kills an enemy */
    onKill?: (unit: Unit, killed: Unit) => void;
    /** Called when unit is first deployed */
    onDeploy?: (unit: Unit) => void;
}

// ─── ABILITY REGISTRY ─────────────────────────────────────────────────

const registry = new Map<string, AbilityDef>();

export function registerAbility(def: AbilityDef): void {
    registry.set(def.id, def);
}

export function getAbility(id: string): AbilityDef | undefined {
    return registry.get(id);
}

// ─── SYSTEM FUNCTIONS ─────────────────────────────────────────────────

/**
 * Tick all passive abilities for a unit.
 * Called every frame from UnitManager.update().
 */
export function tickPassives(unit: Unit, dt: number): void {
    if (!unit.abilityState) return;

    const abilityId = (unit as any)._abilityId as string | undefined;
    if (!abilityId) return;

    const ability = registry.get(abilityId);
    if (ability?.trigger === 'passive' && ability.onTick) {
        ability.onTick(unit, dt);
    }
}

/**
 * Tick status effects on a unit (DoTs, duration reduction, etc.)
 * Returns total DoT damage dealt this frame.
 */
export function tickStatusEffects(unit: Unit, dt: number): number {
    if (!unit.statusEffects || unit.statusEffects.length === 0) return 0;

    let totalDamage = 0;

    for (let i = unit.statusEffects.length - 1; i >= 0; i--) {
        const effect = unit.statusEffects[i];
        effect.duration -= dt;

        switch (effect.type) {
            case 'burning':
                totalDamage += effect.magnitude * dt;
                break;
            case 'poisoned':
                totalDamage += effect.magnitude * dt;
                break;
            case 'frozen':
                // Applied via speed reduction in UnitManager
                break;
            case 'stunned':
                // Handled by state check in UnitManager
                break;
        }

        if (effect.duration <= 0) {
            unit.statusEffects.splice(i, 1);
        }
    }

    return totalDamage;
}

/**
 * Apply a status effect to a unit (deduplicates by type, refreshes duration).
 */
export function applyStatusEffect(unit: Unit, effect: StatusEffect): void {
    const existing = unit.statusEffects.findIndex(e => e.type === effect.type);
    if (existing >= 0) {
        // Refresh duration if new effect is longer
        if (effect.duration > unit.statusEffects[existing].duration) {
            unit.statusEffects[existing].duration = effect.duration;
            unit.statusEffects[existing].magnitude = effect.magnitude;
        }
    } else {
        unit.statusEffects.push({ ...effect });
    }
}

/**
 * Check if a unit has a specific status effect.
 */
export function hasStatus(unit: Unit, type: string): boolean {
    return unit.statusEffects.some(e => e.type === type);
}

/**
 * Fire on-attack callbacks for an attacker hitting a target.
 */
export function checkAbilityTrigger(
    trigger: AbilityTrigger,
    unit: Unit,
    other?: Unit,
    damage?: number,
): number {
    const abilityId = (unit as any)._abilityId as string | undefined;
    if (!abilityId) return damage ?? 0;

    const ability = registry.get(abilityId);
    if (!ability) return damage ?? 0;

    if (trigger === 'on_attack' && ability.onAttack && other) {
        ability.onAttack(unit, other);
    }
    if (trigger === 'on_hit' && ability.onHit && other) {
        return ability.onHit(unit, other, damage ?? 0);
    }
    if (trigger === 'on_kill' && ability.onKill && other) {
        ability.onKill(unit, other);
    }
    if (trigger === 'on_deploy' && ability.onDeploy) {
        ability.onDeploy(unit);
    }
    return damage ?? 0;
}
