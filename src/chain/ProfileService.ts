/**
 * ProfileService.ts — Player profile with localStorage fallback.
 * On-chain contract is optional (VITE_PROFILE_CONTRACT). Without it,
 * profiles are stored locally and work fully offline.
 */
const ethers = (globalThis as any).ethers;
const _win = window as any;

const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
const FUJI_PARAMS = {
    chainId: '0xa869',
    chainName: 'Avalanche Fuji Testnet',
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    rpcUrls: [FUJI_RPC],
    blockExplorerUrls: ['https://testnet.snowtrace.io/'],
};

const CONTRACT_ADDRESS = import.meta.env?.VITE_PROFILE_CONTRACT ?? '';
const LS_KEY = 'a2_profiles';

const PROFILE_ABI = [
    'function registerProfile(string username, string avatarURI) external',
    'function updateProfile(string username, string avatarURI) external',
    'function submitGameResult(uint8 result) external',
    'function getProfile(address player) view returns (tuple(string username, string avatarURI, uint32 gamesPlayed, uint32 wins, uint32 losses, uint32 draws, uint64 registeredAt, bool exists))',
    'function getAllPlayers() view returns (address[])',
    'function getPlayerCount() view returns (uint256)',
];

// ── localStorage helpers ──────────────────────────────────────────────────
function lsGetAll(): Record<string, any> {
    try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}'); } catch { return {}; }
}
function lsSave(profiles: Record<string, any>) {
    localStorage.setItem(LS_KEY, JSON.stringify(profiles));
}
function lsGet(address: string): PlayerProfile | null {
    const all = lsGetAll();
    const p = all[address.toLowerCase()];
    if (!p) return null;
    return { ...p, exists: true };
}
function lsUpsert(profile: PlayerProfile) {
    const all = lsGetAll();
    all[profile.address.toLowerCase()] = { ...profile };
    lsSave(all);
}

export interface PlayerProfile {
    address: string;
    username: string;
    avatarURI: string;
    gamesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
    registeredAt: number;
    exists: boolean;
}

export interface LeaderboardEntry extends PlayerProfile {
    winRate: number;
    rank: number;
}

class ProfileService {
    private contract: any = null;
    private readContract: any = null;
    public walletAddress: string | null = null;
    public currentProfile: PlayerProfile | null = null;
    public isConnected = false;

    constructor() {
        // Setup read-only contract immediately (no wallet needed)
        if (CONTRACT_ADDRESS && ethers) {
            try {
                const readProvider = new ethers.JsonRpcProvider(FUJI_RPC);
                this.readContract = new ethers.Contract(CONTRACT_ADDRESS, PROFILE_ABI, readProvider);
            } catch (e) {
                console.warn('[Profile] Read contract init failed:', e);
            }
        }
    }

    /** Connect MetaMask wallet, switch to Fuji */
    async connectWallet(): Promise<string | null> {
        const _prov = _win.__activeProvider || _win.ethereum;
        if (!ethers || !_prov) {
            console.warn('MetaMask not found');
            return null;
        }
        try {
            const provider = new ethers.BrowserProvider(_prov);
            await provider.send('eth_requestAccounts', []);

            // Switch to Fuji
            try {
                await _prov.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: FUJI_PARAMS.chainId }],
                });
            } catch (switchErr: any) {
                if (switchErr.code === 4902) {
                    await _prov.request({
                        method: 'wallet_addEthereumChain',
                        params: [FUJI_PARAMS],
                    });
                }
            }

            const signer = await provider.getSigner();
            this.walletAddress = await signer.getAddress();
            this.isConnected = true;

            // Setup on-chain contract if address configured
            if (CONTRACT_ADDRESS && ethers) {
                this.contract = new ethers.Contract(CONTRACT_ADDRESS, PROFILE_ABI, signer);
                const readProvider = new ethers.JsonRpcProvider(FUJI_RPC);
                this.readContract = new ethers.Contract(CONTRACT_ADDRESS, PROFILE_ABI, readProvider);
            }

            await this.loadProfile();
            return this.walletAddress;
        } catch (e) {
            console.warn('Wallet connect failed:', e);
            return null;
        }
    }

    /** Load profile — on-chain first, fallback to localStorage */
    async loadProfile(): Promise<PlayerProfile | null> {
        if (!this.walletAddress) return null;

        // Try on-chain
        if (this.readContract) {
            try {
                const p = await this.readContract.getProfile(this.walletAddress);
                if (p.exists) {
                    this.currentProfile = {
                        address: this.walletAddress,
                        username: p.username,
                        avatarURI: p.avatarURI,
                        gamesPlayed: Number(p.gamesPlayed),
                        wins: Number(p.wins),
                        losses: Number(p.losses),
                        draws: Number(p.draws),
                        registeredAt: Number(p.registeredAt),
                        exists: true,
                    };
                    // Sync to localStorage
                    lsUpsert(this.currentProfile);
                    return this.currentProfile;
                }
            } catch (e) {
                console.warn('[Profile] On-chain load failed, using localStorage:', e);
            }
        }

        // Fallback: localStorage
        const local = lsGet(this.walletAddress);
        this.currentProfile = local;
        return local;
    }

    /** Register profile — localStorage always, on-chain if contract configured */
    async registerProfile(username: string, avatarURI: string): Promise<boolean> {
        if (!this.walletAddress) return false;

        const existing = lsGet(this.walletAddress);
        const profile: PlayerProfile = {
            address: this.walletAddress,
            username,
            avatarURI: avatarURI || existing?.avatarURI || '',
            gamesPlayed: existing?.gamesPlayed ?? 0,
            wins: existing?.wins ?? 0,
            losses: existing?.losses ?? 0,
            draws: existing?.draws ?? 0,
            registeredAt: existing?.registeredAt ?? Math.floor(Date.now() / 1000),
            exists: true,
        };

        // Always save to localStorage first (instant, no gas)
        lsUpsert(profile);
        this.currentProfile = profile;

        // Also try on-chain if contract available
        if (this.contract) {
            try {
                const tx = await this.contract.registerProfile(username, avatarURI);
                await tx.wait();
                console.log('[Profile] Registered on-chain');
            } catch (e) {
                console.warn('[Profile] On-chain register failed (localStorage saved):', e);
            }
        }

        return true;
    }

    /** Submit game result — localStorage always, on-chain if available */
    async submitGameResult(result: 'win' | 'loss' | 'draw'): Promise<boolean> {
        if (!this.walletAddress) return false;

        // Update localStorage
        const profile = lsGet(this.walletAddress) ?? {
            address: this.walletAddress,
            username: this.shortAddress(),
            avatarURI: '',
            gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
            registeredAt: Math.floor(Date.now() / 1000),
            exists: true,
        };

        profile.gamesPlayed++;
        if (result === 'win') profile.wins++;
        else if (result === 'loss') profile.losses++;
        else profile.draws++;

        lsUpsert(profile);
        this.currentProfile = profile;

        // Also try on-chain
        if (this.contract && this.currentProfile) {
            const code = result === 'win' ? 1 : result === 'loss' ? 0 : 2;
            try {
                const tx = await this.contract.submitGameResult(code);
                await tx.wait();
            } catch (e) {
                console.warn('[Profile] On-chain submit failed:', e);
            }
        }

        return true;
    }

    /** Get leaderboard — on-chain first (all players), fallback to localStorage */
    async getLeaderboard(): Promise<LeaderboardEntry[]> {
        // Try on-chain: fetch all registered players
        if (this.readContract) {
            try {
                const playerAddresses: string[] = await this.readContract.getAllPlayers();
                if (playerAddresses.length > 0) {
                    const onChainEntries: LeaderboardEntry[] = [];
                    for (const addr of playerAddresses) {
                        try {
                            const p = await this.readContract.getProfile(addr);
                            if (p.exists) {
                                const gp = Number(p.gamesPlayed);
                                const wins = Number(p.wins);
                                const losses = Number(p.losses);
                                const draws = Number(p.draws);
                                const profile: PlayerProfile = {
                                    address: addr,
                                    username: p.username || addr.slice(0, 6) + '...' + addr.slice(-4),
                                    avatarURI: p.avatarURI,
                                    gamesPlayed: gp,
                                    wins,
                                    losses,
                                    draws,
                                    registeredAt: Number(p.registeredAt),
                                    exists: true,
                                };
                                // Sync to localStorage
                                lsUpsert(profile);
                                onChainEntries.push({
                                    ...profile,
                                    winRate: gp > 0 ? Math.round((wins / gp) * 100) : 0,
                                    rank: 0,
                                });
                            }
                        } catch {
                            // Skip individual failures
                        }
                    }
                    if (onChainEntries.length > 0) {
                        onChainEntries.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
                        onChainEntries.forEach((e, i) => e.rank = i + 1);
                        return onChainEntries;
                    }
                }
            } catch (e) {
                console.warn('[Profile] On-chain leaderboard fetch failed, using localStorage:', e);
            }
        }

        // Fallback: localStorage
        const all = lsGetAll();
        const entries: LeaderboardEntry[] = Object.values(all).map((p: any) => {
            const gp = (p.wins ?? 0) + (p.losses ?? 0) + (p.draws ?? 0);
            return {
                ...p,
                gamesPlayed: gp,
                winRate: gp > 0 ? Math.round(((p.wins ?? 0) / gp) * 100) : 0,
                rank: 0,
                exists: true,
            };
        });

        entries.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
        entries.forEach((e, i) => e.rank = i + 1);
        return entries;
    }

    /** Short address for display */
    shortAddress(): string {
        if (!this.walletAddress) return '';
        return this.walletAddress.slice(0, 6) + '...' + this.walletAddress.slice(-4);
    }
}

export const profileService = new ProfileService();
