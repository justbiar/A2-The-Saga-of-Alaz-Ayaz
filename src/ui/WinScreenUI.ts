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
import { escapeHtml } from '../utils/escapeHtml';

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
            <p style="font-size:12px;color:#64748b;margin:0 0 16px;">${escapeHtml(opponentAddress.slice(0,10))}…${escapeHtml(opponentAddress.slice(-4))}</p>
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
            tx.textContent = '';
            const prefix = document.createTextNode('TX: ');
            const a = document.createElement('a');
            const safeTx = txHash.replace(/[^a-fA-F0-9x]/g, '');
            a.href = `https://testnet.snowtrace.io/tx/${safeTx}`;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = `${safeTx.slice(0, 18)}…`;
            tx.appendChild(prefix);
            tx.appendChild(a);
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

    // Share butonu
    const shareBtn = document.getElementById('win-share-btn');
    if (shareBtn) {
        shareBtn.textContent = t('shareBtn');
        shareBtn.onclick = () => generateShareImage(playerWon, winner ?? 'fire');
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

// ── Share Image Generator ─────────────────────────────────────
function generateShareImage(playerWon: boolean, winner: 'fire' | 'ice'): void {
    const W = 800;
    const H = 480;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d')!;

    // Background
    const bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#03020c');
    bg.addColorStop(0.5, '#0a0818');
    bg.addColorStop(1, '#03020c');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    // Subtle team-colored glow at top
    const glowColor = winner === 'fire' ? 'rgba(255,85,32,0.08)' : 'rgba(56,170,255,0.08)';
    const glow = c.createRadialGradient(W / 2, 0, 0, W / 2, 0, 400);
    glow.addColorStop(0, glowColor);
    glow.addColorStop(1, 'transparent');
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);

    // Border frame
    c.strokeStyle = 'rgba(255,201,77,0.15)';
    c.lineWidth = 1;
    c.strokeRect(16, 16, W - 32, H - 32);

    // Corner decorations
    const cornerSize = 20;
    c.strokeStyle = 'rgba(255,201,77,0.4)';
    c.lineWidth = 2;
    // Top-left
    c.beginPath(); c.moveTo(16, 16 + cornerSize); c.lineTo(16, 16); c.lineTo(16 + cornerSize, 16); c.stroke();
    // Top-right
    c.beginPath(); c.moveTo(W - 16 - cornerSize, 16); c.lineTo(W - 16, 16); c.lineTo(W - 16, 16 + cornerSize); c.stroke();
    // Bottom-left
    c.beginPath(); c.moveTo(16, H - 16 - cornerSize); c.lineTo(16, H - 16); c.lineTo(16 + cornerSize, H - 16); c.stroke();
    // Bottom-right
    c.beginPath(); c.moveTo(W - 16 - cornerSize, H - 16); c.lineTo(W - 16, H - 16); c.lineTo(W - 16, H - 16 - cornerSize); c.stroke();

    // "A2: THE SAGA" branding top
    c.font = '600 11px Inter, sans-serif';
    c.fillStyle = 'rgba(255,201,77,0.5)';
    c.textAlign = 'center';
    c.letterSpacing = '3px';
    c.fillText('A2: THE SAGA OF ALAZ & AYAZ', W / 2, 50);

    // Match type badge
    const isOnline = ctx.gameMode === 'multiplayer';
    if (isOnline) {
        c.font = '700 10px Inter, sans-serif';
        c.fillStyle = 'rgba(56,170,255,0.7)';
        c.fillText(t('shareOnline'), W / 2, 68);
    }

    // Victory/Defeat title
    const titleColor = winner === 'fire' ? '#ff5520' : '#38aaff';
    const titleText = playerWon ? t('shareVictory') : t('shareDefeat');
    c.font = '900 52px Cinzel, serif';
    c.fillStyle = titleColor;
    c.textAlign = 'center';
    c.shadowColor = titleColor;
    c.shadowBlur = 40;
    c.fillText(titleText, W / 2, 130);
    c.shadowBlur = 0;

    // Team names: ALAZ vs AYAZ
    const fireColor = '#ff5520';
    const iceColor = '#38aaff';
    const playerTeam = ctx.selectedTeam || 'fire';
    const opTeam = playerTeam === 'fire' ? 'ice' : 'fire';

    c.font = '700 20px Cinzel, serif';
    c.fillStyle = playerTeam === 'fire' ? fireColor : iceColor;
    c.textAlign = 'right';
    c.fillText(playerTeam === 'fire' ? t('shareTeamFire') : t('shareTeamIce'), W / 2 - 30, 170);

    c.font = '400 14px Inter, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.3)';
    c.textAlign = 'center';
    c.fillText(t('shareVs'), W / 2, 170);

    c.font = '700 20px Cinzel, serif';
    c.fillStyle = opTeam === 'fire' ? fireColor : iceColor;
    c.textAlign = 'left';
    c.fillText(opTeam === 'fire' ? t('shareTeamFire') : t('shareTeamIce'), W / 2 + 30, 170);

    // Divider line
    const divGrad = c.createLinearGradient(80, 0, W - 80, 0);
    divGrad.addColorStop(0, 'transparent');
    divGrad.addColorStop(0.3, 'rgba(255,201,77,0.25)');
    divGrad.addColorStop(0.7, 'rgba(255,201,77,0.25)');
    divGrad.addColorStop(1, 'transparent');
    c.strokeStyle = divGrad;
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(80, 190); c.lineTo(W - 80, 190); c.stroke();

    // Bet info (if multiplayer with bet)
    let statsY = 220;
    if (isOnline && betService.state.amount > 0) {
        const amt = betService.state.amount;
        const wonAmt = amt * 2 * 0.98;
        c.font = '600 13px Inter, sans-serif';
        c.textAlign = 'center';
        if (playerWon) {
            c.fillStyle = '#50c878';
            c.fillText(`${t('shareWon')}: +${wonAmt.toFixed(4)} AVAX`, W / 2, statsY);
        } else {
            c.fillStyle = '#ff5520';
            c.fillText(`${t('shareLost')}: -${amt.toFixed(4)} AVAX`, W / 2, statsY);
        }
        statsY += 30;
    }

    // Stats section
    if (ctx._um) {
        const stats = ctx._um.getStats();
        const rows = Object.entries(stats).sort(([a], [b]) => a.localeCompare(b));

        // Stats header
        c.font = '600 10px Inter, sans-serif';
        c.fillStyle = 'rgba(255,201,77,0.5)';
        c.textAlign = 'center';
        c.fillText(t('shareStats'), W / 2, statsY);
        statsY += 20;

        // Stats table header
        const cols = [140, 300, 430, 560, 680];
        c.font = '600 10px Inter, sans-serif';
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.textAlign = 'center';
        c.fillText(t('winStatChar'), cols[0], statsY);
        c.fillText(t('winStatTeam'), cols[1], statsY);
        c.fillText(t('shareDeployed'), cols[2], statsY);
        c.fillText(t('winStatDead'), cols[3], statsY);
        c.fillText(t('shareSurvived'), cols[4], statsY);
        statsY += 6;

        // Thin line under header
        c.strokeStyle = 'rgba(255,255,255,0.08)';
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(80, statsY); c.lineTo(W - 80, statsY); c.stroke();
        statsY += 16;

        // Stats rows
        for (const [key, s] of rows) {
            if (statsY > H - 60) break;
            const type = key.split('_')[0];
            const alive = s.deployed - s.deaths;
            const rowColor = s.team === 'fire' ? 'rgba(255,176,128,0.85)' : 'rgba(128,212,255,0.85)';

            c.font = '600 12px Inter, sans-serif';
            c.fillStyle = rowColor;
            c.textAlign = 'center';
            c.fillText(UNIT_TR_NAMES[type] ?? type, cols[0], statsY);
            c.fillText(s.team === 'fire' ? t('teamFire') : t('teamIce'), cols[1], statsY);

            c.font = '400 12px Inter, sans-serif';
            c.fillStyle = 'rgba(255,255,255,0.7)';
            c.fillText(String(s.deployed), cols[2], statsY);
            c.fillStyle = s.deaths > 0 ? '#ff5555' : 'rgba(255,255,255,0.25)';
            c.fillText(String(s.deaths), cols[3], statsY);
            c.fillStyle = alive > 0 ? '#55ff99' : 'rgba(255,255,255,0.25)';
            c.fillText(String(alive), cols[4], statsY);
            statsY += 22;
        }
    }

    // Footer: domain
    c.font = '600 12px Cinzel, serif';
    c.fillStyle = 'rgba(255,201,77,0.4)';
    c.textAlign = 'center';
    c.fillText(t('sharePlayAt'), W / 2, H - 30);

    // Diamond separator
    c.fillStyle = 'rgba(255,201,77,0.3)';
    c.font = '10px serif';
    c.fillText('◆', W / 2 - 60, H - 30);
    c.fillText('◆', W / 2 + 60, H - 30);

    // Show preview modal
    showShareModal(canvas, playerWon);
}

function showShareModal(canvas: HTMLCanvasElement, playerWon: boolean): void {
    const existing = document.getElementById('share-modal');
    if (existing) existing.remove();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    const modal = document.createElement('div');
    modal.id = 'share-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10002;display:flex;align-items:center;justify-content:center;background:rgba(3,2,12,0.9);backdrop-filter:blur(12px);';
    modal.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:16px;max-width:90vw;">
            <img src="${dataUrl}" style="max-width:min(720px,85vw);border-radius:12px;border:1px solid rgba(255,201,77,0.2);box-shadow:0 8px 40px rgba(0,0,0,0.6);" />
            <div style="display:flex;gap:12px;align-items:center;">
                <button id="share-native-btn" style="
                    padding:10px 28px;border-radius:24px;
                    border:1px solid rgba(255,201,77,0.4);
                    background:linear-gradient(135deg,rgba(255,201,77,0.18),rgba(255,201,77,0.06));
                    color:#ffc94d;font-family:Cinzel,serif;font-size:13px;
                    font-weight:700;letter-spacing:2px;cursor:pointer;
                ">${t('shareBtn')}</button>
                <button id="share-dl-btn" style="
                    padding:10px 28px;border-radius:24px;
                    border:1px solid rgba(255,255,255,0.15);
                    background:rgba(255,255,255,0.06);
                    color:rgba(255,255,255,0.6);font-family:Cinzel,serif;font-size:13px;
                    font-weight:700;letter-spacing:2px;cursor:pointer;
                ">DOWNLOAD</button>
                <button id="share-close-btn" style="
                    padding:10px 20px;border-radius:24px;
                    border:1px solid rgba(255,255,255,0.08);
                    background:transparent;
                    color:rgba(255,255,255,0.35);font-family:Inter,sans-serif;font-size:12px;
                    cursor:pointer;
                ">✕</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Close
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#share-close-btn')!.addEventListener('click', () => modal.remove());

    // Download
    modal.querySelector('#share-dl-btn')!.addEventListener('click', () => {
        canvas.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `a2saga-${playerWon ? 'victory' : 'defeat'}.jpg`;
            a.click();
            URL.revokeObjectURL(url);
            showToast(t('shareDownloaded'));
        }, 'image/jpeg', 0.85);
    });

    // Native share (Web Share API)
    const shareNativeBtn = modal.querySelector('#share-native-btn') as HTMLButtonElement;
    shareNativeBtn.addEventListener('click', async () => {
        try {
            const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.85));
            const file = new File([blob], `a2saga-${playerWon ? 'victory' : 'defeat'}.jpg`, { type: 'image/jpeg' });

            if (navigator.share && navigator.canShare?.({ files: [file] })) {
                await navigator.share({
                    title: 'A2: The Saga of Alaz & Ayaz',
                    text: playerWon ? t('shareVictory') : t('shareDefeat'),
                    files: [file],
                });
            } else {
                // Fallback: copy image to clipboard
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': canvas.toBlob.bind(canvas) as any }),
                ]);
                showToast('Copied!');
            }
        } catch {
            // Final fallback: download
            canvas.toBlob((b) => {
                if (!b) return;
                const url = URL.createObjectURL(b);
                const a = document.createElement('a');
                a.href = url;
                a.download = `a2saga.jpg`;
                a.click();
                URL.revokeObjectURL(url);
            }, 'image/jpeg', 0.85);
        }
    });
}

export { winOverlay, winTitle, winMessage };
