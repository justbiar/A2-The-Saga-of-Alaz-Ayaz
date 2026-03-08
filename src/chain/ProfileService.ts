/**
 * ProfileService.ts — On-chain player profile, scores, leaderboard.
 * Avalanche Fuji testnet. ethers loaded from CDN.
 */
const ethers = (globalThis as any).ethers;

const FUJI_CHAIN_ID = 43113;
const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
const FUJI_PARAMS = {
    chainId: '0xa869',
    chainName: 'Avalanche Fuji Testnet',
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    rpcUrls: [FUJI_RPC],
    blockExplorerUrls: ['https://testnet.snowtrace.io/'],
};

const CONTRACT_ADDRESS = import.meta.env?.VITE_PROFILE_CONTRACT ?? '';

const PROFILE_ABI = [
    'function registerProfile(string username, string avatarURI) external',
    'function updateProfile(string username, string avatarURI) external',
    'function submitGameResult(uint8 result) external',
    'function getProfile(address player) view returns (tuple(string username, string avatarURI, uint32 gamesPlayed, uint32 wins, uint32 losses, uint32 draws, uint64 registeredAt, bool exists))',
    'function getAllPlayers() view returns (address[])',
    'function getPlayerCount() view returns (uint256)',
];

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
    private provider: any = null;
    private signer: any = null;
    private contract: any = null;
    private readContract: any = null;
    public walletAddress: string | null = null;
    public currentProfile: PlayerProfile | null = null;
    public isConnected = false;

    /** Connect wallet to Fuji testnet */
    async connectWallet(): Promise<string | null> {
        if (!ethers || !window.ethereum) {
            console.warn('MetaMask not found');
            return null;
        }
        try {
            this.provider = new ethers.BrowserProvider(window.ethereum);
            // Request accounts
            await this.provider.send('eth_requestAccounts', []);
            // Switch to Fuji if needed
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: FUJI_PARAMS.chainId }],
                });
            } catch (switchErr: any) {
                if (switchErr.code === 4902) {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [FUJI_PARAMS],
                    });
                }
            }

            this.signer = await this.provider.getSigner();
            this.walletAddress = await this.signer.getAddress();
            this.isConnected = true;

            // Setup contracts
            if (CONTRACT_ADDRESS) {
                this.contract = new ethers.Contract(CONTRACT_ADDRESS, PROFILE_ABI, this.signer);
                const readProvider = new ethers.JsonRpcProvider(FUJI_RPC);
                this.readContract = new ethers.Contract(CONTRACT_ADDRESS, PROFILE_ABI, readProvider);
            }

            // Load profile
            await this.loadProfile();
            return this.walletAddress;
        } catch (e) {
            console.warn('Wallet connect failed:', e);
            return null;
        }
    }

    /** Load current user's profile */
    async loadProfile(): Promise<PlayerProfile | null> {
        if (!this.readContract || !this.walletAddress) return null;
        try {
            const p = await this.readContract.getProfile(this.walletAddress);
            if (!p.exists) { this.currentProfile = null; return null; }
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
            return this.currentProfile;
        } catch (e) {
            console.warn('Load profile failed:', e);
            return null;
        }
    }

    /** Register new profile on-chain */
    async registerProfile(username: string, avatarURI: string): Promise<boolean> {
        if (!this.contract) return false;
        try {
            const tx = await this.contract.registerProfile(username, avatarURI);
            await tx.wait();
            await this.loadProfile();
            return true;
        } catch (e) {
            console.warn('Register failed:', e);
            return false;
        }
    }

    /** Submit game result: 'win' | 'loss' | 'draw' */
    async submitGameResult(result: 'win' | 'loss' | 'draw'): Promise<boolean> {
        if (!this.contract || !this.currentProfile) return false;
        const code = result === 'win' ? 1 : result === 'loss' ? 0 : 2;
        try {
            const tx = await this.contract.submitGameResult(code);
            await tx.wait();
            await this.loadProfile();
            return true;
        } catch (e) {
            console.warn('Submit result failed:', e);
            return false;
        }
    }

    /** Get leaderboard — all players sorted by wins */
    async getLeaderboard(): Promise<LeaderboardEntry[]> {
        if (!this.readContract) return [];
        try {
            const players: string[] = await this.readContract.getAllPlayers();
            const entries: LeaderboardEntry[] = [];

            for (const addr of players) {
                const p = await this.readContract.getProfile(addr);
                if (!p.exists) continue;
                const gp = Number(p.gamesPlayed);
                const w = Number(p.wins);
                entries.push({
                    address: addr,
                    username: p.username,
                    avatarURI: p.avatarURI,
                    gamesPlayed: gp,
                    wins: w,
                    losses: Number(p.losses),
                    draws: Number(p.draws),
                    registeredAt: Number(p.registeredAt),
                    exists: true,
                    winRate: gp > 0 ? Math.round((w / gp) * 100) : 0,
                    rank: 0,
                });
            }

            // Sort by wins desc, then winRate desc
            entries.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
            entries.forEach((e, i) => e.rank = i + 1);
            return entries;
        } catch (e) {
            console.warn('Leaderboard failed:', e);
            return [];
        }
    }

    /** Short address display */
    shortAddress(): string {
        if (!this.walletAddress) return '';
        return this.walletAddress.slice(0, 6) + '...' + this.walletAddress.slice(-4);
    }
}

export const profileService = new ProfileService();
