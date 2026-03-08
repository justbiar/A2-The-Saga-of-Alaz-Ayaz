/**
 * winConditionSystem.ts — Checks all win conditions each turn/frame.
 * Returns WinCondition enum when game is over.
 */
import type { BaseBuilding } from '../map/BaseBuilding';
import type { AvaShardManager } from '../map/AvaShard';
import { WinCondition } from '../../game/GameState';
import { t } from '../../i18n';

export class WinConditionSystem {
    private readonly fireBase: BaseBuilding;
    private readonly iceBase: BaseBuilding;
    private readonly shards: AvaShardManager;
    private winner: WinCondition = WinCondition.None;

    constructor(fireBase: BaseBuilding, iceBase: BaseBuilding, shards: AvaShardManager) {
        this.fireBase = fireBase;
        this.iceBase = iceBase;
        this.shards = shards;
    }

    /**
     * Call every render frame. Returns WinCondition if game over, None otherwise.
     */
    check(): WinCondition {
        if (this.winner !== WinCondition.None) return this.winner;

        // Base destruction
        if (this.iceBase.isDestroyed()) {
            this.winner = WinCondition.FireDestroysBase;
            return this.winner;
        }
        if (this.fireBase.isDestroyed()) {
            this.winner = WinCondition.IceDestroysBase;
            return this.winner;
        }

        // Shard timeout win (all 3 shards held for 60s)
        if (this.shards.fireTimeoutWin) {
            this.winner = WinCondition.FireShardTimeout;
            return this.winner;
        }
        if (this.shards.iceTimeoutWin) {
            this.winner = WinCondition.IceShardTimeout;
            return this.winner;
        }

        return WinCondition.None;
    }

    isGameOver(): boolean {
        return this.winner !== WinCondition.None;
    }

    getWinner(): 'fire' | 'ice' | null {
        switch (this.winner) {
            case WinCondition.FireDestroysBase:
            case WinCondition.FireShardTimeout:
                return 'fire';
            case WinCondition.IceDestroysBase:
            case WinCondition.IceShardTimeout:
                return 'ice';
            default:
                return null;
        }
    }

    getWinMessage(): string {
        switch (this.winner) {
            case WinCondition.FireDestroysBase:
                return t('winFireBase');
            case WinCondition.IceDestroysBase:
                return t('winIceBase');
            case WinCondition.FireShardTimeout:
                return t('winFireShard');
            case WinCondition.IceShardTimeout:
                return t('winIceShard');
            default:
                return '';
        }
    }
}
