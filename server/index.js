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
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const http = require('http');
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const { ExpressPeerServer } = require('peer');

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
            addFeeToPool(fee, matchId);
            console.log(`[Settle] ✅ ${matchId} → winner=${winnerAddr.slice(0, 10)} prize=${prize} AVAX fee=${fee.toFixed(4)} AVAX tx=${tx.hash}`);

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
//  LEADERBOARD — Server-side persistent player stats
// ══════════════════════════════════════════════════════════════════════

const LB_FILE = path.join(__dirname, 'data', 'leaderboard.json');
let lbData = {}; // address.toLowerCase() → stats

try {
    if (fs.existsSync(LB_FILE)) {
        lbData = JSON.parse(fs.readFileSync(LB_FILE, 'utf8'));
    }
} catch { lbData = {}; }

function saveLbData() {
    try {
        fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
        fs.writeFileSync(LB_FILE, JSON.stringify(lbData, null, 2));
    } catch (e) {
        console.error('[LB] Save failed:', e.message);
    }
}

function getISOWeek() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function maybeResetWeekly(player) {
    const cur = getISOWeek();
    if (player.lastWeek !== cur) {
        player.weeklyWins = 0;
        player.weeklyBetWon = 0;
        player.lastWeek = cur;
    }
}

/** GET /api/leaderboard — Tüm oyuncular (online stats + composite score) */
app.get('/api/leaderboard', (req, res) => {
    const entries = Object.values(lbData).map(p => {
        maybeResetWeekly(p);
        // Online stats
        const ow = p.onlineWins || 0, ol = p.onlineLosses || 0, od = p.onlineDraws || 0;
        const onlineGP = ow + ol + od;
        // Local stats
        const lw = p.localWins || 0, ll = p.localLosses || 0, ld = p.localDraws || 0;
        const localGP = lw + ll + ld;
        // Total (legacy compat)
        const totalWins = (p.wins || 0), totalLosses = (p.losses || 0), totalDraws = (p.draws || 0);
        const gp = totalWins + totalLosses + totalDraws;
        // Composite score: online wins * 10 + totalBetWon * 100
        const score = ow * 10 + (p.totalBetWon || 0) * 100;
        return {
            address: p.address,
            username: p.username,
            wins: totalWins, losses: totalLosses, draws: totalDraws,
            onlineWins: ow, onlineLosses: ol, onlineDraws: od, onlineGamesPlayed: onlineGP,
            localWins: lw, localLosses: ll, localDraws: ld, localGamesPlayed: localGP,
            weeklyWins: p.weeklyWins || 0,
            totalBetWon: p.totalBetWon || 0,
            totalBetLost: p.totalBetLost || 0,
            gamesPlayed: gp,
            winRate: onlineGP > 0 ? Math.round((ow / onlineGP) * 100) : 0,
            score,
            lastUpdated: p.lastUpdated || 0,
        };
    });
    // Default sort: composite score desc
    entries.sort((a, b) => b.score - a.score || b.onlineWins - a.onlineWins);
    entries.forEach((e, i) => { e.rank = i + 1; });
    res.json({ ok: true, entries });
});

/** POST /api/leaderboard/upsert — Oyuncu kayıt / isim güncelle */
app.post('/api/leaderboard/upsert', rateLimit, (req, res) => {
    const { address, username } = req.body ?? {};
    const addr = validateAddress(address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });
    if (!username || typeof username !== 'string' || username.length > 32) {
        return res.status(400).json({ error: 'Geçersiz username' });
    }
    const key = addr.toLowerCase();
    if (!lbData[key]) {
        lbData[key] = {
            address: addr, username,
            wins: 0, losses: 0, draws: 0,
            totalBetWon: 0, totalBetLost: 0,
            weeklyWins: 0, weeklyBetWon: 0,
            lastWeek: getISOWeek(), lastUpdated: Date.now(),
        };
    } else {
        lbData[key].username = username;
        lbData[key].address = addr;
        lbData[key].lastUpdated = Date.now();
    }
    saveLbData();
    res.json({ ok: true });
});

/** POST /api/leaderboard/result — Oyun sonucu kaydet (mode: online|local) */
app.post('/api/leaderboard/result', rateLimit, (req, res) => {
    const { address, result, betWon, betLost, mode } = req.body ?? {};
    const addr = validateAddress(address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });
    if (!['win', 'loss', 'draw'].includes(result)) {
        return res.status(400).json({ error: 'Geçersiz result' });
    }
    const isOnline = mode === 'online' || mode === 'multiplayer';
    const key = addr.toLowerCase();
    if (!lbData[key]) {
        lbData[key] = {
            address: addr, username: addr.slice(0, 6) + '...' + addr.slice(-4),
            wins: 0, losses: 0, draws: 0,
            onlineWins: 0, onlineLosses: 0, onlineDraws: 0,
            localWins: 0, localLosses: 0, localDraws: 0,
            totalBetWon: 0, totalBetLost: 0,
            weeklyWins: 0, weeklyBetWon: 0,
            lastWeek: getISOWeek(), lastUpdated: Date.now(),
        };
    }
    const p = lbData[key];
    // Init new fields for legacy data
    if (p.onlineWins === undefined) { p.onlineWins = 0; p.onlineLosses = 0; p.onlineDraws = 0; p.localWins = 0; p.localLosses = 0; p.localDraws = 0; }
    maybeResetWeekly(p);
    // Total stats (legacy)
    if (result === 'win') { p.wins++; p.weeklyWins++; }
    else if (result === 'loss') p.losses++;
    else p.draws++;
    // Online/Local split
    if (isOnline) {
        if (result === 'win') p.onlineWins++;
        else if (result === 'loss') p.onlineLosses++;
        else p.onlineDraws++;
    } else {
        if (result === 'win') p.localWins++;
        else if (result === 'loss') p.localLosses++;
        else p.localDraws++;
    }
    const bw = parseFloat(betWon) || 0;
    const bl = parseFloat(betLost) || 0;
    if (bw > 0) { p.totalBetWon += bw; p.weeklyBetWon = (p.weeklyBetWon || 0) + bw; }
    if (bl > 0) p.totalBetLost = (p.totalBetLost || 0) + bl;
    p.lastUpdated = Date.now();
    saveLbData();
    console.log(`[LB] ${addr.slice(0, 8)} → ${result} (${isOnline ? 'online' : 'local'}) wins=${p.wins} online=${p.onlineWins}`);
    res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════
//  FEE POOL — Server-side tracking + otomatik haftalık dağıtım
// ══════════════════════════════════════════════════════════════════════

// Sezon 1 başlangıcı: 16 Mart 2026 Pazartesi 00:00 UTC
const SEASON_START = new Date('2026-03-16T00:00:00Z');

function getSeasonWeek() {
    const now = Date.now();
    const elapsed = now - SEASON_START.getTime();
    if (elapsed < 0) return 1;
    return Math.floor(elapsed / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function getNextDistributionTime() {
    const now = new Date();
    const week = getSeasonWeek();
    const nextMonday = new Date(SEASON_START.getTime() + week * 7 * 24 * 60 * 60 * 1000);
    return { nextDistribution: nextMonday.toISOString(), remainingMs: Math.max(0, nextMonday.getTime() - now.getTime()) };
}

const POOL_FILE = path.join(__dirname, 'data', 'feepool.json');
let poolData = { totalFee: 0, seasonWeek: getSeasonWeek(), matchIds: [], lastDistributedWeek: 0, totalDistributed: 0, distributionHistory: [] };

try {
    if (fs.existsSync(POOL_FILE)) {
        const saved = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
        poolData = { ...poolData, ...saved };
        // Migrate: eski week → seasonWeek
        if (saved.week && !saved.seasonWeek) { poolData.seasonWeek = getSeasonWeek(); }
    }
} catch { /* baştan başla */ }

function savePoolData() {
    try {
        fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
        fs.writeFileSync(POOL_FILE, JSON.stringify(poolData, null, 2));
    } catch (e) { console.error('[Pool] Save failed:', e.message); }
}

function addFeeToPool(feeAvax, matchId) {
    if (poolData.matchIds.includes(matchId)) return;
    poolData.totalFee = +(poolData.totalFee + feeAvax).toFixed(6);
    poolData.seasonWeek = getSeasonWeek();
    poolData.matchIds.push(matchId);
    savePoolData();
    console.log(`[Pool] Fee +${feeAvax.toFixed(4)} AVAX | Toplam: ${poolData.totalFee.toFixed(4)} AVAX (Hafta ${poolData.seasonWeek})`);
}

/** GET /api/fee-pool — Mevcut haftalık ödül havuzu */
app.get('/api/fee-pool', (_req, res) => {
    const seasonWeek = getSeasonWeek();
    const { nextDistribution, remainingMs } = getNextDistributionTime();
    const ratios = [40, 20, 10];
    res.json({
        ok: true,
        totalFee: poolData.totalFee,
        seasonWeek,
        prizes: ratios.map((r, i) => ({ rank: i + 1, avax: +(poolData.totalFee * r / 100).toFixed(4), ratio: r })),
        matchCount: poolData.matchIds.length,
        totalDistributed: poolData.totalDistributed || 0,
        distributionHistory: poolData.distributionHistory || [],
        nextDistribution,
        remainingMs,
    });
});

/** Otomatik haftalık dağıtım — Her saat çalışır, Pazartesi sabahı dağıtır */
async function runWeeklyDistribution() {
    const now = new Date();
    const isMonday = now.getDay() === 1;
    const isEarlyMorning = now.getHours() < 6; // 00:00-06:00 UTC
    const MIN_POOL = 0.1;
    const currentWeek = getSeasonWeek();

    if (!isMonday || !isEarlyMorning) return;
    if (poolData.lastDistributedWeek >= currentWeek) return;

    if (poolData.totalFee < MIN_POOL) {
        console.log(`[WeeklyPrize] Havuz yetersiz (${poolData.totalFee.toFixed(4)} AVAX < ${MIN_POOL}), atlandı`);
        poolData.lastDistributedWeek = currentWeek;
        savePoolData();
        return;
    }

    const sorted = Object.values(lbData)
        .map(p => { maybeResetWeekly(p); return p; })
        .filter(p => (p.weeklyWins || 0) > 0)
        .sort((a, b) => (b.weeklyWins || 0) - (a.weeklyWins || 0))
        .slice(0, 3);

    if (sorted.length === 0) {
        console.log('[WeeklyPrize] Bu hafta oynayan yok, dağıtım atlandı');
        poolData.lastDistributedWeek = currentWeek;
        savePoolData();
        return;
    }

    const ratios = [40, 20, 10];
    const distributedAmounts = [];
    console.log(`[WeeklyPrize] Hafta ${currentWeek} dağıtımı başlıyor. Havuz: ${poolData.totalFee.toFixed(4)} AVAX`);

    for (let i = 0; i < sorted.length; i++) {
        const ratio = ratios[i] ?? 0;
        if (ratio === 0) continue;
        const amount = +(poolData.totalFee * ratio / 100).toFixed(6);
        if (amount < 0.001) continue;
        const addr = sorted[i].address;
        try {
            const tx = await houseSigner.sendTransaction({
                to: addr,
                value: ethers.parseEther(String(amount)),
            });
            await tx.wait(1);
            distributedAmounts.push({ rank: i + 1, address: addr, amount, txHash: tx.hash });
            console.log(`[WeeklyPrize] ${i + 1}. sıra: ${addr.slice(0, 10)} ← ${amount} AVAX | TX: ${tx.hash}`);
        } catch (e) {
            console.error(`[WeeklyPrize] ${addr.slice(0, 10)} ödeme başarısız:`, e.message);
        }
    }

    const totalSent = distributedAmounts.reduce((s, d) => s + d.amount, 0);
    poolData.totalDistributed = +((poolData.totalDistributed || 0) + totalSent).toFixed(6);
    if (!poolData.distributionHistory) poolData.distributionHistory = [];
    poolData.distributionHistory.push({
        week: currentWeek,
        distributedAt: new Date().toISOString(),
        totalFee: poolData.totalFee,
        recipients: distributedAmounts,
    });
    // Pool sıfırla (dağıtım sonrası)
    poolData.totalFee = 0;
    poolData.matchIds = [];
    poolData.lastDistributedWeek = currentWeek;
    savePoolData();
    console.log(`[WeeklyPrize] Dağıtım tamamlandı. Toplam: ${totalSent.toFixed(4)} AVAX`);
}

// Her saat çalıştır (3_600_000 ms)
setInterval(() => { runWeeklyDistribution().catch(e => console.error('[WeeklyPrize] Hata:', e.message)); }, 3_600_000);

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
    const { code, team, betAmount, isPublic, wallet, nickname, lobbyName } = req.body ?? {};
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
        lobbyName: (lobbyName || '').slice(0, 20),
        createdAt: Date.now(),
    });
    console.log(`[Lobby] Registered: ${code} (${isPublic ? 'public' : 'private'}) team=${team} bet=${betAmount} name="${lobbyName || ''}"`);
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
                lobbyName: lobby.lobbyName || '',
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

// ══════════════════════════════════════════════════════════════════════
//  WIN REPORT — Authoritative win determination (prevents desync)
// ══════════════════════════════════════════════════════════════════════

/**
 * In-memory win reports: lobbyCode → { winner, reportedAt }
 * First reporter is authoritative — both clients get the same result.
 */
const winReports = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [code, report] of winReports) {
        if (now - report.reportedAt > 2 * 60 * 60 * 1000) winReports.delete(code);
    }
}, 60_000);

/**
 * POST /api/win-report
 * Body: { lobbyCode, winner: 'fire'|'ice' }
 * First report is stored as authoritative. Subsequent calls return the same winner.
 */
app.post('/api/win-report', rateLimit, (req, res) => {
    const { lobbyCode, winner } = req.body ?? {};
    if (!lobbyCode || typeof lobbyCode !== 'string' || lobbyCode.length > 20) {
        return res.status(400).json({ error: 'Geçersiz lobbyCode' });
    }
    if (!['fire', 'ice'].includes(winner)) {
        return res.status(400).json({ error: 'winner must be fire or ice' });
    }
    const code = lobbyCode.toUpperCase();
    if (!winReports.has(code)) {
        winReports.set(code, { winner, reportedAt: Date.now() });
        console.log(`[WinReport] ${code} → winner: ${winner}`);
    }
    const stored = winReports.get(code);
    res.json({ ok: true, winner: stored.winner });
});

/**
 * GET /api/win-status/:code
 * Returns current win status for a lobby (for polling fallback).
 */
app.get('/api/win-status/:code', (req, res) => {
    const code = req.params.code.toUpperCase();
    const report = winReports.get(code);
    if (!report) return res.json({ ok: true, winner: null });
    res.json({ ok: true, winner: report.winner });
});

// ══════════════════════════════════════════════════════════════════════
//  ERROR REPORTS
// ══════════════════════════════════════════════════════════════════════

const ERROR_FILE = path.join(__dirname, 'data', 'errors.json');
let errorReports = [];

try {
    if (fs.existsSync(ERROR_FILE)) {
        errorReports = JSON.parse(fs.readFileSync(ERROR_FILE, 'utf8'));
    }
} catch { errorReports = []; }

function saveErrorReports() {
    try {
        fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
        // Keep last 500 reports
        if (errorReports.length > 500) errorReports = errorReports.slice(-500);
        fs.writeFileSync(ERROR_FILE, JSON.stringify(errorReports, null, 2));
    } catch (e) {
        console.error('[ErrorReport] Save failed:', e.message);
    }
}

/** POST /api/error-report */
app.post('/api/error-report', rateLimit, (req, res) => {
    const { message, stack, url, userAgent, wallet, screen } = req.body ?? {};
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message gerekli' });
    }
    const report = {
        id: Date.now(),
        message: String(message).slice(0, 500),
        stack: String(stack ?? '').slice(0, 2000),
        url: String(url ?? '').slice(0, 200),
        screen: String(screen ?? '').slice(0, 50),
        wallet: wallet ? String(wallet).slice(0, 50) : null,
        userAgent: String(userAgent ?? '').slice(0, 200),
        reportedAt: new Date().toISOString(),
    };
    errorReports.push(report);
    saveErrorReports();
    console.log(`[ErrorReport] #${report.id} — ${report.message.slice(0, 80)}`);
    res.json({ ok: true, id: report.id });
});

/** GET /api/error-reports?adminKey=xxx */
app.get('/api/error-reports', (req, res) => {
    if (!process.env.ADMIN_KEY || req.query.adminKey !== process.env.ADMIN_KEY) {
        return res.status(403).json({ error: 'Yetkisiz' });
    }
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json({ ok: true, total: errorReports.length, reports: errorReports.slice(-limit).reverse() });
});

// ══════════════════════════════════════════════════════════════════════
//  FEEDBACK / BUG REPORTS (kullanıcı geri bildirimi)
// ══════════════════════════════════════════════════════════════════════

const FEEDBACK_FILE = path.join(__dirname, 'data', 'feedback.json');
let feedbackReports = [];

try {
    if (fs.existsSync(FEEDBACK_FILE)) {
        feedbackReports = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
    }
} catch { feedbackReports = []; }

function saveFeedback() {
    try {
        fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
        if (feedbackReports.length > 1000) feedbackReports = feedbackReports.slice(-1000);
        fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedbackReports, null, 2));
    } catch (e) {
        console.error('[Feedback] Save failed:', e.message);
    }
}

/** POST /api/feedback — { type, message, wallet?, userAgent? } */
app.post('/api/feedback', rateLimit, (req, res) => {
    const { type, message, wallet, userAgent, errorData } = req.body ?? {};
    if (!message || typeof message !== 'string' || message.trim().length < 3) {
        return res.status(400).json({ error: 'Mesaj en az 3 karakter olmalı' });
    }
    const validTypes = ['bug', 'suggestion', 'complaint', 'other'];
    const fb = {
        id: Date.now(),
        type: validTypes.includes(type) ? type : 'other',
        message: String(message).slice(0, 2000),
        wallet: wallet ? String(wallet).slice(0, 50) : null,
        userAgent: String(userAgent ?? '').slice(0, 200),
        errorData: errorData ? String(JSON.stringify(errorData)).slice(0, 1000) : null,
        createdAt: new Date().toISOString(),
    };
    feedbackReports.push(fb);
    saveFeedback();
    console.log(`[Feedback] #${fb.id} [${fb.type}] — ${fb.message.slice(0, 80)}`);
    res.json({ ok: true, id: fb.id });
});

/** GET /api/feedback?adminKey=xxx */
app.get('/api/feedback', (req, res) => {
    if (!process.env.ADMIN_KEY || req.query.adminKey !== process.env.ADMIN_KEY) {
        return res.status(403).json({ error: 'Yetkisiz' });
    }
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json({ ok: true, total: feedbackReports.length, reports: feedbackReports.slice(-limit).reverse() });
});

// ══════════════════════════════════════════════════════════════════════
//  TURN CREDENTIALS — HMAC tabanlı geçici token (1 saat geçerli)
// ══════════════════════════════════════════════════════════════════════

const TURN_SECRET = process.env.TURN_SECRET;
const TURN_HOST = '34.56.130.155';

app.get('/api/turn-credentials', (req, res) => {
    const ttl = 3600; // 1 saat
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${timestamp}:a2player`;
    const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');

    res.json({
        ok: true,
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: `turn:${TURN_HOST}:3478`, username, credential },
            { urls: `turn:${TURN_HOST}:3478?transport=tcp`, username, credential },
        ],
        ttl,
    });
});

// ── PeerJS Signaling Server ────────────────────────────────────────────
const httpServer = http.createServer(app);

const peerServer = ExpressPeerServer(httpServer, {
    path: '/',
    debug: false,
    allow_discovery: false,
});
app.use('/peerjs', peerServer);

peerServer.on('connection', (client) => {
    console.log(`[PeerJS] Connected: ${client.getId()}`);
});
peerServer.on('disconnect', (client) => {
    console.log(`[PeerJS] Disconnected: ${client.getId()}`);
});

// ── Start ─────────────────────────────────────────────────────────────
httpServer.listen(PORT, '127.0.0.1', () => {
    console.log(`[A2 API] Server: http://127.0.0.1:${PORT}`);
    console.log(`[A2 API] PeerJS signaling: /peerjs`);
    console.log(`[A2 API] Endpoints: /api/health · /api/settle · /api/refund · /api/distribute · /api/lobby · /api/lobbies · /api/quickmatch`);
});
