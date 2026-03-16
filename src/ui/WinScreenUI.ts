/**
 * WinScreenUI.ts — Win screen, bet result display, stats table.
 */

import { ctx } from '../game/GameContext';
import { t } from '../i18n';
import { leaderboardService } from '../chain/LeaderboardService';
import { profileService } from '../chain/ProfileService';
import { kiteService } from '../ai/KiteService';
import { betService } from '../chain/BetService';
import { mpService } from '../multiplayer/MultiplayerService';
import { showToast } from './LobbyUI';
import type { WinConditionSystem } from '../scene/systems/winConditionSystem';

const winOverlay = document.getElementById('win-overlay') as HTMLElement;
const winTitle = document.getElementById('win-title') as HTMLElement;
const winMessage = document.getElementById('win-message') as HTMLElement;

const UNIT_TR_NAMES: Record<string, string> = {
    korhan: 'Korhan', erlik: 'Erlik', od: 'Od',
    ayaz: 'Ayaz', tulpar: 'Tulpar', umay: 'Umay',
    albasti: 'Albasti', tepegoz: 'Tepegoz', sahmeran: 'Sahmeran',
};

export function showBetResultOnWin(didWin: boolean, amountAvax: number, txHash: string | null): void {
    const row = document.getElementById('bet-result-row');
    const icon = document.getElementById('bet-result-icon');
    const text = document.getElementById('bet-result-text');
    const tx = document.getElementById('bet-result-tx');
    if (!row || !icon || !text || !tx) return;

    row.style.display = 'block';
    row.className = didWin ? 'bet-win' : 'bet-loss';

    if (didWin) {
        icon.textContent = t('betWinIcon');
        text.textContent = `+${amountAvax.toFixed(4)} ${t('betWinAVAX')}`;
        if (txHash) {
            tx.innerHTML = `TX: <a href="https://testnet.snowtrace.io/tx/${txHash}" target="_blank" rel="noopener">${txHash.slice(0, 18)}…</a>`;
        } else {
            tx.textContent = t('betPaymentProcessing');
        }
    } else {
        icon.textContent = '💸';
        text.textContent = `-${amountAvax.toFixed(4)} ${t('betLossAVAX')}`;
        tx.textContent = '';
    }
}

export function showWinScreen(sys: WinConditionSystem): void {
    const betRow = document.getElementById('bet-result-row');
    if (betRow) betRow.style.display = 'none';

    const winner = sys.getWinner();
    const playerWon = winner === ctx.selectedTeam;

    winTitle.textContent = playerWon ? t('victory') : t('defeat');
    winTitle.className = winner === 'fire' ? 'fire-win' : 'ice-win';
    winMessage.textContent = sys.getWinMessage();

    if (ctx.walletAddress && ctx.gameMode !== 'multiplayer') {
        leaderboardService.recordResult(ctx.walletAddress, playerWon ? 'win' : 'loss', 0, 0, 'local');
    }

    const thead = document.querySelector('#win-stats-table thead tr');
    if (thead) {
        thead.innerHTML = `
            <th>${t('winStatChar')}</th>
            <th>${t('winStatTeam')}</th>
            <th>${t('winStatDep')}</th>
            <th>${t('winStatDead')}</th>
            <th>${t('winStatAlive')}</th>
            <th>${t('winStatPoai')}</th>
        `;
    }

    if (ctx._um) {
        const stats = ctx._um.getStats();
        const tbody = document.getElementById('win-stats-body')!;
        tbody.innerHTML = '';

        const rows = Object.entries(stats).sort(([a], [b]) => a.localeCompare(b));

        for (const [key, s] of rows) {
            const type = key.split('_')[0];
            const alive = s.deployed - s.deaths;
            const tr = document.createElement('tr');
            tr.className = s.team === 'fire' ? 'team-fire' : 'team-ice';
            tr.innerHTML = `
                <td class="stat-name">${UNIT_TR_NAMES[type] ?? type}</td>
                <td>${s.team === 'fire' ? t('teamFire') : t('teamIce')}</td>
                <td>${s.deployed}</td>
                <td class="${s.deaths > 0 ? 'stat-dead' : 'stat-zero'}">${s.deaths}</td>
                <td class="${alive > 0 ? 'stat-alive' : 'stat-zero'}">${alive}</td>
                <td>${s.bestPoAI}</td>
            `;
            tbody.appendChild(tr);
        }
    }

    const winHomeBtn = document.getElementById('win-home-btn');
    if (winHomeBtn) {
        winHomeBtn.textContent = t('winHome');
        winHomeBtn.onclick = () => {
            (window as any).__cleanupGame?.();
        };
        winHomeBtn.onmouseenter = () => { (winHomeBtn as HTMLElement).style.color = '#fff'; (winHomeBtn as HTMLElement).style.borderColor = 'rgba(255,255,255,0.3)'; };
        winHomeBtn.onmouseleave = () => { (winHomeBtn as HTMLElement).style.color = ''; (winHomeBtn as HTMLElement).style.borderColor = ''; };
    }

    winOverlay.classList.add('show');

    void kiteService.finalizeMatch({
        playerAddress: (window as any).__walletAddress ?? '0x0',
        characterType: ctx.selectedTeam === 'fire' ? 'korhan' : 'ayaz',
        won: playerWon,
        turnsPlayed: ctx.turnCount,
        totalPoAIDelta: 0,
    });

    if (profileService.isConnected && profileService.currentProfile) {
        const result = playerWon ? 'win' : 'loss';
        void profileService.submitGameResult(result);
    }
}

export { winOverlay, winTitle, winMessage };
