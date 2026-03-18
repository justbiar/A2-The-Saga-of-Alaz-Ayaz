/**
 * WinScreenUI.ts — Win screen, bet result display, stats table.
 */

import { ctx } from '../game/GameContext';
import { t } from '../i18n';
import { showScreen } from './ScreenRouter';
import { leaderboardService } from '../chain/LeaderboardService';
import { profileService } from '../chain/ProfileService';
import { kiteService } from '../ai/KiteService';
import { betService } from '../chain/BetService';
import { mpService } from '../multiplayer/MultiplayerService';
import { showToast } from './LobbyUI';

/** Oyuncu rapor et (multiplayer maç sonrası) */
function showReportModal(opponentAddress: string, matchId: string | null): void {
    const existing = document.getElementById('win-report-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'win-report-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10001;';
    modal.innerHTML = `
        <div style="background:#161b22;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:28px 32px;min-width:340px;max-width:440px;font-family:Inter,sans-serif;color:#e2e8f0;">
            <h3 style="font-family:Cinzel,serif;margin:0 0 14px;font-size:16px;color:#fff;">Oyuncu Raporla</h3>
            <p style="font-size:12px;color:#64748b;margin:0 0 16px;">${opponentAddress.slice(0,10)}…${opponentAddress.slice(-4)}</p>
            <div style="margin-bottom:12px;">
                <label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px;text-transform:uppercase;">Sebep:</label>
                <select id="wrm-reason" style="width:100%;background:#0a0c10;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;padding:8px;font-size:13px;outline:none;">
                    <option value="Hile / Cheating">Hile / Cheating</option>
                    <option value="Toksik Davranış">Toksik Davranış</option>
                    <option value="Oyunu Terk Etti">Oyunu Terk Etti</option>
                    <option value="Spam / Flood">Spam / Flood</option>
                    <option value="Diğer">Diğer</option>
                </select>
            </div>
            <div style="margin-bottom:16px;">
                <label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px;text-transform:uppercase;">Detay (opsiyonel):</label>
                <textarea id="wrm-details" style="width:100%;box-sizing:border-box;background:#0a0c10;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;padding:8px;font-size:13px;resize:vertical;min-height:60px;outline:none;font-family:inherit;" placeholder="Ek bilgi…"></textarea>
            </div>
            <div style="display:flex;gap:10px;">
                <button id="wrm-send" style="flex:1;background:#f59e0b;color:#000;border:none;border-radius:6px;padding:9px;font-size:13px;font-weight:600;cursor:pointer;">Gönder</button>
                <button id="wrm-cancel" style="background:rgba(255,255,255,0.08);color:#94a3b8;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:9px 18px;font-size:13px;cursor:pointer;">İptal</button>
            </div>
            <p id="wrm-status" style="font-size:12px;color:#64748b;margin:10px 0 0;text-align:center;"></p>
        </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#wrm-cancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    (modal.querySelector('#wrm-send') as HTMLButtonElement).addEventListener('click', async () => {
        const reason = (modal.querySelector('#wrm-reason') as HTMLSelectElement).value;
        const details = (modal.querySelector('#wrm-details') as HTMLTextAreaElement).value;
        const statusEl = modal.querySelector('#wrm-status') as HTMLElement;
        const sendBtn = modal.querySelector('#wrm-send') as HTMLButtonElement;
        sendBtn.disabled = true;
        statusEl.textContent = 'Gönderiliyor…';
        try {
            const res = await fetch('/api/report/player', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reporterAddress: ctx.walletAddress,
                    reportedAddress: opponentAddress,
                    reason,
                    details,
                    matchId,
                }),
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || 'Rapor gönderilemedi');
            statusEl.style.color = '#10b981';
            statusEl.textContent = 'Rapor gönderildi. Teşekkürler.';
            setTimeout(() => modal.remove(), 1500);
        } catch (e: any) {
            statusEl.style.color = '#ef4444';
            statusEl.textContent = e.message;
            sendBtn.disabled = false;
        }
    });
}
import type { WinConditionSystem } from '../scene/systems/winConditionSystem';
import { cleanupDraft } from './CardUI';

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
    cleanupDraft();
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

    const winRestartBtn = document.getElementById('win-restart-btn');
    if (winRestartBtn) {
        winRestartBtn.onclick = () => {
            winOverlay.classList.remove('show');
            (window as any).__cleanupGame?.();
            showScreen('team-select');
        };
    }

    // Rakibi Raporla butonu — sadece multiplayer modda
    const reportBtn = document.getElementById('win-report-btn');
    if (reportBtn) {
        if (ctx.gameMode === 'multiplayer' && ctx.walletAddress && mpService.opponentWallet) {
            reportBtn.style.display = 'inline-block';
            reportBtn.onclick = () => showReportModal(mpService.opponentWallet!, betService.state.matchId ?? null);
        } else {
            reportBtn.style.display = 'none';
        }
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
