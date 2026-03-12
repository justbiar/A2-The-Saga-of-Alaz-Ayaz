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

export type MPRole = 'host' | 'guest' | null;
export type MPMessage =
    | { type: 'ready'; team: 'fire' | 'ice' }
    | { type: 'loaded' }
    | { type: 'start' }
    | { type: 'place'; cardId: string; lane: 'left' | 'mid' | 'right' }
    | { type: 'prompt'; promptId: string }
    | { type: 'sync'; mana: number; avx: number; turn: number }
    | { type: 'ping'; ts: number }
    | { type: 'pong'; ts: number }
    | { type: 'surrender' }
    // ── Bet messages ──
    | { type: 'bet_offer'; amountAvax: number; matchId: string; hostAddress: string }
    | { type: 'bet_accept'; txHash: string; guestAddress: string }
    | { type: 'bet_reject' }
    | { type: 'bet_cancel' }
    | { type: 'bet_claim'; winnerAddress: string }
    | { type: 'game_over'; winner: 'fire' | 'ice'; reason: string };

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

// ── ICE sunucuları (STUN + TURN) ──
const ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Ücretsiz TURN sunucuları (OpenRelay / metered.ca free)
    {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
    },
    {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
    },
    {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
    },
];

const JOIN_TIMEOUT_MS = 20_000;       // 20 saniye timeout
const JOIN_RETRY_MAX = 2;            // 2 kez retry

export class MultiplayerService {
    public role: MPRole = null;
    public status: MPStatus = 'idle';
    public lobbyCode: string = '';
    public ping: number = 0;
    public opponentTeam: 'fire' | 'ice' | null = null;
    /** Host: rakip 'loaded' gönderdi mi? (race condition için) */
    public _opponentLoaded: boolean = false;
    public lobbyAmount: number = 0;
    public lobbyIsPublic: boolean = true;
    public lastError: string = '';

    private peer: any = null;
    private conn: any = null;
    private onMessage: MessageHandler | null = null;
    private onStatus: StatusHandler | null = null;
    private pingInterval: number | null = null;
    private pingTs: number = 0;
    private myTeam: 'fire' | 'ice' = 'fire';

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
    async createLobby(myTeam: 'fire' | 'ice', amount: number = 0, isPublic: boolean = true): Promise<string> {
        this.myTeam = myTeam;
        this.role = 'host';
        this.lobbyAmount = amount;
        this.lobbyIsPublic = isPublic;
        this.setStatus('creating');

        const code = this.generateCode();
        this.lobbyCode = code;

        // Backend'e lobi kaydet
        try {
            const w = (window as any).walletAddress || null;
            const nick = (window as any).profileService?.currentProfile?.username || null;
            await fetch('/api/lobby', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, team: myTeam, betAmount: amount, isPublic, wallet: w, nickname: nick }),
            });
        } catch (e) {
            console.warn('[MP] Lobi backend kaydı başarısız:', e);
        }

        return new Promise((resolve, reject) => {
            this.lastError = '';
            this.peer = new Peer(`a2-${code}`, {
                debug: 1,
                config: { iceServers: ICE_SERVERS },
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
                    resolve(this.createLobby(myTeam, amount, isPublic));
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
                // PeerJS signaling koptu — yeniden bağlan
                console.warn('[MP] Host signaling koptu, yeniden bağlanılıyor…');
                if (this.peer && !this.peer.destroyed) {
                    this.peer.reconnect();
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

    private _tryJoin(attempt: number): Promise<void> {
        this.setStatus('connecting');

        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (ok: boolean, val?: any) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                ok ? resolve() : reject(val);
            };

            this.peer = new Peer(undefined, {
                debug: 1,
                config: { iceServers: ICE_SERVERS },
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
                console.warn('[MP] Guest signaling koptu, yeniden bağlanılıyor…');
                if (this.peer && !this.peer.destroyed) {
                    this.peer.reconnect();
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
            this.send({ type: 'ready', team: this.myTeam });

            // Ping başlat
            this.startPing();
        });

        conn.on('data', (data: MPMessage) => {
            if (data.type === 'ready') {
                this.opponentTeam = data.team;
            } else if (data.type === 'loaded') {
                // Rakip yüklemeyi bitirdi — host tarafında flag set et
                this._opponentLoaded = true;
            } else if (data.type === 'ping') {
                this.send({ type: 'pong', ts: data.ts });
                return;
            } else if (data.type === 'pong') {
                this.ping = Date.now() - data.ts;
                return;
            }
            this.onMessage?.(data);
        });

        conn.on('close', () => {
            console.log('[MP] Bağlantı kapandı');
            this.stopPing();
            this.setStatus('disconnected');
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
    sendPlace(cardId: string, lane: 'left' | 'mid' | 'right') {
        this.send({ type: 'place', cardId, lane });
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

    private startPing() {
        this.pingInterval = window.setInterval(() => {
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
        // Backend'den lobiyi sil
        if (this.lobbyCode) {
            fetch(`/api/lobby/${this.lobbyCode}`, { method: 'DELETE' }).catch(() => {});
        }
        this.conn?.close();
        this.peer?.destroy();
        this.conn = null;
        this.peer = null;
        this.role = null;
        this.lobbyCode = '';
        this.lobbyAmount = 0;
        this.lobbyIsPublic = true;
        this.opponentTeam = null;
        this.setStatus('idle');
    }

    /** 6 haneli büyük harf kod */
    private generateCode(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }
}

export const mpService = new MultiplayerService();
