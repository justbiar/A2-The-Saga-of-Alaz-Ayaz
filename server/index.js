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

// Mainnet provider (kampanya dagitimi icin)
const MAINNET_RPC = 'https://api.avax.network/ext/bc/C/rpc';
const mainnetProvider = new ethers.JsonRpcProvider(MAINNET_RPC);
const mainnetSigner = new ethers.Wallet(HOUSE_WALLET_PK, mainnetProvider);

function getSignerForNetwork(network) {
    return network === 'mainnet' ? mainnetSigner : houseSigner;
}

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

/** Auto-refund & auto-resolve stuck matches */
const MATCH_TIMEOUT = 10 * 60 * 1000;          // 10 min — host deposit, guest never joined
const LOCKED_REPORT_TIMEOUT = 2 * 60 * 1000;   // 2 min — one side reported, other abandoned
const LOCKED_ABANDON_TIMEOUT = 15 * 60 * 1000; // 15 min — both deposited, neither reported (game abandoned)
setInterval(() => {
    const now = Date.now();
    for (const [matchId, match] of matches) {
        // 1) Host deposited, guest never joined → refund host
        if (match.status === 'host_deposited' && (now - match.createdAt) > MATCH_TIMEOUT) {
            console.log(`[AutoRefund] Match ${matchId} timed out — refunding host`);
            match.status = 'refunded';
            const refundWei = ethers.parseEther(match.amount.toFixed(6));
            houseSigner.sendTransaction({
                to: match.hostAddress,
                value: refundWei,
            }).then(tx => {
                match.settledAt = Date.now();
                console.log(`[AutoRefund] ${matchId} → ${match.hostAddress} TX: ${tx.hash}`);
            }).catch(err => {
                console.error(`[AutoRefund] ${matchId} failed:`, err.message);
                match.status = 'host_deposited'; // retry next cycle
            });
        }

        // 2) Locked: one side reported, opponent abandoned → auto-settle after 2 min
        if (match.status === 'locked' && match.firstReportAt) {
            const hasOneReport = (match.hostResult && !match.guestResult) || (!match.hostResult && match.guestResult);
            if (hasOneReport && (now - match.firstReportAt) > LOCKED_REPORT_TIMEOUT) {
                const reporterWon = (match.hostResult === 'win') || (match.guestResult === 'win');
                if (reporterWon) {
                    const winnerAddr = match.hostResult === 'win' ? match.hostAddress : match.guestAddress;
                    const totalPot = match.amount * 2;
                    const fee = totalPot * (BET_FEE_PERCENT / 100);
                    const prize = totalPot - fee;
                    console.log(`[AutoResolve] Match ${matchId} — one side reported win, settling`);
                    match.status = 'settling';
                    houseSigner.sendTransaction({
                        to: winnerAddr,
                        value: ethers.parseEther(prize.toFixed(6)),
                    }).then(tx => {
                        match.status = 'settled';
                        match.settledAt = Date.now();
                        match.winnerAddress = winnerAddr;
                        addFeeToPool(fee, matchId);
                        console.log(`[AutoResolve] ✅ ${matchId} → ${winnerAddr.slice(0, 10)} ${prize} AVAX tx=${tx.hash}`);
                    }).catch(err => {
                        match.status = 'locked';
                        console.error(`[AutoResolve] ${matchId} settle failed:`, err.message);
                    });
                } else {
                    // Reporter said they lost, opponent didn't report → refund both
                    console.log(`[AutoResolve] Match ${matchId} — reporter said loss, refunding both`);
                    refundBothPlayers(matchId, match);
                }
            }
        }

        // 3) Locked: no reports at all for 15 min → game abandoned, refund both
        if (match.status === 'locked' && !match.hostResult && !match.guestResult) {
            if ((now - match.createdAt) > LOCKED_ABANDON_TIMEOUT) {
                console.log(`[AutoRefund] Match ${matchId} locked 15min, no reports — refunding both`);
                refundBothPlayers(matchId, match);
            }
        }

        // Clean up old settled/refunded/disputed matches after 1 hour
        if (['settled', 'refunded', 'disputed'].includes(match.status) && (now - (match.settledAt || match.createdAt)) > 60 * 60 * 1000) {
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
    if (!match.firstReportAt) match.firstReportAt = Date.now();

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
            match.winnerAddress = winnerAddr;
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
        winnerAddress: match.winnerAddress || null,
    });
});

/**
 * POST /api/match/:matchId/refund-both
 * Body: { address }
 * → Locked maçta her iki tarafa da iade (oyun başlamadan kopma durumu)
 */
app.post('/api/match/:matchId/refund-both', rateLimit, async (req, res) => {
    const { address } = req.body ?? {};
    const addr = validateAddress(address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });

    const match = matches.get(req.params.matchId);
    if (!match) return res.status(404).json({ error: 'Maç bulunamadı' });

    const isPlayer = addr.toLowerCase() === match.hostAddress?.toLowerCase() ||
                     addr.toLowerCase() === match.guestAddress?.toLowerCase();
    if (!isPlayer) return res.status(403).json({ error: 'Bu maçın oyuncusu değilsin' });

    if (['settled', 'refunded', 'disputed'].includes(match.status)) {
        return res.status(409).json({ error: 'Maç zaten sonuçlandı', status: match.status });
    }
    if (match.status !== 'locked') {
        return res.status(409).json({ error: 'Maç locked değil', status: match.status });
    }

    console.log(`[RefundBoth] ${req.params.matchId} — requested by ${addr.slice(0, 10)}`);
    await refundBothPlayers(req.params.matchId, match);
    res.json({ ok: true, status: 'refunded' });
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
            totalDonated: (faucetData.donations?.[p.address?.toLowerCase()] || 0),
            avatarURI: p.avatarURI || '',
        };
    });
    // Default sort: composite score desc
    entries.sort((a, b) => b.score - a.score || b.onlineWins - a.onlineWins);
    entries.forEach((e, i) => { e.rank = i + 1; });
    res.json({ ok: true, entries });
});

/** POST /api/avatar/upload — Base64 görsel yükle → WebP'ye çevir → kaydet */
const AVATARS_DIR = '/var/www/html/avatars';
try { fs.mkdirSync(AVATARS_DIR, { recursive: true }); } catch {}
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

app.post('/api/avatar/upload', rateLimit, async (req, res) => {
    const { address, dataUrl } = req.body ?? {};
    const addr = validateAddress(address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });

    const match = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(jpeg|jpg|png|webp|gif);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Geçersiz görsel formatı' });

    const rawBuffer = Buffer.from(match[2], 'base64');
    if (rawBuffer.length > 1024 * 1024) return res.status(400).json({ error: 'Max 1MB' });

    try {
        const filename = `${addr.toLowerCase()}.webp`;
        const outPath = path.join(AVATARS_DIR, filename);
        if (sharp) {
            await sharp(rawBuffer)
                .resize(256, 256, { fit: 'cover', position: 'centre' })
                .webp({ quality: 82 })
                .toFile(outPath);
        } else {
            fs.writeFileSync(outPath, rawBuffer);
        }
        const avatarUrl = `/avatars/${filename}`;
        // Leaderboard kaydını da güncelle
        const lbKey = addr.toLowerCase();
        if (lbData[lbKey]) {
            lbData[lbKey].avatarURI = avatarUrl;
            saveLbData();
        }
        res.json({ ok: true, url: avatarUrl });
    } catch {
        res.status(500).json({ error: 'Kayıt hatası' });
    }
});

/** POST /api/leaderboard/upsert — Oyuncu kayıt / isim güncelle */
app.post('/api/leaderboard/upsert', rateLimit, (req, res) => {
    const { address, username, avatarURI } = req.body ?? {};
    const addr = validateAddress(address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });
    if (!username || typeof username !== 'string' || username.length > 32) {
        return res.status(400).json({ error: 'Geçersiz username' });
    }
    // avatarURI: sadece http/https URL kabul et, base64 reddet
    const safeAvatar = (typeof avatarURI === 'string' &&
        (/^https?:\/\/.{1,280}$/.test(avatarURI) || /^\/avatars\/0x[0-9a-fA-F]{40}\.webp$/.test(avatarURI)))
        ? avatarURI : null;
    const key = addr.toLowerCase();
    if (!lbData[key]) {
        lbData[key] = {
            address: addr, username,
            wins: 0, losses: 0, draws: 0,
            totalBetWon: 0, totalBetLost: 0,
            weeklyWins: 0, weeklyBetWon: 0,
            lastWeek: getISOWeek(), lastUpdated: Date.now(),
            avatarURI: safeAvatar || '',
        };
    } else {
        lbData[key].username = username;
        lbData[key].address = addr;
        lbData[key].lastUpdated = Date.now();
        if (safeAvatar !== null) lbData[key].avatarURI = safeAvatar;
    }
    saveLbData();
    res.json({ ok: true });
});

/** GET /api/leaderboard/matches/:address — Son online maçlar */
app.get('/api/leaderboard/matches/:address', (req, res) => {
    const addr = validateAddress(req.params.address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });
    const p = lbData[addr.toLowerCase()];
    if (!p) return res.json({ ok: true, matches: [] });
    res.json({ ok: true, matches: (p.matchHistory || []).slice().reverse() });
});

/** POST /api/leaderboard/result — Oyun sonucu kaydet (mode: online|local) */
app.post('/api/leaderboard/result', rateLimit, (req, res) => {
    const { address, result, betWon, betLost, mode, opponentAddress, opponentUsername } = req.body ?? {};
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
    // Match history (online only, last 50)
    if (isOnline) {
        if (!p.matchHistory) p.matchHistory = [];
        p.matchHistory.push({
            result,
            betWon: bw,
            betLost: bl,
            ts: Date.now(),
            opponentAddress: opponentAddress || null,
            opponentUsername: opponentUsername || null,
        });
        if (p.matchHistory.length > 50) p.matchHistory = p.matchHistory.slice(-50);
    }
    p.lastUpdated = Date.now();
    saveLbData();

    // Aktif kampanya leaderboard'larini guncelle
    if (isOnline) {
        for (const camp of campaignsData) {
            if (camp.status !== 'active') continue;
            if (!camp.participants?.[key]) continue;
            if (!camp.campaignLeaderboard) camp.campaignLeaderboard = {};
            if (!camp.campaignLeaderboard[key]) {
                camp.campaignLeaderboard[key] = { points: 0, tasksCompleted: 0, username: p.username || key.slice(0, 10) };
            }
            const ce = camp.campaignLeaderboard[key];
            if (result === 'win') ce.points += 10;
            if (bw > 0) ce.points += Math.floor(bw * 100);
        }
        saveCampaignsData();
    }

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

// ── Kampanya Otomatik Dagitim — 30 dakikada bir kontrol ────────────────
let campaignDistributing = false;

async function runCampaignDistributions() {
    if (campaignDistributing) return;
    campaignDistributing = true;
    const now = Date.now();

    try {
        for (const camp of campaignsData) {
            if (camp.status !== 'active' || !camp.autoDistribute) continue;
            const dist = camp.distribution;
            if (!dist || !dist.dailyAvax || !dist.intervalHours) continue;

            const intervalMs = dist.intervalHours * 60 * 60 * 1000;
            const lastDist = dist.lastDistributionAt || camp.createdAt;
            if (now - lastDist < intervalMs) continue;

            // Top N kampanya leaderboard'undan
            const sorted = Object.entries(camp.campaignLeaderboard || {})
                .map(([addr, stats]) => ({ address: addr, ...stats }))
                .filter(e => e.points > 0)
                .sort((a, b) => b.points - a.points)
                .slice(0, dist.topN || 1);

            if (sorted.length === 0) {
                console.log(`[CampaignDist:${camp.id}] Leaderboard bos, atlandi`);
                dist.lastDistributionAt = now;
                saveCampaignsData();
                continue;
            }

            const signer = getSignerForNetwork(dist.network || camp.network);
            const ratios = dist.ratios || [100];
            const results = [];

            console.log(`[CampaignDist:${camp.id}] Dagitim basliyor — ${dist.dailyAvax} AVAX, top ${sorted.length}, network=${dist.network || camp.network}`);

            for (let i = 0; i < sorted.length && i < ratios.length; i++) {
                const ratio = ratios[i] || 0;
                if (ratio <= 0) continue;
                const amt = +(dist.dailyAvax * ratio / 100).toFixed(6);
                if (amt < 0.0001) continue;

                try {
                    const tx = await signer.sendTransaction({
                        to: sorted[i].address,
                        value: ethers.parseEther(String(amt)),
                    });
                    await tx.wait(1);
                    results.push({ address: sorted[i].address, avax: amt, txHash: tx.hash, ok: true });
                    console.log(`[CampaignDist:${camp.id}] ${i + 1}. ${sorted[i].address.slice(0, 10)} ← ${amt} AVAX TX=${tx.hash}`);
                } catch (e) {
                    results.push({ address: sorted[i].address, avax: amt, error: e.message });
                    console.error(`[CampaignDist:${camp.id}] ${sorted[i].address.slice(0, 10)} BASARISIZ:`, e.message);
                }
            }

            camp.distributions.push({ at: now, by: 'auto', results });
            dist.lastDistributionAt = now;
            saveCampaignsData();

            const totalSent = results.filter(r => r.ok).reduce((s, r) => s + r.avax, 0);
            console.log(`[CampaignDist:${camp.id}] Tamamlandi: ${totalSent.toFixed(4)} AVAX, ${results.filter(r => r.ok).length}/${results.length} basarili`);
        }
    } catch (e) {
        console.error('[CampaignDist] Genel hata:', e.message);
    } finally {
        campaignDistributing = false;
    }
}

setInterval(() => { runCampaignDistributions().catch(e => console.error('[CampaignDist] Hata:', e.message)); }, 30 * 60 * 1000);

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
const TURN_HOST = '34.170.132.21';

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

// ══════════════════════════════════════════════════════════════════════
//  LOBİ CHAT — In-memory, 10 dk TTL, max 100 mesaj
// ══════════════════════════════════════════════════════════════════════

const chatMessages = []; // { id, nickname, text, ts }
const CHAT_MAX = 100;
const CHAT_TTL = 10 * 60 * 1000;

function pruneChat() {
    const cutoff = Date.now() - CHAT_TTL;
    while (chatMessages.length > 0 && chatMessages[0].ts < cutoff) chatMessages.shift();
    if (chatMessages.length > CHAT_MAX) chatMessages.splice(0, chatMessages.length - CHAT_MAX);
}

/** GET /api/chat?since=<timestamp> */
app.get('/api/chat', (req, res) => {
    pruneChat();
    const since = parseInt(req.query.since) || 0;
    res.json({ ok: true, messages: chatMessages.filter(m => m.ts > since) });
});

/** POST /api/chat — body: { nickname, text } */
app.post('/api/chat', rateLimit, (req, res) => {
    const { nickname, text } = req.body ?? {};
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text gerekli' });
    const safe = String(text).trim().slice(0, 200);
    if (!safe) return res.status(400).json({ error: 'Boş mesaj' });
    const nick = String(nickname || 'Misafir').trim().slice(0, 20) || 'Misafir';
    pruneChat();
    const msg = { id: Date.now() + '_' + Math.random().toString(36).slice(2), nickname: nick, text: safe, ts: Date.now() };
    chatMessages.push(msg);
    res.json({ ok: true, id: msg.id });
});

// ══════════════════════════════════════════════════════════════════════
//  ASKIDA AVAX (FAUCET)
// ══════════════════════════════════════════════════════════════════════

const FAUCET_FILE = path.join(__dirname, 'data', 'faucet.json');
const FAUCET_AMOUNT = 0.015;       // AVAX per claim
const FAUCET_COOLDOWN = 24 * 60 * 60 * 1000; // 24h in ms
const FAUCET_MIN_GAMES = 3;        // local games required

let faucetData = { totalDonated: 0, totalClaimed: 0, claims: {} };
try {
    if (fs.existsSync(FAUCET_FILE)) {
        faucetData = { ...faucetData, ...JSON.parse(fs.readFileSync(FAUCET_FILE, 'utf8')) };
    }
} catch { /* baştan başla */ }

function saveFaucetData() {
    try { fs.writeFileSync(FAUCET_FILE, JSON.stringify(faucetData, null, 2)); } catch { }
}

function getFaucetEligibility(addr) {
    const key = addr.toLowerCase();
    const p = lbData[key];
    const localGames = p ? ((p.localWins || 0) + (p.localLosses || 0) + (p.localDraws || 0)) : 0;
    const eligible = localGames >= FAUCET_MIN_GAMES;
    const lastClaim = faucetData.claims[key] || 0;
    const cooldownMs = Math.max(0, lastClaim + FAUCET_COOLDOWN - Date.now());
    return { eligible, localGames, cooldownMs };
}

/** GET /api/faucet/info?address=0x... */
app.get('/api/faucet/info', async (req, res) => {
    let houseBalanceAVAX = null;
    try {
        if (houseSigner) {
            const bal = await provider.getBalance(houseSigner.address);
            houseBalanceAVAX = parseFloat(ethers.formatEther(bal)).toFixed(4);
        }
    } catch {}
    const faucetPool = Math.max(0, (faucetData.totalDonated || 0) - (faucetData.totalClaimed || 0));
    const info = {
        ok: true,
        totalDonated: faucetData.totalDonated,
        totalClaimed: faucetData.totalClaimed,
        faucetPool: parseFloat(faucetPool.toFixed(4)),
        houseBalanceAVAX,
        claimAmount: FAUCET_AMOUNT,
        minGames: FAUCET_MIN_GAMES,
        cooldownHours: 24,
        houseWallet: process.env.HOUSE_WALLET_PK ? (() => { try { return new ethers.Wallet(process.env.HOUSE_WALLET_PK).address; } catch { return null; } })() : null,
    };
    const addr = validateAddress(req.query.address);
    if (addr) {
        const { eligible, localGames, cooldownMs } = getFaucetEligibility(addr);
        info.eligible = eligible;
        info.localGames = localGames;
        info.cooldownMs = cooldownMs;
    }
    res.json(info);
});

/** POST /api/faucet/claim — { address } */
app.post('/api/faucet/claim', rateLimit, async (req, res) => {
    const addr = validateAddress(req.body?.address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });

    const { eligible, localGames, cooldownMs } = getFaucetEligibility(addr);
    if (!eligible) return res.status(403).json({ error: `En az ${FAUCET_MIN_GAMES} yerel oyun gerekli (${localGames}/${FAUCET_MIN_GAMES})` });
    if (cooldownMs > 0) return res.status(429).json({ error: '24 saat dolmadan tekrar çekemezsin', cooldownMs });

    if (!houseSigner) return res.status(503).json({ error: 'House wallet yapılandırılmamış' });

    try {
        const amountWei = ethers.parseEther(FAUCET_AMOUNT.toFixed(6));
        const tx = await houseSigner.sendTransaction({ to: addr, value: amountWei });
        faucetData.claims[addr.toLowerCase()] = Date.now();
        faucetData.totalClaimed = (faucetData.totalClaimed || 0) + FAUCET_AMOUNT;
        saveFaucetData();
        console.log(`[Faucet] Claim: ${addr.slice(0, 8)} ← ${FAUCET_AMOUNT} AVAX TX: ${tx.hash}`);
        res.json({ ok: true, txHash: tx.hash, amount: FAUCET_AMOUNT });
    } catch (e) {
        console.error('[Faucet] Claim failed:', e.message);
        res.status(500).json({ error: 'Gönderim başarısız: ' + e.message });
    }
});

/** POST /api/faucet/donate — { amount, address } (bağış kaydı) */
app.post('/api/faucet/donate', rateLimit, (req, res) => {
    const amount = parseFloat(req.body?.amount);
    if (!amount || amount <= 0 || amount > 1000) return res.status(400).json({ error: 'Geçersiz miktar' });
    faucetData.totalDonated = (faucetData.totalDonated || 0) + amount;
    const addr = validateAddress(req.body?.address);
    if (addr) {
        if (!faucetData.donations) faucetData.donations = {};
        const key = addr.toLowerCase();
        faucetData.donations[key] = (faucetData.donations[key] || 0) + amount;
    }
    saveFaucetData();
    console.log(`[Faucet] Donate recorded: ${amount} AVAX${addr ? ' from ' + addr.slice(0,8) : ''} — total: ${faucetData.totalDonated.toFixed(4)}`);
    res.json({ ok: true, totalDonated: faucetData.totalDonated });
});

// ══════════════════════════════════════════════════════════════════════
//  ADMIN PANEL — Kimlik doğrulama, ban, raporlar, kampanyalar
// ══════════════════════════════════════════════════════════════════════

const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || '')
    .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
console.log(`[Admin] Admin cüzdanlar: ${ADMIN_WALLETS.length} adet`, ADMIN_WALLETS);
const ADMIN_SESSIONS = new Map(); // token → { address, expiresAt }

// Süresi dolan session'ları temizle
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of ADMIN_SESSIONS) {
        if (session.expiresAt < now) ADMIN_SESSIONS.delete(token);
    }
}, 60_000);

// ── Ban Verisi ─────────────────────────────────────────────────────────
const BANS_FILE = path.join(__dirname, 'data', 'bans.json');
let bansData = {};
try {
    if (fs.existsSync(BANS_FILE)) bansData = JSON.parse(fs.readFileSync(BANS_FILE, 'utf8'));
} catch { bansData = {}; }

function saveBansData() {
    try { fs.writeFileSync(BANS_FILE, JSON.stringify(bansData, null, 2)); }
    catch (e) { console.error('[Bans] Save failed:', e.message); }
}

// ── Raporlar Verisi ────────────────────────────────────────────────────
const REPORTS_FILE = path.join(__dirname, 'data', 'reports.json');
let reportsData = [];
try {
    if (fs.existsSync(REPORTS_FILE)) reportsData = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
} catch { reportsData = []; }

function saveReportsData() {
    try { fs.writeFileSync(REPORTS_FILE, JSON.stringify(reportsData, null, 2)); }
    catch (e) { console.error('[Reports] Save failed:', e.message); }
}

// ── Kampanyalar Verisi ──────────────────────────────────────────────────
const CAMPAIGNS_FILE = path.join(__dirname, 'data', 'campaigns.json');
let campaignsData = [];
try {
    if (fs.existsSync(CAMPAIGNS_FILE)) campaignsData = JSON.parse(fs.readFileSync(CAMPAIGNS_FILE, 'utf8'));
} catch { campaignsData = []; }

function saveCampaignsData() {
    try { fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaignsData, null, 2)); }
    catch (e) { console.error('[Campaigns] Save failed:', e.message); }
}

// ── Admin Auth Middleware ──────────────────────────────────────────────
function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token) return res.status(401).json({ error: 'Admin token gerekli' });
    const session = ADMIN_SESSIONS.get(token);
    if (!session || session.expiresAt < Date.now()) {
        ADMIN_SESSIONS.delete(token);
        return res.status(401).json({ error: 'Oturum süresi dolmuş' });
    }
    req.adminAddress = session.address;
    next();
}

/** POST /api/admin/auth — Cüzdan imzasıyla oturum aç */
app.post('/api/admin/auth', async (req, res) => {
    const { address, signature, challenge } = req.body ?? {};
    const addr = validateAddress(address);
    if (!addr || !signature || !challenge) {
        return res.status(400).json({ error: 'address, signature, challenge gerekli' });
    }
    const m = challenge.match(/^A2 Admin: (\d+)$/);
    if (!m) return res.status(400).json({ error: 'Geçersiz challenge formatı' });
    if (Math.abs(Date.now() - parseInt(m[1])) > 5 * 60 * 1000) {
        return res.status(400).json({ error: 'Challenge süresi dolmuş (5dk)' });
    }
    try {
        const recovered = ethers.verifyMessage(challenge, signature);
        if (recovered.toLowerCase() !== addr.toLowerCase()) {
            return res.status(401).json({ error: 'İmza doğrulanamadı' });
        }
        if (!ADMIN_WALLETS.includes(addr.toLowerCase())) {
            return res.status(403).json({ error: 'Bu cüzdan admin değil' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        ADMIN_SESSIONS.set(token, { address: addr, expiresAt: Date.now() + 60 * 60 * 1000 });
        console.log(`[Admin] Auth: ${addr.slice(0, 10)} → token verildi`);
        res.json({ ok: true, token });
    } catch (e) {
        res.status(401).json({ error: 'İmza hatası: ' + e.message });
    }
});

/** GET /api/admin/dashboard — Genel istatistikler */
app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
    const players = Object.values(lbData);
    const now = Date.now();
    let houseBalance = '0';
    try {
        const bal = await provider.getBalance(houseSigner.address);
        houseBalance = parseFloat(ethers.formatEther(bal)).toFixed(4);
    } catch {}
    const totalOnlineGames = players.reduce((s, p) =>
        s + ((p.onlineWins || 0) + (p.onlineLosses || 0) + (p.onlineDraws || 0)), 0);
    const totalLocalGames = players.reduce((s, p) =>
        s + ((p.localWins || 0) + (p.localLosses || 0) + (p.localDraws || 0)), 0);
    const totalBetVolume = players.reduce((s, p) => s + (p.totalBetWon || 0), 0);
    res.json({
        ok: true,
        stats: {
            totalPlayers: players.length,
            activeLast24h: players.filter(p => p.lastUpdated && (now - p.lastUpdated) < 86400000).length,
            activeLast7d: players.filter(p => p.lastUpdated && (now - p.lastUpdated) < 7 * 86400000).length,
            totalOnlineGames,
            totalLocalGames,
            totalBetVolume: parseFloat(totalBetVolume.toFixed(4)),
            houseBalance,
            activeMatches: Array.from(matches.values()).filter(m =>
                ['host_deposited', 'locked', 'settling'].includes(m.status)).length,
            totalBanned: Object.keys(bansData).length,
            totalReports: reportsData.length,
            openReports: reportsData.filter(r => r.status === 'open').length,
            feePool: poolData.totalFee,
            totalDistributed: poolData.totalDistributed || 0,
            activeCampaigns: campaignsData.filter(c => c.status === 'active').length,
            activeLobbies: lobbies.size,
        },
    });
});

/** GET /api/admin/players — Tüm oyuncular + detaylar */
app.get('/api/admin/players', requireAdmin, (req, res) => {
    const entries = Object.values(lbData).map(p => {
        const key = (p.address || '').toLowerCase();
        const ow = p.onlineWins || 0, ol = p.onlineLosses || 0, od = p.onlineDraws || 0;
        const lw = p.localWins || 0, ll = p.localLosses || 0, ld = p.localDraws || 0;
        return {
            address: p.address,
            username: p.username,
            onlineWins: ow, onlineLosses: ol, onlineDraws: od,
            onlineGamesPlayed: ow + ol + od,
            localWins: lw, localLosses: ll, localDraws: ld,
            localGamesPlayed: lw + ll + ld,
            totalGamesPlayed: ow + ol + od + lw + ll + ld,
            totalBetWon: p.totalBetWon || 0,
            totalBetLost: p.totalBetLost || 0,
            weeklyWins: p.weeklyWins || 0,
            lastUpdated: p.lastUpdated || 0,
            avatarURI: p.avatarURI || '',
            isBanned: !!bansData[key],
            banInfo: bansData[key] || null,
            reportCount: reportsData.filter(r => r.reportedAddress?.toLowerCase() === key).length,
        };
    });
    entries.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    res.json({ ok: true, players: entries });
});

/** GET /api/ban/check/:address — Public: ban kontrolü */
app.get('/api/ban/check/:address', (req, res) => {
    const addr = validateAddress(req.params.address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });
    const ban = bansData[addr.toLowerCase()];
    res.json({ banned: !!ban, reason: ban?.reason || null });
});

/** GET /api/admin/bans — Ban listesi */
app.get('/api/admin/bans', requireAdmin, (req, res) => {
    const bans = Object.entries(bansData).map(([address, b]) => ({ address, ...b }));
    bans.sort((a, b) => (b.bannedAt || 0) - (a.bannedAt || 0));
    res.json({ ok: true, bans });
});

/** POST /api/admin/ban — Oyuncu banla */
app.post('/api/admin/ban', requireAdmin, (req, res) => {
    const { address, reason, notes } = req.body ?? {};
    const addr = validateAddress(address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });
    if (!reason) return res.status(400).json({ error: 'reason gerekli' });
    bansData[addr.toLowerCase()] = {
        address: addr, reason,
        notes: (notes || '').slice(0, 500),
        bannedAt: Date.now(),
        bannedBy: req.adminAddress,
    };
    saveBansData();
    console.log(`[Admin] Ban: ${addr.slice(0, 10)} by ${req.adminAddress.slice(0, 10)} — ${reason}`);
    res.json({ ok: true });
});

/** DELETE /api/admin/ban/:address — Ban kaldır */
app.delete('/api/admin/ban/:address', requireAdmin, (req, res) => {
    const addr = validateAddress(req.params.address);
    if (!addr) return res.status(400).json({ error: 'Geçersiz address' });
    const key = addr.toLowerCase();
    if (!bansData[key]) return res.status(404).json({ error: 'Ban kaydı bulunamadı' });
    delete bansData[key];
    saveBansData();
    console.log(`[Admin] Unban: ${addr.slice(0, 10)} by ${req.adminAddress.slice(0, 10)}`);
    res.json({ ok: true });
});

/** POST /api/report/player — Public: oyuncu raporla */
app.post('/api/report/player', rateLimit, (req, res) => {
    const { reporterAddress, reportedAddress, reason, matchId, details } = req.body ?? {};
    const reporter = validateAddress(reporterAddress);
    const reported = validateAddress(reportedAddress);
    if (!reporter || !reported) return res.status(400).json({ error: 'Geçersiz adresler' });
    if (!reason || typeof reason !== 'string') return res.status(400).json({ error: 'reason gerekli' });
    if (reporter.toLowerCase() === reported.toLowerCase()) {
        return res.status(400).json({ error: 'Kendini raporlayamazsın' });
    }
    const recent = reportsData.filter(r =>
        r.reporterAddress?.toLowerCase() === reporter.toLowerCase() &&
        r.reportedAddress?.toLowerCase() === reported.toLowerCase() &&
        (Date.now() - r.createdAt) < 86400000
    );
    if (recent.length >= 2) return res.status(429).json({ error: 'Bu oyuncuyu son 24 saatte zaten raporladın' });
    const report = {
        id: crypto.randomBytes(8).toString('hex'),
        reporterAddress: reporter,
        reportedAddress: reported,
        reason: reason.slice(0, 200),
        details: typeof details === 'string' ? details.slice(0, 500) : '',
        matchId: matchId || null,
        status: 'open',
        createdAt: Date.now(),
        resolvedAt: null, resolvedBy: null, action: null, adminNotes: '',
    };
    reportsData.push(report);
    if (reportsData.length > 5000) reportsData = reportsData.slice(-5000);
    saveReportsData();
    console.log(`[Report] ${reporter.slice(0, 8)} → ${reported.slice(0, 8)} : ${reason}`);
    res.json({ ok: true, reportId: report.id });
});

/** GET /api/admin/reports — Raporlar listesi */
app.get('/api/admin/reports', requireAdmin, (req, res) => {
    const status = req.query.status;
    let reports = [...reportsData];
    if (status) reports = reports.filter(r => r.status === status);
    reports.sort((a, b) => b.createdAt - a.createdAt);
    res.json({
        ok: true,
        reports: reports.map(r => ({
            ...r,
            isReportedBanned: !!bansData[r.reportedAddress?.toLowerCase()],
            reportedUsername: lbData[r.reportedAddress?.toLowerCase()]?.username || null,
            reporterUsername: lbData[r.reporterAddress?.toLowerCase()]?.username || null,
        })),
    });
});

/** PATCH /api/admin/report/:id — Raporu çöz */
app.patch('/api/admin/report/:id', requireAdmin, (req, res) => {
    const report = reportsData.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: 'Report bulunamadı' });
    report.status = 'resolved';
    report.resolvedAt = Date.now();
    report.resolvedBy = req.adminAddress;
    report.action = (req.body?.action || 'reviewed').slice(0, 100);
    report.adminNotes = (req.body?.notes || '').slice(0, 500);
    saveReportsData();
    res.json({ ok: true });
});

/** GET /api/admin/campaigns — Kampanyalar */
app.get('/api/admin/campaigns', requireAdmin, (req, res) => {
    res.json({ ok: true, campaigns: campaignsData });
});

/** POST /api/admin/campaign — Yeni kampanya */
app.post('/api/admin/campaign', requireAdmin, (req, res) => {
    const { name, description, network, poolAvax, rules, startDate, endDate, tasks, distribution, autoDistribute } = req.body ?? {};
    if (!name || !network) return res.status(400).json({ error: 'name ve network gerekli' });

    // Gorevleri hazirla
    const safeTasks = Array.isArray(tasks) ? tasks.slice(0, 20).map(t => ({
        id: crypto.randomBytes(4).toString('hex'),
        type: ['twitter_follow', 'twitter_rt', 'twitter_like', 'custom'].includes(t.type) ? t.type : 'custom',
        title: String(t.title || '').slice(0, 100),
        description: String(t.description || '').slice(0, 300),
        url: String(t.url || '').slice(0, 500),
        points: Math.max(1, parseInt(t.points) || 10),
    })) : [];

    // Dagitim ayarlari
    const dist = distribution || {};
    const safeDist = {
        dailyAvax: parseFloat(dist.dailyAvax) || 0,
        intervalHours: Math.max(1, parseInt(dist.intervalHours) || 24),
        topN: Math.max(1, Math.min(10, parseInt(dist.topN) || 3)),
        ratios: Array.isArray(dist.ratios) ? dist.ratios.map(r => parseFloat(r) || 0).slice(0, 10) : [50, 30, 20],
        lastDistributionAt: null,
        network: ['testnet', 'mainnet'].includes(dist.network) ? dist.network : (network === 'mainnet' ? 'mainnet' : 'testnet'),
    };

    const campaign = {
        id: crypto.randomBytes(8).toString('hex'),
        name: String(name).slice(0, 100),
        description: String(description || '').slice(0, 500),
        network: ['testnet', 'mainnet', 'both'].includes(network) ? network : 'testnet',
        status: 'active',
        poolAvax: parseFloat(poolAvax) || 0,
        rules: rules || { minGames: 0, minOnlineGames: 0, minWins: 0 },
        startDate: startDate || new Date().toISOString(),
        endDate: endDate || null,
        createdAt: Date.now(),
        createdBy: req.adminAddress,
        tasks: safeTasks,
        participants: {},
        campaignLeaderboard: {},
        distribution: safeDist,
        autoDistribute: !!autoDistribute,
        snapshots: [],
        distributions: [],
    };
    campaignsData.push(campaign);
    saveCampaignsData();
    console.log(`[Campaign] Created: ${campaign.id} "${campaign.name}" tasks=${safeTasks.length} autoDist=${campaign.autoDistribute}`);
    res.json({ ok: true, campaign });
});

/** PUT /api/admin/campaign/:id — Kampanya güncelle */
app.put('/api/admin/campaign/:id', requireAdmin, (req, res) => {
    const campaign = campaignsData.find(c => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadı' });
    const { name, description, status, poolAvax, rules, endDate, tasks, distribution, autoDistribute } = req.body ?? {};
    if (name) campaign.name = String(name).slice(0, 100);
    if (description !== undefined) campaign.description = String(description).slice(0, 500);
    if (status && ['active', 'paused', 'ended'].includes(status)) campaign.status = status;
    if (poolAvax !== undefined) campaign.poolAvax = parseFloat(poolAvax) || 0;
    if (rules) campaign.rules = rules;
    if (endDate !== undefined) campaign.endDate = endDate;
    if (Array.isArray(tasks)) {
        campaign.tasks = tasks.slice(0, 20).map(t => ({
            id: t.id || crypto.randomBytes(4).toString('hex'),
            type: ['twitter_follow', 'twitter_rt', 'twitter_like', 'custom'].includes(t.type) ? t.type : 'custom',
            title: String(t.title || '').slice(0, 100),
            description: String(t.description || '').slice(0, 300),
            url: String(t.url || '').slice(0, 500),
            points: Math.max(1, parseInt(t.points) || 10),
        }));
    }
    if (distribution) {
        if (!campaign.distribution) campaign.distribution = {};
        const d = distribution;
        if (d.dailyAvax !== undefined) campaign.distribution.dailyAvax = parseFloat(d.dailyAvax) || 0;
        if (d.intervalHours !== undefined) campaign.distribution.intervalHours = Math.max(1, parseInt(d.intervalHours) || 24);
        if (d.topN !== undefined) campaign.distribution.topN = Math.max(1, Math.min(10, parseInt(d.topN) || 3));
        if (Array.isArray(d.ratios)) campaign.distribution.ratios = d.ratios.map(r => parseFloat(r) || 0).slice(0, 10);
        if (d.network) campaign.distribution.network = ['testnet', 'mainnet'].includes(d.network) ? d.network : 'testnet';
    }
    if (autoDistribute !== undefined) campaign.autoDistribute = !!autoDistribute;
    saveCampaignsData();
    res.json({ ok: true, campaign });
});

/** POST /api/admin/campaign/:id/snapshot — Leaderboard snapshot al */
app.post('/api/admin/campaign/:id/snapshot', requireAdmin, (req, res) => {
    const campaign = campaignsData.find(c => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadı' });
    const rules = campaign.rules || {};
    const snapshot = Object.values(lbData)
        .filter(p => !bansData[(p.address || '').toLowerCase()])
        .map(p => {
            const ow = p.onlineWins || 0, ol = p.onlineLosses || 0, od = p.onlineDraws || 0;
            const total = (p.wins || 0) + (p.losses || 0) + (p.draws || 0);
            return {
                address: p.address,
                username: p.username,
                wins: p.wins || 0,
                onlineWins: ow,
                onlineGamesPlayed: ow + ol + od,
                totalGamesPlayed: total,
                totalBetWon: p.totalBetWon || 0,
                score: ow * 10 + (p.totalBetWon || 0) * 100,
            };
        })
        .filter(p => {
            if (rules.minGames && p.totalGamesPlayed < rules.minGames) return false;
            if (rules.minOnlineGames && p.onlineGamesPlayed < rules.minOnlineGames) return false;
            if (rules.minWins && p.wins < rules.minWins) return false;
            return true;
        })
        .sort((a, b) => b.score - a.score);
    campaign.snapshots.push({ takenAt: Date.now(), takenBy: req.adminAddress, players: snapshot });
    saveCampaignsData();
    res.json({ ok: true, playerCount: snapshot.length, top10: snapshot.slice(0, 10) });
});

/** POST /api/admin/campaign/:id/distribute — Kampanya ödülü dağıt */
app.post('/api/admin/campaign/:id/distribute', requireAdmin, async (req, res) => {
    const campaign = campaignsData.find(c => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadı' });
    const { recipients } = req.body ?? {};
    if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: 'recipients gerekli' });
    }
    const results = [];
    for (const r of recipients.slice(0, 20)) {
        const addr = validateAddress(r.address);
        const amt = validateAmount(r.avax);
        if (!addr || !amt) { results.push({ address: r.address, error: 'Geçersiz' }); continue; }
        try {
            const signer = getSignerForNetwork(campaign.distribution?.network || campaign.network);
            const tx = await signer.sendTransaction({
                to: addr, value: ethers.parseEther(amt.toFixed(6)),
            });
            await tx.wait(1);
            results.push({ address: addr, avax: amt, txHash: tx.hash, ok: true });
            console.log(`[Campaign:${campaign.id}] ${addr.slice(0, 10)} ← ${amt} AVAX TX=${tx.hash}`);
        } catch (e) {
            results.push({ address: addr, avax: amt, error: e.message });
        }
    }
    campaign.distributions.push({ at: Date.now(), by: req.adminAddress, results });
    if (results.length > 0 && results.every(r => r.ok)) campaign.status = 'ended';
    saveCampaignsData();
    res.json({ ok: true, results });
});

// ══════════════════════════════════════════════════════════════════════
//  KAMPANYA — Public endpointler (kullanici tarafli)
// ══════════════════════════════════════════════════════════════════════

/** GET /api/campaigns/active — Aktif kampanyalari listele (public) */
app.get('/api/campaigns/active', (req, res) => {
    const active = campaignsData
        .filter(c => c.status === 'active')
        .map(c => {
            const participantCount = Object.keys(c.participants || {}).length;
            // Kampanya leaderboard top 10
            const lb = Object.entries(c.campaignLeaderboard || {})
                .map(([addr, s]) => ({
                    address: addr,
                    username: s.username || (lbData[addr]?.username) || addr.slice(0, 8) + '...',
                    points: s.points || 0,
                    tasksCompleted: s.tasksCompleted || 0,
                }))
                .sort((a, b) => b.points - a.points)
                .slice(0, 50);
            return {
                id: c.id,
                name: c.name,
                description: c.description,
                network: c.network,
                poolAvax: c.poolAvax,
                tasks: (c.tasks || []).map(t => ({ id: t.id, type: t.type, title: t.title, description: t.description, url: t.url, points: t.points })),
                participantCount,
                leaderboard: lb,
                distribution: c.distribution ? {
                    dailyAvax: c.distribution.dailyAvax,
                    intervalHours: c.distribution.intervalHours,
                    topN: c.distribution.topN,
                    ratios: c.distribution.ratios,
                    lastDistributionAt: c.distribution.lastDistributionAt,
                    network: c.distribution.network,
                } : null,
                sponsors: (c.sponsors || []).map(s => {
                    const lbKey = s.address?.toLowerCase();
                    const profile = lbData[lbKey];
                    return {
                        address: s.address,
                        amount: s.amount,
                        txHash: s.txHash,
                        timestamp: s.timestamp,
                        username: profile?.username || s.address.slice(0, 6) + '...' + s.address.slice(-4),
                        avatarURI: profile?.avatarURI || '',
                    };
                }),
                houseWallet: houseSigner.address,
                startDate: c.startDate,
                endDate: c.endDate,
                createdAt: c.createdAt,
            };
        });
    res.json({ ok: true, campaigns: active });
});

/** GET /api/campaign/:id/info — Tek kampanya detayi + kullanicinin durumu (public) */
app.get('/api/campaign/:id/info', (req, res) => {
    const campaign = campaignsData.find(c => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadi' });

    const addr = req.query.address ? validateAddress(req.query.address) : null;
    const participant = addr ? (campaign.participants || {})[addr.toLowerCase()] : null;

    const lb = Object.entries(campaign.campaignLeaderboard || {})
        .map(([a, s]) => ({
            address: a,
            username: s.username || (lbData[a]?.username) || a.slice(0, 8) + '...',
            points: s.points || 0,
            tasksCompleted: s.tasksCompleted || 0,
        }))
        .sort((a, b) => b.points - a.points);
    lb.forEach((e, i) => { e.rank = i + 1; });

    res.json({
        ok: true,
        campaign: {
            id: campaign.id,
            name: campaign.name,
            description: campaign.description,
            status: campaign.status,
            network: campaign.network,
            poolAvax: campaign.poolAvax,
            tasks: (campaign.tasks || []),
            participantCount: Object.keys(campaign.participants || {}).length,
            leaderboard: lb.slice(0, 50),
            distribution: campaign.distribution,
            startDate: campaign.startDate,
            endDate: campaign.endDate,
        },
        joined: !!participant,
        completedTasks: participant?.completedTasks || {},
    });
});

/** POST /api/campaign/:id/join — Kampanyaya katil (public) */
app.post('/api/campaign/:id/join', rateLimit, (req, res) => {
    const campaign = campaignsData.find(c => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadi' });
    if (campaign.status !== 'active') return res.status(409).json({ error: 'Kampanya aktif degil' });

    const addr = validateAddress(req.body?.address);
    if (!addr) return res.status(400).json({ error: 'Gecersiz address' });

    const key = addr.toLowerCase();
    if (!campaign.participants) campaign.participants = {};
    if (campaign.participants[key]) {
        return res.status(409).json({ error: 'Zaten katildiniz', joined: true });
    }

    campaign.participants[key] = { joinedAt: Date.now(), completedTasks: {} };
    if (!campaign.campaignLeaderboard) campaign.campaignLeaderboard = {};
    const username = lbData[key]?.username || addr.slice(0, 6) + '...' + addr.slice(-4);
    campaign.campaignLeaderboard[key] = { points: 0, tasksCompleted: 0, username };

    saveCampaignsData();
    console.log(`[Campaign:${campaign.id}] Join: ${addr.slice(0, 10)} — total: ${Object.keys(campaign.participants).length}`);
    res.json({ ok: true, joined: true });
});

/** POST /api/campaign/:id/sponsor — Kampanyaya sponsor ol (public) */
app.post('/api/campaign/:id/sponsor', rateLimit, async (req, res) => {
    const { address, txHash, amount } = req.body ?? {};
    const campaign = campaignsData.find(c => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadi' });
    if (campaign.status !== 'active') return res.status(409).json({ error: 'Kampanya aktif degil' });

    const addr = validateAddress(address);
    if (!addr) return res.status(400).json({ error: 'Gecersiz address' });
    if (!txHash || typeof txHash !== 'string' || !txHash.startsWith('0x')) {
        return res.status(400).json({ error: 'Gecersiz txHash' });
    }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Gecersiz amount' });

    // Ayni TX tekrar kullanilmasin
    if (!campaign.sponsors) campaign.sponsors = [];
    if (campaign.sponsors.some(s => s.txHash === txHash)) {
        return res.status(409).json({ error: 'Bu TX zaten kayitli' });
    }

    // On-chain dogrulama — kampanya network'une gore provider sec
    const isMainnet = campaign.network === 'mainnet';
    const verifyProvider = isMainnet ? mainnetProvider : provider;
    try {
        const tx = await verifyProvider.getTransaction(txHash);
        if (!tx) return res.status(400).json({ error: 'TX bulunamadi — ' + (isMainnet ? 'mainnet' : 'testnet') + ' uzerinde kontrol edildi' });

        const receipt = await verifyProvider.getTransactionReceipt(txHash);
        if (!receipt || receipt.status !== 1) return res.status(400).json({ error: 'TX onaylanmamis veya basarisiz' });

        if (tx.to?.toLowerCase() !== houseSigner.address.toLowerCase()) {
            return res.status(400).json({ error: 'TX house wallet\'a gonderilmemis' });
        }
        if (tx.from?.toLowerCase() !== addr.toLowerCase()) {
            return res.status(400).json({ error: 'TX gonderici uyusmuyor' });
        }

        const expectedWei = ethers.parseEther(amt.toFixed(6));
        const diff = tx.value > expectedWei ? tx.value - expectedWei : expectedWei - tx.value;
        const tolerance = expectedWei / 100n; // 1%
        if (diff > tolerance) {
            return res.status(400).json({ error: `Miktar uyusmuyor: beklenen ${amt}, gelen ${ethers.formatEther(tx.value)}` });
        }

        campaign.sponsors.push({
            address: addr,
            amount: parseFloat(ethers.formatEther(tx.value)),
            txHash,
            timestamp: Date.now(),
        });
        campaign.poolAvax = (campaign.poolAvax || 0) + parseFloat(ethers.formatEther(tx.value));
        saveCampaignsData();
        console.log(`[Campaign:${campaign.id}] Sponsor: ${addr.slice(0, 10)} → ${ethers.formatEther(tx.value)} AVAX tx=${txHash.slice(0, 12)}`);
        res.json({ ok: true });
    } catch (e) {
        console.error('[Sponsor] Verify failed:', e.message);
        res.status(500).json({ error: 'TX dogrulama hatasi: ' + e.message });
    }
});

/** POST /api/campaign/:id/complete-task — Gorevi tamamla (public) */
app.post('/api/campaign/:id/complete-task', rateLimit, (req, res) => {
    const campaign = campaignsData.find(c => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadi' });
    if (campaign.status !== 'active') return res.status(409).json({ error: 'Kampanya aktif degil' });

    const addr = validateAddress(req.body?.address);
    if (!addr) return res.status(400).json({ error: 'Gecersiz address' });
    const { taskId, proof } = req.body ?? {};
    if (!taskId) return res.status(400).json({ error: 'taskId gerekli' });

    if (!proof || typeof proof !== 'string' || proof.trim().length < 3) {
        return res.status(400).json({ error: 'Geçersiz kanıt (Link veya @kullaniciadi girmelisiniz)' });
    }

    const key = addr.toLowerCase();
    if (!campaign.participants) campaign.participants = {};
    const participant = campaign.participants[key];
    if (!participant) return res.status(403).json({ error: 'Once kampanyaya katilin' });

    const task = (campaign.tasks || []).find(t => t.id === taskId);
    if (!task) return res.status(404).json({ error: 'Gorev bulunamadi' });

    if (participant.completedTasks[taskId]) {
        return res.status(409).json({ error: 'Bu gorev zaten tamamlandi' });
    }

    participant.completedTasks[taskId] = { ts: Date.now(), proof: proof.trim() };

    // Kampanya leaderboard guncelle
    if (!campaign.campaignLeaderboard) campaign.campaignLeaderboard = {};
    if (!campaign.campaignLeaderboard[key]) {
        const username = lbData[key]?.username || addr.slice(0, 6) + '...' + addr.slice(-4);
        campaign.campaignLeaderboard[key] = { points: 0, tasksCompleted: 0, username };
    }
    campaign.campaignLeaderboard[key].points += (task.points || 10);
    campaign.campaignLeaderboard[key].tasksCompleted++;

    saveCampaignsData();
    console.log(`[Campaign:${campaign.id}] Task done: ${addr.slice(0, 10)} task=${task.title} +${task.points}pts`);
    res.json({ ok: true, points: campaign.campaignLeaderboard[key].points });
});

/** GET /api/campaign/:id/leaderboard — Kampanya leaderboard (public) */
app.get('/api/campaign/:id/leaderboard', (req, res) => {
    const campaign = campaignsData.find(c => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadi' });

    const entries = Object.entries(campaign.campaignLeaderboard || {})
        .map(([addr, s]) => ({
            address: addr,
            username: s.username || (lbData[addr]?.username) || addr.slice(0, 8) + '...',
            points: s.points || 0,
            tasksCompleted: s.tasksCompleted || 0,
        }))
        .sort((a, b) => b.points - a.points);
    entries.forEach((e, i) => { e.rank = i + 1; });
    res.json({ ok: true, entries });
});

/** GET /api/admin/chat — Chat logları (sadece admin) */
app.get('/api/admin/chat', requireAdmin, (req, res) => {
    pruneChat();
    res.json({ ok: true, messages: [...chatMessages].reverse() });
});

/** DELETE /api/admin/chat/:id — Mesaj sil */
app.delete('/api/admin/chat/:id', requireAdmin, (req, res) => {
    const idx = chatMessages.findIndex(m => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Mesaj bulunamadı' });
    chatMessages.splice(idx, 1);
    res.json({ ok: true });
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
