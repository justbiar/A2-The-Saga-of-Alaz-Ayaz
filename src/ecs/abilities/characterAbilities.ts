/**
 * characterAbilities.ts — Registers all 8 character abilities.
 * Called once at game startup to populate the AbilitySystem registry.
 */
import { registerAbility, applyStatusEffect } from './AbilitySystem';
import type { Unit } from '../Unit';

// ─── KORHAN — Iron Armor ──────────────────────────────────────────────
// Passive: Every 3rd hit taken reduces damage by 40%
registerAbility({
    id: 'korhan_iron_armor',
    name: 'Iron Armor',
    trigger: 'on_hit',
    onHit(unit: Unit, _attacker: Unit, damage: number): number {
        const state = unit.abilityState as { hitCount?: number };
        state.hitCount = (state.hitCount ?? 0) + 1;
        if (state.hitCount % 3 === 0) {
            return damage * 0.6;  // 40% damage reduction on every 3rd hit
        }
        return damage;
    },
});

// ─── ERLIK — Dark Flame ───────────────────────────────────────────────
// On-attack: 30% chance to apply Burning (5 dmg/s, 3s)
registerAbility({
    id: 'erlik_dark_flame',
    name: 'Dark Flame',
    trigger: 'on_attack',
    onAttack(attacker: Unit, target: Unit): void {
        if (Math.random() < 0.30) {
            applyStatusEffect(target, {
                type: 'burning',
                duration: 3,
                magnitude: 5,
                sourceUnitId: attacker.id,
            });
        }
    },
});

// ─── AYAZ — Hoarfrost ─────────────────────────────────────────────────
// On-attack: Every 4th attack applies Frozen (slowed 50%, 2s)
registerAbility({
    id: 'ayaz_hoarfrost',
    name: 'Hoarfrost',
    trigger: 'on_attack',
    onAttack(attacker: Unit, target: Unit): void {
        const state = attacker.abilityState as { attackCount?: number };
        state.attackCount = (state.attackCount ?? 0) + 1;
        if (state.attackCount % 4 === 0) {
            applyStatusEffect(target, {
                type: 'frozen',
                duration: 2,
                magnitude: 0.5,  // 50% speed reduction
                sourceUnitId: attacker.id,
            });
        }
    },
});

// ─── UMAY — Mercy ─────────────────────────────────────────────────────
// Passive: Every 5s, heal nearest allied unit for 15 HP
registerAbility({
    id: 'umay_mercy',
    name: 'Mercy',
    trigger: 'passive',
    onTick(unit: Unit, dt: number): void {
        const state = unit.abilityState as { healTimer?: number };
        state.healTimer = (state.healTimer ?? 0) + dt;
        if (state.healTimer >= 5) {
            state.healTimer = 0;
            // Mark that a heal should be applied — UnitManager reads this
            (unit.abilityState as any).pendingHeal = 15;
        }
    },
});

// ─── TULPAR — Charge ──────────────────────────────────────────────────
// On-deploy: First attack deals double damage
registerAbility({
    id: 'tulpar_charge',
    name: 'Charge',
    trigger: 'on_deploy',
    onDeploy(unit: Unit): void {
        (unit.abilityState as any).chargeReady = true;
    },
    onAttack(attacker: Unit, _target: Unit): void {
        const state = attacker.abilityState as { chargeReady?: boolean };
        if (state.chargeReady) {
            state.chargeReady = false;
            // UnitManager reads chargeReady before applying damage
            (attacker.abilityState as any).chargeActive = true;
        }
    },
});

// ─── ŞAHMERAN — Poison ───────────────────────────────────────────────
// On-attack: Always applies Poisoned (8 dmg/s, 4s) — stacks magnitude
registerAbility({
    id: 'sahmeran_poison',
    name: 'Serpent Venom',
    trigger: 'on_attack',
    onAttack(attacker: Unit, target: Unit): void {
        applyStatusEffect(target, {
            type: 'poisoned',
            duration: 4,
            magnitude: 8,
            sourceUnitId: attacker.id,
        });
    },
});

// ─── TEPEGÖZ — Earth Tremor ───────────────────────────────────────────
// Passive: Every 8s, create a shockwave that stuns nearby enemies for 1s
registerAbility({
    id: 'tepegoz_earth_tremor',
    name: 'Earth Tremor',
    trigger: 'passive',
    onTick(unit: Unit, dt: number): void {
        const state = unit.abilityState as { tremorTimer?: number };
        state.tremorTimer = (state.tremorTimer ?? 0) + dt;
        if (state.tremorTimer >= 8) {
            state.tremorTimer = 0;
            (unit.abilityState as any).pendingTremor = true;  // UnitManager handles AOE
        }
    },
});

// ─── OD — Yalın Ateş ─────────────────────────────────────────────────
// On-attack: 20% chance to deal +50% bonus fire damage
registerAbility({
    id: 'od_yalin_ates',
    name: 'Yalın Ateş',
    trigger: 'on_hit',
    onHit(_unit: Unit, _attacker: Unit, damage: number): number {
        if (Math.random() < 0.20) {
            return damage * 1.5;
        }
        return damage;
    },
});

// Map unit types to ability IDs
export const UNIT_ABILITY_MAP: Record<string, string> = {
    korhan: 'korhan_iron_armor',
    erlik: 'erlik_dark_flame',
    ayaz: 'ayaz_hoarfrost',
    umay: 'umay_mercy',
    tulpar: 'tulpar_charge',
    sahmeran: 'sahmeran_poison',
    tepegoz: 'tepegoz_earth_tremor',
    od: 'od_yalin_ates',
    albasti: '',  // no special ability yet
};
