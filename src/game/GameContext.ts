/**
 * GameContext.ts — Shared mutable game state singleton.
 * All modules import ctx from here instead of relying on main.ts closures.
 */

import type { UnitManager } from '../ecs/UnitManager';
import type { AvaShardManager } from '../scene/map/AvaShard';
import type { BaseBuilding } from '../scene/map/BaseBuilding';
import type { CardDef, UnitType } from '../ecs/Unit';
import type { PromptCardDef } from '../ecs/types';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';

export type GameMode = 'realtime' | 'twoplayer' | 'multiplayer';
export type Phase = 'player' | 'enemy';

export const MAX_MANA = 12;
export const MANA_REGEN_INTERVAL = 3.0;

export const ctx = {
    // ── Game mode / phase ──
    gameMode: 'realtime' as GameMode,
    phase: 'player' as Phase,
    difficultyLevel: 1,

    // ── Player resources ──
    playerMana: 0,
    iceMana: 0,
    playerAvx: 0,
    iceAvx: 0,
    bonusMana: 0,

    // ── Turn tracking ──
    turnCount: 1,

    // ── Card state ──
    pendingCard: null as CardDef | null,
    selectedIceCardId: null as UnitType | null,

    // ── Team selection ──
    selectedTeam: 'fire' as 'fire' | 'ice',
    lobbyTeam: null as 'fire' | 'ice' | null,

    // ── Multiplayer ──
    mpGameStarted: false,
    _mpSpawnUnit: null as ((team: 'fire' | 'ice', cardId: UnitType, lane: 'left' | 'mid' | 'right') => void) | null,
    _mpApplyPrompt: null as ((team: 'fire' | 'ice', promptId: string) => void) | null,
    _mpTriggerWin: null as ((winner: 'fire' | 'ice', msg: string, isDisconnect?: boolean) => void) | null,
    _mpStartGame: null as (() => void) | null,
    _mpGameEnded: false,

    // ── Realtime / 2P accumulators ──
    realtimeManaAccum: 0,
    realtimeAiAccum: 0,
    iceManaAccum: 0,

    // ── Skill card state ──
    manaFrozen: false,
    manaFreezeTimer: 0,
    ouroborosMode: false,
    autoCollectActive: false,
    autoCollectTimer: null as ReturnType<typeof setTimeout> | null,
    banCollectActive: false,
    banCollectTimer: null as ReturnType<typeof setTimeout> | null,

    // ── Draft system ──
    playerDeck: [] as PromptCardDef[],
    draftTimer: 45,
    draftPopupOpen: false,
    recallUsed: false,
    towerCardAdded: false,
    healHomeInterval: null as ReturnType<typeof setInterval> | null,
    unluckyInterval: null as ReturnType<typeof setInterval> | null,

    // ── Tower system ──
    spawnTower: null as (() => boolean) | null,
    disposeTowers: null as (() => void) | null,

    // ── Flower system ──
    spawnFlower: null as (() => boolean) | null,
    disposeFlowers: null as (() => void) | null,

    // ── Tree system ──
    selectedTreeType: null as 'mana' | 'avx' | null,
    spawnTree: null as (() => boolean) | null,
    upgradeTree: null as ((index: number) => boolean) | null,
    disposeTrees: null as (() => void) | null,

    // ── Cooldown ──
    skillCooldowns: {} as Record<string, number>,
    cooldownRAF: null as number | null,
    unitCooldowns: {} as Record<string, number>,

    // ── Module-level refs (set by boot, used by prompt effects / coin system) ──
    _um: null as UnitManager | null,
    _shards: null as AvaShardManager | null,
    _fireBase: null as BaseBuilding | null,
    _iceBase: null as BaseBuilding | null,
    _scene: null as Scene | null,
    _engine: null as Engine | null,

    // ── Wallet ──
    walletAddress: null as string | null,
    _activeProvider: null as any,

    // ── Keybindings ──
    _listeningEl: null as HTMLElement | null,
    _listeningKey: null as { player: 'fire' | 'ice'; action: string } | null,

    // ── Multiplayer sync ──
    _baseSyncAccum: 0,

    // ── Pause ──
    isPaused: false,

    // ── Character select ──
    currentCharId: 'korhan',
};

/** Convenience: reset game state for new game */
export function resetGameState(): void {
    ctx.playerMana = 3;
    ctx.playerAvx = 0;
    ctx.turnCount = 1;
    ctx.realtimeManaAccum = 0;
    ctx.realtimeAiAccum = 0;
    ctx.iceManaAccum = 0;
    ctx._mpGameEnded = false;
    ctx.mpGameStarted = false;
    ctx.unitCooldowns = {};
    ctx.towerCardAdded = false;
    ctx.disposeTowers?.();
    ctx.spawnTower = null;
    ctx.disposeTowers = null;
    ctx.disposeFlowers?.();
    ctx.spawnFlower = null;
    ctx.disposeFlowers = null;
    ctx.disposeTrees?.();
    ctx.spawnTree = null;
    ctx.upgradeTree = null;
    ctx.disposeTrees = null;
    ctx.selectedTreeType = null;
}
