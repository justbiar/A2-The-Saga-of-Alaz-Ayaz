/**
 * AdminPanel.ts — Gizli admin yönetim paneli
 * Erişim: Ctrl+Shift+A
 * Auth: Cüzdan imzası → sunucu token (1 saat)
 */

import { ctx } from '../game/GameContext';

const TOKEN_KEY = 'a2_admin_token';
const API = '/api';

let adminToken: string | null = sessionStorage.getItem(TOKEN_KEY);
let panelEl: HTMLElement | null = null;

// ── Panel oluştur & body'e ekle ───────────────────────────────────────
function buildPanel(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'admin-panel';
    el.innerHTML = `
        <!-- Auth ekranı -->
        <div id="admin-auth-screen">
            <div class="adm-auth-card">
                <div class="adm-auth-icon">⚔</div>
                <h2>A2 Admin Paneli</h2>
                <p id="adm-auth-msg">Yönetim paneline erişmek için cüzdanınızla imzalayın.</p>
                <button id="adm-sign-btn" class="adm-btn adm-btn-primary">İmzala &amp; Giriş Yap</button>
                <button id="adm-close-auth-btn" class="adm-btn adm-btn-ghost">Kapat</button>
            </div>
        </div>

        <!-- Ana panel -->
        <div id="admin-main" style="display:none">
            <aside class="adm-sidebar">
                <div class="adm-sidebar-brand">⚔ A2 Admin</div>
                <nav class="adm-nav">
                    <button class="adm-nav-btn active" data-tab="overview">Dashboard</button>
                    <button class="adm-nav-btn" data-tab="players">Oyuncular</button>
                    <button class="adm-nav-btn" data-tab="reports">Raporlar <span id="adm-reports-badge" class="adm-badge" style="display:none"></span></button>
                    <button class="adm-nav-btn" data-tab="bans">Banlar</button>
                    <button class="adm-nav-btn" data-tab="campaigns">Kampanyalar</button>
                    <button class="adm-nav-btn" data-tab="pool">Fee Pool</button>
                    <button class="adm-nav-btn" data-tab="chat">Chat Logları</button>
                </nav>
                <div class="adm-sidebar-foot">
                    <div id="adm-wallet-label" class="adm-wallet-label"></div>
                    <button id="adm-logout-btn" class="adm-btn adm-btn-danger-sm">Çıkış</button>
                    <button id="adm-close-btn" class="adm-btn adm-btn-ghost-sm">✕ Kapat</button>
                </div>
            </aside>

            <main class="adm-content">
                <div id="adm-tab-overview" class="adm-tab">
                    <div class="adm-tab-header"><h2>Dashboard</h2><button class="adm-btn adm-btn-ghost" id="adm-refresh-btn">Yenile</button></div>
                    <div id="adm-stats-grid" class="adm-stats-grid"></div>
                    <div id="adm-overview-extra"></div>
                </div>

                <div id="adm-tab-players" class="adm-tab" style="display:none">
                    <div class="adm-tab-header">
                        <h2>Oyuncular</h2>
                        <input id="adm-player-search" class="adm-input" type="text" placeholder="Adres veya isim ara…" />
                    </div>
                    <div id="adm-players-wrap" class="adm-table-wrap"></div>
                </div>

                <div id="adm-tab-reports" class="adm-tab" style="display:none">
                    <div class="adm-tab-header">
                        <h2>Raporlar</h2>
                        <div class="adm-filter-row">
                            <button class="adm-filter-btn active" data-filter="open">Açık</button>
                            <button class="adm-filter-btn" data-filter="resolved">Çözüldü</button>
                            <button class="adm-filter-btn" data-filter="">Tümü</button>
                        </div>
                    </div>
                    <div id="adm-reports-list"></div>
                </div>

                <div id="adm-tab-bans" class="adm-tab" style="display:none">
                    <div class="adm-tab-header">
                        <h2>Banlar</h2>
                        <button id="adm-ban-new-btn" class="adm-btn adm-btn-primary">+ Yeni Ban</button>
                    </div>
                    <div id="adm-bans-list"></div>
                </div>

                <div id="adm-tab-campaigns" class="adm-tab" style="display:none">
                    <div class="adm-tab-header">
                        <h2>Kampanyalar</h2>
                        <button id="adm-campaign-new-btn" class="adm-btn adm-btn-primary">+ Yeni Kampanya</button>
                    </div>
                    <div id="adm-campaigns-list"></div>
                </div>

                <div id="adm-tab-pool" class="adm-tab" style="display:none">
                    <div class="adm-tab-header"><h2>Fee Pool</h2></div>
                    <div id="adm-pool-info"></div>
                </div>

                <div id="adm-tab-chat" class="adm-tab" style="display:none">
                    <div class="adm-tab-header">
                        <h2>Chat Logları</h2>
                        <button id="adm-chat-refresh-btn" class="adm-btn adm-btn-ghost">Yenile</button>
                    </div>
                    <div id="adm-chat-list"></div>
                </div>
            </main>
        </div>

        <!-- Modal overlay -->
        <div id="adm-modal-overlay" class="adm-modal-overlay" style="display:none">
            <div id="adm-modal-box" class="adm-modal-box"></div>
        </div>
    `;
    return el;
}

// ── API yardımcıları ──────────────────────────────────────────────────
async function admFetch(path: string, opts: RequestInit = {}): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (adminToken) headers['X-Admin-Token'] = adminToken;
    const res = await fetch(API + path, { ...opts, headers: { ...headers, ...(opts.headers as any ?? {}) } });
    if (res.status === 401) {
        sessionStorage.removeItem(TOKEN_KEY);
        adminToken = null;
        showAuthScreen();
        throw new Error('Oturum süresi dolmuş');
    }
    return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────
function showAuthScreen() {
    document.getElementById('admin-auth-screen')!.style.display = 'flex';
    document.getElementById('admin-main')!.style.display = 'none';
}

function showMainPanel() {
    document.getElementById('admin-auth-screen')!.style.display = 'none';
    document.getElementById('admin-main')!.style.display = 'flex';
    const walletEl = document.getElementById('adm-wallet-label');
    if (walletEl) {
        const addr = sessionStorage.getItem('a2_admin_addr') || '';
        walletEl.textContent = addr ? addr.slice(0, 8) + '…' + addr.slice(-4) : '';
    }
    switchTab('overview');
    loadOverviewBadge();
}

async function doAuth() {
    const msgEl = document.getElementById('adm-auth-msg');
    const btn = document.getElementById('adm-sign-btn') as HTMLButtonElement;
    // Önce oyunda aktif bağlı cüzdanı kullan, yoksa window.ethereum'a düş
    const provider = ctx._activeProvider ?? (window as any).ethereum;
    if (!provider) {
        if (msgEl) msgEl.textContent = 'Önce oyunda cüzdanını bağla.';
        return;
    }
    try {
        btn.disabled = true;
        btn.textContent = 'Bağlanıyor…';
        const address = ctx.walletAddress
            ?? (await provider.request({ method: 'eth_requestAccounts' }))[0];
        if (msgEl) msgEl.textContent = 'İmza bekleniyor…';
        btn.textContent = 'İmzala…';
        const challenge = `A2 Admin: ${Date.now()}`;
        const signature = await provider.request({
            method: 'personal_sign',
            params: [challenge, address],
        });
        btn.textContent = 'Doğrulanıyor…';
        const data = await admFetch('/admin/auth', {
            method: 'POST',
            body: JSON.stringify({ address, signature, challenge }),
        });
        if (!data.ok) throw new Error(data.error || 'Giriş başarısız');
        adminToken = data.token;
        sessionStorage.setItem(TOKEN_KEY, adminToken!);
        sessionStorage.setItem('a2_admin_addr', address);
        showMainPanel();
    } catch (e: any) {
        if (msgEl) msgEl.textContent = 'Hata: ' + (e.message || 'Bilinmeyen hata');
        btn.textContent = 'İmzala & Giriş Yap';
    } finally {
        btn.disabled = false;
    }
}

// ── Tab yönetimi ──────────────────────────────────────────────────────
let currentTab = 'overview';

function switchTab(tab: string) {
    currentTab = tab;
    document.querySelectorAll<HTMLElement>('.adm-tab').forEach(t => t.style.display = 'none');
    const el = document.getElementById(`adm-tab-${tab}`);
    if (el) el.style.display = 'block';
    document.querySelectorAll<HTMLButtonElement>('.adm-nav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    switch (tab) {
        case 'overview': loadOverview(); break;
        case 'players': loadPlayers(); break;
        case 'reports': loadReports('open'); break;
        case 'bans': loadBans(); break;
        case 'campaigns': loadCampaigns(); break;
        case 'pool': loadPool(); break;
        case 'chat': loadChat(); break;
    }
}

async function loadOverviewBadge() {
    try {
        const d = await admFetch('/admin/dashboard');
        const badge = document.getElementById('adm-reports-badge');
        if (badge && d.stats?.openReports > 0) {
            badge.textContent = String(d.stats.openReports);
            badge.style.display = 'inline-block';
        }
    } catch { /* ignore */ }
}

// ── Dashboard ─────────────────────────────────────────────────────────
async function loadOverview() {
    const grid = document.getElementById('adm-stats-grid')!;
    grid.innerHTML = '<div class="adm-loading">Yükleniyor…</div>';
    try {
        const d = await admFetch('/admin/dashboard');
        const s = d.stats;
        const cards = [
            { label: 'Toplam Oyuncu', value: s.totalPlayers, icon: '👥' },
            { label: 'Son 24s Aktif', value: s.activeLast24h, icon: '🟢' },
            { label: 'Son 7g Aktif', value: s.activeLast7d, icon: '📅' },
            { label: 'Online Maç', value: s.totalOnlineGames, icon: '🌐' },
            { label: 'Lokal Maç', value: s.totalLocalGames, icon: '🖥' },
            { label: 'Bahis Hacmi', value: s.totalBetVolume + ' AVAX', icon: '💰' },
            { label: 'House Wallet', value: s.houseBalance + ' AVAX', icon: '🏦' },
            { label: 'Aktif Maçlar', value: s.activeMatches, icon: '⚔' },
            { label: 'Fee Pool', value: s.feePool.toFixed(4) + ' AVAX', icon: '💎' },
            { label: 'Dağıtılan', value: (s.totalDistributed || 0).toFixed(4) + ' AVAX', icon: '🎁' },
            { label: 'Banlar', value: s.totalBanned, icon: '🔨', warn: s.totalBanned > 0 },
            { label: 'Açık Raporlar', value: s.openReports, icon: '🚨', warn: s.openReports > 0 },
            { label: 'Aktif Kampanya', value: s.activeCampaigns, icon: '🏆' },
            { label: 'Aktif Lobi', value: s.activeLobbies, icon: '🏠' },
        ];
        grid.innerHTML = cards.map(c => `
            <div class="adm-stat-card${c.warn ? ' adm-stat-warn' : ''}">
                <div class="adm-stat-icon">${c.icon}</div>
                <div class="adm-stat-value">${c.value}</div>
                <div class="adm-stat-label">${c.label}</div>
            </div>
        `).join('');
    } catch (e: any) {
        grid.innerHTML = `<div class="adm-error">${e.message}</div>`;
    }
}

// ── Oyuncular ─────────────────────────────────────────────────────────
let allPlayers: any[] = [];

async function loadPlayers(search = '') {
    const wrap = document.getElementById('adm-players-wrap')!;
    if (allPlayers.length === 0) {
        wrap.innerHTML = '<div class="adm-loading">Yükleniyor…</div>';
        try {
            const d = await admFetch('/admin/players');
            allPlayers = d.players || [];
        } catch (e: any) {
            wrap.innerHTML = `<div class="adm-error">${e.message}</div>`;
            return;
        }
    }
    const q = search.toLowerCase();
    const filtered = q
        ? allPlayers.filter(p => p.address?.toLowerCase().includes(q) || p.username?.toLowerCase().includes(q))
        : allPlayers;

    if (filtered.length === 0) {
        wrap.innerHTML = '<div class="adm-empty">Oyuncu bulunamadı.</div>';
        return;
    }
    wrap.innerHTML = `
        <table class="adm-table">
            <thead><tr>
                <th>Oyuncu</th>
                <th>Online</th>
                <th>Lokal</th>
                <th>Bahis Kazancı</th>
                <th>Son Aktif</th>
                <th>Durum</th>
                <th>İşlem</th>
            </tr></thead>
            <tbody>${filtered.map(p => `
                <tr class="${p.isBanned ? 'adm-row-banned' : ''}">
                    <td>
                        <div class="adm-player-name">${esc(p.username || 'Anonim')}</div>
                        <div class="adm-player-addr">${p.address?.slice(0, 10)}…</div>
                        ${p.reportCount > 0 ? `<span class="adm-badge">${p.reportCount} rapor</span>` : ''}
                    </td>
                    <td>${p.onlineWins}W / ${p.onlineLosses}L</td>
                    <td>${p.localWins}W / ${p.localLosses}L</td>
                    <td>${(p.totalBetWon || 0).toFixed(4)} AVAX</td>
                    <td>${p.lastUpdated ? timeAgo(p.lastUpdated) : '—'}</td>
                    <td>${p.isBanned
                        ? `<span class="adm-chip adm-chip-ban">Banlı</span>`
                        : '<span class="adm-chip adm-chip-ok">Aktif</span>'}</td>
                    <td class="adm-actions">
                        ${p.isBanned
                            ? `<button class="adm-btn adm-btn-sm" onclick="window.__admUnban('${p.address}')">Banı Kaldır</button>`
                            : `<button class="adm-btn adm-btn-sm adm-btn-danger-sm" onclick="window.__admBanModal('${p.address}','${esc(p.username||'')}')">Banla</button>`}
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>
    `;
}

// ── Raporlar ──────────────────────────────────────────────────────────
async function loadReports(statusFilter = 'open') {
    const list = document.getElementById('adm-reports-list')!;
    list.innerHTML = '<div class="adm-loading">Yükleniyor…</div>';
    document.querySelectorAll<HTMLButtonElement>('.adm-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === statusFilter);
    });
    try {
        const url = statusFilter ? `/admin/reports?status=${statusFilter}` : '/admin/reports';
        const d = await admFetch(url);
        const reports: any[] = d.reports || [];
        if (reports.length === 0) {
            list.innerHTML = '<div class="adm-empty">Rapor yok.</div>';
            return;
        }
        list.innerHTML = reports.map(r => `
            <div class="adm-report-card ${r.status === 'resolved' ? 'adm-report-resolved' : ''}">
                <div class="adm-report-header">
                    <span class="adm-report-reason">${esc(r.reason)}</span>
                    <span class="adm-report-time">${timeAgo(r.createdAt)}</span>
                    ${r.isReportedBanned ? '<span class="adm-chip adm-chip-ban">Banlı</span>' : ''}
                </div>
                <div class="adm-report-parties">
                    <span>Şikayet eden: <strong>${esc(r.reporterUsername || addrShort(r.reporterAddress))}</strong></span>
                    <span>Şikayet edilen: <strong>${esc(r.reportedUsername || addrShort(r.reportedAddress))}</strong> (${addrShort(r.reportedAddress)})</span>
                </div>
                ${r.details ? `<div class="adm-report-details">${esc(r.details)}</div>` : ''}
                ${r.matchId ? `<div class="adm-report-match">Maç: ${r.matchId}</div>` : ''}
                ${r.status === 'open' ? `
                    <div class="adm-report-actions">
                        <button class="adm-btn adm-btn-sm" onclick="window.__admResolve('${r.id}','reviewed')">Gözden Geçirildi</button>
                        <button class="adm-btn adm-btn-sm adm-btn-danger-sm" onclick="window.__admBanModal('${r.reportedAddress}','${esc(r.reportedUsername||'')}','${r.id}')">Banla</button>
                        <button class="adm-btn adm-btn-sm adm-btn-ghost" onclick="window.__admResolve('${r.id}','dismissed')">Reddet</button>
                    </div>` : `<div class="adm-report-resolved-info">Çözüldü: ${esc(r.action || '')} — ${timeAgo(r.resolvedAt)}</div>`}
            </div>
        `).join('');
    } catch (e: any) {
        list.innerHTML = `<div class="adm-error">${e.message}</div>`;
    }
}

// ── Banlar ────────────────────────────────────────────────────────────
async function loadBans() {
    const list = document.getElementById('adm-bans-list')!;
    list.innerHTML = '<div class="adm-loading">Yükleniyor…</div>';
    try {
        const d = await admFetch('/admin/bans');
        const bans: any[] = d.bans || [];
        if (bans.length === 0) {
            list.innerHTML = '<div class="adm-empty">Ban kaydı yok.</div>';
            return;
        }
        list.innerHTML = `
            <table class="adm-table">
                <thead><tr><th>Adres</th><th>Sebep</th><th>Tarih</th><th>Banlayan</th><th></th></tr></thead>
                <tbody>${bans.map(b => `
                    <tr>
                        <td><code class="adm-code">${addrShort(b.address)}</code></td>
                        <td>${esc(b.reason)}</td>
                        <td>${b.bannedAt ? new Date(b.bannedAt).toLocaleDateString('tr-TR') : '—'}</td>
                        <td><code class="adm-code">${addrShort(b.bannedBy)}</code></td>
                        <td><button class="adm-btn adm-btn-sm" onclick="window.__admUnban('${b.address}')">Kaldır</button></td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
    } catch (e: any) {
        list.innerHTML = `<div class="adm-error">${e.message}</div>`;
    }
}

// ── Kampanyalar ────────────────────────────────────────────────────────
async function loadCampaigns() {
    const list = document.getElementById('adm-campaigns-list')!;
    list.innerHTML = '<div class="adm-loading">Yükleniyor…</div>';
    try {
        const d = await admFetch('/admin/campaigns');
        const camps: any[] = d.campaigns || [];
        if (camps.length === 0) {
            list.innerHTML = '<div class="adm-empty">Kampanya yok. Yeni bir kampanya oluştur.</div>';
            return;
        }
        list.innerHTML = camps.map(c => `
            <div class="adm-campaign-card">
                <div class="adm-campaign-header">
                    <div>
                        <span class="adm-campaign-name">${esc(c.name)}</span>
                        <span class="adm-chip ${c.status === 'active' ? 'adm-chip-ok' : c.status === 'ended' ? 'adm-chip-gray' : 'adm-chip-warn'}">${c.status}</span>
                        <span class="adm-chip adm-chip-info">${c.network}</span>
                    </div>
                    <div class="adm-campaign-meta">Pool: <strong>${c.poolAvax} AVAX</strong> · Oluşturuldu: ${new Date(c.createdAt).toLocaleDateString('tr-TR')}</div>
                </div>
                ${c.description ? `<div class="adm-campaign-desc">${esc(c.description)}</div>` : ''}
                <div class="adm-campaign-rules">
                    Min oyun: ${c.rules?.minGames || 0} · Min online: ${c.rules?.minOnlineGames || 0} · Min galibiyet: ${c.rules?.minWins || 0}
                </div>
                ${c.snapshots?.length > 0 ? `
                    <div class="adm-campaign-snap">
                        Son snapshot: ${new Date(c.snapshots.at(-1).takenAt).toLocaleString('tr-TR')} — ${c.snapshots.at(-1).players?.length || 0} oyuncu
                        <div class="adm-snap-top">${(c.snapshots.at(-1).players || []).slice(0, 5).map((p: any, i: number) =>
                            `${i+1}. ${esc(p.username || addrShort(p.address))} — ${p.onlineWins}W / ${p.totalBetWon?.toFixed(4) || 0} AVAX`
                        ).join('<br>')}</div>
                    </div>` : ''}
                <div class="adm-campaign-actions">
                    <button class="adm-btn adm-btn-sm" onclick="window.__admSnapshot('${c.id}')">Snapshot Al</button>
                    ${c.snapshots?.length > 0 ? `<button class="adm-btn adm-btn-sm adm-btn-primary" onclick="window.__admDistributeModal('${c.id}')">Dağıt</button>` : ''}
                    ${c.status === 'active' ? `<button class="adm-btn adm-btn-sm adm-btn-ghost" onclick="window.__admEndCampaign('${c.id}')">Sonlandır</button>` : ''}
                </div>
                ${c.distributions?.length > 0 ? `
                    <div class="adm-campaign-dist">Son dağıtım: ${new Date(c.distributions.at(-1).at).toLocaleString('tr-TR')}</div>
                ` : ''}
            </div>
        `).join('');
    } catch (e: any) {
        list.innerHTML = `<div class="adm-error">${e.message}</div>`;
    }
}

// ── Fee Pool ──────────────────────────────────────────────────────────
async function loadPool() {
    const el = document.getElementById('adm-pool-info')!;
    el.innerHTML = '<div class="adm-loading">Yükleniyor…</div>';
    try {
        const d = await fetch('/api/fee-pool').then(r => r.json());
        el.innerHTML = `
            <div class="adm-pool-grid">
                <div class="adm-stat-card"><div class="adm-stat-value">${d.totalFee?.toFixed(4)} AVAX</div><div class="adm-stat-label">Mevcut Pool</div></div>
                <div class="adm-stat-card"><div class="adm-stat-value">Sezon 1 · Hafta ${d.seasonWeek}</div><div class="adm-stat-label">Aktif Hafta</div></div>
                <div class="adm-stat-card"><div class="adm-stat-value">${d.matchCount}</div><div class="adm-stat-label">Toplam Maç</div></div>
                <div class="adm-stat-card"><div class="adm-stat-value">${(d.totalDistributed || 0).toFixed(4)} AVAX</div><div class="adm-stat-label">Toplam Dağıtılan</div></div>
            </div>
            <div class="adm-pool-prizes">
                <h3>Ödüller</h3>
                ${(d.prizes || []).map((p: any) => `
                    <div class="adm-pool-prize-row">
                        <span>${p.rank}. sıra (%${p.ratio})</span>
                        <strong>${p.avax} AVAX</strong>
                    </div>`).join('')}
            </div>
            ${d.distributionHistory?.length > 0 ? `
                <div class="adm-pool-history">
                    <h3>Dağıtım Geçmişi</h3>
                    ${d.distributionHistory.slice().reverse().map((h: any) => `
                        <div class="adm-history-row">
                            <span>Hafta ${h.week}</span>
                            <span>${new Date(h.distributedAt).toLocaleDateString('tr-TR')}</span>
                            <strong>${h.recipients?.length || 0} kişi · ${h.recipients?.reduce((s: number, r: any) => s + r.amount, 0).toFixed(4)} AVAX</strong>
                        </div>`).join('')}
                </div>` : ''}
            <div class="adm-pool-next">Sonraki dağıtım: <strong>${new Date(d.nextDistribution).toLocaleString('tr-TR')}</strong></div>
        `;
    } catch (e: any) {
        el.innerHTML = `<div class="adm-error">${e.message}</div>`;
    }
}

// ── Chat Logları ──────────────────────────────────────────────────────
async function loadChat() {
    const list = document.getElementById('adm-chat-list')!;
    list.innerHTML = '<div class="adm-loading">Yükleniyor…</div>';
    try {
        const d = await admFetch('/admin/chat');
        const msgs: any[] = d.messages || [];
        if (msgs.length === 0) {
            list.innerHTML = '<div class="adm-empty">Mesaj yok.</div>';
            return;
        }
        list.innerHTML = `
            <table class="adm-table">
                <thead><tr><th>Zaman</th><th>Kullanıcı</th><th>Mesaj</th><th></th></tr></thead>
                <tbody>${msgs.map(m => `
                    <tr>
                        <td>${new Date(m.ts).toLocaleTimeString('tr-TR')}</td>
                        <td>${esc(m.nickname)}</td>
                        <td>${esc(m.text)}</td>
                        <td><button class="adm-btn adm-btn-sm adm-btn-danger-sm" onclick="window.__admDeleteChat('${m.id}')">Sil</button></td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
    } catch (e: any) {
        list.innerHTML = `<div class="adm-error">${e.message}</div>`;
    }
}

// ── Modaller ──────────────────────────────────────────────────────────
function showModal(html: string) {
    const overlay = document.getElementById('adm-modal-overlay')!;
    const box = document.getElementById('adm-modal-box')!;
    box.innerHTML = html;
    overlay.style.display = 'flex';
}

function hideModal() {
    document.getElementById('adm-modal-overlay')!.style.display = 'none';
}

// Ban modal
function showBanModal(address: string, username: string, resolveReportId?: string) {
    showModal(`
        <h3>Oyuncu Banla</h3>
        <p><strong>${esc(username || addrShort(address))}</strong><br><code>${addrShort(address)}</code></p>
        <div class="adm-form-group">
            <label>Sebep:</label>
            <select id="adm-ban-reason" class="adm-input">
                <option value="Hile / Cheating">Hile / Cheating</option>
                <option value="Toksik Davranış">Toksik Davranış</option>
                <option value="Spam">Spam</option>
                <option value="Dolandırıcılık">Dolandırıcılık</option>
                <option value="Diğer">Diğer</option>
            </select>
        </div>
        <div class="adm-form-group">
            <label>Notlar (opsiyonel):</label>
            <textarea id="adm-ban-notes" class="adm-input adm-textarea" placeholder="Ek bilgi…"></textarea>
        </div>
        <div class="adm-modal-actions">
            <button class="adm-btn adm-btn-danger-sm" id="adm-ban-confirm-btn">Banla</button>
            <button class="adm-btn adm-btn-ghost" onclick="window.__admHideModal()">İptal</button>
        </div>
    `);
    document.getElementById('adm-ban-confirm-btn')!.onclick = async () => {
        const reason = (document.getElementById('adm-ban-reason') as HTMLSelectElement).value;
        const notes = (document.getElementById('adm-ban-notes') as HTMLTextAreaElement).value;
        try {
            const d = await admFetch('/admin/ban', { method: 'POST', body: JSON.stringify({ address, reason, notes }) });
            if (!d.ok) throw new Error(d.error);
            if (resolveReportId) await admFetch(`/admin/report/${resolveReportId}`, { method: 'PATCH', body: JSON.stringify({ action: 'banned' }) });
            hideModal();
            allPlayers = [];
            if (currentTab === 'players') loadPlayers();
            else if (currentTab === 'reports') loadReports('open');
            else if (currentTab === 'bans') loadBans();
        } catch (e: any) {
            alert('Hata: ' + e.message);
        }
    };
}

// Yeni kampanya modal
function showNewCampaignModal() {
    showModal(`
        <h3>Yeni Kampanya</h3>
        <div class="adm-form-group">
            <label>Kampanya Adı:</label>
            <input id="adm-camp-name" class="adm-input" type="text" placeholder="Örn: Mart 2026 Sezonu" />
        </div>
        <div class="adm-form-group">
            <label>Açıklama:</label>
            <textarea id="adm-camp-desc" class="adm-input adm-textarea" placeholder="Opsiyonel…"></textarea>
        </div>
        <div class="adm-form-group">
            <label>Ağ:</label>
            <select id="adm-camp-network" class="adm-input">
                <option value="testnet">Testnet (Fuji)</option>
                <option value="mainnet">Mainnet (Avalanche C)</option>
                <option value="both">Her ikisi</option>
            </select>
        </div>
        <div class="adm-form-group">
            <label>Pool (AVAX):</label>
            <input id="adm-camp-pool" class="adm-input" type="number" step="0.01" placeholder="0.5" />
        </div>
        <div class="adm-form-group"><label>Min. Oyun Sayısı:</label><input id="adm-camp-mingames" class="adm-input" type="number" value="0" /></div>
        <div class="adm-form-group"><label>Min. Online Oyun:</label><input id="adm-camp-minonline" class="adm-input" type="number" value="0" /></div>
        <div class="adm-form-group"><label>Min. Galibiyet:</label><input id="adm-camp-minwins" class="adm-input" type="number" value="0" /></div>
        <div class="adm-modal-actions">
            <button class="adm-btn adm-btn-primary" id="adm-camp-create-btn">Oluştur</button>
            <button class="adm-btn adm-btn-ghost" onclick="window.__admHideModal()">İptal</button>
        </div>
    `);
    document.getElementById('adm-camp-create-btn')!.onclick = async () => {
        const name = (document.getElementById('adm-camp-name') as HTMLInputElement).value.trim();
        if (!name) { alert('Kampanya adı gerekli'); return; }
        try {
            const d = await admFetch('/admin/campaign', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    description: (document.getElementById('adm-camp-desc') as HTMLTextAreaElement).value,
                    network: (document.getElementById('adm-camp-network') as HTMLSelectElement).value,
                    poolAvax: parseFloat((document.getElementById('adm-camp-pool') as HTMLInputElement).value) || 0,
                    rules: {
                        minGames: parseInt((document.getElementById('adm-camp-mingames') as HTMLInputElement).value) || 0,
                        minOnlineGames: parseInt((document.getElementById('adm-camp-minonline') as HTMLInputElement).value) || 0,
                        minWins: parseInt((document.getElementById('adm-camp-minwins') as HTMLInputElement).value) || 0,
                    },
                }),
            });
            if (!d.ok) throw new Error(d.error);
            hideModal();
            loadCampaigns();
        } catch (e: any) {
            alert('Hata: ' + e.message);
        }
    };
}

// Dağıtım modal
async function showDistributeModal(campaignId: string) {
    const d = await admFetch('/admin/campaigns');
    const camp = d.campaigns?.find((c: any) => c.id === campaignId);
    if (!camp || !camp.snapshots?.length) {
        alert('Önce snapshot al'); return;
    }
    const top = (camp.snapshots.at(-1).players || []).slice(0, 10);
    const pool = camp.poolAvax || 0;
    const ratios = [40, 20, 10, 5, 5];
    const recipients = top.slice(0, Math.min(top.length, ratios.length)).map((p: any, i: number) => ({
        address: p.address,
        username: p.username || addrShort(p.address),
        avax: parseFloat((pool * ratios[i] / 100).toFixed(6)),
        ratio: ratios[i],
    }));

    showModal(`
        <h3>Kampanya Dağıtımı — ${esc(camp.name)}</h3>
        <p>Pool: <strong>${pool} AVAX</strong> · Network: <strong>${camp.network}</strong></p>
        <table class="adm-table">
            <thead><tr><th>Sıra</th><th>Oyuncu</th><th>%</th><th>AVAX</th><th>Adres</th></tr></thead>
            <tbody>${recipients.map((r: any, i: number) => `
                <tr>
                    <td>${i + 1}.</td>
                    <td>${esc(r.username)}</td>
                    <td>%${r.ratio}</td>
                    <td><input type="number" step="0.001" value="${r.avax}" class="adm-input adm-input-sm" id="dist-amt-${i}" /></td>
                    <td><code>${addrShort(r.address)}</code></td>
                </tr>`).join('')}
            </tbody>
        </table>
        <div class="adm-modal-actions">
            <button class="adm-btn adm-btn-primary" id="adm-dist-confirm-btn">Dağıt (Testnet)</button>
            <button class="adm-btn adm-btn-ghost" onclick="window.__admHideModal()">İptal</button>
        </div>
        <p class="adm-note">Not: Mainnet için ayrı yapılandırma gerekir. Şimdilik Fuji testnet üzerinden gönderilir.</p>
    `);
    document.getElementById('adm-dist-confirm-btn')!.onclick = async () => {
        const updated = recipients.map((r: any, i: number) => ({
            address: r.address,
            avax: parseFloat((document.getElementById(`dist-amt-${i}`) as HTMLInputElement).value) || 0,
        })).filter((r: any) => r.avax > 0);
        if (!confirm(`${updated.length} oyuncuya toplam ${updated.reduce((s: number, r: any) => s + r.avax, 0).toFixed(4)} AVAX gönderilecek. Devam?`)) return;
        try {
            const res = await admFetch(`/admin/campaign/${campaignId}/distribute`, {
                method: 'POST',
                body: JSON.stringify({ recipients: updated }),
            });
            const success = res.results?.filter((r: any) => r.ok).length || 0;
            alert(`Dağıtım tamamlandı: ${success}/${updated.length} başarılı`);
            hideModal();
            loadCampaigns();
        } catch (e: any) {
            alert('Hata: ' + e.message);
        }
    };
}

// ── Global callback'ler (onclick handler'ları için) ────────────────────
function registerGlobals() {
    (window as any).__admBanModal = (addr: string, username: string, reportId?: string) => showBanModal(addr, username, reportId);
    (window as any).__admUnban = async (addr: string) => {
        if (!confirm('Banı kaldır?')) return;
        try {
            const d = await admFetch(`/admin/ban/${addr}`, { method: 'DELETE' });
            if (!d.ok) throw new Error(d.error);
            allPlayers = [];
            if (currentTab === 'players') loadPlayers();
            else if (currentTab === 'bans') loadBans();
        } catch (e: any) { alert('Hata: ' + e.message); }
    };
    (window as any).__admResolve = async (id: string, action: string) => {
        try {
            await admFetch(`/admin/report/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
            loadReports('open');
        } catch (e: any) { alert('Hata: ' + e.message); }
    };
    (window as any).__admSnapshot = async (id: string) => {
        try {
            const d = await admFetch(`/admin/campaign/${id}/snapshot`, { method: 'POST', body: '{}' });
            alert(`Snapshot alındı: ${d.playerCount} oyuncu`);
            loadCampaigns();
        } catch (e: any) { alert('Hata: ' + e.message); }
    };
    (window as any).__admDistributeModal = (id: string) => showDistributeModal(id);
    (window as any).__admEndCampaign = async (id: string) => {
        if (!confirm('Kampanyayı sonlandır?')) return;
        try {
            await admFetch(`/admin/campaign/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'ended' }) });
            loadCampaigns();
        } catch (e: any) { alert('Hata: ' + e.message); }
    };
    (window as any).__admDeleteChat = async (id: string) => {
        try {
            await admFetch(`/admin/chat/${id}`, { method: 'DELETE' });
            loadChat();
        } catch (e: any) { alert('Hata: ' + e.message); }
    };
    (window as any).__admHideModal = hideModal;
}

// ── Açma / Kapama ─────────────────────────────────────────────────────
function openPanel() {
    if (!panelEl) return;
    panelEl.style.display = 'flex';
    if (adminToken) {
        showMainPanel();
    } else {
        showAuthScreen();
    }
}

function closePanel() {
    if (panelEl) panelEl.style.display = 'none';
}

// ── Başlatıcı ─────────────────────────────────────────────────────────
export function initAdminPanel(): void {
    panelEl = buildPanel();
    document.body.appendChild(panelEl);
    registerGlobals();

    // Keyboard shortcut: Ctrl+Shift+F12 veya URL'de ?admin
    document.addEventListener('keydown', (e) => {
        const combo = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F12';
        if (combo) {
            e.preventDefault();
            if (panelEl!.style.display === 'none' || panelEl!.style.display === '') {
                openPanel();
            } else {
                closePanel();
            }
        }
    });

    // URL'de ?admin varsa aç
    if (new URLSearchParams(window.location.search).has('admin')) {
        openPanel();
    }

    // Auth ekranı butonları
    panelEl.querySelector('#adm-sign-btn')!.addEventListener('click', doAuth);
    panelEl.querySelector('#adm-close-auth-btn')!.addEventListener('click', closePanel);

    // Tab navigasyon
    panelEl.querySelectorAll<HTMLButtonElement>('.adm-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (tab) switchTab(tab);
        });
    });

    // Dashboard yenile
    panelEl.querySelector('#adm-refresh-btn')!.addEventListener('click', loadOverview);

    // Oyuncu arama
    const searchInput = panelEl.querySelector('#adm-player-search') as HTMLInputElement;
    let searchTimer: ReturnType<typeof setTimeout>;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadPlayers(searchInput.value), 300);
    });

    // Rapor filtreleri
    panelEl.querySelectorAll<HTMLButtonElement>('.adm-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => loadReports(btn.dataset.filter));
    });

    // Yeni ban & kampanya butonları
    panelEl.querySelector('#adm-ban-new-btn')!.addEventListener('click', () => {
        const addr = prompt('Banlanacak cüzdan adresi:');
        if (addr) showBanModal(addr, '');
    });
    panelEl.querySelector('#adm-campaign-new-btn')!.addEventListener('click', showNewCampaignModal);

    // Chat yenile
    panelEl.querySelector('#adm-chat-refresh-btn')!.addEventListener('click', loadChat);

    // Logout
    panelEl.querySelector('#adm-logout-btn')!.addEventListener('click', () => {
        adminToken = null;
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem('a2_admin_addr');
        showAuthScreen();
    });

    // Kapat
    panelEl.querySelector('#adm-close-btn')!.addEventListener('click', closePanel);

    // Modal overlay click → kapat
    panelEl.querySelector('#adm-modal-overlay')!.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).id === 'adm-modal-overlay') hideModal();
    });
}

// ── Yardımcılar ───────────────────────────────────────────────────────
function esc(str: string): string {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function addrShort(addr: string): string {
    if (!addr) return '—';
    return addr.slice(0, 8) + '…' + addr.slice(-4);
}

function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Az önce';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'dk önce';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 's önce';
    return Math.floor(diff / 86400000) + 'g önce';
}
