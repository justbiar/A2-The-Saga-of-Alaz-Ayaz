/**
 * MultiplayerService.ts — PeerJS tabanlı P2P multiplayer
 * Host: lobi oluşturur, Peer ID = lobi kodu
 * Guest: host'un Peer ID'sine bağlanır
 *
 * Mesaj tipleri:
 *  - 'ready'    : karşı taraf bağlandı, takım bilgisi gönderilir
 *  - 'loaded'   : kendi yükleme tamamlandı (oyun başlatma senkronizasyonu)
 *  - 'start'    : host her iki taraf hazır olunca gönderir, oyun başlar
 *  - 'place'    : birim yerleştirme { cardId, lane }
 *  - 'prompt'   : skill kart kullanımı { promptId }
 *  - 'sync'     : periyodik state sync { mana, avx, turn }
 *  - 'ping'     : gecikme ölçümü
 *  - 'pong'     : ping yanıtı
 */

declare const Peer: any; // PeerJS CDN'den geliyor

import { GameRandom } from '../utils/Random';

export type MPRole = 'host' | 'guest' | null;
export type MPMessage =
    | { type: 'ready'; team: 'fire' | 'ice'; wallet?: string }
    | { type: 'loaded' }
    | { type: 'start'; seed?: number }
    | { type: 'place'; cardId: string; lane: 'left' | 'mid' | 'right'; unitId?: string }
    | { type: 'prompt'; promptId: string }
    | { type: 'sync'; mana: number; avx: number; turn: number }
    | { type: 'unit_sync'; data: { id: string, hp: number, x: number, z: number, state: string, team: string }[] }
    | { type: 'ping'; ts: number }
    | { type: 'pong'; ts: number }
    | { type: 'surrender' }
    | { type: 'start_game' }  // host oyunu başlattı, guest de geçsin
    // ── Bet messages ──
    | { type: 'bet_offer'; amountAvax: number; matchId: string; hostAddress: string }
    | { type: 'bet_accept'; txHash: string; guestAddress: string }
    | { type: 'bet_reject' }
    | { type: 'bet_cancel' }
    | { type: 'bet_counter'; amountAvax: number }
    | { type: 'bet_claim'; winnerAddress: string }
    | { type: 'game_over'; winner: 'fire' | 'ice'; reason: string }
    | { type: 'base_sync'; fireHp: number; iceHp: number }
    | { type: 'chat'; text: string; nickname: string };

type MessageHandler = (msg: MPMessage) => void;
type StatusHandler = (status: MPStatus) => void;

export type MPStatus =
    | 'idle'
    | 'creating'    // Peer oluşturuluyor
    | 'waiting'     // Host lobide bekliyor
    | 'connecting'  // Guest bağlanmaya çalışıyor
    | 'connected'   // İki taraf bağlı
    | 'disconnected'
    | 'error';

// ICE sunucuları sunucudan alınır (geçici HMAC token)
const FALLBACK_ICE: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];

async function fetchIceServers(): Promise<RTCIceServer[]> {
    try {
        const res = await fetch('/api/turn-credentials');
        const data = await res.json();
        if (data.ok && Array.isArray(data.iceServers)) return data.iceServers;
    } catch { /* sunucuya ulaşılamazsa fallback */ }
    return FALLBACK_ICE;
}

const JOIN_TIMEOUT_MS = 45_000;       // 45 saniye timeout (TURN relay yavaş olabilir)
const JOIN_RETRY_MAX = 2;            // 2 kez retry
const DC_GRACE_MS = 5000;             // Data channel kapandıktan sonra 5s bekle (geçici kopma olabilir)
const PONG_TIMEOUT_MS = 10_000;      // 10s pong gelmezse disconnect

export class MultiplayerService {
    public role: MPRole = null;
    public status: MPStatus = 'idle';
    public lobbyCode: string = '';
    public ping: number = 0;
    public opponentTeam: 'fire' | 'ice' | null = null;
    /** Host: rakip 'loaded' gönderdi mi? (race condition için) */
    public _opponentLoaded: boolean = false;
    /** Guest: host 'start' gönderdi mi? (race condition için) */
    public _startReceived: boolean = false;
    public lobbyAmount: number = 0;
    public lobbyIsPublic: boolean = true;
    public lastError: string = '';
    /** Rakibin cüzdan adresi (bet mesajlarından çıkarılır) */
    public opponentWallet: string | null = null;

    private peer: any = null;
    private conn: any = null;
    private onMessage: MessageHandler | null = null;
    private onStatus: StatusHandler | null = null;
    private pingInterval: number | null = null;
    private pingTs: number = 0;
    private lastPongTs: number = 0;
    private myTeam: 'fire' | 'ice' = 'fire';
    private reconnectTimer: number | null = null;
    private dcGraceTimer: number | null = null;

    /** Callback'leri kaydet */
    init(onMessage: MessageHandler, onStatus: StatusHandler) {
        this.onMessage = onMessage;
        this.onStatus = onStatus;
    }

    private setStatus(s: MPStatus) {
        this.status = s;
        this.onStatus?.(s);
    }

    /** Lobi oluştur (host) — rastgele 6 haneli kod */
    async createLobby(myTeam: 'fire' | 'ice', amount: number = 0, isPublic: boolean = true, lobbyName: string = ''): Promise<string> {
        this.myTeam = myTeam;
        this.role = 'host';
        this.lobbyAmount = amount;
        this.lobbyIsPublic = isPublic;
        this.setStatus('creating');

        const code = this.generateCode();
        this.lobbyCode = code;

        const iceServers = await fetchIceServers();

        // Backend'e lobi kaydet
        try {
            const w = (window as any).walletAddress || null;
            const nick = (window as any).profileService?.currentProfile?.username || null;
            await fetch('/api/lobby', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, team: myTeam, betAmount: amount, isPublic, wallet: w, nickname: nick, lobbyName: lobbyName.slice(0, 20) }),
            });
        } catch (e) {
            console.warn('[MP] Lobi backend kaydı başarısız:', e);
        }

        return new Promise((resolve, reject) => {
            this.lastError = '';
            this.peer = new Peer(`a2-${code}`, {
                host: 'a2saga.me',
                port: 443,
                path: '/peerjs',
                secure: true,
                debug: 1,
                config: { iceServers },
            });

            this.peer.on('open', (id: string) => {
                console.log('[MP] Host peer açıldı:', id);
                this.setStatus('waiting');
                resolve(code);
            });

            this.peer.on('error', (err: any) => {
                // ID çakışması → yeni kod dene
                if (err.type === 'unavailable-id') {
                    this.peer.destroy();
                    resolve(this.createLobby(myTeam, amount, isPublic, lobbyName));
                } else {
                    console.error('[MP] Peer error:', err);
                    this.lastError = err.message || err.type || String(err);
                    this.setStatus('error');
                    reject(err);
                }
            });

            this.peer.on('connection', (conn: any) => {
                this.conn = conn;
                this.setupConnection(conn);
            });

            this.peer.on('disconnected', () => {
                // PeerJS signaling koptu — veri kanalı hâlâ açık olabilir
                console.warn('[MP] Host signaling koptu');
                if (this.conn?.open) {
                    // Data channel açık — oyun devam ediyor, sadece signaling'i tekrar bağla
                    console.log('[MP] Data channel hâlâ açık, sadece signaling reconnect yapılıyor');
                }
                if (this.peer && !this.peer.destroyed) {
                    // Debounced reconnect
                    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = window.setTimeout(() => {
                        if (this.peer && !this.peer.destroyed) {
                            this.peer.reconnect();
                        }
                    }, 2000);
                }
            });
        });
    }

    /** Lobileye katıl (guest) */
    async joinLobby(code: string, myTeam: 'fire' | 'ice'): Promise<void> {
        this.myTeam = myTeam;
        this.role = 'guest';
        this.lobbyCode = code.trim().toUpperCase();
        this.lastError = '';

        for (let attempt = 0; attempt <= JOIN_RETRY_MAX; attempt++) {
            try {
                await this._tryJoin(attempt);
                return; // başarılı
            } catch (err: any) {
                console.warn(`[MP] joinLobby deneme ${attempt + 1}/${JOIN_RETRY_MAX + 1} başarısız:`, err.message);
                // Son denemeyse throw
                if (attempt >= JOIN_RETRY_MAX) {
                    this.lastError = err.message || String(err);
                    this.setStatus('error');
                    throw err;
                }
                // Temizle, tekrar dene
                this.conn?.close();
                this.peer?.destroy();
                this.conn = null;
                this.peer = null;
                await new Promise(r => setTimeout(r, 1000)); // 1s bekle
            }
        }
    }

    private async _tryJoin(attempt: number): Promise<void> {
        this.setStatus('connecting');

        const iceServers = await fetchIceServers();

        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (ok: boolean, val?: any) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                ok ? resolve() : reject(val);
            };

            this.peer = new Peer(undefined, {
                host: 'a2saga.me',
                port: 443,
                path: '/peerjs',
                secure: true,
                debug: 1,
                config: { iceServers },
            });

            this.peer.on('open', () => {
                const conn = this.peer.connect(`a2-${this.lobbyCode}`, {
                    reliable: true,
                    serialization: 'json',
                });
                this.conn = conn;
                this.setupConnection(conn);

                conn.on('open', () => finish(true));
                conn.on('error', (err: any) => {
                    console.error('[MP] Bağlantı hatası:', err);
                    finish(false, err);
                });
            });

            this.peer.on('error', (err: any) => {
                console.error('[MP] Peer error:', err);
                finish(false, err);
            });

            this.peer.on('disconnected', () => {
                console.warn('[MP] Guest signaling koptu');
                if (this.conn?.open) {
                    console.log('[MP] Data channel hâlâ açık, sadece signaling reconnect yapılıyor');
                }
                if (this.peer && !this.peer.destroyed) {
                    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = window.setTimeout(() => {
                        if (this.peer && !this.peer.destroyed) {
                            this.peer.reconnect();
                        }
                    }, 2000);
                }
            });

            // Timeout
            const timer = setTimeout(() => {
                finish(false, new Error(`Bağlantı zaman aşımı (deneme ${attempt + 1})`));
            }, JOIN_TIMEOUT_MS);
        });
    }

    private setupConnection(conn: any) {
        conn.on('open', () => {
            console.log('[MP] Bağlantı açıldı');
            this.setStatus('connected');

            // Kendi takımını karşıya bildir
            this.send({ type: 'ready', team: this.myTeam, wallet: (window as any).__walletAddress || '' });

            // Ping başlat
            this.startPing();
        });

        const VALID_TYPES = new Set([
            'ready', 'loaded', 'start', 'place', 'prompt', 'sync', 'unit_sync',
            'ping', 'pong', 'surrender', 'start_game',
            'bet_offer', 'bet_accept', 'bet_reject', 'bet_cancel', 'bet_counter', 'bet_claim',
            'game_over', 'base_sync', 'chat',
        ]);
        conn.on('data', (data: any) => {
            if (!data || typeof data !== 'object' || !VALID_TYPES.has(data.type)) {
                console.warn('[MP] Geçersiz mesaj:', data?.type);
                return;
            }

            // Payload dogrulama — tip ve uzunluk kontrolleri
            if (data.type === 'chat') {
                if (typeof data.text !== 'string' || typeof data.nickname !== 'string') return;
                data.text = data.text.slice(0, 200);
                data.nickname = data.nickname.slice(0, 20);
            }
            if (data.type === 'ready') {
                if (data.team !== 'fire' && data.team !== 'ice') return;
                if (data.wallet && typeof data.wallet !== 'string') return;
                if (data.wallet) data.wallet = data.wallet.slice(0, 42);
            }
            if (data.type === 'place') {
                if (typeof data.cardId !== 'string' || !['left', 'mid', 'right'].includes(data.lane)) return;
                data.cardId = data.cardId.slice(0, 30);
                if (data.unitId) data.unitId = String(data.unitId).slice(0, 60);
            }
            if (data.type === 'prompt') {
                if (typeof data.promptId !== 'string') return;
                data.promptId = data.promptId.slice(0, 30);
            }
            if (data.type === 'sync') {
                if (typeof data.mana !== 'number' || typeof data.avx !== 'number' || typeof data.turn !== 'number') return;
            }
            if (data.type === 'ping' || data.type === 'pong') {
                if (typeof data.ts !== 'number') return;
            }
            if (data.type === 'bet_offer') {
                if (typeof data.amountAvax !== 'number' || typeof data.matchId !== 'string' || typeof data.hostAddress !== 'string') return;
                data.matchId = data.matchId.slice(0, 80);
                data.hostAddress = data.hostAddress.slice(0, 42);
            }
            if (data.type === 'bet_accept') {
                if (typeof data.txHash !== 'string' || typeof data.guestAddress !== 'string') return;
                data.txHash = data.txHash.replace(/[^a-fA-F0-9x]/g, '').slice(0, 66);
                data.guestAddress = data.guestAddress.slice(0, 42);
            }
            if (data.type === 'game_over') {
                if (data.winner !== 'fire' && data.winner !== 'ice') return;
                if (typeof data.reason !== 'string') return;
                data.reason = data.reason.slice(0, 100);
            }
            if (data.type === 'base_sync') {
                if (typeof data.fireHp !== 'number' || typeof data.iceHp !== 'number') return;
            }
            if (data.type === 'bet_claim') {
                if (typeof data.winnerAddress !== 'string') return;
                data.winnerAddress = data.winnerAddress.slice(0, 42);
            }
            if (data.type === 'start' && data.seed !== undefined) {
                if (typeof data.seed !== 'number') return;
            }

            const msg = data as MPMessage;
            if (msg.type === 'ready') {
                this.opponentTeam = msg.team;
                if (msg.wallet) this.opponentWallet = msg.wallet;
            } else if (msg.type === 'loaded') {
                this._opponentLoaded = true;
            } else if (msg.type === 'start') {
                if (msg.seed !== undefined) {
                    GameRandom.setSeed(msg.seed);
                    console.log(`[MP] Seed received from host: ${msg.seed}`);
                }
                this._startReceived = true;
            } else if (msg.type === 'ping') {
                this.send({ type: 'pong', ts: msg.ts });
                return;
            } else if (msg.type === 'pong') {
                this.ping = Date.now() - msg.ts;
                this.lastPongTs = Date.now();
                return;
            }
            this.onMessage?.(msg);
        });

        conn.on('close', () => {
            console.log('[MP] Data channel kapandı, grace period başlatılıyor...');
            // Data channel kapandı — hemen disconnect etme, belki geçicidir
            if (this.dcGraceTimer) clearTimeout(this.dcGraceTimer);
            this.dcGraceTimer = window.setTimeout(() => {
                // Grace period doldu, hâlâ kapalıysa gerçekten disconnect
                if (!this.conn?.open) {
                    console.log('[MP] Grace period doldu → disconnect');
                    this.stopPing();
                    this.setStatus('disconnected');
                }
            }, DC_GRACE_MS);
        });

        conn.on('error', (err: any) => {
            console.error('[MP] Conn error:', err);
            this.setStatus('error');
        });
    }

    /** Mesaj gönder */
    send(msg: MPMessage) {
        if (this.conn?.open) {
            this.conn.send(msg);
        }
    }

    /** Birim yerleştirme gönder */
    sendPlace(cardId: string, lane: 'left' | 'mid' | 'right', unitId: string) {
        this.send({ type: 'place', cardId, lane, unitId });
    }

    /** Tam senkron paketi (Host -> Guest) */
    sendUnitSync(data: { id: string, hp: number, x: number, z: number, state: string, team: string }[]) {
        this.send({ type: 'unit_sync', data });
    }

    /** Skill kart gönder */
    sendPrompt(promptId: string) {
        this.send({ type: 'prompt', promptId });
    }

    /** Teslim */
    sendSurrender() {
        this.send({ type: 'surrender' });
    }

    /** Bet teklifi gönder (host → guest) */
    sendBetOffer(amountAvax: number, matchId: string, hostAddress: string) {
        this.send({ type: 'bet_offer', amountAvax, matchId, hostAddress });
    }

    /** Bet kabul (guest → host): kendi tx hash'ini gönder */
    sendBetAccept(txHash: string, guestAddress: string) {
        this.send({ type: 'bet_accept', txHash, guestAddress });
    }

    /** Bet reddet */
    sendBetReject() {
        this.send({ type: 'bet_reject' });
    }

    /** Bet iptal */
    sendBetCancel() {
        this.send({ type: 'bet_cancel' });
    }

    /** Kazananı bildir (her iki client'a) */
    sendBetClaim(winnerAddress: string) {
        this.send({ type: 'bet_claim', winnerAddress });
    }

    /** Oyun bitti — kazananı karşıya bildir */
    sendGameOver(winner: 'fire' | 'ice', reason: string) {
        this.send({ type: 'game_over', winner, reason });
    }

    /** Host → Guest: base HP senkronizasyonu */
    sendBaseSync(fireHp: number, iceHp: number) {
        this.send({ type: 'base_sync', fireHp, iceHp });
    }

    private startPing() {
        this.lastPongTs = Date.now();
        this.pingInterval = window.setInterval(() => {
            // Pong timeout — sadece oyun basladiktan sonra kontrol et
            // (loading sirasinda main thread mesgul, pong gelemeyebilir)
            const ctx = (window as any).__a2ctx;
            const gameActive = ctx?.mpGameStarted === true;
            if (gameActive && this.lastPongTs > 0 && Date.now() - this.lastPongTs > PONG_TIMEOUT_MS) {
                console.warn(`[MP] Pong timeout (${PONG_TIMEOUT_MS}ms) — disconnect`);
                this.stopPing();
                this.setStatus('disconnected');
                return;
            }
            // Loading sirasinda lastPongTs'i guncelle (timeout sayma)
            if (!gameActive) this.lastPongTs = Date.now();
            this.pingTs = Date.now();
            this.send({ type: 'ping', ts: this.pingTs });
        }, 3000);
    }

    private stopPing() {
        if (this.pingInterval !== null) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /** Bağlantıyı kapat */
    disconnect() {
        this.stopPing();
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this.dcGraceTimer)   { clearTimeout(this.dcGraceTimer);   this.dcGraceTimer = null; }
        // Backend'den lobiyi sil (wallet ile sahiplik kontrolu)
        if (this.lobbyCode) {
            const w = (window as any).__walletAddress || '';
            fetch(`/api/lobby/${this.lobbyCode}?wallet=${encodeURIComponent(w)}`, { method: 'DELETE' }).catch(() => {});
        }
        // onMessage/onStatus'u temizle — close event'in gecikmeli callback'i triggerWin yapmasin
        this.onMessage = null;
        this.onStatus = null;
        this.conn?.close();
        this.peer?.destroy();
        // close event grace timer yaratabilir — tekrar temizle
        if (this.dcGraceTimer)   { clearTimeout(this.dcGraceTimer);   this.dcGraceTimer = null; }
        this.conn = null;
        this.peer = null;
        this.role = null;
        this.lobbyCode = '';
        this.lobbyAmount = 0;
        this.lobbyIsPublic = true;
        this.opponentTeam = null;
        this.opponentWallet = null;
        this._opponentLoaded = false;
        this._startReceived = false;
        this.status = 'idle';  // setStatus yerine direkt set (callback null'landı)
    }

    /** 6 haneli büyük harf kod (crypto-safe) */
    private generateCode(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const arr = crypto.getRandomValues(new Uint8Array(6));
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[arr[i] % chars.length];
        }
        return code;
    }
}

export const mpService = new MultiplayerService();
