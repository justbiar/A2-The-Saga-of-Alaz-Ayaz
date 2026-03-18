/**
 * ProfileLeaderboard.ts — Profile modal, leaderboard rendering, on-chain sync.
 */

import { ctx } from '../game/GameContext';
import { t, TransKey } from '../i18n';
import { profileService } from '../chain/ProfileService';
import { leaderboardService } from '../chain/LeaderboardService';
import { showWalletModal, lockGameUntilProfile } from './WalletUI';
import { showToast } from './LobbyUI';

// ─── DOM REFS ──────────────────────────────────────────────────────
const profileModal = document.getElementById('profile-modal')!;
const profileCloseBtn = document.getElementById('profile-close')!;
const profileRegisterDiv = document.getElementById('profile-register')!;
const profileViewDiv = document.getElementById('profile-view')!;
const profileNotConnected = document.getElementById('profile-not-connected')!;
const profileConnectBtn = document.getElementById('profile-connect-btn')!;
const profileRegisterBtn = document.getElementById('profile-register-btn') as HTMLButtonElement;
const profileNameInput = document.getElementById('profile-name-input') as HTMLInputElement;
const profileAvatarInput = document.getElementById('profile-avatar-input') as HTMLInputElement;
const avatarPreview = document.getElementById('avatar-preview') as HTMLImageElement;

// ─── ON-CHAIN LEADERBOARD SYNC ─────────────────────────────────────
export async function syncOnChainLeaderboard(): Promise<void> {
    try {
        const entries = await profileService.getLeaderboard();
        if (entries.length > 0) {
            for (const e of entries) {
                leaderboardService.upsertPlayer(e.address, e.username);
                const existing = leaderboardService.getPlayer(e.address);
                if (existing && e.wins > existing.wins) {
                    const diff = e.wins - existing.wins;
                    for (let i = 0; i < diff; i++) {
                        leaderboardService.recordResult(e.address, 'win');
                    }
                }
            }
        }
    } catch {
        // silently ignore
    }
}

// ─── COUNTDOWN FORMATTER ───────────────────────────────────────────
function formatCountdown(remainingMs: number): string {
    if (remainingMs <= 0) return t('lbCountdownSoon' as TransKey);
    const totalSec = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const d = t('lbCountdownDays' as TransKey);
    const h = t('lbCountdownHours' as TransKey);
    const m = t('lbCountdownMins' as TransKey);
    const left = t('lbCountdownLeft' as TransKey);
    if (days > 0) return `${days}${d} ${hours}${h} ${left}`;
    if (hours > 0) return `${hours}${h} ${mins}${m} ${left}`;
    return `${mins}${m} ${left}`;
}

function formatSeasonLabel(seasonWeek: number): string {
    const s = t('lbSeasonLabel' as TransKey);
    const w = t('lbWeekLabel' as TransKey);
    return `${s} 1 · ${w} ${seasonWeek}`;
}

const SEASON_START = new Date('2026-03-16T00:00:00Z');

function getClientSeasonWeek(): number {
    const elapsed = Date.now() - SEASON_START.getTime();
    if (elapsed < 0) return 1;
    return Math.floor(elapsed / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function getClientRemainingMs(): number {
    const week = getClientSeasonWeek();
    const nextMonday = new Date(SEASON_START.getTime() + week * 7 * 24 * 60 * 60 * 1000);
    return Math.max(0, nextMonday.getTime() - Date.now());
}

// ─── PRIZE POOL BANNER ─────────────────────────────────────────────
export async function updatePrizePoolBanner(): Promise<void> {
    const serverPool = await leaderboardService.getServerPrizePool().catch(() => null);
    const info = serverPool
        ? { totalFee: serverPool.totalFee, enabled: true, prizes: serverPool.prizes, minPool: 0.1, enoughForDistribution: serverPool.totalFee >= 0.1 }
        : leaderboardService.getPrizePoolInfo();
    const banner = document.getElementById('weekly-prize-banner');
    const totalEl = document.getElementById('wpb-total-amount');
    const prize1El = document.getElementById('wpb-prize-1');
    const prize2El = document.getElementById('wpb-prize-2');
    const prize3El = document.getElementById('wpb-prize-3');
    const noteEl = document.getElementById('wpb-note');
    const seasonEl = document.getElementById('wpb-season');
    const countdownEl = document.getElementById('wpb-countdown');

    if (!banner) return;

    if (!info.enabled) banner.classList.add('wpb-disabled');
    else banner.classList.remove('wpb-disabled');

    if (totalEl) totalEl.textContent = info.totalFee.toFixed(4);
    if (prize1El) prize1El.textContent = info.prizes[0]?.avax.toFixed(4) ?? '—';
    if (prize2El) prize2El.textContent = info.prizes[1]?.avax.toFixed(4) ?? '—';
    if (prize3El) prize3El.textContent = info.prizes[2]?.avax.toFixed(4) ?? '—';
    if (noteEl && !info.enoughForDistribution && info.totalFee > 0) {
        noteEl.textContent = `Min ${info.minPool} AVAX · ${info.totalFee.toFixed(4)} AVAX`;
    }
    const week = serverPool?.week ?? getClientSeasonWeek();
    const remainingMs = serverPool?.remainingMs ?? getClientRemainingMs();
    if (seasonEl) seasonEl.textContent = formatSeasonLabel(week);
    if (countdownEl) countdownEl.textContent = formatCountdown(remainingMs);
}

// ─── LOCAL LEADERBOARD RENDER ──────────────────────────────────────
export async function renderLocalLeaderboard(sortBy: 'wins' | 'weeklyWins' | 'betWon' = 'wins'): Promise<void> {
    const lbBody = document.getElementById('leaderboard-body')!;
    let entries: any[];
    try {
        const serverEntries = await leaderboardService.getServerLeaderboard();
        if (serverEntries && serverEntries.length > 0) {
            if (sortBy === 'weeklyWins') serverEntries.sort((a: any, b: any) => b.weeklyWins - a.weeklyWins || b.wins - a.wins);
            else if (sortBy === 'betWon') serverEntries.sort((a: any, b: any) => b.totalBetWon - a.totalBetWon);
            else serverEntries.sort((a: any, b: any) => b.wins - a.wins || b.winRate - a.winRate);
            serverEntries.forEach((e: any, i: number) => e.rank = i + 1);
            entries = serverEntries;
        } else {
            const onChain = await profileService.getLeaderboard();
            if (onChain.length > 0) {
                entries = onChain.map((e: any) => {
                    const local = leaderboardService.getPlayer(e.address);
                    return { ...e, weeklyWins: local?.weeklyWins ?? 0, totalBetWon: local?.totalBetWon ?? 0 };
                });
                if (sortBy === 'weeklyWins') entries.sort((a: any, b: any) => b.weeklyWins - a.weeklyWins);
                else if (sortBy === 'betWon') entries.sort((a: any, b: any) => b.totalBetWon - a.totalBetWon);
                else entries.sort((a: any, b: any) => b.wins - a.wins || b.winRate - a.winRate);
                entries.forEach((e: any, i: number) => e.rank = i + 1);
            } else {
                entries = leaderboardService.getLeaderboard(sortBy);
            }
        }
    } catch {
        entries = leaderboardService.getLeaderboard(sortBy);
    }
    lbBody.innerHTML = '';

    for (const e of entries) {
        const isMe = e.address.toLowerCase() === (ctx.walletAddress ?? '').toLowerCase();
        const tr = document.createElement('tr');
        if (isMe) tr.className = 'is-me';

        const prizeCell = e.weeklyPrize && e.weeklyPrize > 0
            ? `<td class="lb-prize-cell">${e.weeklyPrize.toFixed(4)}</td>`
            : `<td class="lb-prize-none">—</td>`;

        const donated = e.totalDonated ?? 0;
        const donateCell = donated > 0
            ? `<td class="lb-donate-cell">${donated.toFixed(3)}</td>`
            : `<td class="lb-prize-none">—</td>`;

        const gamesPlayed = (e.onlineWins ?? 0) + (e.onlineLosses ?? 0) + (e.onlineDraws ?? 0);
        tr.innerHTML = `
            <td class="lb-rank ${e.rank <= 3 ? 'lb-rank-' + e.rank : ''}">${e.rank}</td>
            <td>${e.username}</td>
            <td>${sortBy === 'weeklyWins' ? e.weeklyWins : (e.onlineWins ?? e.wins)}</td>
            <td>${gamesPlayed}</td>
            <td class="lb-winrate">${e.winRate}%</td>
            ${donateCell}
            ${prizeCell}
        `;
        lbBody.appendChild(tr);
    }

    if (entries.length === 0) {
        lbBody.innerHTML = `<tr><td colspan="7" style="color:rgba(255,255,255,0.25);padding:12px;text-align:center;">${t('lbTableEmpty' as TransKey)}</td></tr>`;
    }
}

// ─── LEADERBOARD SCREEN ────────────────────────────────────────────
export async function renderLeaderboardScreen(sortBy: 'wins' | 'weeklyWins' | 'betWon' = 'wins'): Promise<void> {
    const serverPool = await leaderboardService.getServerPrizePool();
    const info = serverPool
        ? { totalFee: serverPool.totalFee, week: serverPool.week, enabled: true, prizes: serverPool.prizes, minPool: 0.1, enoughForDistribution: serverPool.totalFee >= 0.1 }
        : leaderboardService.getPrizePoolInfo();

    const totalEl = document.getElementById('lb-screen-total');
    if (totalEl) totalEl.textContent = info.totalFee.toFixed(4);

    const seasonEl = document.getElementById('lb-pp-season');
    const countdownEl = document.getElementById('lb-pp-countdown');
    const totalDistEl = document.getElementById('lb-pp-total-distributed');
    const swWeek = serverPool?.week ?? getClientSeasonWeek();
    const swRemaining = serverPool?.remainingMs ?? getClientRemainingMs();
    if (seasonEl) seasonEl.textContent = formatSeasonLabel(swWeek);
    if (countdownEl) countdownEl.textContent = formatCountdown(swRemaining);
    if (totalDistEl) totalDistEl.textContent = (serverPool?.totalDistributed ?? 0).toFixed(4);
    if (serverPool) {
    }

    const ratios = leaderboardService.prizeConfig?.prizeRatios ?? [40, 20, 10];
    [0, 1, 2].forEach(i => {
        const el = document.getElementById(`lb-pp-prize-${i + 1}`);
        if (el) el.textContent = info.enabled && info.totalFee > 0
            ? (info.totalFee * (ratios[i] / 100)).toFixed(4)
            : '—';
    });

    let entries: any[];
    try {
        // Server API (global, no gas needed) — primary source
        const serverEntries = await leaderboardService.getServerLeaderboard();
        if (serverEntries && serverEntries.length > 0) {
            if (sortBy === 'weeklyWins') serverEntries.sort((a: any, b: any) => b.weeklyWins - a.weeklyWins || (b.onlineWins ?? 0) - (a.onlineWins ?? 0));
            else if (sortBy === 'betWon') serverEntries.sort((a: any, b: any) => (b.totalBetWon ?? 0) - (a.totalBetWon ?? 0));
            else serverEntries.sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0) || (b.onlineWins ?? 0) - (a.onlineWins ?? 0));
            serverEntries.forEach((e: any, i: number) => {
                e.rank = i + 1;
                if (info.enabled && info.totalFee >= info.minPool && i < 3) {
                    const ratios = leaderboardService.prizeConfig.prizeRatios;
                    e.weeklyPrize = +(info.totalFee * (ratios[i] / 100)).toFixed(4);
                }
            });
            entries = serverEntries;
        } else {
            // Fallback: on-chain contract
            const onChain = await profileService.getLeaderboard();
            if (onChain.length > 0) {
                entries = onChain.map((e: any) => ({ ...e, weeklyWins: 0, totalBetWon: 0, weeklyPrize: undefined }));
                if (sortBy === 'weeklyWins') entries.sort((a: any, b: any) => b.weeklyWins - a.weeklyWins);
                else if (sortBy === 'betWon') entries.sort((a: any, b: any) => (b.totalBetWon ?? 0) - (a.totalBetWon ?? 0));
                else entries.sort((a: any, b: any) => b.wins - a.wins || b.winRate - a.winRate);
                entries.forEach((e: any, i: number) => { e.rank = i + 1; });
            } else {
                entries = leaderboardService.getLeaderboard(sortBy);
            }
        }
    } catch {
        entries = leaderboardService.getLeaderboard(sortBy);
    }

    // Podium
    const podiumEl = document.getElementById('lb-podium')!;
    podiumEl.innerHTML = '';

    if (entries.length === 0) {
        podiumEl.innerHTML = `<div class="lb-podium-empty">${t('lbPodiumEmpty' as TransKey)}</div>`;
    } else {
        const podiumOrder = [1, 0, 2];
        for (const idx of podiumOrder) {
            if (idx >= entries.length) continue;
            const e = entries[idx];
            const pClass = idx === 0 ? 'p1' : idx === 1 ? 'p2' : 'p3';
            const rankLabel = idx === 0 ? '1' : idx === 1 ? '2' : '3';
            const gamesPlayed = (e.onlineWins ?? 0) + (e.onlineLosses ?? 0) + (e.onlineDraws ?? 0);
            const winVal = sortBy === 'weeklyWins' ? e.weeklyWins : (e.onlineWins ?? e.wins);
            const winLabel = sortBy === 'weeklyWins' ? t('lbPodiumWeek' as TransKey) : t('lbPodiumWins' as TransKey);
            const prizeHtml = e.weeklyPrize && e.weeklyPrize > 0
                ? `<div class="lb-podium-prize">${e.weeklyPrize.toFixed(4)} AVAX</div>
                   <div class="lb-podium-prize-lbl">${t('lbPodiumPrize' as TransKey)}</div>`
                : '';

            const totalAvx = e.totalBetWon ?? 0;
            const avxHtml = `<div class="lb-podium-avx">
                <div class="lb-podium-avx-val">${totalAvx.toFixed(4)}</div>
                <div class="lb-podium-avx-lbl">TOTAL AVAX</div>
            </div>`;
            const card = document.createElement('div');
            card.className = `lb-podium-card ${pClass}`;
            const avatarSrc = e.avatarURI
                || localStorage.getItem(`a2_avatar_${e.address.toLowerCase()}`)
                || '/assets/images/logo.webp';
            card.innerHTML = `
                <div class="lb-podium-rank">${rankLabel}</div>
                <img class="lb-podium-avatar" src="${avatarSrc}" alt="" onerror="this.src='/assets/images/logo.webp'" />
                <div class="lb-podium-name">${e.username}</div>
                <div class="lb-podium-addr">${e.address.slice(0, 8)}…${e.address.slice(-4)}</div>
                <div class="lb-podium-stats">
                    <div class="lb-podium-stat">
                        <div class="lb-podium-stat-val">${winVal}</div>
                        <div class="lb-podium-stat-lbl">${winLabel}</div>
                    </div>
                    <div class="lb-podium-stat">
                        <div class="lb-podium-stat-val" style="color:rgba(255,255,255,0.45);">${gamesPlayed}</div>
                        <div class="lb-podium-stat-lbl">${t('lbPodiumGames' as TransKey)}</div>
                    </div>
                </div>
                <div class="lb-podium-winrate">${e.winRate}% W/R</div>
                ${avxHtml}
                ${prizeHtml}
            `;
            podiumEl.appendChild(card);
        }
    }

    // Table with pagination (100 entries, 10 per page)
    const lbBody = document.getElementById('lb-screen-body')!;
    const paginationEl = document.getElementById('lb-pagination') as HTMLElement | null;
    const pageInfoEl = document.getElementById('lb-page-info') as HTMLElement | null;
    const prevBtn = document.getElementById('lb-page-prev') as HTMLButtonElement | null;
    const nextBtn = document.getElementById('lb-page-next') as HTMLButtonElement | null;

    const PAGE_SIZE = 10;
    const MAX_ENTRIES = 100;
    const pagedEntries = entries.slice(0, MAX_ENTRIES);
    const totalPages = Math.max(1, Math.ceil(pagedEntries.length / PAGE_SIZE));
    let currentPage = 0;

    function renderPage(page: number): void {
        currentPage = Math.max(0, Math.min(page, totalPages - 1));
        const slice = pagedEntries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
        lbBody.innerHTML = '';

        if (pagedEntries.length === 0) {
            lbBody.innerHTML = `<tr><td colspan="7"><div class="lb-empty-state"><div class="lb-empty-state-icon">--</div>${t('lbTableEmpty' as TransKey)}</div></td></tr>`;
            return;
        }

        for (const e of slice) {
            const isMe = e.address.toLowerCase() === (ctx.walletAddress ?? '').toLowerCase();
            const tr = document.createElement('tr');
            if (isMe) tr.className = 'lb-me';

            const gamesPlayed = (e.onlineWins ?? 0) + (e.onlineLosses ?? 0) + (e.onlineDraws ?? 0);
            const winVal = sortBy === 'weeklyWins' ? e.weeklyWins : (e.onlineWins ?? e.wins);
            const prize = e.weeklyPrize && e.weeklyPrize > 0
                ? `<span class="lb-prize-val">${e.weeklyPrize.toFixed(4)}</span>`
                : `<span class="lb-prize-empty">—</span>`;

            const rateClass = e.winRate >= 60 ? 'high' : e.winRate >= 40 ? 'mid' : '';
            const donated = e.totalDonated ?? 0;
            const donateHtml = donated > 0
                ? `<span class="lb-donate-cell">${donated.toFixed(3)}</span>`
                : `<span class="lb-prize-empty">—</span>`;

            const rowAvatar = e.avatarURI
                || localStorage.getItem(`a2_avatar_${e.address.toLowerCase()}`)
                || '/assets/images/logo.webp';
            tr.innerHTML = `
                <td><span class="lb-rank-num ${e.rank <= 3 ? 'lb-rank-' + e.rank : 'lb-rank-4up'}">${e.rank}</span></td>
                <td>
                  <div class="lb-player-cell">
                    <img class="lb-player-avatar" src="${rowAvatar}" alt="" onerror="this.src='/assets/images/logo.webp'" />
                    <div>
                      <div class="lb-player-name">${e.username}</div>
                      <div class="lb-player-addr">${e.address.slice(0, 6)}…${e.address.slice(-4)}</div>
                    </div>
                  </div>
                </td>
                <td><span class="lb-win-count">${winVal}</span></td>
                <td><span class="lb-games-count">${gamesPlayed}</span></td>
                <td><span class="lb-rate-pill ${rateClass}">${e.winRate}%</span></td>
                <td>${donateHtml}</td>
                <td>${prize}</td>
            `;
            lbBody.appendChild(tr);
        }

        if (pageInfoEl) pageInfoEl.textContent = `${currentPage + 1} / ${totalPages}`;
        if (prevBtn) prevBtn.disabled = currentPage === 0;
        if (nextBtn) nextBtn.disabled = currentPage >= totalPages - 1;
    }

    if (paginationEl) paginationEl.style.display = totalPages > 1 ? 'flex' : 'none';
    if (prevBtn) prevBtn.onclick = () => renderPage(currentPage - 1);
    if (nextBtn) nextBtn.onclick = () => renderPage(currentPage + 1);

    renderPage(0);
}

// ─── PROFILE MODAL ─────────────────────────────────────────────────
export async function openProfileModal(): Promise<void> {
    profileViewDiv.style.display = 'none';
    profileNotConnected.style.display = 'none';

    if (!ctx.walletAddress) {
        profileNotConnected.style.display = '';
        profileModal.classList.add('show');
        return;
    }

    if (!profileService.isConnected) {
        profileService.walletAddress = ctx.walletAddress;
        profileService.isConnected = true;
        await profileService.loadProfile();
    }

    let profile = profileService.currentProfile;

    if (!profile) {
        profileRegisterDiv.style.display = '';
        profileViewDiv.style.display = 'none';
        profileNotConnected.style.display = 'none';
        profileModal.classList.add('show');
        return;
    }

    const profAvatar = document.getElementById('profile-avatar') as HTMLImageElement;
    const profName = document.getElementById('profile-display-name')!;
    const profAddr = document.getElementById('profile-display-addr')!;

    profName.textContent = profile.username;
    profAddr.textContent = profileService.shortAddress();
    profAvatar.src = profile.avatarURI || '/assets/images/logo.webp';

    document.getElementById('prof-games')!.textContent = String(profile.gamesPlayed);
    document.getElementById('prof-wins')!.textContent = String(profile.wins);
    document.getElementById('prof-losses')!.textContent = String(profile.losses);
    document.getElementById('prof-draws')!.textContent = String(profile.draws);

    const lbBody = document.getElementById('leaderboard-body')!;
    lbBody.innerHTML = '<tr><td colspan="6" style="color:rgba(255,255,255,0.3);padding:12px;">...</td></tr>';

    profileViewDiv.style.display = '';
    profileModal.classList.add('show');

    const renameBtn = document.getElementById('profile-rename-btn');
    const renameInput = document.getElementById('profile-rename-input') as HTMLInputElement;
    if (renameBtn && renameInput) {
        renameBtn.onclick = async () => {
            const newName = renameInput.value.trim();
            if (!newName || newName.length > 32) return;
            await profileService.registerProfile(newName, profile!.avatarURI ?? '');
            profName.textContent = newName;
            renameInput.value = '';
            leaderboardService.upsertPlayer(ctx.walletAddress!, newName);
            renderLocalLeaderboard('wins');
            showToast(t('pfsNameUpdated' as TransKey), 2000);
        };
    }

    document.querySelectorAll<HTMLButtonElement>('.lb-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            void renderLocalLeaderboard(tab.dataset.sort as any);
        });
    });

    void renderLocalLeaderboard('wins');
}

// ─── PROFILE SCREEN ────────────────────────────────────────────────
export function renderProfileScreen(): void {
    const notConn = document.getElementById('pfs-not-connected')!;
    const regWrap = document.getElementById('pfs-register')!;
    const viewWrap = document.getElementById('pfs-view')!;

    notConn.style.display = 'none';
    regWrap.style.display = 'none';
    viewWrap.style.display = 'none';

    if (!ctx.walletAddress) {
        notConn.style.display = '';
        return;
    }

    const profile = profileService.currentProfile;
    if (!profile) {
        regWrap.style.display = '';

        const nameInput = document.getElementById('pfs-name-input') as HTMLInputElement;
        const avatarInput = document.getElementById('pfs-avatar-input') as HTMLInputElement;
        const avatarPreviewEl = document.getElementById('pfs-avatar-preview') as HTMLImageElement;
        const regBtn = document.getElementById('pfs-register-btn') as HTMLButtonElement;

        avatarInput.oninput = () => {
            const url = avatarInput.value.trim();
            avatarPreviewEl.src = url || '/assets/images/logo.webp';
        };

        // Kayıt formunda dosya seçme
        const regFileBtn = document.getElementById('pfs-reg-file-btn');
        const regAvatarFile = document.getElementById('pfs-reg-avatar-file') as HTMLInputElement;
        if (regFileBtn && regAvatarFile) {
            regFileBtn.onclick = () => regAvatarFile.click();
            regAvatarFile.onchange = () => {
                const file = regAvatarFile.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const dataUrl = ev.target?.result as string;
                    avatarPreviewEl.src = dataUrl;
                    avatarInput.value = '';
                    (regAvatarFile as any)._pendingDataUrl = dataUrl;
                };
                reader.readAsDataURL(file);
            };
        }

        regBtn.onclick = async () => {
            const username = nameInput.value.trim();
            if (!username || username.length > 32) { nameInput.style.borderColor = '#ff5555'; return; }
            nameInput.style.borderColor = '';
            regBtn.disabled = true;
            regBtn.textContent = '...';
            // Dosya yüklemesi varsa onu kullan, yoksa URL
            const pendingDataUrl = (regAvatarFile as any)?._pendingDataUrl as string | undefined;
            let avatarVal = avatarInput.value.trim();
            if (pendingDataUrl) {
                try {
                    const upRes = await fetch('/api/avatar/upload', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ address: ctx.walletAddress, dataUrl: pendingDataUrl }),
                    });
                    const upData = await upRes.json();
                    avatarVal = upData.ok ? upData.url : '';
                    if (!upData.ok) localStorage.setItem(`a2_avatar_${ctx.walletAddress!.toLowerCase()}`, pendingDataUrl);
                } catch {
                    avatarVal = '';
                    localStorage.setItem(`a2_avatar_${ctx.walletAddress!.toLowerCase()}`, pendingDataUrl);
                }
            }
            const ok = await profileService.registerProfile(username, avatarVal);
            regBtn.disabled = false;
            regBtn.textContent = t('pfsRegisterBtn' as TransKey);
            if (ok) {
                leaderboardService.upsertPlayer(ctx.walletAddress!, username, avatarVal);
                lockGameUntilProfile(false);
                renderProfileScreen();
            } else {
                alert(t('pfsRegisterFailed' as TransKey));
            }
        };
        return;
    }

    viewWrap.style.display = '';
    const avatarImg = document.getElementById('pfs-avatar-img') as HTMLImageElement;
    const savedAvatar = localStorage.getItem(`a2_avatar_${ctx.walletAddress!.toLowerCase()}`);
    avatarImg.src = savedAvatar || profile.avatarURI || '/assets/images/logo.webp';
    document.getElementById('pfs-display-name')!.textContent = profile.username;
    document.getElementById('pfs-display-addr')!.textContent = profileService.shortAddress();

    // Local stats from localStorage profile (immediate, no network)
    document.getElementById('pfs-local-games')!.textContent = String(profile.gamesPlayed);
    document.getElementById('pfs-local-wins')!.textContent = String(profile.wins);
    document.getElementById('pfs-local-losses')!.textContent = String(profile.losses);
    document.getElementById('pfs-draws')!.textContent = String(profile.draws);

    // Fetch server stats for online/local split + match history
    void (async () => {
        try {
            const serverEntries = await leaderboardService.getServerLeaderboard();
            const me: any = serverEntries?.find((e: any) => e.address.toLowerCase() === ctx.walletAddress!.toLowerCase());
            if (me) {
                const el = (id: string) => document.getElementById(id);
                el('pfs-online-games')!.textContent = String(me.onlineGamesPlayed ?? 0);
                el('pfs-online-wins')!.textContent = String(me.onlineWins ?? 0);
                el('pfs-online-losses')!.textContent = String(me.onlineLosses ?? 0);
                el('pfs-avax-won')!.textContent = (me.totalBetWon ?? 0).toFixed(4);
                el('pfs-local-games')!.textContent = String(me.localGamesPlayed ?? 0);
                el('pfs-local-wins')!.textContent = String(me.localWins ?? 0);
                el('pfs-local-losses')!.textContent = String(me.localLosses ?? 0);
            }
        } catch { /* ignore */ }

        // Match history
        try {
            const res = await fetch(`/api/leaderboard/matches/${ctx.walletAddress}`);
            const data = await res.json();
            const matchesSection = document.getElementById('pfs-matches-section');
            const matchesList = document.getElementById('pfs-matches-list');
            if (!matchesSection || !matchesList) return;

            const matches: any[] = data.matches ?? [];
            matchesSection.style.display = '';

            if (matches.length === 0) {
                matchesList.innerHTML = `<div class="pfs-matches-empty">${t('pfsMatchEmpty' as TransKey)}</div>`;
                return;
            }

            matchesList.innerHTML = '';
            for (const m of matches.slice(0, 15)) {
                const row = document.createElement('div');
                row.className = 'pfs-match-row';

                const resultLabel = m.result === 'win' ? t('pfsMatchWin' as TransKey) : m.result === 'loss' ? t('pfsMatchLoss' as TransKey) : t('pfsMatchDraw' as TransKey);
                const resClass = m.result === 'win' ? 'win' : m.result === 'loss' ? 'loss' : 'draw';

                const opponent = m.opponentUsername
                    ? m.opponentUsername
                    : m.opponentAddress
                        ? `${m.opponentAddress.slice(0, 6)}…${m.opponentAddress.slice(-4)}`
                        : t('pfsMatchOpponent' as TransKey);

                let betHtml = '<span class="pfs-match-bet">—</span>';
                if (m.betWon > 0) {
                    betHtml = `<span class="pfs-match-bet won">+${m.betWon.toFixed(4)} AVAX</span>`;
                } else if (m.betLost > 0) {
                    betHtml = `<span class="pfs-match-bet lost">-${m.betLost.toFixed(4)} AVAX</span>`;
                }

                const date = new Date(m.ts);
                const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;

                row.innerHTML = `
                    <span class="pfs-match-result ${resClass}">${resultLabel}</span>
                    <span class="pfs-match-opponent">${opponent}</span>
                    ${betHtml}
                    <span class="pfs-match-date">${dateStr}</span>
                `;
                matchesList.appendChild(row);
            }
        } catch { /* ignore */ }
    })();

    // Avatar değiştir — dosya
    const avatarWrap = document.getElementById('pfs-avatar-wrap');
    const avatarFile = document.getElementById('pfs-avatar-file') as HTMLInputElement;
    if (avatarWrap && avatarFile) {
        avatarWrap.onclick = () => avatarFile.click();
        avatarFile.onchange = () => {
            const file = avatarFile.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const dataUrl = ev.target?.result as string;
                avatarImg.src = dataUrl; // geçici önizleme
                try {
                    const res = await fetch('/api/avatar/upload', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ address: ctx.walletAddress, dataUrl }),
                    });
                    const data = await res.json();
                    const finalUrl = data.ok ? data.url : dataUrl;
                    if (data.ok) localStorage.removeItem(`a2_avatar_${ctx.walletAddress!.toLowerCase()}`);
                    else localStorage.setItem(`a2_avatar_${ctx.walletAddress!.toLowerCase()}`, dataUrl);
                    await profileService.registerProfile(profile!.username, finalUrl);
                    leaderboardService.upsertPlayer(ctx.walletAddress!, profile!.username, finalUrl);
                } catch {
                    localStorage.setItem(`a2_avatar_${ctx.walletAddress!.toLowerCase()}`, dataUrl);
                }
                showToast('Görsel güncellendi', 2000);
            };
            reader.readAsDataURL(file);
        };
    }

    // Avatar değiştir — URL
    const avatarUrlInput = document.getElementById('pfs-avatar-url-input') as HTMLInputElement;
    const avatarUrlBtn = document.getElementById('pfs-avatar-url-btn');
    if (avatarUrlBtn && avatarUrlInput) {
        avatarUrlBtn.onclick = async () => {
            const url = avatarUrlInput.value.trim();
            if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
                showToast('Geçerli bir URL gir', 1500);
                return;
            }
            avatarImg.src = url;
            localStorage.removeItem(`a2_avatar_${ctx.walletAddress!.toLowerCase()}`);
            await profileService.registerProfile(profile!.username, url);
            leaderboardService.upsertPlayer(ctx.walletAddress!, profile!.username, url);
            avatarUrlInput.value = '';
            showToast('Görsel güncellendi', 2000);
        };
    }

    const renameInput = document.getElementById('pfs-rename-input') as HTMLInputElement;
    const renameBtn = document.getElementById('pfs-rename-btn')!;
    renameBtn.onclick = async () => {
        const newName = renameInput.value.trim();
        if (!newName || newName.length > 32) return;
        await profileService.registerProfile(newName, profile.avatarURI ?? '');
        document.getElementById('pfs-display-name')!.textContent = newName;
        renameInput.value = '';
        leaderboardService.upsertPlayer(ctx.walletAddress!, newName);
        showToast(t('pfsNameUpdated' as TransKey), 2000);
    };
}

// ─── INIT WIRING ───────────────────────────────────────────────────
export function initProfileLeaderboard(): void {
    profileCloseBtn.addEventListener('click', () => {
        if (ctx.walletAddress && !profileService.currentProfile) return;
        profileModal.classList.remove('show');
    });
    profileModal.addEventListener('click', (e) => {
        if (ctx.walletAddress && !profileService.currentProfile) return;
        if (e.target === profileModal) profileModal.classList.remove('show');
    });

    profileConnectBtn.addEventListener('click', () => {
        profileModal.classList.remove('show');
        showWalletModal();
    });

    profileAvatarInput.addEventListener('input', () => {
        const url = profileAvatarInput.value.trim();
        if (url) avatarPreview.src = url;
        else avatarPreview.src = '/assets/images/logo.webp';
    });

    profileRegisterBtn.addEventListener('click', async () => {
        const username = profileNameInput.value.trim();
        if (!username || username.length > 32) {
            profileNameInput.style.borderColor = '#ff5555';
            return;
        }
        profileNameInput.style.borderColor = '';
        const avatarURI = profileAvatarInput.value.trim();

        profileRegisterBtn.disabled = true;
        profileRegisterBtn.textContent = 'KAYDEDILIYOR...';

        const ok = await profileService.registerProfile(username, avatarURI);
        profileRegisterBtn.disabled = false;
        profileRegisterBtn.textContent = 'KAYIT OL';

        if (ok) {
            leaderboardService.upsertPlayer(ctx.walletAddress!, username);
            lockGameUntilProfile(false);
            openProfileModal();
        } else {
            alert(t('pfsRegisterFailed' as TransKey));
        }
    });

    // Leaderboard screen sort tabs
    document.querySelectorAll<HTMLButtonElement>('.lb-sort-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.lb-sort-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            void renderLeaderboardScreen(tab.dataset.sort as any);
        });
    });

    // Profile screen connect button
    document.getElementById('pfs-connect-btn')?.addEventListener('click', () => showWalletModal());

    // ── Askıda AVAX ──────────────────────────────────────────────
    initFaucet();
}

// ─── ASKIDA AVAX (FAUCET) ──────────────────────────────────────────
const HOUSE_WALLET = import.meta.env.VITE_HOUSE_WALLET as string;

function setFaucetStatus(panelId: 'donate' | 'claim', msg: string, type: 'ok' | 'err' | ''): void {
    const el = document.getElementById(`askida-${panelId}-status`) as HTMLElement;
    if (!el) return;
    el.innerHTML = msg;
    el.className = `askida-${panelId}-status` + (type ? ' ' + type : '');
    el.style.display = msg ? 'block' : 'none';
}

async function refreshFaucetInfo(): Promise<void> {
    try {
        const url = ctx.walletAddress ? `/api/faucet/info?address=${ctx.walletAddress}` : '/api/faucet/info';
        const data = await fetch(url).then(r => r.json());
        if (!data.ok) return;

        // Banner
        const bannerDonated = document.getElementById('lb-askida-donated');
        if (bannerDonated) bannerDonated.textContent = (data.totalDonated || 0).toFixed(4);

        // Modal stats
        const elPool = document.getElementById('askida-faucet-pool');
        const elDon = document.getElementById('askida-total-donated');
        const elCla = document.getElementById('askida-total-claimed');
        if (elPool) elPool.textContent = (data.faucetPool ?? 0).toFixed(4);
        if (elDon) elDon.textContent = (data.totalDonated || 0).toFixed(4);
        if (elCla) elCla.textContent = (data.totalClaimed || 0).toFixed(4);

        // House wallet address
        if (data.houseWallet) {
            const addrEl = document.getElementById('askida-house-addr');
            if (addrEl) addrEl.textContent = data.houseWallet;
        }

        // Claim eligibility
        const claimBtn = document.getElementById('askida-claim-btn') as HTMLButtonElement | null;
        const walletWarn = document.getElementById('askida-claim-wallet-warn');
        const gamesRow = document.getElementById('askida-elig-games');
        const cooldownRow = document.getElementById('askida-elig-cooldown');
        const gamesBadge = document.getElementById('askida-elig-games-badge');
        const cooldownBadge = document.getElementById('askida-elig-cooldown-badge');

        if (!ctx.walletAddress) {
            if (walletWarn) walletWarn.style.display = 'block';
            if (claimBtn) claimBtn.disabled = true;
        } else {
            if (walletWarn) walletWarn.style.display = 'none';
            const games = data.localGames ?? 0;
            const gamesOk = games >= (data.minGames ?? 3);
            const cooldownOk = (data.cooldownMs ?? 0) === 0;

            if (gamesRow) gamesRow.classList.toggle('ok', gamesOk);
            if (gamesBadge) gamesBadge.textContent = `${Math.min(games, data.minGames ?? 3)}/${data.minGames ?? 3}`;
            if (cooldownRow) cooldownRow.classList.toggle('ok', cooldownOk);
            if (cooldownBadge) {
                if (cooldownOk) {
                    cooldownBadge.textContent = t('askidaReady' as any);
                } else {
                    const h = Math.ceil((data.cooldownMs ?? 0) / 3600000);
                    cooldownBadge.textContent = `${h} ${t('askidaCooldownLeft' as any)}`;
                }
            }
            if (claimBtn) claimBtn.disabled = !(gamesOk && cooldownOk);
        }
    } catch { /* ignore */ }
}

export function openFaucetModal(tab: 'donate' | 'claim' = 'donate'): void {
    const modal = document.getElementById('askida-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    const donatePanel = document.getElementById('askida-panel-donate');
    const claimPanel = document.getElementById('askida-panel-claim');
    const tabDonate = document.getElementById('askida-tab-donate');
    const tabClaim = document.getElementById('askida-tab-claim');
    if (donatePanel) donatePanel.style.display = tab === 'donate' ? 'flex' : 'none';
    if (claimPanel) claimPanel.style.display = tab === 'claim' ? 'flex' : 'none';
    if (tabDonate) tabDonate.classList.toggle('active', tab === 'donate');
    if (tabClaim) tabClaim.classList.toggle('active', tab === 'claim');
    void refreshFaucetInfo();
}

function initFaucet(): void {
    const modal = document.getElementById('askida-modal')!;
    function openModal(tab: 'donate' | 'claim'): void {
        openFaucetModal(tab);
    }

    function showFaucetTab(tab: 'donate' | 'claim'): void {
        document.getElementById('askida-panel-donate')!.style.display = tab === 'donate' ? 'flex' : 'none';
        document.getElementById('askida-panel-claim')!.style.display = tab === 'claim' ? 'flex' : 'none';
        document.getElementById('askida-tab-donate')!.classList.toggle('active', tab === 'donate');
        document.getElementById('askida-tab-claim')!.classList.toggle('active', tab === 'claim');
    }

    // Banner buttons
    document.getElementById('lb-askida-open-donate')?.addEventListener('click', () => openModal('donate'));
    document.getElementById('lb-askida-open-claim')?.addEventListener('click', () => openModal('claim'));

    // Close
    document.getElementById('askida-close')?.addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    // Tabs
    document.getElementById('askida-tab-donate')?.addEventListener('click', () => showFaucetTab('donate'));
    document.getElementById('askida-tab-claim')?.addEventListener('click', () => showFaucetTab('claim'));

    // Copy address
    document.getElementById('askida-copy-addr')?.addEventListener('click', () => {
        const addr = (document.getElementById('askida-house-addr') as HTMLElement).textContent ?? '';
        navigator.clipboard.writeText(addr).catch(() => { });
        const btn = document.getElementById('askida-copy-addr') as HTMLButtonElement;
        const orig = btn.textContent ?? '';
        btn.textContent = t('lobbyCopied' as any);
        setTimeout(() => { btn.textContent = orig; }, 1500);
    });

    // MetaMask deposit
    document.getElementById('askida-deposit-btn')?.addEventListener('click', async () => {
        if (!ctx.walletAddress || !ctx._activeProvider) { setFaucetStatus('donate', t('askidaConnectWallet' as any), 'err'); return; }
        const amtInput = document.getElementById('askida-deposit-amount') as HTMLInputElement;
        const amount = parseFloat(amtInput.value);
        if (!amount || amount <= 0) { setFaucetStatus('donate', 'Geçerli bir miktar gir', 'err'); return; }
        const ethers = (window as any).ethers;
        if (!ethers) { setFaucetStatus('donate', 'ethers yüklü değil', 'err'); return; }
        const btn = document.getElementById('askida-deposit-btn') as HTMLButtonElement;
        btn.disabled = true;
        setFaucetStatus('donate', '', '');
        try {
            const provider = new ethers.BrowserProvider(ctx._activeProvider);
            const signer = await provider.getSigner();
            const tx = await signer.sendTransaction({
                to: HOUSE_WALLET,
                value: ethers.parseEther(amount.toFixed(6)),
                gasLimit: 21000,
            });
            // TX yayınlandı, onay bekleme — Fuji testnet yavaş olabilir
            void fetch('/api/faucet/donate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, address: ctx.walletAddress }) });
            setFaucetStatus('donate', `${t('askidaDepositOk' as any)} <a href="https://testnet.snowtrace.io/tx/${tx.hash}" target="_blank" style="color:#4af;word-break:break-all">${tx.hash.slice(0,18)}…</a>`, 'ok');
            amtInput.value = '';
            void refreshFaucetInfo();
        } catch (e: any) {
            setFaucetStatus('donate', e?.message?.slice(0, 80) ?? 'Hata', 'err');
        } finally {
            btn.disabled = false;
        }
    });

    // Claim
    document.getElementById('askida-claim-btn')?.addEventListener('click', async () => {
        if (!ctx.walletAddress) { setFaucetStatus('claim', t('askidaConnectWallet' as any), 'err'); return; }
        const btn = document.getElementById('askida-claim-btn') as HTMLButtonElement;
        btn.disabled = true;
        setFaucetStatus('claim', '', '');
        try {
            const res = await fetch('/api/faucet/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: ctx.walletAddress }),
            });
            const data = await res.json();
            if (data.ok) {
                setFaucetStatus('claim', t('askidaClaimOk' as any), 'ok');
                void refreshFaucetInfo();
            } else {
                setFaucetStatus('claim', data.error ?? 'Hata', 'err');
                btn.disabled = false;
            }
        } catch {
            setFaucetStatus('claim', 'Bağlantı hatası', 'err');
            btn.disabled = false;
        }
    });

    // Banner donated on leaderboard load
    void refreshFaucetInfo();
}
