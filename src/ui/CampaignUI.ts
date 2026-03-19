/**
 * CampaignUI.ts — Kullaniciya acik kampanya ekrani
 * Gorev listesi, katilim, kampanya leaderboard
 */

import { ctx } from '../game/GameContext';
import { t, TransKey } from '../i18n';
import { showWalletModal } from './WalletUI';

const API = '/api';
const AVAX_MAINNET = {
    chainId: '0xa86a',
    chainName: 'Avalanche C-Chain',
    rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    blockExplorerUrls: ['https://snowtrace.io'],
};
const FUJI_CHAIN_ID = '0xa869';

async function switchToMainnet(provider: any): Promise<boolean> {
    try {
        const chainId = await provider.request({ method: 'eth_chainId' });
        if (chainId === AVAX_MAINNET.chainId) return true;
        try {
            await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: AVAX_MAINNET.chainId }] });
            return true;
        } catch (err: any) {
            if (err.code === 4902) {
                await provider.request({ method: 'wallet_addEthereumChain', params: [AVAX_MAINNET] });
                return true;
            }
            return false;
        }
    } catch { return false; }
}

async function switchBackToFuji(provider: any): Promise<void> {
    try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: FUJI_CHAIN_ID }] });
    } catch { /* ignore */ }
}

function showMainnetConfirm(amount: number): Promise<boolean> {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9500;';
        overlay.innerHTML = `
            <div style="background:rgba(20,12,4,0.98);border:2px solid rgba(255,60,60,0.5);border-radius:14px;padding:28px 32px;max-width:420px;width:90%;text-align:center;box-shadow:0 0 60px rgba(255,60,60,0.15);">
                <div style="font-size:36px;margin-bottom:12px;">&#9888;</div>
                <div style="font-family:'Cinzel',serif;font-size:15px;color:#ff6b6b;letter-spacing:2px;font-weight:700;margin-bottom:14px;">${t('sponsorMainnetWarningTitle' as TransKey)}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.7);line-height:1.7;margin-bottom:18px;">
                    ${(t('sponsorMainnetWarningDesc' as TransKey) as string).replace('{amount}', String(amount))}
                </div>
                <label id="mnc-label" style="display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;margin-bottom:20px;padding:10px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;">
                    <input type="checkbox" id="mnc-check" style="width:18px;height:18px;accent-color:#ffc94d;cursor:pointer;" />
                    <span style="font-size:11px;color:rgba(255,255,255,0.6);letter-spacing:0.5px;">${t('sponsorMainnetCheckbox' as TransKey)}</span>
                </label>
                <div style="display:flex;gap:10px;">
                    <button id="mnc-cancel" style="flex:1;padding:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:rgba(255,255,255,0.5);font-size:12px;cursor:pointer;letter-spacing:1px;">${t('sponsorCancel' as TransKey)}</button>
                    <button id="mnc-confirm" disabled style="flex:1;padding:12px;background:rgba(255,60,60,0.1);border:1px solid rgba(255,60,60,0.3);border-radius:8px;color:rgba(255,100,100,0.4);font-family:'Cinzel',serif;font-size:12px;font-weight:700;cursor:not-allowed;letter-spacing:1.5px;">${t('sponsorMainnetConfirm' as TransKey)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const checkbox = document.getElementById('mnc-check') as HTMLInputElement;
        const confirmBtn = document.getElementById('mnc-confirm') as HTMLButtonElement;
        const cancelBtn = document.getElementById('mnc-cancel') as HTMLButtonElement;

        checkbox.onchange = () => {
            confirmBtn.disabled = !checkbox.checked;
            confirmBtn.style.color = checkbox.checked ? '#ff6b6b' : 'rgba(255,100,100,0.4)';
            confirmBtn.style.borderColor = checkbox.checked ? 'rgba(255,60,60,0.6)' : 'rgba(255,60,60,0.3)';
            confirmBtn.style.cursor = checkbox.checked ? 'pointer' : 'not-allowed';
            confirmBtn.style.background = checkbox.checked ? 'rgba(255,60,60,0.15)' : 'rgba(255,60,60,0.1)';
        };
        confirmBtn.onclick = () => { overlay.remove(); resolve(true); };
        cancelBtn.onclick = () => { overlay.remove(); resolve(false); };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
    });
}

let currentCampaign: any = null;
let userJoined = false;
let userCompletedTasks: Record<string, number> = {};
let countdownInterval: ReturnType<typeof setInterval> | null = null;

// ── Fetch helpers ────────────────────────────────────────────────────
async function fetchJSON(url: string, opts?: RequestInit): Promise<any> {
    const res = await fetch(url, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(opts?.headers as any ?? {}) },
    });
    return res.json();
}

// ── Ana render ───────────────────────────────────────────────────────
export async function renderCampaignScreen(): Promise<void> {
    const content = document.getElementById('camp-content')!;
    content.innerHTML = `<div class="camp-loading">${t('campaignLoading' as TransKey)}</div>`;

    try {
        const data = await fetchJSON(`${API}/campaigns/active`);
        const campaigns = data.campaigns || [];

        if (campaigns.length === 0) {
            content.innerHTML = `
                <div class="lb-empty-state">
                    <div class="lb-empty-state-icon">🏕</div>
                    <div>${t('campaignNoActive' as TransKey)}</div>
                    <div style="margin-top:8px;color:rgba(255,255,255,0.1)">${t('campaignNoActiveDesc' as TransKey)}</div>
                </div>`;
            return;
        }

        const camp = campaigns[0];
        currentCampaign = camp;

        if (ctx.walletAddress) {
            const info = await fetchJSON(`${API}/campaign/${camp.id}/info?address=${ctx.walletAddress}`);
            userJoined = info.joined || false;
            userCompletedTasks = info.completedTasks || {};
        } else {
            userJoined = false;
            userCompletedTasks = {};
        }

        renderCampaignContent(camp, content);
    } catch (e: any) {
        content.innerHTML = `<div class="camp-loading" style="color:#ff7b7b">${t('campaignError' as TransKey)}: ${e.message}</div>`;
    }
}

function renderCampaignContent(camp: any, container: HTMLElement): void {
    const tasks = camp.tasks || [];
    const dist = camp.distribution || {};
    const lb = camp.leaderboard || [];
    const completedCount = Object.keys(userCompletedTasks).length;
    const totalTasks = tasks.length;

    // Sonraki dagitim zamani
    let nextDistTargetMs = 0;
    if (dist.lastDistributionAt && dist.intervalHours) {
        nextDistTargetMs = dist.lastDistributionAt + dist.intervalHours * 60 * 60 * 1000;
    } else if (dist.intervalHours && camp.createdAt) {
        nextDistTargetMs = camp.createdAt + dist.intervalHours * 60 * 60 * 1000;
    }

    // Ratios hesapla
    const ratios = dist.ratios || [100];
    const dailyAvax = dist.dailyAvax || 0;

    container.innerHTML = `
        <!-- Prize Pool Banner — lb-prize-pool ile ayni yapi -->
        <div class="lb-prize-pool" style="border-color:rgba(255,185,50,0.25);background:linear-gradient(160deg,rgba(40,30,8,0.9),rgba(12,8,0,0.95));box-shadow:0 0 80px rgba(255,185,50,0.08)">
            <div class="lb-pp-left">
                <div class="lb-pp-meta">
                    <span class="lb-pp-season" style="color:rgba(255,185,50,0.55)">${camp.network === 'mainnet' ? 'MAINNET' : camp.network === 'testnet' ? 'TESTNET' : camp.network.toUpperCase()}</span>
                    ${nextDistTargetMs ? `<span class="lb-pp-countdown" id="camp-countdown" data-target="${nextDistTargetMs}">--:--</span>` : ''}
                </div>
                <div class="lb-pp-label" style="color:rgba(255,185,50,0.6)">${t('campaignDailyReward' as TransKey)}</div>
                <div class="lb-pp-amount" style="color:#ffc94d;text-shadow:0 0 40px rgba(255,185,50,0.7),0 0 80px rgba(255,185,50,0.3)">
                    <span>${dailyAvax}</span>
                    <img class="lb-pp-avax-icon" src="/assets/images/Avalanche_Blockchain_Logo.svg" alt="AVAX" style="width:36px;height:36px;opacity:0.85" />
                </div>
                <div class="lb-pp-note">${camp.participantCount || 0} ${t('campaignParticipants' as TransKey)} · ${(t('campaignEveryHour' as TransKey) as string).replace('{0}', String(dist.intervalHours || 24))}</div>
            </div>
            <div class="lb-pp-right">
                ${ratios.slice(0, dist.topN || 1).map((r: number, i: number) => {
                    const amt = +(dailyAvax * r / 100).toFixed(4);
                    const ranks = ['1.', '2.', '3.', '4.', '5.'];
                    return `
                    <div class="lb-pp-prize-box">
                        <div class="lb-pp-prize-rank">${ranks[i] || (i+1) + '.'}</div>
                        <div class="lb-pp-prize-val">${amt}</div>
                        <div class="lb-pp-prize-unit">AVAX</div>
                    </div>`;
                }).join('')}
            </div>
        </div>

        <!-- Katil / Katildi -->
        ${!userJoined ? `
            <button class="camp-join-btn" id="camp-join-btn">${t('campaignJoin' as TransKey)}</button>
        ` : `
            <div class="camp-joined-badge">${t('campaignJoined' as TransKey)} · ${completedCount}/${totalTasks} ${t('campaignTaskCount' as TransKey)}</div>
        `}

        <!-- Sponsor Ol -->
        <button class="camp-sponsor-btn" id="camp-sponsor-btn">${t('sponsorBtn' as TransKey)}</button>

        <!-- Gorevler -->
        ${tasks.length > 0 ? `
        <div class="camp-tasks-section">
            <h3 class="camp-section-title">${t('campaignTasks' as TransKey)}</h3>
            <div class="camp-tasks-list">
                ${tasks.map((task: any) => {
                    const done = !!userCompletedTasks[task.id];
                    const typeLabel = task.type === 'twitter_follow' ? t('campaignTaskFollow' as TransKey)
                        : task.type === 'twitter_rt' ? t('campaignTaskRT' as TransKey)
                        : task.type === 'twitter_like' ? t('campaignTaskLike' as TransKey)
                        : t('campaignTaskCustom' as TransKey);
                    return `
                    <div class="camp-task-card ${done ? 'camp-task-done' : ''}">
                        <div class="camp-task-info">
                            <div class="camp-task-type">${typeLabel}</div>
                            <div class="camp-task-title">${escHtml(task.title)}</div>
                            ${task.description ? `<div class="camp-task-desc">${escHtml(task.description)}</div>` : ''}
                        </div>
                        <div class="camp-task-points">+${task.points}p</div>
                        <div class="camp-task-action">
                            ${done
                                ? '<span class="camp-task-check">✓</span>'
                                : userJoined
                                    ? `<button class="camp-task-btn" data-task-id="${task.id}" data-task-type="${escHtml(task.type || '')}" data-task-url="${escHtml(task.url || '')}">${t('campaignTaskComplete' as TransKey)}</button>`
                                    : ''
                            }
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>` : ''}

        <!-- Kampanya Leaderboard — Podium (lb-podium ile ayni) -->
        ${lb.length > 0 ? `
        <div class="lb-podium">
            ${lb.slice(0, 3).map((e: any, i: number) => {
                const isMe = e.address.toLowerCase() === (ctx.walletAddress ?? '').toLowerCase();
                const cls = ['p1', 'p2', 'p3'][i];
                const addrShort = e.address.slice(0, 6) + '...' + e.address.slice(-4);
                return `
                <div class="lb-podium-card ${cls} ${isMe ? 'lb-me' : ''}">
                    <div class="lb-podium-rank">${i + 1}</div>
                    <div class="lb-podium-name">${escHtml(e.username)}</div>
                    <div class="lb-podium-addr">${addrShort}</div>
                    <div class="lb-podium-stats">
                        <div class="lb-podium-stat">
                            <div class="lb-podium-stat-val">${e.points}</div>
                            <div class="lb-podium-stat-lbl">${t('campaignPoints' as TransKey)}</div>
                        </div>
                        <div class="lb-podium-stat">
                            <div class="lb-podium-stat-val">${e.tasksCompleted}</div>
                            <div class="lb-podium-stat-lbl">${t('campaignTask' as TransKey)}</div>
                        </div>
                    </div>
                    ${i < ratios.length ? `
                    <div class="lb-podium-avx">
                        <div class="lb-podium-avx-val">${+(dailyAvax * (ratios[i] || 0) / 100).toFixed(4)}</div>
                        <div class="lb-podium-avx-lbl">AVAX / ${t('campaignDistribution' as TransKey)}</div>
                    </div>` : ''}
                </div>`;
            }).join('')}
        </div>` : ''}

        <!-- Kampanya Leaderboard Table — lb-full-table ile ayni -->
        <div class="lb-table-wrap">
            <table class="lb-full-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>${t('campaignPlayer' as TransKey)}</th>
                        <th>${t('campaignPoints' as TransKey)}</th>
                        <th>${t('campaignTask' as TransKey)}</th>
                    </tr>
                </thead>
                <tbody>
                    ${lb.length > 0 ? lb.map((e: any, i: number) => {
                        const isMe = e.address.toLowerCase() === (ctx.walletAddress ?? '').toLowerCase();
                        const rankCls = i < 3 ? ['lb-rank-gold', 'lb-rank-silver', 'lb-rank-bronze'][i] : 'lb-rank-4up';
                        return `
                        <tr class="${isMe ? 'lb-me' : ''}">
                            <td><span class="lb-rank-num ${rankCls}">${i + 1}</span></td>
                            <td>
                                <div class="lb-player-cell">
                                    <div>
                                        <div class="lb-player-name">${escHtml(e.username)}</div>
                                        <div class="lb-player-addr">${e.address.slice(0, 6)}...${e.address.slice(-4)}</div>
                                    </div>
                                </div>
                            </td>
                            <td class="lb-prize-val">${e.points}p</td>
                            <td>${e.tasksCompleted}</td>
                        </tr>`;
                    }).join('') : `
                        <tr><td colspan="4" style="text-align:center;padding:40px;color:rgba(255,255,255,0.15)">${t('campaignLbEmpty' as TransKey)}</td></tr>
                    `}
                </tbody>
            </table>
        </div>

        <!-- Sponsorlar -->
        ${(camp.sponsors && camp.sponsors.length > 0) ? `
        <div class="camp-tasks-section">
            <h3 class="camp-section-title">${t('sponsorTitle' as TransKey)}</h3>
            <div class="camp-sponsors-list">
                ${camp.sponsors.sort((a: any, b: any) => b.amount - a.amount).slice(0, 10).map((s: any) => {
                    const addrShort = s.address.slice(0, 6) + '...' + s.address.slice(-4);
                    const isMe = s.address.toLowerCase() === (ctx.walletAddress ?? '').toLowerCase();
                    const name = s.username || addrShort;
                    const avatar = s.avatarURI
                        ? `<img src="${escHtml(s.avatarURI)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,185,50,0.3);" />`
                        : `<div style="width:28px;height:28px;border-radius:50%;background:rgba(255,185,50,0.12);display:flex;align-items:center;justify-content:center;font-size:12px;color:rgba(255,185,50,0.5);border:1px solid rgba(255,185,50,0.2);">${name.charAt(0).toUpperCase()}</div>`;
                    return `
                    <div class="camp-sponsor-row ${isMe ? 'lb-me' : ''}">
                        ${avatar}
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:12px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(name)}</div>
                            <div style="font-size:9px;color:rgba(255,255,255,0.25);font-family:monospace;">${addrShort}</div>
                        </div>
                        <div class="camp-sponsor-amount">${s.amount.toFixed(4)} AVAX</div>
                    </div>`;
                }).join('')}
            </div>
        </div>` : ''}
    `;

    // Event listeners
    const joinBtn = document.getElementById('camp-join-btn');
    if (joinBtn) {
        joinBtn.addEventListener('click', () => joinCampaign(camp.id));
    }

    const sponsorBtn = document.getElementById('camp-sponsor-btn');
    if (sponsorBtn) {
        sponsorBtn.addEventListener('click', () => showSponsorModal(camp));
    }

    container.querySelectorAll<HTMLButtonElement>('.camp-task-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const taskId = btn.dataset.taskId!;
            const taskType = btn.dataset.taskType || 'custom';
            const taskUrl = btn.dataset.taskUrl;
            completeTask(camp.id, taskId, taskType, taskUrl);
        });
    });

    startCountdown();
}

function startCountdown(): void {
    if (countdownInterval) clearInterval(countdownInterval);
    const el = document.getElementById('camp-countdown');
    if (!el) return;
    const target = parseInt(el.dataset.target || '0');
    if (!target) return;

    function tick() {
        const el = document.getElementById('camp-countdown');
        if (!el) { if (countdownInterval) clearInterval(countdownInterval); return; }
        const remain = target - Date.now();
        if (remain <= 0) {
            el.textContent = t('campaignSoon' as TransKey);
            if (countdownInterval) clearInterval(countdownInterval);
            return;
        }
        const h = Math.floor(remain / 3600000);
        const m = Math.floor((remain % 3600000) / 60000);
        const s = Math.floor((remain % 60000) / 1000);
        el.textContent = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    }
    tick();
    countdownInterval = setInterval(tick, 1000);
}

// ── Kampanyaya katil ─────────────────────────────────────────────────
async function joinCampaign(campaignId: string): Promise<void> {
    if (!ctx.walletAddress) {
        showWalletModal();
        return;
    }
    try {
        const data = await fetchJSON(`${API}/campaign/${campaignId}/join`, {
            method: 'POST',
            body: JSON.stringify({ address: ctx.walletAddress }),
        });
        if (!data.ok && !data.joined) throw new Error(data.error);
        userJoined = true;
        renderCampaignScreen();
    } catch (e: any) {
        // Zaten katildiysa yeniden render et
        if (e.message && e.message.includes('Zaten')) {
            userJoined = true;
            renderCampaignScreen();
        } else {
            alert(t('campaignError' as TransKey) + ': ' + e.message);
        }
    }
}

function showProofModal(taskType: string, onConfirm: (proof: string) => void) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;';
    
    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(20,12,4,0.98);border:1px solid rgba(255,185,50,0.3);border-radius:12px;padding:24px;width:90%;max-width:400px;text-align:center;box-shadow:0 0 40px rgba(0,0,0,0.8);';
    
    let titleStr = '';
    let descStr = '';
    let placeholderStr = '';

    if (taskType === 'twitter_rt') {
        titleStr = 'RETWEET LİNKİ GEREKLİ';
        descStr = 'Lütfen yaptığınız <b>Retweet\'in bağlantısını (Link)</b> girin.<br><span style="color:#ff6b6b;font-size:11px;">(Yanlış linkler iptal edilir)</span>';
        placeholderStr = 'https://x.com/kullanici/status/...';
    } else if (taskType === 'twitter_follow' || taskType === 'twitter_like') {
        titleStr = 'KULLANICI ADI GEREKLİ';
        descStr = 'Lütfen bu görevi tamamladığınız <b>X (Twitter) kullanıcı adınızı</b> girin.<br><span style="color:#ff6b6b;font-size:11px;">(Yanlış isimler iptal edilir)</span>';
        placeholderStr = '@kullaniciadi';
    } else {
        titleStr = 'GÖREV DOĞRULAMA';
        descStr = 'Lütfen bu görevi tamamladığınıza dair kanıt (Link vb.) girin.';
        placeholderStr = 'Kanıt...';
    }

    box.innerHTML = `
        <div style="font-family:'Cinzel',serif;color:#ffc94d;font-size:16px;margin-bottom:12px;letter-spacing:1px;">${titleStr}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:20px;line-height:1.5;">${descStr}</div>
        <input type="text" id="proof-input" placeholder="${placeholderStr}" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:12px;border-radius:6px;margin-bottom:20px;font-size:13px;outline:none;" />
        <div style="display:flex;gap:10px;">
            <button id="proof-cancel" style="flex:1;padding:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#ccc;border-radius:6px;cursor:pointer;">İptal</button>
            <button id="proof-submit" style="flex:1;padding:10px;background:rgba(255,185,50,0.15);border:1px solid rgba(255,185,50,0.4);color:#ffc94d;border-radius:6px;cursor:pointer;font-weight:bold;">Doğrula</button>
        </div>
    `;
    
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    const input = document.getElementById('proof-input') as HTMLInputElement;
    input.focus();
    
    const submit = () => {
        const val = input.value.trim();
        if (val.length < 3) {
            input.style.borderColor = '#ff6b6b';
            return;
        }
        overlay.remove();
        onConfirm(val);
    };
    
    document.getElementById('proof-submit')!.onclick = submit;
    document.getElementById('proof-cancel')!.onclick = () => overlay.remove();
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

// ── Gorev tamamla ────────────────────────────────────────────────────
async function completeTask(campaignId: string, taskId: string, taskType: string, url?: string): Promise<void> {
    if (!ctx.walletAddress) return;

    if (url) {
        window.open(url, '_blank');
    }

    showProofModal(taskType, async (proof) => {
        try {
            const data = await fetchJSON(`${API}/campaign/${campaignId}/complete-task`, {
                method: 'POST',
                body: JSON.stringify({ address: ctx.walletAddress, taskId, proof }),
            });
            if (!data.ok) throw new Error(data.error);

            userCompletedTasks[taskId] = Date.now();
            renderCampaignScreen();
        } catch (e: any) {
            if (e.message && e.message.includes('zaten tamamlandi')) {
                userCompletedTasks[taskId] = Date.now();
                renderCampaignScreen();
            } else {
                alert(t('campaignError' as TransKey) + ': ' + (e.message || String(e)));
            }
        }
    });
}

// ── Sponsor Modal ───────────────────────────────────────────────────
function showSponsorModal(camp: any): void {
    if (!ctx.walletAddress) {
        showWalletModal();
        return;
    }
    const houseWallet = camp.houseWallet || '';
    const existing = document.getElementById('sponsor-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'sponsor-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9000;';
    modal.innerHTML = `
        <div style="background:rgba(20,15,30,0.97);border:1px solid rgba(255,185,50,0.25);border-radius:14px;padding:28px 32px;max-width:460px;width:90%;font-family:'Inter',sans-serif;color:#e2e8f0;">
            <h3 style="font-family:'Cinzel',serif;margin:0 0 16px;font-size:16px;color:#ffc94d;letter-spacing:2px;">${t('sponsorModalTitle' as TransKey)}</h3>
            <p style="font-size:12px;color:rgba(255,255,255,0.5);margin:0 0 16px;line-height:1.6">${t('sponsorModalDesc' as TransKey)}</p>

            <label style="font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:1px;display:block;margin-bottom:6px">${t('sponsorAmountLabel' as TransKey)}</label>
            <input id="spm-amount" type="number" step="0.01" min="0.01" placeholder="0.1" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;padding:10px 12px;font-size:14px;outline:none;margin-bottom:18px" />

            <button id="spm-send-wallet" style="width:100%;padding:13px;background:linear-gradient(135deg,rgba(255,185,50,0.15),rgba(255,140,0,0.15));border:1px solid rgba(255,185,50,0.4);border-radius:8px;color:#ffc94d;font-family:'Cinzel',serif;font-size:13px;font-weight:700;letter-spacing:1.5px;cursor:pointer;margin-bottom:12px">${t('sponsorSendWallet' as TransKey)}</button>

            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
                <div style="flex:1;height:1px;background:rgba(255,255,255,0.1)"></div>
                <span style="font-size:10px;color:rgba(255,255,255,0.25);letter-spacing:1px">${t('sponsorOrManual' as TransKey)}</span>
                <div style="flex:1;height:1px;background:rgba(255,255,255,0.1)"></div>
            </div>

            <div style="display:flex;gap:8px;margin-bottom:12px">
                <input id="spm-wallet" type="text" readonly value="${houseWallet}" style="flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,185,50,0.6);padding:8px 10px;font-size:10px;font-family:monospace;outline:none" />
                <button id="spm-copy" style="padding:6px 12px;background:rgba(255,185,50,0.08);border:1px solid rgba(255,185,50,0.2);border-radius:8px;color:#ffc94d;font-size:9px;font-weight:700;cursor:pointer;letter-spacing:1px;white-space:nowrap">${t('sponsorCopy' as TransKey)}</button>
            </div>

            <input id="spm-txhash" type="text" placeholder="${t('sponsorTxLabel' as TransKey)} (0x...)" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;padding:8px 10px;font-size:11px;font-family:monospace;outline:none;margin-bottom:12px" />

            <div style="display:flex;gap:10px">
                <button id="spm-confirm" style="flex:1;padding:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:rgba(255,255,255,0.5);font-size:11px;cursor:pointer;letter-spacing:1px">${t('sponsorConfirmManual' as TransKey)}</button>
                <button id="spm-cancel" style="padding:10px 18px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.4);font-size:11px;cursor:pointer">${t('sponsorCancel' as TransKey)}</button>
            </div>
            <p id="spm-status" style="font-size:11px;color:rgba(255,255,255,0.4);margin:12px 0 0;text-align:center;display:none"></p>
        </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.getElementById('spm-cancel')!.onclick = () => modal.remove();
    document.getElementById('spm-copy')!.onclick = () => {
        navigator.clipboard.writeText(houseWallet);
        const copyBtn = document.getElementById('spm-copy')!;
        const orig = copyBtn.textContent!;
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = orig; }, 1200);
    };

    // Cuzdan ile direkt gonder
    document.getElementById('spm-send-wallet')!.onclick = async () => {
        const amount = parseFloat((document.getElementById('spm-amount') as HTMLInputElement).value);
        const statusEl = document.getElementById('spm-status')!;
        const sendBtn = document.getElementById('spm-send-wallet') as HTMLButtonElement;

        if (!amount || amount <= 0) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#ff7b7b';
            statusEl.textContent = t('sponsorErrAmount' as TransKey);
            return;
        }

        const _ethers = (window as any).ethers;
        if (!_ethers || !ctx._activeProvider) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#ff7b7b';
            statusEl.textContent = 'Wallet not connected';
            return;
        }

        // Mainnet uyari confirmation
        sendBtn.disabled = true;
        const confirmed = await showMainnetConfirm(amount);
        if (!confirmed) {
            sendBtn.disabled = false;
            return;
        }

        statusEl.style.display = 'block';
        statusEl.style.color = 'rgba(255,255,255,0.4)';
        statusEl.textContent = 'Mainnet\'e geciliyor...';

        try {
            // Mainnet'e switch et
            const onMainnet = await switchToMainnet(ctx._activeProvider);
            if (!onMainnet) {
                throw new Error('Avalanche Mainnet\'e gecilemedi. MetaMask\'tan agi kontrol et.');
            }

            statusEl.textContent = t('sponsorSending' as TransKey);
            const provider = new _ethers.BrowserProvider(ctx._activeProvider);
            const signer = await provider.getSigner();
            const tx = await signer.sendTransaction({
                to: houseWallet,
                value: _ethers.parseEther(amount.toString()),
            });
            statusEl.textContent = t('sponsorWaiting' as TransKey);
            await tx.wait();

            // Backend'e bildir
            await fetchJSON(`${API}/campaign/${camp.id}/sponsor`, {
                method: 'POST',
                body: JSON.stringify({ address: ctx.walletAddress, txHash: tx.hash, amount }),
            });

            statusEl.style.color = '#55ff99';
            statusEl.textContent = t('sponsorSuccess' as TransKey);
            setTimeout(async () => {
                modal.remove();
                // Fuji'ye geri don (oyun icin)
                await switchBackToFuji(ctx._activeProvider);
                renderCampaignScreen();
            }, 1500);
        } catch (e: any) {
            sendBtn.disabled = false;
            statusEl.style.color = '#ff7b7b';
            statusEl.textContent = e.reason || e.message || t('campaignError' as TransKey);
            // Hata olursa da Fuji'ye geri don
            switchBackToFuji(ctx._activeProvider);
        }
    };

    // Manuel tx hash ile onayla
    document.getElementById('spm-confirm')!.onclick = async () => {
        const txHash = (document.getElementById('spm-txhash') as HTMLInputElement).value.trim();
        const amount = parseFloat((document.getElementById('spm-amount') as HTMLInputElement).value);
        const statusEl = document.getElementById('spm-status')!;
        const confirmBtn = document.getElementById('spm-confirm') as HTMLButtonElement;

        if (!txHash || !txHash.startsWith('0x')) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#ff7b7b';
            statusEl.textContent = t('sponsorErrTx' as TransKey);
            return;
        }
        if (!amount || amount <= 0) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#ff7b7b';
            statusEl.textContent = t('sponsorErrAmount' as TransKey);
            return;
        }

        confirmBtn.disabled = true;
        statusEl.style.display = 'block';
        statusEl.style.color = 'rgba(255,255,255,0.4)';
        statusEl.textContent = t('sponsorVerifying' as TransKey);

        try {
            const data = await fetchJSON(`${API}/campaign/${camp.id}/sponsor`, {
                method: 'POST',
                body: JSON.stringify({ address: ctx.walletAddress, txHash, amount }),
            });
            if (!data.ok) throw new Error(data.error);
            statusEl.style.color = '#55ff99';
            statusEl.textContent = t('sponsorSuccess' as TransKey);
            setTimeout(() => {
                modal.remove();
                renderCampaignScreen();
            }, 1500);
        } catch (e: any) {
            statusEl.style.color = '#ff7b7b';
            statusEl.textContent = e.message || t('campaignError' as TransKey);
            confirmBtn.disabled = false;
        }
    };
}

// ── Helpers ──────────────────────────────────────────────────────────
function escHtml(str: string): string {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
