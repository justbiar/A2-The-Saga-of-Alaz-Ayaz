/**
 * KiteAIInterface.ts — Swap point for real Kite AI integration.
 *
 * Currently served by MockKiteAI. Replace with real API call when
 * Kite endpoint is available.
 */
import type { BoardState, ActionQueue, AIProfile } from '../ecs/types';

export interface IKiteAI {
    /**
     * Process the current board state and return a queue of actions.
     * @param boardState  — snapshot of the current game state
     * @param aiProfile   — the AI trait profile for the acting unit/team
     * @returns           — ordered list of actions to execute
     */
    process(boardState: BoardState, aiProfile: AIProfile): Promise<ActionQueue>;
}
