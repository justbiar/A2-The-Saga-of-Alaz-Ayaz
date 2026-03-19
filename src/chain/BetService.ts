/**
 * BetService.ts — On-chain AVAX bet escrow with server-side verification.
 *
 * SECURE Flow:
 *  1. Host deposits bet amount to HOUSE_WALLET via MetaMask tx
 *  2. Host calls /api/register-bet → server verifies TX on-chain ✅
 *  3. Guest deposits same amount → calls /api/register-bet → server verifies ✅
 *  4. Game ends → BOTH players call /api/report-result with their result
 *  5. Server checks consensus:
 *     - Both agree on winner → auto-settle (prize sent to winner)
 *     - Disagreement → dispute → both refunded
 *  6. If guest never deposits → 10min auto-refund to host
 *
 * Security:
 *  - Private key stays on the GCP VM Express server (server/.env)
 *  - Every deposit is verified on-chain before being accepted
 *  - Winner is determined by mutual agreement, not client-side claim
 */

const ethers = (globalThis as any).ethers;

const HOUSE_WALLET = import.meta.env?.VITE_HOUSE_WALLET ?? '';
const API_BASE = import.meta.env?.VITE_API_BASE ?? '/api';
const FUJI_CHAIN_ID = '0xa869';

async function ensureFujiChain(provider: any): Promise<boolean> {
    try {
        const chainId = await provider.request({ method: 'eth_chainId' });
        if (chainId === FUJI_CHAIN_ID) return true;
        try {
            await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: FUJI_CHAIN_ID }] });
            return true;
        } catch (switchErr: any) {
            if (switchErr.code === 4902) {
                await provider.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: FUJI_CHAIN_ID,
                        chainName: 'Avalanche Fuji Testnet',
                        rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'],
                        nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
                        blockExplorerUrls: ['https://testnet.snowtrace.io'],
                    }],
                });
                return true;
            }
            throw switchErr;
        }
    } catch {
        return false;
    }
}

export const BET_FEE_PERCENT = 2;
export const MIN_BET = 0.01;  // AVAX
export const MAX_BET = 100;   // AVAX

export type BetStatus =
    | 'none'          // no bet this match
    | 'pending_host'  // host deposited, waiting guest
    | 'pending_guest' // guest received offer, needs to deposit
    | 'locked'        // both deposited, game in progress
    | 'settling'      // winner tx in progress
    | 'settled'       // done
    | 'cancelled';    // cancelled / refund

export interface BetState {
    amount: number;        // AVAX per player
    status: BetStatus;
    hostTxHash?: string;
    guestTxHash?: string;
    winnerAddress?: string;
    settleHash?: string;
    matchId?: string;
}

class BetService {
    public state: BetState = { amount: 0, status: 'none' };

    /** Last error message for UI display */
    public lastError: string = '';

    constructor() {
        this._restoreState();
    }

    /** Restore state from localStorage — only for active states that need server resolution */
    private _restoreState() {
        try {
            const raw = localStorage.getItem('a2_bet_state');
            if (!raw) return;
            const saved = JSON.parse(raw);
            // Only restore 'locked' or 'settling' — these need server-side resolution
            if (['locked', 'settling'].includes(saved.status) && saved.matchId && saved.amount > 0) {
                this.state = saved;
                console.log('[Bet] Restored active bet from localStorage:', saved.status, saved.matchId);
            } else {
                // Clear stale/completed states
                localStorage.removeItem('a2_bet_state');
            }
        } catch {
            localStorage.removeItem('a2_bet_state');
        }
    }

    /** Host: deposit bet amount to house wallet + register on backend. Returns tx hash on success. */
    async depositBet(amountAvax: number, matchId: string): Promise<string | null> {
        if (!ethers || !HOUSE_WALLET) {
            this.lastError = 'ethers veya HOUSE_WALLET yapılandırılmamış';
            console.warn('[Bet] ethers or HOUSE_WALLET not configured');
            return null;
        }
        if (amountAvax < MIN_BET || amountAvax > MAX_BET) {
            this.lastError = `Bahis ${MIN_BET}–${MAX_BET} AVAX arasında olmalı`;
            return null;
        }

        const provider = (window as any).__activeProvider;
        if (!provider) {
            this.lastError = 'Cüzdan bağlı değil — önce MetaMask ile bağlan';
            return null;
        }

        try {
            // Chain kontrolu — yanlış ağdaysa Fuji'ye geçir
            const onFuji = await ensureFujiChain(provider);
            if (!onFuji) {
                this.lastError = 'Avalanche Fuji ağına geçilemedi. MetaMask\'tan ağı kontrol et.';
                console.warn('[Bet] Not on Fuji chain');
                return null;
            }

            const ethProvider = new ethers.BrowserProvider(provider);
            const signer = await ethProvider.getSigner();
            const signerAddress = await signer.getAddress();

            // House wallet ile aynı hesaptan gönderim engellensin
            if (signerAddress.toLowerCase() === HOUSE_WALLET.toLowerCase()) {
                this.lastError = 'House wallet ile bahis yapılamaz! Farklı bir hesap kullan.';
                console.warn('[Bet] Cannot bet with house wallet');
                return null;
            }

            const amountWei = ethers.parseEther(amountAvax.toFixed(6));

            // Bakiye kontrolu
            const balance = await ethProvider.getBalance(signerAddress);
            const gasEstimate = BigInt(21000) * BigInt(30_000_000_000); // 21k gas * 30 gwei
            if (balance < amountWei + gasEstimate) {
                const balAvax = parseFloat(ethers.formatEther(balance)).toFixed(4);
                this.lastError = `Yetersiz bakiye! ${balAvax} AVAX var, ${amountAvax} AVAX + gas gerekli. Faucet: faucet.avax.network`;
                console.warn(`[Bet] Insufficient balance: ${balAvax} AVAX < ${amountAvax} + gas`);
                return null;
            }

            console.log(`[Bet] Depositing ${amountAvax} AVAX from ${signerAddress} to ${HOUSE_WALLET}`);

            const tx = await signer.sendTransaction({
                to: HOUSE_WALLET,
                value: amountWei,
            });

            await tx.wait(1);

            // Register on backend — server verifies TX on-chain
            const regRes = await fetch(`${API_BASE}/register-bet`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    matchId,
                    role: 'host',
                    address: signerAddress,
                    txHash: tx.hash,
                    amount: amountAvax,
                }),
            });
            const regData = await regRes.json();
            if (!regRes.ok) {
                console.error('[Bet] Register-bet failed:', regData);
                // Deposit went through but backend rejected — should not happen with valid TX
                return null;
            }

            this.state = {
                amount: amountAvax,
                status: 'pending_host',
                hostTxHash: tx.hash,
                matchId,
            };
            this._persistState();
            console.log(`[Bet] Host deposited ${amountAvax} AVAX + registered. TX: ${tx.hash}`);
            return tx.hash;
        } catch (err: any) {
            if (err?.code === 'INSUFFICIENT_FUNDS') {
                this.lastError = 'Yetersiz bakiye! Test AVAX almak için: faucet.avax.network';
            } else if (err?.code === 4001 || err?.code === 'ACTION_REJECTED') {
                this.lastError = 'İşlem iptal edildi';
            } else if (err?.code === 'CALL_EXCEPTION') {
                this.lastError = 'İşlem başarısız — bakiye veya ağ hatası. Fuji testnet\'te yeterli AVAX olduğundan emin ol.';
            } else {
                this.lastError = err?.shortMessage || err?.message || 'Deposit başarısız';
            }
            console.error('[Bet] Deposit failed:', err);
            return null;
        }
    }

    /** Host lobiden çıkarken guest deposit yoksa refund iste */
    async cancelBet(): Promise<{ ok: boolean; txHash?: string; refundAVAX?: number }> {
        const matchId = this.state.matchId;
        const address = (window as any).__walletAddress;
        if (!matchId || !address) {
            this.reset();
            return { ok: true };
        }

        // Locked durumda cancel edilemez — forfeit (loss report) yapılmalı
        if (this.state.status === 'locked') {
            console.log('[Bet] cancelBet: locked status — forfeiting via report-result');
            try {
                await this.reportResult(address, false); // report loss = forfeit
            } catch { /* server auto-resolve will handle */ }
            this.reset();
            return { ok: true };
        }

        // Sadece host_deposited veya pending_host durumunda iptal edilebilir
        if (!['pending_host', 'host_deposited'].includes(this.state.status ?? '')) {
            console.log('[Bet] cancelBet: status uygun değil:', this.state.status);
            this.reset();
            return { ok: true };
        }

        try {
            const res = await fetch(`${API_BASE}/cancel-bet`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ matchId, address }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                console.log(`[Bet] ✅ Bet cancelled, refund TX: ${data.txHash}, ${data.refundAVAX} AVAX`);
                this.reset();
                return { ok: true, txHash: data.txHash, refundAVAX: data.refundAVAX };
            } else {
                console.warn('[Bet] Cancel failed:', data.error);
                this.reset();
                return { ok: false };
            }
        } catch (e: any) {
            console.error('[Bet] cancelBet error:', e);
            this.reset();
            return { ok: false };
        }
    }

    /** Guest: deposit matching bet amount to house wallet + register on backend. */
    async acceptBet(amountAvax: number, matchId: string): Promise<string | null> {
        if (!ethers || !HOUSE_WALLET) return null;
        const provider = (window as any).__activeProvider;
        if (!provider) {
            this.lastError = 'Cüzdan bağlı değil — önce MetaMask ile bağlan';
            return null;
        }
        this.lastError = '';

        try {
            // Chain kontrolu
            const onFuji = await ensureFujiChain(provider);
            if (!onFuji) {
                this.lastError = 'Avalanche Fuji ağına geçilemedi. MetaMask\'tan ağı kontrol et.';
                return null;
            }

            const ethProvider = new ethers.BrowserProvider(provider);
            await provider.request({ method: 'eth_requestAccounts' });
            const signer = await ethProvider.getSigner();
            const signerAddress = await signer.getAddress();

            if (signerAddress.toLowerCase() === HOUSE_WALLET.toLowerCase()) {
                this.lastError = 'House wallet ile bahis yapılamaz! Farklı bir hesap kullan.';
                console.warn('[Bet] Cannot bet with house wallet');
                return null;
            }

            const amountWei = ethers.parseEther(amountAvax.toFixed(6));

            // Bakiye kontrolu
            const balance = await ethProvider.getBalance(signerAddress);
            const gasEstimate = BigInt(21000) * BigInt(30_000_000_000);
            if (balance < amountWei + gasEstimate) {
                const balAvax = parseFloat(ethers.formatEther(balance)).toFixed(4);
                this.lastError = `Yetersiz bakiye! ${balAvax} AVAX var, ${amountAvax} AVAX + gas gerekli. Faucet: faucet.avax.network`;
                return null;
            }

            console.log(`[Bet] Guest depositing ${amountAvax} AVAX from ${signerAddress} to ${HOUSE_WALLET}`);

            const tx = await signer.sendTransaction({
                to: HOUSE_WALLET,
                value: amountWei,
            });

            await tx.wait(1);

            // Register on backend — server verifies TX on-chain
            const regRes = await fetch(`${API_BASE}/register-bet`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    matchId,
                    role: 'guest',
                    address: signerAddress,
                    txHash: tx.hash,
                    amount: amountAvax,
                }),
            });
            const regData = await regRes.json();
            if (!regRes.ok) {
                console.error('[Bet] Guest register-bet failed:', regData);
                return null;
            }

            this.state.status = 'locked';
            this.state.guestTxHash = tx.hash;
            this._persistState();
            console.log(`[Bet] Guest deposited ${amountAvax} AVAX + registered. TX: ${tx.hash}`);
            return tx.hash;
        } catch (err: any) {
            if (err?.code === 'INSUFFICIENT_FUNDS') {
                this.lastError = 'Yetersiz bakiye! Test AVAX almak için: faucet.avax.network';
            } else if (err?.code === 4001 || err?.code === 'ACTION_REJECTED') {
                this.lastError = 'İşlem iptal edildi';
            } else {
                this.lastError = err?.shortMessage || err?.message || 'Deposit başarısız';
            }
            console.error('[Bet] Guest deposit failed:', err);
            return null;
        }
    }

    /**
     * Report game result to backend. Both players call this.
     * Server waits for both reports:
     *  - Consensus → auto-settle (prize sent)
     *  - Disagreement → dispute → both refunded
     */
    async reportResult(myAddress: string, didWin: boolean): Promise<{ status: string; txHash?: string; prizeAVAX?: number } | null> {
        if (this.state.status !== 'locked' || this.state.amount <= 0) return null;

        try {
            this.state.status = 'settling';
            const res = await fetch(`${API_BASE}/report-result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    matchId: this.state.matchId ?? '',
                    address: myAddress,
                    result: didWin ? 'win' : 'loss',
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                console.error('[Bet] Report-result error:', data);
                this.state.status = 'locked';
                return null;
            }

            if (data.status === 'settled') {
                this.state.status = 'settled';
                this.state.winnerAddress = data.winnerAddress;
                this.state.settleHash = data.txHash;

                // Track fee in localStorage
                const totalPot = this.state.amount * 2;
                const fee = totalPot * (BET_FEE_PERCENT / 100);
                trackFeeCollected(fee, this.state.matchId ?? '');

                this._persistState();
                console.log(`[Bet] Settled! Prize ${data.prizeAVAX} AVAX → ${data.winnerAddress}. TX: ${data.txHash}`);
                return { status: 'settled', txHash: data.txHash, prizeAVAX: data.prizeAVAX };

            } else if (data.status === 'disputed') {
                this.state.status = 'cancelled';
                this._persistState();
                console.log('[Bet] Disputed — both players refunded');
                return { status: 'disputed' };

            } else if (data.status === 'waiting') {
                // Other player hasn't reported yet — keep polling or wait for P2P signal
                this.state.status = 'locked'; // stay locked until resolved
                console.log('[Bet] Waiting for opponent\'s result report...');
                return { status: 'waiting' };
            }

            return { status: data.status };
        } catch (err: any) {
            console.error('[Bet] Report result failed:', err);
            this.state.status = 'locked';
            return null;
        }
    }

    /**
     * Poll match status — call after reporting to check if opponent has also reported.
     */
    async pollMatchStatus(): Promise<{ status: string; txHash?: string; prizeAVAX?: number; winnerAddress?: string } | null> {
        if (!this.state.matchId) return null;
        try {
            const res = await fetch(`${API_BASE}/match/${this.state.matchId}`);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }

    /** Cancel and refund — only if guest hasn't deposited yet (status = pending_host) */
    async cancelAndRefund(hostAddress: string): Promise<string | null> {
        if (this.state.status !== 'pending_host') return null;

        try {
            const res = await fetch(`${API_BASE}/refund`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hostAddress,
                    betAmountPerPlayer: this.state.amount,
                    matchId: this.state.matchId ?? '',
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                console.error('[Bet] Refund API error:', err);
                return null;
            }

            const data = await res.json();
            this.state.status = 'cancelled';
            this._persistState();
            return data.txHash;
        } catch (err: any) {
            console.error('[Bet] Refund failed:', err);
            return null;
        }
    }

    reset() {
        this.state = { amount: 0, status: 'none' };
        localStorage.removeItem('a2_bet_state');
    }

    private _persistState() {
        localStorage.setItem('a2_bet_state', JSON.stringify(this.state));
    }

    isActive(): boolean {
        return this.state.status !== 'none' && this.state.status !== 'cancelled' && this.state.status !== 'settled';
    }

    /** Human-readable status label */
    statusLabel(): string {
        switch (this.state.status) {
            case 'none': return '';
            case 'pending_host': return 'Rakip bekleniyor...';
            case 'pending_guest': return 'Bahis teklifi var!';
            case 'locked': return 'Bahis kilitlendi';
            case 'settling': return 'Odul gonderiliyor...';
            case 'settled': return 'Odul odendi!';
            case 'cancelled': return 'Iptal';
        }
    }
}

/** Track collected fees for weekly prize pool */
export function trackFeeCollected(feeAvax: number, matchId: string) {
    const raw = localStorage.getItem('a2_fee_pool') ?? '{}';
    const pool: { totalFee: number; week: number; matches: string[] } = JSON.parse(raw);
    const currentWeek = getISOWeek();

    if (pool.week !== currentWeek) {
        // New week — reset pool (previous week's distribution should have happened)
        pool.totalFee = 0;
        pool.week = currentWeek;
        pool.matches = [];
    }

    pool.totalFee = (pool.totalFee || 0) + feeAvax;
    pool.matches = [...(pool.matches || []), matchId];
    localStorage.setItem('a2_fee_pool', JSON.stringify(pool));
    console.log(`[Bet] Fee pool: ${pool.totalFee.toFixed(4)} AVAX (week ${currentWeek})`);
}

/** Get current week's fee pool info */
export function getFeePool(): { totalFee: number; week: number; matches: string[] } {
    const raw = localStorage.getItem('a2_fee_pool') ?? '{}';
    const pool = JSON.parse(raw);
    const currentWeek = getISOWeek();
    if (pool.week !== currentWeek) {
        return { totalFee: 0, week: currentWeek, matches: [] };
    }
    return { totalFee: pool.totalFee || 0, week: currentWeek, matches: pool.matches || [] };
}

function getISOWeek(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export const betService = new BetService();
