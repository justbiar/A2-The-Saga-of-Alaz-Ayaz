/**
 * Unit.ts — Core types, card definitions and stats for all 9 characters.
 *
 * TEAMS:
 *   fire     — Korhan (Warrior), Erlik (Mage), Od (Mage)
 *   ice      — Ayaz (Warrior), Tulpar (Warrior), Umay (Mage)
 *   mercenary — Albasti (Neutral), Tepegöz (Mage), Şahmeran (Spirit)
 *               Mercenaries can be deployed by EITHER team (always listed as fire in spawn)
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AIProfile, StatusEffect } from './types';

export type Team = 'fire' | 'ice';
export type UnitType =
    | 'korhan' | 'erlik' | 'od'
    | 'ayaz' | 'tulpar' | 'umay'
    | 'albasti' | 'tepegoz' | 'sahmeran'
    | 'boru';

export type CardTeam = 'fire' | 'ice' | 'mercenary';
export type UnitState = 'walking' | 'fighting' | 'dead';

export interface UnitStats {
    maxHp: number;
    attack: number;
    attackRange: number;
    attackCooldown: number;
    speed: number;
    armor: number;         // flat damage reduction (GDD §1.4)
    magicResist: number;   // % magic damage reduction (0-1)
}

export interface CardDef {
    id: UnitType;
    name: string;
    role: string;          // Savaşçı / Büyücü / Neutral / Spirit
    cardTeam: CardTeam;    // visual theme
    spawnTeam: Team;       // which team gets deployed
    manaCost: number;
    avxCost: number;       // 0 = uses mana, >0 = uses AVX currency (mercenaries)
    stats: UnitStats;
    description: string;
    imagePath: string;     // /assets/images/characters/<name>.webp
    glowColor: string;
    borderColor: string;
}

// ─── UNIT STATS (GDD Part I §1.4) ─────────────────────────────────────

// Güçlü → yavaş + yüksek armor/HP   |   Zayıf → hızlı + düşük armor
const FIRE: Record<string, UnitStats> = {
    korhan: { maxHp: 220, attack: 24, attackRange: 4, attackCooldown: 0.9, speed: 4,  armor: 8, magicResist: 0.10 },  // tank — yavaş, zırhlı
    erlik:  { maxHp: 100, attack: 35, attackRange: 6, attackCooldown: 1.4, speed: 7,  armor: 1, magicResist: 0.15 },  // glass cannon — hızlı, kırılgan
    od:     { maxHp: 90, attack: 3, attackRange: 12, attackCooldown: 2.5, speed: 5,  armor: 2, magicResist: 0.20 },  // destek — dost heal + zayıf ateş büyüsü
};

const ICE: Record<string, UnitStats> = {
    ayaz:   { maxHp: 240, attack: 18, attackRange: 3, attackCooldown: 1.0, speed: 3.5, armor: 10, magicResist: 0.12 }, // en tank — en yavaş, en zırhlı
    tulpar: { maxHp: 90, attack: 3, attackRange: 12, attackCooldown: 2.5, speed: 5,  armor: 1,  magicResist: 0.05 }, // destek — dost heal + zayıf buz büyüsü
    umay:   { maxHp: 120, attack: 22, attackRange: 8, attackCooldown: 1.5, speed: 5,   armor: 2,  magicResist: 0.30 }, // uzak menzil mage
};

const MERC: Record<string, UnitStats> = {
    albasti:  { maxHp: 140, attack: 26, attackRange: 5, attackCooldown: 1.0, speed: 8,  armor: 2, magicResist: 0.10 }, // hızlı neutral
    tepegoz:  { maxHp: 300, attack: 20, attackRange: 4, attackCooldown: 2.0, speed: 3,  armor: 12, magicResist: 0.08 }, // dev — en yavaş, en zırhlı
    sahmeran: { maxHp: 130, attack: 32, attackRange: 7, attackCooldown: 1.1, speed: 7,  armor: 1, magicResist: 0.18 }, // hızlı zehirci
    boru:     { maxHp: 180, attack: 28, attackRange: 4, attackCooldown: 0.9, speed: 6,  armor: 5, magicResist: 0.15 }, // ruh kurdu — kristalden çıkar
};

export const STATS_MAP: Record<UnitType, UnitStats> = {
    ...FIRE, ...ICE, ...MERC,
} as Record<UnitType, UnitStats>;

// ─── AI PROFILES MAP ──────────────────────────────────────────────────

export const AI_PROFILES_MAP: Record<UnitType, AIProfile> = {
    korhan:   { trait: 'aggressive',  targetPriority: 'nearest',    retreatThreshold: 0.20, aggressionRadius: 12 },
    erlik:    { trait: 'tactical',    targetPriority: 'lowest_hp',  retreatThreshold: 0.15, aggressionRadius: 10 },
    od:       { trait: 'tactical',    targetPriority: 'lowest_hp',  retreatThreshold: 0.0,  aggressionRadius: 12 },
    ayaz:     { trait: 'defensive',   targetPriority: 'highest_hp', retreatThreshold: 0.30, aggressionRadius: 8  },
    tulpar:   { trait: 'tactical',    targetPriority: 'lowest_hp',  retreatThreshold: 0.0,  aggressionRadius: 12 },
    umay:     { trait: 'adaptive',    targetPriority: 'lowest_hp',  retreatThreshold: 0.25, aggressionRadius: 12 },
    albasti:  { trait: 'adaptive',    targetPriority: 'nearest',    retreatThreshold: 0.20, aggressionRadius: 12 },
    tepegoz:  { trait: 'defensive',   targetPriority: 'highest_hp', retreatThreshold: 0.35, aggressionRadius: 8  },
    sahmeran: { trait: 'tactical',    targetPriority: 'lowest_hp',  retreatThreshold: 0.15, aggressionRadius: 10 },
    boru:     { trait: 'aggressive',  targetPriority: 'nearest',    retreatThreshold: 0.10, aggressionRadius: 14 },
};

// ─── CARD DEFINITIONS ────────────────────────────────────────────────

export const PLAYER_CARDS: CardDef[] = [
    // ── FIRE ──────────────────────────────────────────────────────────
    {
        id: 'korhan', name: 'Korhan', role: 'Savaşçı', cardTeam: 'fire', spawnTeam: 'fire',
        manaCost: 4, avxCost: 0, stats: FIRE.korhan,
        description: 'Her 3. darbe %40 hasar azaltır',
        imagePath: '/assets/images/characters/korhan.webp',
        glowColor: 'rgba(255,80,0,0.8)', borderColor: '#cc3300',
    },
    {
        id: 'erlik', name: 'Erlik', role: 'Büyücü', cardTeam: 'fire', spawnTeam: 'fire',
        manaCost: 5, avxCost: 0, stats: FIRE.erlik,
        description: 'Saldırıda %30 yakma şansı (5 hp/s, 3s)',
        imagePath: '/assets/images/characters/erlik.webp',
        glowColor: 'rgba(200,20,0,0.8)', borderColor: '#aa0000',
    },
    {
        id: 'od', name: 'Od', role: 'Destek', cardTeam: 'fire', spawnTeam: 'fire',
        manaCost: 7, avxCost: 0, stats: FIRE.od,
        description: 'Dostlara ateş büyüsü ile heal, düşmana zayıf saldırı',
        imagePath: '/assets/images/characters/od.webp',
        glowColor: 'rgba(255,120,0,0.8)', borderColor: '#dd4400',
    },
    // ── MERCENARY ─────────────────────────────────────────────────────
    {
        id: 'albasti', name: 'Albastı', role: 'Neutral', cardTeam: 'mercenary', spawnTeam: 'fire',
        manaCost: 0, avxCost: 3, stats: MERC.albasti,
        description: 'Hızlı kanatlı saldırı',
        imagePath: '/assets/images/characters/albasti.webp',
        glowColor: 'rgba(180,120,255,0.8)', borderColor: '#886600',
    },
    {
        id: 'tepegoz', name: 'Tepegöz', role: 'Büyücü', cardTeam: 'mercenary', spawnTeam: 'fire',
        manaCost: 0, avxCost: 5, stats: MERC.tepegoz,
        description: 'AOE sersemletme (8s)',
        imagePath: '/assets/images/characters/tepegoz.webp',
        glowColor: 'rgba(160,0,200,0.8)', borderColor: '#775500',
    },
    {
        id: 'sahmeran', name: 'Şahmeran', role: 'Spirit of the Steppe', cardTeam: 'mercenary', spawnTeam: 'fire',
        manaCost: 0, avxCost: 4, stats: MERC.sahmeran,
        description: 'Her saldırıda zehir (8 hp/s, 4s)',
        imagePath: '/assets/images/characters/sahmeran.webp',
        glowColor: 'rgba(60,200,60,0.8)', borderColor: '#886600',
    },
];

// AI cards (ice team)
export const AI_CARDS: CardDef[] = [
    {
        id: 'ayaz', name: 'Ayaz', role: 'Savaşçı', cardTeam: 'ice', spawnTeam: 'ice',
        manaCost: 3, avxCost: 0, stats: ICE.ayaz,
        description: '4. saldırıda 2s dondurma (%50 yavaşlatma)',
        imagePath: '/assets/images/characters/ayaz.webp',
        glowColor: 'rgba(0,140,255,0.8)', borderColor: '#0055aa',
    },
    {
        id: 'tulpar', name: 'Tulpar', role: 'Destek', cardTeam: 'ice', spawnTeam: 'ice',
        manaCost: 3, avxCost: 0, stats: ICE.tulpar,
        description: 'Dostlara buz büyüsü ile heal, düşmana zayıf saldırı',
        imagePath: '/assets/images/characters/tulpar.webp',
        glowColor: 'rgba(40,180,255,0.8)', borderColor: '#0066cc',
    },
    {
        id: 'umay', name: 'Umay', role: 'Büyücü', cardTeam: 'ice', spawnTeam: 'ice',
        manaCost: 4, avxCost: 0, stats: ICE.umay,
        description: 'En yakın dosta 15HP/5s iyileştirme',
        imagePath: '/assets/images/characters/umay.webp',
        glowColor: 'rgba(100,200,255,0.8)', borderColor: '#004488',
    },
    {
        id: 'albasti', name: 'Albastı', role: 'Neutral', cardTeam: 'mercenary', spawnTeam: 'ice',
        manaCost: 0, avxCost: 3, stats: MERC.albasti,
        description: 'Hızlı kanatlı saldırı',
        imagePath: '/assets/images/characters/albasti.webp',
        glowColor: 'rgba(180,120,255,0.8)', borderColor: '#886600',
    },
    {
        id: 'tepegoz', name: 'Tepegöz', role: 'Büyücü', cardTeam: 'mercenary', spawnTeam: 'ice',
        manaCost: 0, avxCost: 5, stats: MERC.tepegoz,
        description: 'AOE sersemletme (8s)',
        imagePath: '/assets/images/characters/tepegoz.webp',
        glowColor: 'rgba(160,0,200,0.8)', borderColor: '#775500',
    },
    {
        id: 'sahmeran', name: 'Şahmeran', role: 'Spirit of the Steppe', cardTeam: 'mercenary', spawnTeam: 'ice',
        manaCost: 0, avxCost: 4, stats: MERC.sahmeran,
        description: 'Her saldırıda zehir (8 hp/s, 4s)',
        imagePath: '/assets/images/characters/sahmeran.webp',
        glowColor: 'rgba(60,200,60,0.8)', borderColor: '#886600',
    },
];

export const CARD_DEFS = PLAYER_CARDS; // alias for main.ts

// ─── TOWER / UNIT INTERFACES ─────────────────────────────────────────

export interface TowerData {
    mesh: Mesh;
    position: Vector3;
    team: Team;
    hp: number;
    maxHp: number;
    attackRange: number;
    attackCooldown: number;
    attackDamage: number;
    lastAttackTime: number;
}

export interface Unit {
    id: number;
    team: Team;
    type: UnitType;
    mesh: Mesh;
    hp: number;
    stats: UnitStats;
    state: UnitState;
    pathQueue: Vector3[];
    targetUnit: Unit | null;
    lastAttackTime: number;
    walkBobTime: number;
    baseY: number;
    healthBarBg: Mesh | null;
    healthBarFill: Mesh | null;
    // GDD additions
    aiProfile: AIProfile;
    statusEffects: StatusEffect[];
    poaiScore: number;              // 0–10000, grows with PoAI data
    abilityState: Record<string, unknown>;
}
