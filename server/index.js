/**
 * A2 API Server — Express backend for secure bet settlement.
 *
 * Endpoints:
 *   POST /api/settle          — Send prize to winner (uses HOUSE_WALLET_PK)
 *   POST /api/refund          — Refund host if guest never deposited
 *   POST /api/distribute      — Admin: distribute weekly leaderboard prizes
 *   GET  /api/health          — Health check
 *
 * Private key never leaves this server.
 * nginx proxies /api/* → http://localhost:3001
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT ?? 3001;

// ── Config ────────────────────────────────────────────────────────────
const HOUSE_WALLET_PK = process.env.HOUSE_WALLET_PK;
const ALLOWED_ORIGINS = [
    'https://a2saga.me',
    'https://www.a2saga.me',
    'http://localhost:5173',
    'http://localhost:4173',
];
const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
const BET_FEE_PERCENT = 2;

if (!HOUSE_WALLET_PK) {
    console.error('[A2 API] HOUSE_WALLET_PK eksik! .env dosyasını kontrol et.');
    process.exit(1);
}

// ── Middleware ────────────────────────────────────────────────────────
app.use(express.json());
app.use(cors({
    origin: (origin, cb) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error('CORS: izinsiz origin: ' + origin));
    },
    methods: ['GET', 'POST', 'DELETE'],
}));

// ── Ethers setup ──────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(FUJI_RPC);
const houseSigner = new ethers.Wallet(HOUSE_WALLET_PK, provider);

console.log('[A2 API] House wallet:', houseSigner.address);

// ── Rate limit (basit, per-IP) ────────────────────────────────────────
const recentRequests = new Map(); // ip → timestamp[]
function rateLimit(req, res, next) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();
    const arr = (recentRequests.get(ip) ?? []).filter(t => now - t < 60_000);
    if (arr.length >= 10) {
        return res.status(429).json({ error: 'Çok fazla istek. 1 dakika bekle.' });
    }
    arr.push(now);
    recentRequests.set(ip, arr);
    next();
}

// ── Helpers ───────────────────────────────────────────────────────────
function validateAddress(addr) {
    try { return ethers.getAddress(addr); }
    catch { return null; }
}

function validateAmount(val) {
    const n = parseFloat(val);
    if (isNaN(n) || n <= 0 || n > 200) return null; // max pot = 2 * 100 AVAX
    return n;
}

// ══════════════════════════════════════════════════════════════════════
//  MATCH REGISTRY — Server-side bet tracking + on-chain verification
// ══════════════════════════════════════════════════════════════════════

/**
 * matches: matchId → {
 *   hostAddress, guestAddress,
 *   amount,
 *   hostTxHash, guestTxHash,
 *   hostVerified, guestVerified,
 *   status: 'host_deposited' | 'locked' | 'settling' | 'settled' | 'refunded' | 'disputed',
 *   hostResult, guestResult,   // 'win' | 'loss' reported by each side
 *   createdAt, settledAt
 * }
 */
const matches = new Map();

/** Verify a deposit TX on-chain: check to, value, data */
async function verifyDepositTx(txHash, expectedFrom, expectedAmountAvax, expectedMatchId) {
    try {
        const tx = await provider.getTransaction(txHash);
        if (!tx) return { ok: false, error: 'TX bulunamadı' };

        // Wait for at least 1 confirmation
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt || receipt.status !== 1) return { ok: false, error: 'TX onaylanmamış veya başarısız' };

        // Check recipient is house wallet
        if (tx.to?.toLowerCase() !== houseSigner.address.toLowerCase()) {
            return { ok: false, error: 'TX house wallet\'a gönderilmemiş' };
        }

        // Check sender
        if (tx.from?.toLowerCase() !== expectedFrom.toLowerCase()) {
            return { ok: false, error: 'TX gönderici uyuşmuyor' };
        }

        // Check amount (allow 0.1% tolerance for gas rounding)
        const expectedWei = ethers.parseEther(expectedAmountAvax.toFixed(6));
        const diff = tx.value > expectedWei ? tx.value - expectedWei : expectedWei - tx.value;
        const tolerance = expectedWei / 1000n; // 0.1%
        if (diff > tolerance) {
            return { ok: false, error: `Miktar uyuşmuyor: beklenen ${expectedAmountAvax}, gelen ${ethers.formatEther(tx.value)}` };
        }

        // Data field kontrolü kaldırıldı — MetaMask EOA'ya data'lı TX engellediği için

        return { ok: true };
    } catch (e) {
        return { ok: false, error: 'RPC hatası: ' + e.message };
    }
}

/** Auto-refund: 10 dakika içinde guest deposit olmazsa host'a iade */
const MATCH_TIMEOUT = 10 * 60 * 1000; // 10 min
setInterval(() => {
    const now = Date.now();
    for (const [matchId, match] of matches) {
        if (match.status === 'host_deposited' && (now - match.createdAt) > MATCH_TIMEOUT) {
            console.log(`[AutoRefund] Match ${matchId} timed out — refunding host`);
            match.status = 'refunded';
            const refundWei = ethers.parseEther(match.amount.toFixed(6));
            houseSigner.sendTransaction({
                to: match.hostAddress,
                value: refundWei,
            }).then(tx => {
                console.log(`[AutoRefund] ${matchId} → ${match.hostAddress} TX: ${tx.hash}`);
            }).catch(err => {
                console.error(`[AutoRefund] ${matchId} failed:`, err.message);
                match.status = 'host_deposited'; // retry next cycle
            });
        }
        // Clean up old settled/refunded matches after 1 hour
        if (['settled', 'refunded'].includes(match.status) && (now - (match.settledAt || match.createdAt)) > 60 * 60 * 1000) {
            matches.delete(matchId);
        }
    }
}, 30_000);

// ── Routes ────────────────────────────────────────────────────────────

/** GET /api/health */
app.get('/api/health', async (req, res) => {
    try {
        const bal = await provider.getBalance(houseSigner.address);
        res.json({
            ok: true,
            houseWallet: houseSigner.address,
            balanceAVAX: parseFloat(ethers.formatEther(bal)).toFixed(4),
            network: 'Avalanche Fuji Testnet',
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * POST /api/settle
 * Body: { winnerAddress, betAmountPerPlayer, matchId }
 *
 * ❌ OLD: Client calls this directly → anyone could claim win.
 * ✅ NEW: This is now called internally by /api/report-result when both sides agree.
 *         Direct calls are rejected unless match is in 'settling' state.
 */
const settledMatches = new Set();

app.post('/api/settle', rateLimit, async (req, res) => {
    return res.status(403).json({ error: 'Doğrudan settle çağrısı devre dışı. /api/report-result kullanın.' });
});

/**
 * POST /api/register-bet
 * Body: { matchId, role: 'host'|'guest', address, txHash, amount }
 * → Verifies the deposit TX on-chain, registers it in match registry.
 */
app.post('/api/register-bet', rateLimit, async (req, res) => {
    const { matchId, role, address, txHash, amount } = req.body ?? {};

    // Validate inputs
    if (!matchId || typeof matchId !== 'string' || matchId.length > 80) {
        return res.status(400).json({ error: 'Geçersiz matchId' });
    }
    const addr = validateAddress(address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });

    const amt = validateAmount(amount);
    if (!amt) return res.status(400).json({ error: 'Geçersiz amount' });

    if (!txHash || typeof txHash !== 'string' || !txHash.startsWith('0x')) {
        return res.status(400).json({ error: 'Geçersiz txHash' });
    }
    if (!['host', 'guest'].includes(role)) {
        return res.status(400).json({ error: 'role must be host or guest' });
    }

    // Prevent reusing same txHash
    for (const [, m] of matches) {
        if (m.hostTxHash === txHash || m.guestTxHash === txHash) {
            return res.status(409).json({ error: 'Bu TX zaten kullanılmış' });
        }
    }

    // On-chain verification
    console.log(`[RegisterBet] Verifying ${role} deposit: ${txHash} for match ${matchId}`);
    const verify = await verifyDepositTx(txHash, addr, amt, matchId);
    if (!verify.ok) {
        console.log(`[RegisterBet] FAILED: ${verify.error}`);
        return res.status(400).json({ error: 'Deposit doğrulanamadı: ' + verify.error });
    }

    if (role === 'host') {
        if (matches.has(matchId)) {
            return res.status(409).json({ error: 'Bu matchId zaten kayıtlı' });
        }
        matches.set(matchId, {
            hostAddress: addr,
            guestAddress: null,
            amount: amt,
            hostTxHash: txHash,
            guestTxHash: null,
            hostVerified: true,
            guestVerified: false,
            status: 'host_deposited',
            hostResult: null,
            guestResult: null,
            createdAt: Date.now(),
            settledAt: null,
        });
        console.log(`[RegisterBet] Host registered: ${matchId} amount=${amt} AVAX`);
        res.json({ ok: true, status: 'host_deposited' });

    } else {
        // Guest
        const match = matches.get(matchId);
        if (!match) {
            return res.status(404).json({ error: 'Maç bulunamadı. Host henüz deposit yapmamış olabilir.' });
        }
        if (match.status !== 'host_deposited') {
            return res.status(409).json({ error: 'Maç durumu uygun değil: ' + match.status });
        }
        if (Math.abs(match.amount - amt) > 0.001) {
            return res.status(400).json({ error: `Miktar uyuşmuyor: beklenen ${match.amount}, gelen ${amt}` });
        }

        match.guestAddress = addr;
        match.guestTxHash = txHash;
        match.guestVerified = true;
        match.status = 'locked';
        console.log(`[RegisterBet] Guest registered → match LOCKED: ${matchId}`);
        res.json({ ok: true, status: 'locked' });
    }
});

/**
 * POST /api/cancel-bet
 * Body: { matchId, address }
 * → Host lobiden çıkarken guest henüz deposit yapmamışsa refund yap.
 */
app.post('/api/cancel-bet', rateLimit, async (req, res) => {
    const { matchId, address } = req.body ?? {};

    const addr = validateAddress(address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });
    if (!matchId || typeof matchId !== 'string') {
        return res.status(400).json({ error: 'Geçersiz matchId' });
    }

    const match = matches.get(matchId);
    if (!match) return res.status(404).json({ error: 'Maç bulunamadı' });

    // Sadece host iptal edebilir
    if (match.hostAddress.toLowerCase() !== addr.toLowerCase()) {
        return res.status(403).json({ error: 'Sadece host iptal edebilir' });
    }

    // Eğer guest zaten deposit yaptıysa iptal edilemez
    if (match.status === 'locked') {
        return res.status(409).json({ error: 'Her iki taraf da deposit yaptı, iptal edilemez' });
    }

    if (['settled', 'refunded'].includes(match.status)) {
        return res.status(409).json({ error: 'Maç zaten sonuçlandı', status: match.status });
    }

    // host_deposited durumunda — refund yap
    if (match.status === 'host_deposited') {
        try {
            const refundWei = ethers.parseEther(match.amount.toFixed(6));
            const tx = await houseSigner.sendTransaction({
                to: match.hostAddress,
                value: refundWei,
            });
            await tx.wait(1);

            match.status = 'refunded';
            match.settledAt = Date.now();
            console.log(`[CancelBet] ✅ ${matchId} → host refunded ${match.amount} AVAX tx=${tx.hash}`);
            res.json({ ok: true, status: 'refunded', txHash: tx.hash, refundAVAX: match.amount });
        } catch (e) {
            console.error(`[CancelBet] ${matchId} refund failed:`, e.message);
            res.status(500).json({ error: 'Refund başarısız: ' + e.message });
        }
    } else {
        res.status(409).json({ error: 'Beklenmeyen durum: ' + match.status });
    }
});

/**
 * POST /api/report-result
 * Body: { matchId, address, result: 'win' | 'loss' }
 * → Each player reports their result. When both agree → auto-settle.
 *   If they disagree → 'disputed' state, admin resolves manually.
 */
app.post('/api/report-result', rateLimit, async (req, res) => {
    const { matchId, address, result } = req.body ?? {};

    const addr = validateAddress(address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });

    if (!matchId || typeof matchId !== 'string') {
        return res.status(400).json({ error: 'Geçersiz matchId' });
    }
    if (!['win', 'loss'].includes(result)) {
        return res.status(400).json({ error: 'result must be win or loss' });
    }

    const match = matches.get(matchId);
    if (!match) return res.status(404).json({ error: 'Maç bulunamadı' });

    if (['settled', 'refunded'].includes(match.status)) {
        return res.status(409).json({ error: 'Maç zaten sonuçlandı', status: match.status });
    }
    if (match.status !== 'locked') {
        return res.status(409).json({ error: 'Maç henüz kilitlenmemiş (iki taraf da deposit yapmadı)', status: match.status });
    }

    // Determine which side is reporting
    const isHost = addr.toLowerCase() === match.hostAddress?.toLowerCase();
    const isGuest = addr.toLowerCase() === match.guestAddress?.toLowerCase();
    if (!isHost && !isGuest) {
        return res.status(403).json({ error: 'Bu maçın oyuncusu değilsin' });
    }

    if (isHost) match.hostResult = result;
    if (isGuest) match.guestResult = result;

    console.log(`[ReportResult] ${matchId} ${isHost ? 'host' : 'guest'}(${addr.slice(0, 8)}) → ${result}`);

    // Both reported?
    if (match.hostResult && match.guestResult) {
        // Determine winner
        let winnerAddr = null;

        if (match.hostResult === 'win' && match.guestResult === 'loss') {
            winnerAddr = match.hostAddress;
        } else if (match.guestResult === 'win' && match.hostResult === 'loss') {
            winnerAddr = match.guestAddress;
        } else if (match.hostResult === 'win' && match.guestResult === 'win') {
            // Both claim win — dispute
            match.status = 'disputed';
            console.log(`[ReportResult] DISPUTE: ${matchId} — both claim win, refunding both`);
            // Auto-resolve dispute: refund both players
            await refundBothPlayers(matchId, match);
            return res.json({ ok: true, status: 'disputed', message: 'İki taraf da kazandığını iddia etti — her iki tarafa iade yapılıyor' });
        } else {
            // Both claim loss (edge case) — refund both
            match.status = 'disputed';
            console.log(`[ReportResult] DISPUTE: ${matchId} — both claim loss, refunding both`);
            await refundBothPlayers(matchId, match);
            return res.json({ ok: true, status: 'disputed', message: 'İki taraf da kaybettiğini iddia etti — iade yapılıyor' });
        }

        // Consensus! Settle.
        match.status = 'settling';
        const totalPot = match.amount * 2;
        const fee = totalPot * (BET_FEE_PERCENT / 100);
        const prize = totalPot - fee;
        const prizeWei = ethers.parseEther(prize.toFixed(6));

        try {
            const bal = await provider.getBalance(houseSigner.address);
            if (bal < prizeWei) {
                match.status = 'locked'; // revert
                return res.status(503).json({ error: 'House wallet bakiyesi yetersiz' });
            }

            const tx = await houseSigner.sendTransaction({
                to: winnerAddr,
                value: prizeWei,
            });

            match.status = 'settled';
            match.settledAt = Date.now();
            settledMatches.add(matchId);
            console.log(`[Settle] ✅ ${matchId} → winner=${winnerAddr.slice(0, 10)} prize=${prize} AVAX tx=${tx.hash}`);

            res.json({ ok: true, status: 'settled', winnerAddress: winnerAddr, prizeAVAX: prize, txHash: tx.hash });

            // Background confirm
            tx.wait(1).then(r => console.log(`[Settle] Confirmed block=${r.blockNumber}`))
                .catch(e => console.error('[Settle] Confirm err:', e.message));

        } catch (e) {
            match.status = 'locked';
            console.error('[Settle] TX failed:', e.message);
            res.status(500).json({ error: 'Settle TX başarısız: ' + e.message });
        }

    } else {
        // Only one side reported so far
        res.json({ ok: true, status: 'waiting', message: 'Rakibin sonucu bekleniyor…' });
    }
});

/** Refund both players (dispute resolution) */
async function refundBothPlayers(matchId, match) {
    const refundWei = ethers.parseEther(match.amount.toFixed(6));
    const players = [match.hostAddress, match.guestAddress].filter(Boolean);
    for (const addr of players) {
        try {
            const tx = await houseSigner.sendTransaction({
                to: addr,
                value: refundWei,
            });
            console.log(`[DisputeRefund] ${matchId} → ${addr.slice(0, 10)} TX: ${tx.hash}`);
        } catch (e) {
            console.error(`[DisputeRefund] ${matchId} → ${addr.slice(0, 10)} FAILED:`, e.message);
        }
    }
    match.status = 'refunded';
    match.settledAt = Date.now();
}

/** GET /api/match/:matchId — Match durumu sorgula */
app.get('/api/match/:matchId', (req, res) => {
    const match = matches.get(req.params.matchId);
    if (!match) return res.status(404).json({ error: 'Maç bulunamadı' });
    res.json({
        ok: true,
        status: match.status,
        amount: match.amount,
        hostVerified: match.hostVerified,
        guestVerified: match.guestVerified,
        hostResult: match.hostResult,
        guestResult: match.guestResult,
    });
});

/**
 * POST /api/refund
 * Body: { hostAddress, betAmountPerPlayer, matchId }
 * → Refunds host's deposit (no fee taken)
 */
const refundedMatches = new Set();

app.post('/api/refund', rateLimit, async (req, res) => {
    const { hostAddress, betAmountPerPlayer, matchId } = req.body ?? {};

    const host = validateAddress(hostAddress);
    if (!host) return res.status(400).json({ error: 'Geçersiz hostAddress' });

    const amount = validateAmount(betAmountPerPlayer);
    if (!amount) return res.status(400).json({ error: 'Geçersiz betAmountPerPlayer' });

    if (!matchId || typeof matchId !== 'string') {
        return res.status(400).json({ error: 'Geçersiz matchId' });
    }

    if (refundedMatches.has(matchId)) {
        return res.status(409).json({ error: 'Bu maç zaten iade edildi.' });
    }

    const refundWei = ethers.parseEther(amount.toFixed(6));

    try {
        const tx = await houseSigner.sendTransaction({
            to: host,
            value: refundWei,
        });

        refundedMatches.add(matchId);
        console.log(`[Refund] matchId=${matchId} host=${host} amount=${amount} AVAX tx=${tx.hash}`);
        res.json({ ok: true, txHash: tx.hash, refundAVAX: amount, matchId });

    } catch (e) {
        console.error('[Refund] TX failed:', e.message);
        res.status(500).json({ error: 'TX gönderilemedi: ' + e.message });
    }
});

/**
 * POST /api/distribute
 * Body: { adminKey, recipients: [{address, avax}] }
 * → Distributes weekly prize pool to top players
 * adminKey = process.env.ADMIN_KEY (basit auth)
 */
app.post('/api/distribute', async (req, res) => {
    const { adminKey, recipients } = req.body ?? {};

    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
        return res.status(403).json({ error: 'Yetkisiz' });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: 'recipients dizisi gerekli' });
    }

    const results = [];
    for (const r of recipients.slice(0, 10)) { // max 10 kişi
        const addr = validateAddress(r.address);
        const amt = validateAmount(r.avax);
        if (!addr || !amt) { results.push({ address: r.address, error: 'Geçersiz' }); continue; }

        try {
            const tx = await houseSigner.sendTransaction({
                to: addr,
                value: ethers.parseEther(amt.toFixed(6)),
            });
            await tx.wait(1);
            results.push({ address: addr, avax: amt, txHash: tx.hash });
            console.log(`[Distribute] ${addr} ← ${amt} AVAX tx=${tx.hash}`);
        } catch (e) {
            results.push({ address: addr, avax: amt, error: e.message });
        }
    }

    res.json({ ok: true, results });
});

// ══════════════════════════════════════════════════════════════════════
//  LOBBY BROWSER & QUICK MATCH
// ══════════════════════════════════════════════════════════════════════

/** In-memory lobby store: code → { team, betAmount, isPublic, wallet, nickname, createdAt } */
const lobbies = new Map();

/** Lobiler 30 dakika sonra otomatik temizlenir (oyuncu çıkana kadar açık kalır, fallback TTL) */
const LOBBY_TTL = 30 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [code, lobby] of lobbies) {
        if (now - lobby.createdAt > LOBBY_TTL) lobbies.delete(code);
    }
}, 30_000);

/** POST /api/lobby — Lobi kaydet */
app.post('/api/lobby', rateLimit, (req, res) => {
    const { code, team, betAmount, isPublic, wallet, nickname } = req.body ?? {};
    if (!code || typeof code !== 'string' || code.length !== 6) {
        return res.status(400).json({ error: 'Geçersiz lobi kodu' });
    }
    if (!team || !['fire', 'ice'].includes(team)) {
        return res.status(400).json({ error: 'Geçersiz takım' });
    }
    lobbies.set(code.toUpperCase(), {
        team,
        betAmount: parseFloat(betAmount) || 0,
        isPublic: !!isPublic,
        wallet: wallet || null,
        nickname: (nickname || 'Anonim').slice(0, 20),
        createdAt: Date.now(),
    });
    console.log(`[Lobby] Registered: ${code} (${isPublic ? 'public' : 'private'}) team=${team} bet=${betAmount}`);
    res.json({ ok: true });
});

/** DELETE /api/lobby/:code — Lobi sil */
app.delete('/api/lobby/:code', (req, res) => {
    const code = req.params.code.toUpperCase();
    lobbies.delete(code);
    console.log(`[Lobby] Removed: ${code}`);
    res.json({ ok: true });
});

/** GET /api/lobbies — Public lobileri listele */
app.get('/api/lobbies', (req, res) => {
    const publicLobbies = [];
    for (const [code, lobby] of lobbies) {
        if (lobby.isPublic) {
            publicLobbies.push({
                code,
                team: lobby.team,
                betAmount: lobby.betAmount,
                nickname: lobby.nickname,
                age: Math.floor((Date.now() - lobby.createdAt) / 1000),
            });
        }
    }
    // En yeniler önce
    publicLobbies.sort((a, b) => a.age - b.age);
    res.json({ ok: true, lobbies: publicLobbies });
});

/** Quick Match queue: { wallet, team, code, nickname, joinedAt } */
const quickMatchQueue = [];
const quickMatchPairs = new Map(); // wallet → { opponent, code }

/** Kuyruğu 3 dakika sonra temizle */
setInterval(() => {
    const now = Date.now();
    for (let i = quickMatchQueue.length - 1; i >= 0; i--) {
        if (now - quickMatchQueue[i].joinedAt > 3 * 60 * 1000) {
            quickMatchQueue.splice(i, 1);
        }
    }
    // Stale pairs temizle
    for (const [wallet, pair] of quickMatchPairs) {
        if (now - pair.matchedAt > 60 * 1000) quickMatchPairs.delete(wallet);
    }
}, 15_000);

/** POST /api/quickmatch/join — Kuyruğa gir */
app.post('/api/quickmatch/join', rateLimit, (req, res) => {
    const { wallet, team, code, nickname } = req.body ?? {};
    if (!wallet || !team || !code) {
        return res.status(400).json({ error: 'wallet, team ve code gerekli' });
    }

    // Zaten kuyrukta mı?
    const existing = quickMatchQueue.findIndex(q => q.wallet === wallet);
    if (existing >= 0) quickMatchQueue.splice(existing, 1);

    // Eşleşme ara: farklı wallet yeterli (aynı takım olabilir)
    const matchIdx = quickMatchQueue.findIndex(q => q.wallet !== wallet);

    if (matchIdx >= 0) {
        const opponent = quickMatchQueue.splice(matchIdx, 1)[0];
        // Her iki tarafı pair'e ekle
        const now = Date.now();
        quickMatchPairs.set(wallet, { opponentCode: opponent.code, opponentTeam: opponent.team, opponentNickname: opponent.nickname, matchedAt: now });
        quickMatchPairs.set(opponent.wallet, { opponentCode: code, opponentTeam: team, opponentNickname: (nickname || 'Anonim').slice(0, 20), matchedAt: now });
        console.log(`[QuickMatch] Matched: ${wallet.slice(0, 8)} ↔ ${opponent.wallet.slice(0, 8)}`);
        res.json({ ok: true, matched: true, opponentCode: opponent.code, opponentTeam: opponent.team, opponentNickname: opponent.nickname });
    } else {
        quickMatchQueue.push({
            wallet,
            team,
            code,
            nickname: (nickname || 'Anonim').slice(0, 20),
            joinedAt: Date.now(),
        });
        console.log(`[QuickMatch] Queued: ${wallet.slice(0, 8)} team=${team}`);
        res.json({ ok: true, matched: false, position: quickMatchQueue.length });
    }
});

/** GET /api/quickmatch/poll?wallet=0x... — Eşleşme kontrol */
app.get('/api/quickmatch/poll', (req, res) => {
    const wallet = req.query.wallet;
    if (!wallet) return res.status(400).json({ error: 'wallet gerekli' });

    const pair = quickMatchPairs.get(wallet);
    if (pair) {
        quickMatchPairs.delete(wallet);
        res.json({ ok: true, matched: true, opponentCode: pair.opponentCode, opponentTeam: pair.opponentTeam, opponentNickname: pair.opponentNickname });
    } else {
        const inQueue = quickMatchQueue.some(q => q.wallet === wallet);
        res.json({ ok: true, matched: false, inQueue });
    }
});

/** POST /api/quickmatch/leave — Kuyruktan çık */
app.post('/api/quickmatch/leave', (req, res) => {
    const { wallet } = req.body ?? {};
    if (!wallet) return res.status(400).json({ error: 'wallet gerekli' });
    const idx = quickMatchQueue.findIndex(q => q.wallet === wallet);
    if (idx >= 0) quickMatchQueue.splice(idx, 1);
    quickMatchPairs.delete(wallet);
    res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
    console.log(`[A2 API] Server: http://127.0.0.1:${PORT}`);
    console.log(`[A2 API] Endpoints: /api/health · /api/settle · /api/refund · /api/distribute · /api/lobby · /api/lobbies · /api/quickmatch`);
});
