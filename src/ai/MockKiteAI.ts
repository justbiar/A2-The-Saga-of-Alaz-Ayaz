/**
 * MockKiteAI.ts — Rule-based AI implementation (no network).
 * Implements IKiteAI so it can be swapped with real Kite when ready.
 */
import type { IKiteAI } from './KiteAIInterface';
import type { BoardState, ActionQueue, AIProfile, KiteAction } from '../ecs/types';
import { GameRandom } from '../utils/Random';

// Ice unit pool for AI deployment decisions
const ICE_UNIT_POOL: string[] = ['ayaz', 'tulpar', 'tulpar', 'umay', 'albasti', 'tepegoz'];

export class MockKiteAI implements IKiteAI {
    async process(boardState: BoardState, aiProfile: AIProfile): Promise<ActionQueue> {
        const actions: KiteAction[] = [];
        let confidence = 0.6;

        const {
            turn,
            enemyMana,
            fireUnits,
            iceUnits,
            equilibriumScore,
            iceBaseHp,
        } = boardState;

        // Determine number of units to deploy based on mana and board state
        const unitsToDeploy = this.calcDeployCount(
            turn, enemyMana, fireUnits, iceUnits, aiProfile,
        );

        // Pick deploy lanes based on shard control and profile
        for (let i = 0; i < unitsToDeploy; i++) {
            const unitType = this.pickUnit(aiProfile, turn, boardState);
            const lane = this.pickLane(aiProfile, boardState, i);

            actions.push({
                type: 'deploy',
                unitType,
                lane,
            });
        }

        // Tactical: if base is damaged and trait is defensive, add shield action
        if (aiProfile.trait === 'defensive' && iceBaseHp < 500) {
            actions.push({ type: 'ability', abilityId: 'ice_fortify' });
            confidence += 0.1;
        }

        // Equilibrium surge check: if fire is too dominant, go aggressive
        if (equilibriumScore < -0.4 && aiProfile.trait !== 'defensive') {
            confidence += 0.15;
            // Prioritize fast units
            if (unitsToDeploy === 0) {
                actions.push({
                    type: 'deploy',
                    unitType: 'tulpar',
                    lane: 1,
                });
            }
        }

        return {
            actions,
            confidence: Math.min(1.0, confidence),
            reasoning: `Turn ${turn}: deploying ${unitsToDeploy} units. Profile: ${aiProfile.trait}`,
        };
    }

    private calcDeployCount(
        turn: number,
        mana: number,
        fire: number,
        ice: number,
        profile: AIProfile,
    ): number {
        let count = 1 + Math.floor(turn / 3);
        if (fire > ice + 2) count++;
        if (profile.trait === 'aggressive') count++;
        if (profile.trait === 'defensive') count = Math.max(1, count - 1);
        return Math.min(4, count);
    }

    private pickUnit(profile: AIProfile, turn: number, board: BoardState): string {
        if (profile.targetPriority === 'base_focus') return 'tulpar'; // fastest
        if (board.equilibriumScore < -0.5) return 'umay'; // ranged counter
        if (turn >= 7) {
            // Late game: use heavier units
            const late = ['tepegoz', 'umay', 'albasti'];
            return GameRandom.choice(late);
        }
        return GameRandom.choice(ICE_UNIT_POOL);
    }

    private pickLane(profile: AIProfile, board: BoardState, index: number): number {
        const { shardControl } = board;
        // Capture uncontrolled shards
        const uncontrolled: number[] = [];
        if (shardControl.left !== 'ice') uncontrolled.push(0);
        if (shardControl.mid !== 'ice') uncontrolled.push(1);
        if (shardControl.right !== 'ice') uncontrolled.push(2);

        if (uncontrolled.length > 0 && profile.trait !== 'base_focus' as any) {
            return uncontrolled[index % uncontrolled.length];
        }

        // Default: spread evenly
        return index % 3;
    }
}
