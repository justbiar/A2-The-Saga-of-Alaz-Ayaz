/**
 * KiteService.ts — Central Kite AI orchestrator.
 *
 * Combines the LLM inference client (KiteAIClient) and the on-chain
 * recording service (KiteChainService) into a single interface that
 * main.ts uses for all AI and chain operations.
 *
 * Usage in main.ts:
 *   const kite = new KiteService();
 *   await kite.init();
 *
 *   // In doEnemyTurn:
 *   const queue = await kite.decideTurn(boardState, aiProfile);
 *
 *   // On game over:
 *   await kite.finalizeMatch({ ... });
 */
import { KiteAIClient }     from './KiteAIClient';
import { KiteChainService } from './KiteChainService';
import type { BoardState, ActionQueue, AIProfile } from '../ecs/types';
import type { MatchResult } from './KiteChainService';

export type { MatchResult };

export class KiteService {
    public readonly ai    = new KiteAIClient();
    public readonly chain = new KiteChainService();

    // Status flags — readable by the UI
    get isLiveAI():      boolean { return this.ai.isLive; }
    get isChainActive(): boolean { return this.chain.isConnected; }

    // ── Initialise (non-blocking — game starts even if chain is down) ─────
    async init(): Promise<void> {
        try {
            await this.chain.connect();
        } catch {
            // Chain failure is non-fatal
        }
        console.log(
            `[KiteService] Init — LLM: ${this._endpointConfigured() ? 'endpoint configured' : 'MockKiteAI'} | ` +
            `Chain: ${this.chain.isConnected ? `connected (chainId ${this.chain.chainId})` : 'offline'}`,
        );
    }

    // ── AI turn decision ──────────────────────────────────────────────────
    async decideTurn(board: BoardState, profile: AIProfile): Promise<ActionQueue> {
        const start = performance.now();
        const queue = await this.ai.process(board, profile);
        const ms    = (performance.now() - start).toFixed(0);

        // Log turn for PoAI accumulation
        this.chain.logTurn({
            turn:         board.turn,
            actionsCount: queue.actions.length,
            confidence:   queue.confidence,
            unitType:     queue.actions[0]?.unitType,
            lane:         queue.actions[0]?.lane,
        });

        console.log(`[KiteService] Turn ${board.turn} decided in ${ms}ms | confidence: ${queue.confidence.toFixed(2)} | source: ${this.ai.isLive ? 'Kite LLM' : 'MockAI'}`);
        return queue;
    }

    // ── Finalize and record match ─────────────────────────────────────────
    async finalizeMatch(result: MatchResult): Promise<void> {
        result.totalPoAIDelta = this.chain.calculatePoAIDelta();
        await this.chain.finalizeMatch(result);
    }

    // ── Build BoardState from live game objects ───────────────────────────
    static buildBoardState(
        turn:       number,
        playerMana: number,
        enemyMana:  number,
        fireUnits:  number,
        iceUnits:   number,
        fireBaseHp: number,
        iceBaseHp:  number,
        shardLeft:   'fire' | 'ice' | 'neutral',
        shardMid:    'fire' | 'ice' | 'neutral',
        shardRight:  'fire' | 'ice' | 'neutral',
    ): BoardState {
        const total = fireUnits + iceUnits || 1;
        const equilibriumScore = (iceUnits - fireUnits) / total; // +1 = ice dominant
        return {
            turn,
            playerMana,
            enemyMana,
            fireUnits,
            iceUnits,
            fireBaseHp,
            iceBaseHp,
            equilibriumScore,
            shardControl: { left: shardLeft, mid: shardMid, right: shardRight },
        };
    }

    private _endpointConfigured(): boolean {
        return !!(import.meta.env?.VITE_KITE_ENDPOINT);
    }
}

// Singleton — import { kiteService } from '...' for convenience
export const kiteService = new KiteService();
