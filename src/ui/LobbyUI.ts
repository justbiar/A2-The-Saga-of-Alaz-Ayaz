/**
 * LobbyUI.ts — Lobby screen, bet panel, quick match, MP message handling.
 */

import { ctx, type GameMode } from '../game/GameContext';
import { showScreen } from './ScreenRouter';
import { t } from '../i18n';
import { mpService } from '../multiplayer/MultiplayerService';
import { betService, BET_FEE_PERCENT, MIN_BET, MAX_BET } from '../chain/BetService';
import { leaderboardService } from '../chain/LeaderboardService';
import { profileService } from '../chain/ProfileService';
import { showWalletModal } from './WalletUI';
import { PLAYER_CARDS, AI_CARDS, type UnitType } from '../ecs/Unit';
import { logCardPlay } from './CardUI';
import { GameRandom } from '../utils/Random';

// ─── TOAST ─────────────────────────────────────────────────────────
export function showToast(msg: string, durationMs = 4000): void {
    const existing = document.getElementById('a2-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'a2-toast';
    el.textContent = msg;
    el.style.cssText = `
        position:fixed;top:72px;left:50%;transform:translateX(-50%);
        z-index:9999;
        background:rgba(4,3,16,0.95);
        border:1px solid rgba(255,185,50,0.4);
        border-radius:8px;padding:10px 20px;
        color:#ffc94d;font-family:'Cinzel',serif;
        font-size:11px;letter-spacing:1px;
        box-shadow:0 0 20px rgba(255,185,50,0.15);
        animation:fadeUp 0.3s ease;
        pointer-events:none;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), durationMs);
}

function showLobbyError(msg: string): void {
    const el = document.getElementById('lobby-error')!;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ─── BET PANEL ─────────────────────────────────────────────────────
type BetPanelState =
    | 'host-idle' | 'host-depositing' | 'host-waiting'
    | 'guest-incoming' | 'guest-depositing' | 'guest-wait'
    | 'locked' | 'no-wallet' | 'no-bet' | 'guest-counter';

function showBetPanel(state: BetPanelState): void {
    const hostSection = document.getElementById('bet-host-section');
    const offerSent = document.getElementById('bet-offer-sent');
    const incoming = document.getElementById('bet-incoming');
    const locked = document.getElementById('bet-locked');
    const skipNote = document.getElementById('bet-skip-note');
    const noWallet = document.getElementById('bet-no-wallet');
    const guestWait = document.getElementById('bet-guest-wait');
    const counterSection = document.getElementById('bet-counter');

    if (!hostSection) return;

    hostSection.style.display = 'none';
    offerSent!.style.display = 'none';
    incoming!.style.display = 'none';
    locked!.style.display = 'none';
    skipNote!.style.display = 'none';
    if (noWallet) noWallet.style.display = 'none';
    if (guestWait) guestWait.style.display = 'none';
    if (counterSection) counterSection.style.display = 'none';

    const sendBtn = document.getElementById('bet-send-btn') as HTMLButtonElement | null;

    switch (state) {
        case 'host-idle':
            hostSection.style.display = 'block';
            if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = t('betSendBtn'); }
            break;
        case 'host-depositing':
            hostSection.style.display = 'block';
            if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = t('betDepositing'); }
            break;
        case 'host-waiting':
            offerSent!.style.display = 'block';
            break;
        case 'guest-incoming': {
            incoming!.style.display = 'block';
            const acceptBtn = document.getElementById('bet-accept-btn') as HTMLButtonElement;
            if (acceptBtn) { acceptBtn.disabled = false; acceptBtn.textContent = t('betAcceptBtn'); }
            break;
        }
        case 'guest-depositing': {
            incoming!.style.display = 'block';
            const acceptBtn = document.getElementById('bet-accept-btn') as HTMLButtonElement;
            if (acceptBtn) { acceptBtn.disabled = true; acceptBtn.textContent = t('betDepositing'); }
            break;
        }
        case 'guest-wait':
            if (guestWait) guestWait.style.display = 'block';
            break;
        case 'locked': {
            locked!.style.display = 'block';
            const lockedText = document.getElementById('bet-locked-text');
            const lockedAmt = document.getElementById('bet-locked-amount');
            const totalPot = betService.state.amount * 2;
            const fee = totalPot * (BET_FEE_PERCENT / 100);
            const prize = totalPot - fee;
            if (lockedText) lockedText.textContent = t('betLockedText');
            if (lockedAmt) lockedAmt.textContent = `${prize.toFixed(4)} AVAX (%${100 - BET_FEE_PERCENT} · ${BET_FEE_PERCENT}% fee)`;
            break;
        }
        case 'no-wallet':
            if (noWallet) noWallet.style.display = 'block';
            break;
        case 'no-bet':
            skipNote!.style.display = 'block';
            break;
        case 'guest-counter':
            if (counterSection) counterSection.style.display = 'block';
            break;
    }
}

// ─── LOBBY STATE ───────────────────────────────────────────────────
function setLobbyState(state: 'actions' | 'waiting' | 'connected' | 'qm-waiting'): void {
    document.getElementById('lobby-actions')!.style.display = state === 'actions' ? 'flex' : 'none';
    document.getElementById('lobby-waiting')!.style.display = state === 'waiting' ? 'block' : 'none';
    document.getElementById('lobby-connected')!.style.display = state === 'connected' ? 'block' : 'none';
    const qmWaiting = document.getElementById('lobby-qm-waiting');
    if (qmWaiting) qmWaiting.style.display = state === 'qm-waiting' ? 'block' : 'none';
}

function updateLobbyConnectedUI(): void {
    const myName = (ctx.lobbyTeam === 'fire' ? t('lobbyFireName') : t('lobbyIceName')) + ' ' + t('lobbyMySuffix');
    const oppTeam = mpService.opponentTeam ?? (ctx.lobbyTeam === 'fire' ? 'ice' : 'fire');
    const oppName = (oppTeam === 'fire' ? t('lobbyFireName') : t('lobbyIceName')) + ' ' + t('lobbyOppSuffix');

    document.getElementById('lc-my-team')!.innerHTML = `<span class="lct-name">${myName}</span>`;
    document.getElementById('lc-opp-team')!.innerHTML = `<span class="lct-name">${oppName}</span>`;
    document.getElementById('lc-opp-label')!.textContent = t('lobbyConnected');
}

// ─── CHAT ──────────────────────────────────────────────────────────
let _chatActiveTab: 'lobby' | 'room' = 'lobby';
let _chatPollTimer: number | null = null;
let _chatLastTs = 0;
let _chatNick = '';

function getChatNick(): string {
    if (!_chatNick) {
        _chatNick = ctx.walletAddress
            ? ctx.walletAddress.slice(0, 6) + '…' + ctx.walletAddress.slice(-4)
            : 'Misafir' + Math.floor(Math.random() * 900 + 100);
    }
    return _chatNick;
}

function appendChatMsg(nickname: string, text: string, isOwn = false, tab: 'lobby' | 'room' = 'lobby'): void {
    if (tab !== _chatActiveTab) return;
    const msgs = document.getElementById('chat-msgs');
    if (!msgs) return;
    const div = document.createElement('div');
    div.className = 'ko-chat-msg' + (isOwn ? ' ko-chat-msg-own' : '');
    const nick = document.createElement('span');
    nick.className = 'ko-chat-nick';
    nick.textContent = nickname;
    const text_ = document.createElement('span');
    text_.className = 'ko-chat-text';
    text_.textContent = text;
    div.appendChild(nick);
    div.appendChild(text_);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
}

function appendChatSystem(text: string): void {
    const msgs = document.getElementById('chat-msgs');
    if (!msgs) return;
    const div = document.createElement('div');
    div.className = 'ko-chat-system';
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
}

async function pollLobbyChat(): Promise<void> {
    try {
        const res = await fetch(`/api/chat?since=${_chatLastTs}`);
        const data = await res.json();
        if (data.ok && data.messages?.length) {
            const myNick = getChatNick();
            for (const m of data.messages) {
                if (m.ts > _chatLastTs) _chatLastTs = m.ts;
                appendChatMsg(m.nickname, m.text, m.nickname === myNick, 'lobby');
            }
        }
    } catch { /* ignore */ }
}

export function receiveChatFromPeer(nickname: string, text: string): void {
    appendChatMsg(nickname, text, false, 'room');
}

function initChatPanel(): void {
    _chatNick = '';
    _chatLastTs = Date.now();
    _chatActiveTab = 'lobby';

    const tabLobby = document.getElementById('chat-tab-lobby')!;
    const tabRoom = document.getElementById('chat-tab-room')!;
    const msgs = document.getElementById('chat-msgs')!;
    const input = document.getElementById('chat-input') as HTMLInputElement;
    const sendBtn = document.getElementById('chat-send-btn')!;

    tabLobby.onclick = () => {
        _chatActiveTab = 'lobby';
        tabLobby.classList.add('active');
        tabRoom.classList.remove('active');
        msgs.innerHTML = '';
        // son 5 dakikayı yükle
        _chatLastTs = Date.now() - 5 * 60 * 1000;
        pollLobbyChat();
    };

    tabRoom.onclick = () => {
        if (mpService.status !== 'connected') return;
        _chatActiveTab = 'room';
        tabRoom.classList.add('active');
        tabLobby.classList.remove('active');
        msgs.innerHTML = '';
        appendChatSystem(t('chatP2PActive'));
    };

    const sendMsg = async () => {
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        const nick = getChatNick();
        if (_chatActiveTab === 'lobby') {
            appendChatMsg(nick, text, true, 'lobby');
            try {
                await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nickname: nick, text }),
                });
            } catch { /* ignore */ }
        } else if (_chatActiveTab === 'room' && mpService.status === 'connected') {
            appendChatMsg(nick, text, true, 'room');
            mpService.send({ type: 'chat', text, nickname: nick });
        }
    };

    sendBtn.onclick = sendMsg;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });

    if (_chatPollTimer) clearInterval(_chatPollTimer);
    pollLobbyChat();
    _chatPollTimer = setInterval(() => {
        const lobbyScreen = document.getElementById('lobby-screen');
        if (lobbyScreen && lobbyScreen.style.display !== 'none') {
            if (_chatActiveTab === 'lobby') pollLobbyChat();
        } else {
            clearInterval(_chatPollTimer!);
            _chatPollTimer = null;
        }
    }, 3000) as unknown as number;
}

// ─── QUICK MATCH ───────────────────────────────────────────────────
let _qmPollTimer: number | null = null;
let _qmCode: string = '';
let _qmAcceptTimer: number | null = null;

async function fetchPublicLobbies(): Promise<void> {
    const listEl = document.getElementById('lobby-list');
    if (!listEl) return;
    try {
        const res = await fetch('/api/lobbies');
        const data = await res.json();
        if (!data.ok || !data.lobbies?.length) {
            listEl.innerHTML = `<div class="lb-empty">${t('betNoLobbies')}</div>`;
            return;
        }
        listEl.innerHTML = data.lobbies.map((l: any, i: number) => `
            <tr class="ko-row" data-code="${l.code}">
                <td>${String(i + 1).padStart(2, '0')}</td>
                <td>${l.lobbyName ? l.lobbyName : (l.nickname || 'Adsız Oda')}</td>
                <td><span class="${l.isFake ? 'ko-status-closed' : 'ko-status-open'}">${l.isFake ? t('lobbyStatusOpen') /* Fake lobi ama dolu göstereceğiz */ : t('lobbyStatusOpen')}</span></td>
                <td>${l.isFake ? (l.playerCount || '2/2') : '1/2'}</td>
                <td>${l.betAmount > 0 ? l.betAmount + ' A' : '—'}</td>
                <td class="${l.team === 'fire' ? 'ko-team-fire' : 'ko-team-ice'}">${l.team === 'fire' ? 'ALAZ' : 'AYAZ'}</td>
                <td><button class="ko-row-join lb-item-join ${l.isFake ? 'lb-btn-disabled' : ''}" data-code="${l.code}" data-team="${l.team}" data-fake="${l.isFake ? 'true' : 'false'}">${l.isFake ? 'DOLU' : 'KATIL'}</button></td>
            </tr>
        `).join('');
        listEl.querySelectorAll('.lb-item-join').forEach((btn: Element) => {
            (btn as HTMLButtonElement).onclick = () => {
                if (btn.getAttribute('data-fake') === 'true') {
                    showLobbyError(t('lobbyRoomFull'));
                    return;
                }
                const code = btn.getAttribute('data-code') ?? '';
                const hostTeam = (btn.getAttribute('data-team') ?? 'fire') as 'fire' | 'ice';
                ctx.lobbyTeam = hostTeam === 'fire' ? 'ice' : 'fire';
                ctx.selectedTeam = ctx.lobbyTeam;
                joinLobbyByCode(code);
            };
        });
    } catch {
        listEl.innerHTML = `<div class="lb-empty">${t('betConnError')}</div>`;
    }
}

async function joinLobbyByCode(code: string): Promise<void> {
    if (!ctx.lobbyTeam) ctx.lobbyTeam = 'fire';
    try {
        document.getElementById('lobby-status-text')!.textContent = t('lobbyConnecting');
        setLobbyState('waiting');
        mpService.init(handleMPMessage, handleMPStatus);
        await mpService.joinLobby(code, ctx.lobbyTeam);
    } catch (e: any) {
        setLobbyState('actions');
        showLobbyError(t('lobbyErrJoin') + (e?.message ?? e));
    }
}

function startQuickMatch(): void {
    if (!ctx.lobbyTeam) ctx.lobbyTeam = 'fire';
    if (!ctx.walletAddress) return showLobbyError(t('qmWalletRequired'));

    mpService.init(handleMPMessage, handleMPStatus);
    mpService.createLobby(ctx.lobbyTeam, 0, false).then(code => {
        _qmCode = code;
        setLobbyState('qm-waiting');

        const nick = profileService?.currentProfile?.username || 'Anonim';
        fetch('/api/quickmatch/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet: ctx.walletAddress, team: ctx.lobbyTeam, code, nickname: nick }),
        }).catch(() => { });

        _qmPollTimer = window.setInterval(async () => {
            try {
                const res = await fetch(`/api/quickmatch/poll?wallet=${ctx.walletAddress}`);
                const data = await res.json();
                if (data.ok && data.matched) {
                    stopQuickMatchPoll();
                    showQmNotification(data.opponentCode, data.opponentTeam, data.opponentNickname);
                }
            } catch { /* ignore */ }
        }, 2000);
    }).catch(e => {
        showLobbyError(t('qmStartFailed') + (e?.message ?? e));
    });
}

function stopQuickMatchPoll(): void {
    if (_qmPollTimer !== null) {
        clearInterval(_qmPollTimer);
        _qmPollTimer = null;
    }
}

function leaveQuickMatch(): void {
    stopQuickMatchPoll();
    if (ctx.walletAddress) {
        fetch('/api/quickmatch/leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet: ctx.walletAddress }),
        }).catch(() => { });
    }
    mpService.disconnect();
    setLobbyState('actions');
}

function showQmNotification(opponentCode: string, opponentTeam: string, opponentNick: string): void {
    const notifEl = document.getElementById('qm-notification')!;
    const nameEl = document.getElementById('qmn-opponent-name')!;
    const timerEl = document.getElementById('qmn-timer')!;
    notifEl.style.display = 'flex';
    nameEl.textContent = `${opponentNick || t('anon')} · ${opponentTeam === 'fire' ? t('lobbyFireName') : t('lobbyIceName')}`;

    let timeLeft = 15;
    timerEl.textContent = String(timeLeft);
    if (_qmAcceptTimer) clearInterval(_qmAcceptTimer);
    _qmAcceptTimer = window.setInterval(() => {
        timeLeft--;
        timerEl.textContent = String(timeLeft);
        if (timeLeft <= 0) {
            clearInterval(_qmAcceptTimer!);
            _qmAcceptTimer = null;
            notifEl.style.display = 'none';
            leaveQuickMatch();
            showToast(t('qmTimeout'));
        }
    }, 1000);

    document.getElementById('qm-accept-btn')!.onclick = async () => {
        if (_qmAcceptTimer) { clearInterval(_qmAcceptTimer); _qmAcceptTimer = null; }
        notifEl.style.display = 'none';
        try {
            document.getElementById('lobby-status-text')!.textContent = t('lobbyConnecting');
            setLobbyState('waiting');
            await mpService.joinLobby(opponentCode, ctx.lobbyTeam!);
        } catch (e: any) {
            setLobbyState('actions');
            showLobbyError(t('lobbyErrJoin') + (e?.message ?? e));
        }
    };

    document.getElementById('qm-decline-btn')!.onclick = () => {
        if (_qmAcceptTimer) { clearInterval(_qmAcceptTimer); _qmAcceptTimer = null; }
        notifEl.style.display = 'none';
        leaveQuickMatch();
    };
}

// ─── MP CALLBACKS ──────────────────────────────────────────────────
const MP_LANE_MAP: Record<'left' | 'mid' | 'right', number> = { left: 0, mid: 1, right: 2 };

function spawnUnitForTeam(team: 'fire' | 'ice', cardId: UnitType, lane: 'left' | 'mid' | 'right', unitId?: string): void {
    ctx._mpSpawnUnit?.(team, cardId, lane, unitId);
}
function applyPromptForTeam(team: 'fire' | 'ice', promptId: string): void {
    ctx._mpApplyPrompt?.(team, promptId);
}
export function triggerWin(winner: 'fire' | 'ice', msg: string, isDisconnect = false): void {
    ctx._mpTriggerWin?.(winner, msg, isDisconnect);
}

export function handleMPMessage(msg: import('../multiplayer/MultiplayerService').MPMessage): void {
    if (msg.type === 'chat') {
        appendChatMsg(msg.nickname, msg.text, false, 'room');
        return;
    }
    // BET MESSAGES
    if (msg.type === 'bet_offer') {
        // Guest tarafı: host adresini kaydet (rapor için)
        mpService.opponentWallet = msg.hostAddress || null;
        betService.state = {
            amount: msg.amountAvax,
            status: 'pending_guest',
            matchId: msg.matchId,
        };
        const amtEl = document.getElementById('bet-incoming-amount');
        if (amtEl) amtEl.textContent = `${msg.amountAvax} AVAX`;
        showBetPanel('guest-incoming');
        return;
    }
    if (msg.type === 'bet_accept') {
        // Host tarafı: guest adresini kaydet (rapor için)
        mpService.opponentWallet = msg.guestAddress || null;
        betService.state.status = 'locked';
        betService.state.guestTxHash = msg.txHash;
        showBetPanel('locked');
        return;
    }
    if (msg.type === 'bet_reject' || msg.type === 'bet_cancel') {
        if (mpService.role === 'host' && betService.state.status === 'pending_host') {
            // Host para yatırdıysa ve guest reddettiyse — iade et
            showBetPanel('host-depositing'); // gönder butonu disabled, oyun başlatılamaz
            betService.cancelBet().then(() => {
                betService.reset();
                showBetPanel('host-idle');
                showToast(t('betRejectedRefunded'));
            }).catch(() => {
                betService.reset();
                showBetPanel('host-idle');
            });
        } else {
            betService.reset();
            showBetPanel(mpService.role === 'host' ? 'host-idle' : 'guest-wait');
        }
        return;
    }
    if (msg.type === 'bet_claim') {
        console.log('[Bet] Received legacy bet_claim — ignored (dual-confirm active)');
        return;
    }

    // ── Team enforcement: guest MUST be opposite team ──
    if (msg.type === 'ready') {
        if (mpService.role === 'guest' && (msg as any).team) {
            const hostTeam: 'fire' | 'ice' = (msg as any).team;
            const forcedTeam: 'fire' | 'ice' = hostTeam === 'fire' ? 'ice' : 'fire';
            const wasWrongTeam = ctx.lobbyTeam !== forcedTeam;
            ctx.lobbyTeam = forcedTeam;
            ctx.selectedTeam = forcedTeam;
            mpService.opponentTeam = hostTeam;
            if (wasWrongTeam) {
                console.log(`[MP] Guest team forced to ${forcedTeam} (host is ${hostTeam})`);
                mpService.send({ type: 'ready', team: forcedTeam });
            }
            // Update lobby team buttons
            const fireBtn = document.getElementById('lobby-pick-fire');
            const iceBtn = document.getElementById('lobby-pick-ice');
            if (fireBtn && iceBtn) {
                fireBtn.classList.remove('selected-fire');
                iceBtn.classList.remove('selected-ice');
                if (forcedTeam === 'fire') fireBtn.classList.add('selected-fire');
                else iceBtn.classList.add('selected-ice');
            }
            updateLobbyConnectedUI();
        }
        return;
    }

    if (msg.type === 'bet_counter') {
        if (mpService.role === 'host') {
            const amountInput = document.getElementById('bet-amount-input') as HTMLInputElement;
            if (amountInput) amountInput.value = String(msg.amountAvax);
            showToast(`${t('betCounterReceived')}: ${msg.amountAvax} AVAX`);
            showBetPanel('host-idle');
        }
        return;
    }

    if (msg.type === 'start_game') {
        // Host oyunu başlattı — guest de game screen'e geçsin + boot etsin
        startMultiplayerGame();
        return;
    }

    if (ctx.gameMode !== 'multiplayer') return;

    if (msg.type === 'loaded') {
        if (mpService.role === 'host') {
            const seed = Math.floor(Math.random() * 1000000000);
            GameRandom.setSeed(seed);
            console.log(`[MP] Host generating seed: ${seed}`);
            mpService.send({ type: 'start', seed });
            ctx._mpStartGame?.();
        }
    } else if (msg.type === 'start') {
        ctx._mpStartGame?.();
    } else if (msg.type === 'place') {
        const { cardId, lane, unitId } = msg;
        const oppTeam = mpService.opponentTeam ?? (ctx.lobbyTeam === 'fire' ? 'ice' : 'fire');
        console.log(`[MP-SYNC] Received place: ${cardId} lane=${lane} oppTeam=${oppTeam} unitId=${unitId}`);
        spawnUnitForTeam(oppTeam as 'fire' | 'ice', cardId as UnitType, lane, unitId);
        
        const cDef = [...PLAYER_CARDS, ...AI_CARDS].find(c => c.id === cardId);
        if (cDef) {
            const nameStr = (cDef as any).nameKey ? t((cDef as any).nameKey) : cDef.name;
            const descStr = (cDef as any).descKey ? t((cDef as any).descKey) : cDef.description;
            // logCardPlay(oppTeam as 'fire' | 'ice', nameStr, descStr, cDef.imagePath); // Disabled unit logs
        }
    } else if (msg.type === 'prompt') {
        const { promptId } = msg;
        const oppTeam = mpService.opponentTeam ?? (ctx.lobbyTeam === 'fire' ? 'ice' : 'fire');
        applyPromptForTeam(oppTeam as 'fire' | 'ice', promptId);
    } else if (msg.type === 'surrender') {
        const winner = ctx.lobbyTeam === 'fire' ? 'fire' : 'ice';
        triggerWin(winner as 'fire' | 'ice', t('mpSurrender'));
    } else if (msg.type === 'game_over') {
        console.log(`[MP-SYNC] Received game_over: winner=${msg.winner} reason=${msg.reason} _mpGameEnded=${ctx._mpGameEnded}`);
        triggerWin(msg.winner, msg.reason);
    } else if (msg.type === 'unit_sync') {
        // Guest: host'tan gelen unit pozisyon/HP senkronizasyonu
        if (mpService.role === 'guest') {
            ctx._mpApplyUnitSync?.(msg.data);
        }
    } else if (msg.type === 'base_sync') {
        // Guest: host'tan gelen otoritif base HP degerlerini uygula
        if (mpService.role === 'guest') {
            if (ctx._fireBase) ctx._fireBase.forceSetHp(msg.fireHp);
            if (ctx._iceBase) ctx._iceBase.forceSetHp(msg.iceHp);
        }
    }
}

export function handleMPStatus(status: string): void {
    if (status === 'connected') {
        // Guest: lock team buttons (team is auto-assigned opposite of host)
        if (mpService.role === 'guest') {
            const fireBtn = document.getElementById('lobby-pick-fire');
            const iceBtn = document.getElementById('lobby-pick-ice');
            if (fireBtn) { fireBtn.style.opacity = '0.4'; fireBtn.style.pointerEvents = 'none'; }
            if (iceBtn) { iceBtn.style.opacity = '0.4'; iceBtn.style.pointerEvents = 'none'; }
        }
        updateLobbyConnectedUI();
        setLobbyState('connected');

        if (mpService.role === 'host' && betService.isActive() && betService.state.status === 'pending_host') {
            mpService.sendBetOffer(betService.state.amount, betService.state.matchId!, ctx.walletAddress!);
            showBetPanel('host-waiting');
        } else if (mpService.role === 'host') {
            showBetPanel(ctx.walletAddress ? 'host-idle' : 'no-wallet');
        } else {
            showBetPanel(ctx.walletAddress ? 'guest-wait' : 'no-wallet');
        }

        const startBtn = document.getElementById('lobby-start-btn') as HTMLButtonElement;
        if (startBtn) {
            if (mpService.role === 'host') {
                startBtn.textContent = t('lobbyStartBtn');
                startBtn.style.display = 'block';
            } else {
                startBtn.textContent = t('lobbyHostStartWait');
                startBtn.style.opacity = '0.5';
                startBtn.style.pointerEvents = 'none';
            }
        }

        const pingInterval = setInterval(() => {
            if (mpService.status !== 'connected') { clearInterval(pingInterval); return; }
            const el = document.getElementById('lc-ping');
            if (el) el.textContent = `Ping: ${mpService.ping ?? '—'} ms`;
        }, 500);
    } else if (status === 'disconnected' || status === 'error') {
        if (ctx.gameMode === 'multiplayer') {
            triggerWin(ctx.lobbyTeam === 'fire' ? 'fire' : 'ice', t('mpDisconnWin'), true);
        } else {
            // Lobide iken rakip ayrıldı — locked bet varsa oyun başlamadı, iki tarafa iade
            if (betService.isActive() && betService.state.status === 'locked' && ctx.walletAddress) {
                showToast(t('betRefundedBoth'));
                fetch(`/api/match/${betService.state.matchId}/refund-both`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address: ctx.walletAddress }),
                }).catch(() => {});
                betService.reset();
            }
            setLobbyState('actions');
            showLobbyError(t('lobbyErrDisconn'));
        }
        const startBtn = document.getElementById('lobby-start-btn') as HTMLButtonElement;
        if (startBtn) {
            startBtn.textContent = t('lobbyStartBtn');
            startBtn.style.opacity = '1';
            startBtn.style.pointerEvents = 'auto';
        }
    }
}

export function startMultiplayerGame(): void {
    ctx._mpGameEnded = false;
    showScreen('game');
    ctx.gameMode = 'multiplayer';
    // boot will be called by main.ts
    (window as any).__startMultiplayerBoot?.();
}

// ─── INIT LOBBY ────────────────────────────────────────────────────
export function initLobbyScreen(): void {
    // Default team = fire (no separate team-select screen for multiplayer)
    if (!ctx.lobbyTeam) ctx.lobbyTeam = 'fire';
    ctx.selectedTeam = ctx.lobbyTeam;
    setLobbyState('actions');
    document.getElementById('lobby-error')!.style.display = 'none';

    // Wallet info in topbar
    const walletTextEl = document.getElementById('lobby-wallet-text');
    if (ctx.walletAddress && walletTextEl) {
        walletTextEl.className = 'lobby-wallet-addr';
        let walletDisplay = `${ctx.walletAddress.slice(0, 6)}...${ctx.walletAddress.slice(-4)}`;
        const ethers = (window as any).ethers;
        if (ethers && (window as any).ethereum) {
            const provider = new ethers.BrowserProvider((window as any).ethereum);
            provider.getBalance(ctx.walletAddress).then((bal: any) => {
                walletTextEl.innerHTML = `<span class="lobby-wallet-addr">${ctx.walletAddress!.slice(0, 6)}...${ctx.walletAddress!.slice(-4)}</span> <span class="lobby-wallet-bal">${parseFloat(ethers.formatEther(bal)).toFixed(4)} AVAX</span>`;
            }).catch(() => {
                walletTextEl.textContent = walletDisplay;
            });
        } else {
            walletTextEl.textContent = walletDisplay;
        }
    } else if (walletTextEl) {
        walletTextEl.className = 'lobby-wallet-none';
        walletTextEl.textContent = t('lobbyNoWallet');
    }

    // Team buttons — pre-select current team
    const fireBtn = document.getElementById('lobby-pick-fire')!;
    const iceBtn = document.getElementById('lobby-pick-ice')!;
    fireBtn.classList.remove('selected-fire');
    iceBtn.classList.remove('selected-ice');
    if (ctx.lobbyTeam === 'fire') fireBtn.classList.add('selected-fire');
    else iceBtn.classList.add('selected-ice');

    fireBtn.onclick = () => {
        ctx.lobbyTeam = 'fire';
        ctx.selectedTeam = 'fire';
        fireBtn.classList.add('selected-fire');
        iceBtn.classList.remove('selected-ice');
    };
    iceBtn.onclick = () => {
        ctx.lobbyTeam = 'ice';
        ctx.selectedTeam = 'ice';
        iceBtn.classList.add('selected-ice');
        fireBtn.classList.remove('selected-fire');
    };

    const pubBtn = document.getElementById('lobby-privacy-public');
    const prvBtn = document.getElementById('lobby-privacy-private');
    if (pubBtn && prvBtn) {
        pubBtn.onclick = () => { pubBtn.classList.add('active'); prvBtn.classList.remove('active'); };
        prvBtn.onclick = () => { prvBtn.classList.add('active'); pubBtn.classList.remove('active'); };
    }

    document.getElementById('lobby-create-btn')!.onclick = async () => {
        if (!ctx.lobbyTeam) ctx.lobbyTeam = 'fire';
        const amountInput = document.getElementById('lobby-avax-input') as HTMLInputElement;
        const amount = amountInput?.value ? parseFloat(amountInput.value) : 0;
        const nameInput = document.getElementById('lobby-name-input') as HTMLInputElement;
        const lobbyName = nameInput?.value?.trim().slice(0, 20) ?? '';
        if (amount && (amount < MIN_BET || amount > MAX_BET)) {
            return showLobbyError(t('betValidAmount'));
        }

        if (amount > 0) {
            if (!ctx.walletAddress) {
                showWalletModal();
                return showLobbyError(t('betWalletRequired'));
            }
            const tempMatchId = 'PRE_' + Date.now();
            const createBtn = document.getElementById('lobby-create-btn') as HTMLButtonElement;
            const origText = createBtn.textContent;
            createBtn.disabled = true;
            createBtn.textContent = t('betMetamaskPending');

            try {
                const txHash = await betService.depositBet(amount, tempMatchId);
                if (!txHash) {
                    createBtn.disabled = false;
                    createBtn.textContent = origText;
                    return showLobbyError(betService.lastError || t('betDepositFailed'));
                }
                const isPublic = document.getElementById('lobby-privacy-public')?.classList.contains('active') ?? true;
                mpService.init(handleMPMessage, handleMPStatus);
                const code = await mpService.createLobby(ctx.lobbyTeam, amount, isPublic, lobbyName);
                document.getElementById('lobby-display-code')!.textContent = code;
                if (lobbyName) {
                    const nameDisplay = document.getElementById('lobby-display-name');
                    if (nameDisplay) nameDisplay.textContent = lobbyName;
                }
                document.getElementById('room-create-modal')!.style.display = 'none';
                setLobbyState('waiting');
                document.getElementById('lobby-status-text')!.textContent = t('betDepositedWaiting');
                showBetPanel('host-waiting');
                createBtn.disabled = false;
                createBtn.textContent = origText;
            } catch (e: any) {
                createBtn.disabled = false;
                createBtn.textContent = origText;
                showLobbyError(t('lobbyErrCreate') + (e?.message ?? e));
            }
        } else {
            const isPublic = document.getElementById('lobby-privacy-public')?.classList.contains('active') ?? true;
            try {
                mpService.init(handleMPMessage, handleMPStatus);
                const code = await mpService.createLobby(ctx.lobbyTeam, amount, isPublic, lobbyName);
                document.getElementById('lobby-display-code')!.textContent = code;
                if (lobbyName) {
                    const nameDisplay = document.getElementById('lobby-display-name');
                    if (nameDisplay) nameDisplay.textContent = lobbyName;
                }
                document.getElementById('room-create-modal')!.style.display = 'none';
                setLobbyState('waiting');
                document.getElementById('lobby-status-text')!.textContent = t('lobbyWaiting');
            } catch (e: any) {
                showLobbyError(t('lobbyErrCreate') + (e?.message ?? e));
            }
        }
    };

    document.getElementById('lobby-copy-btn')!.onclick = () => {
        const code = document.getElementById('lobby-display-code')!.textContent ?? '';
        const copyBtn = document.getElementById('lobby-copy-btn')!;
        const copySpan = copyBtn.querySelector('span') as HTMLElement | null;
        navigator.clipboard.writeText(code).then(() => {
            if (copySpan) {
                const orig = copySpan.textContent ?? '';
                copySpan.textContent = t('lobbyCopied');
                setTimeout(() => { copySpan.textContent = orig; }, 1500);
            }
        });
    };

    document.getElementById('lobby-join-btn')!.onclick = async () => {
        if (!ctx.lobbyTeam) ctx.lobbyTeam = 'fire';
        const code = (document.getElementById('lobby-code-input') as HTMLInputElement).value.trim().toUpperCase();
        if (code.length !== 6) return showLobbyError(t('lobbyErrBadCode'));
        joinLobbyByCode(code);
    };

    document.getElementById('lobby-qm-btn')!.onclick = () => startQuickMatch();
    document.getElementById('lobby-qm-cancel')!.onclick = () => leaveQuickMatch();

    fetchPublicLobbies();
    document.getElementById('lobby-refresh-btn')!.onclick = () => fetchPublicLobbies();
    const _lobbyRefreshTimer = setInterval(() => {
        const lobbyScreen = document.getElementById('lobby-screen');
        if (lobbyScreen && lobbyScreen.style.display !== 'none') {
            fetchPublicLobbies();
        } else {
            clearInterval(_lobbyRefreshTimer);
        }
    }, 8000);

    document.getElementById('lobby-start-btn')!.onclick = () => {
        if (mpService.status !== 'connected') return;
        if (betService.isActive() && betService.state.status !== 'locked') {
            return showLobbyError(t('betPendingCannotStart'));
        }
        // Guest'e "sen de başla" mesajı gönder
        mpService.send({ type: 'start_game' });
        startMultiplayerGame();
    };

    // OFFLINE MOD
    document.getElementById('lobby-offline-btn')!.onclick = () => {
        mpService.disconnect();
        showScreen('mode-select');
    };

    // ODA KUR modal open/close
    const modal = document.getElementById('room-create-modal')!;
    document.getElementById('lobby-open-modal-btn')!.onclick = () => { modal.style.display = 'flex'; };
    document.getElementById('room-create-cancel')!.onclick = () => { modal.style.display = 'none'; };
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    initChatPanel();

    betService.reset();
    showBetPanel(ctx.walletAddress ? 'host-idle' : 'no-wallet');

    document.getElementById('bet-send-btn')!.onclick = async () => {
        if (!ctx.walletAddress) return showLobbyError(t('walletConnectFirst'));
        const amountInput = document.getElementById('bet-amount-input') as HTMLInputElement;
        const amount = parseFloat(amountInput.value);
        if (!amount || amount < MIN_BET || amount > MAX_BET) {
            return showLobbyError(t('betValidAmount'));
        }
        const matchId = mpService.lobbyCode + '_' + Date.now();
        showBetPanel('host-depositing');
        try {
            const txPromise = betService.depositBet(amount, matchId);
            const timeoutPromise = new Promise<null>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 90_000)
            );
            const txHash = await Promise.race([txPromise, timeoutPromise]);
            if (!txHash) {
                showBetPanel('host-idle');
                return showLobbyError(betService.lastError || t('betDepositFailed'));
            }
            mpService.sendBetOffer(amount, matchId, ctx.walletAddress!);
            showBetPanel('host-waiting');
        } catch (e: any) {
            console.warn('[Bet] Deposit failed:', e);
            showBetPanel('host-idle');
            showLobbyError(e?.message === 'timeout' ? 'Islem zaman asimina ugradi' : (betService.lastError || t('betDepositFailed')));
        }
    };

    document.getElementById('bet-cancel-btn')!.onclick = async () => {
        mpService.sendBetCancel();
        await betService.cancelAndRefund(ctx.walletAddress!);
        betService.reset();
        showBetPanel('host-idle');
    };

    document.getElementById('bet-accept-btn')!.onclick = async () => {
        if (!ctx.walletAddress) return showLobbyError(t('walletConnectFirst'));
        const amount = betService.state.amount;
        const matchId = betService.state.matchId ?? '';
        showBetPanel('guest-depositing');
        try {
            const txPromise = betService.acceptBet(amount, matchId);
            const timeoutPromise = new Promise<null>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 90_000)
            );
            const txHash = await Promise.race([txPromise, timeoutPromise]);
            if (!txHash) {
                showBetPanel('guest-incoming');
                return showLobbyError(betService.lastError || t('betDepositFailed'));
            }
            mpService.sendBetAccept(txHash, ctx.walletAddress!);
            betService.state.status = 'locked';
            showBetPanel('locked');
        } catch (e: any) {
            console.warn('[Bet] Accept failed:', e);
            showBetPanel('guest-incoming');
            showLobbyError(e?.message === 'timeout' ? 'Islem zaman asimina ugradi' : (betService.lastError || t('betDepositFailed')));
        }
    };

    document.getElementById('bet-decline-btn')!.onclick = () => {
        mpService.sendBetReject();
        betService.reset();
        showBetPanel('guest-counter');
    };

    document.getElementById('bet-counter-btn')!.onclick = () => {
        const input = document.getElementById('bet-counter-input') as HTMLInputElement;
        const amount = parseFloat(input.value);
        if (!amount || amount < MIN_BET || amount > MAX_BET) {
            return showLobbyError(t('betValidAmount'));
        }
        mpService.send({ type: 'bet_counter', amountAvax: amount });
        showBetPanel('guest-wait');
        showToast(`${amount} ${t('betCounterOffer')}`);
    };
}

// ─── LOBBY BACK + BEFOREUNLOAD ─────────────────────────────────────
export function initLobbyBackHandlers(): void {
    document.getElementById('lobby-back')?.addEventListener('click', async () => {
        if (betService.isActive() && betService.state.status === 'locked') {
            // Locked bet — kullanıcı çıkarsa kaybeder
            const confirmed = confirm(t('betForfeitConfirm'));
            if (!confirmed) return;
            const btn = document.getElementById('lobby-back') as HTMLButtonElement;
            btn.disabled = true;
            btn.textContent = t('betRefunding');
            await betService.cancelBet(); // reports loss via forfeit
            btn.disabled = false;
            btn.textContent = t('back');
        } else if (betService.isActive() && ['pending_host', 'host_deposited'].includes(betService.state.status ?? '')) {
            const btn = document.getElementById('lobby-back') as HTMLButtonElement;
            btn.disabled = true;
            btn.textContent = t('betRefunding');
            const result = await betService.cancelBet();
            btn.disabled = false;
            btn.textContent = t('back');
            if (result.ok && result.txHash) {
                console.log(`[Lobby] Bet refunded: ${result.refundAVAX} AVAX`);
            }
        } else {
            betService.reset();
        }
        leaveQuickMatch();
        mpService.disconnect();
        showScreen('home');
    });

    window.addEventListener('beforeunload', () => {
        if (!betService.isActive()) return;
        const matchId = betService.state.matchId;
        const address = (window as any).__walletAddress;
        if (!matchId || !address) return;

        if (betService.state.status === 'locked') {
            // Locked bet — report loss so server can settle
            navigator.sendBeacon('/api/report-result', new Blob(
                [JSON.stringify({ matchId, address, result: 'loss' })],
                { type: 'application/json' }
            ));
        } else if (['pending_host', 'host_deposited'].includes(betService.state.status ?? '')) {
            navigator.sendBeacon('/api/cancel-bet', new Blob(
                [JSON.stringify({ matchId, address })],
                { type: 'application/json' }
            ));
        }
    });
}
