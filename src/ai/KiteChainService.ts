/**
 * KiteChainService.ts — On-chain PoAI score recording.
 *
 * Records match actions and final results to the AgentNFT contract.
 * Currently targets Avalanche Fuji testnet; swap VITE_KITE_CHAIN_RPC
 * to point at Kite Chain when it launches.
 *
 * All chain calls are fire-and-forget with silent failure —
 * the game always runs regardless of chain availability.
 *
 * Env vars:
 *   VITE_KITE_CHAIN_RPC        — RPC endpoint (default: Fuji testnet)
 *   VITE_AGENT_NFT_ADDRESS     — Deployed AgentNFT contract address
 *   VITE_GAME_REGISTRY_ADDRESS — A2GameRegistry contract address
 */
// ethers loaded from CDN (window.ethers)
const ethers = (globalThis as any).ethers;

// ─── Env vars ───────────────────────────────────────────────────────────────
const CHAIN_RPC      = import.meta.env?.VITE_KITE_CHAIN_RPC        ?? 'https://api.avax-test.network/ext/bc/C/rpc';
const NFT_ADDRESS    = import.meta.env?.VITE_AGENT_NFT_ADDRESS      ?? '';
const REGISTRY_ADDR  = import.meta.env?.VITE_GAME_REGISTRY_ADDRESS  ?? '';

// ─── Minimal ABI fragments we need ─────────────────────────────────────────
const AGENT_NFT_ABI = [
    'function updatePoAI(uint256 tokenId, uint32 delta) external',
    'function agents(uint256) view returns (string characterType, uint8 tier, uint32 poaiScore, uint32 matchesPlayed, uint32 wins, address tbaAddress)',
    'function ownerOf(uint256 tokenId) view returns (address)',
];

const REGISTRY_ABI = [
    'function recordMatch(address player, string characterType, bool won, uint32 poaiDelta) external',
];

// ─── Types ───────────────────────────────────────────────────────────────────
export interface MatchResult {
    playerAddress: string;
    characterType: string;  // 'korhan', 'erlik', etc.
    won: boolean;
    turnsPlayed: number;
    totalPoAIDelta: number; // accumulated across all turns
    agentNFTTokenId?: number;
}

export interface TurnRecord {
    turn: number;
    actionsCount: number;
    confidence: number;       // 0-1, from KiteAI
    unitType?: string;
    lane?: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────
export class KiteChainService {
    private provider: any = null;
    private nftContract:      any = null;
    private registryContract: any = null;

    public isConnected  = false;
    public chainId: number | null = null;

    private turnLog: TurnRecord[] = [];

    // ── Connect to chain via MetaMask or RPC fallback ─────────────────────
    async connect(): Promise<boolean> {
        try {
            if (typeof window !== 'undefined' && (window as any).ethereum) {
                this.provider = new ethers.BrowserProvider((window as any).ethereum);
                const network  = await this.provider.getNetwork();
                this.chainId   = Number(network.chainId);
                console.log(`[KiteChain] MetaMask connected, chainId: ${this.chainId}`);
            } else {
                // Read-only fallback for environments without MetaMask
                this.provider = new ethers.JsonRpcProvider(CHAIN_RPC);
                const network  = await this.provider.getNetwork();
                this.chainId   = Number(network.chainId);
                console.log(`[KiteChain] RPC connected (read-only), chainId: ${this.chainId}`);
            }

            if (NFT_ADDRESS) {
                this.nftContract = new ethers.Contract(NFT_ADDRESS, AGENT_NFT_ABI, this.provider);
            }
            if (REGISTRY_ADDR) {
                this.registryContract = new ethers.Contract(REGISTRY_ADDR, REGISTRY_ABI, this.provider);
            }

            this.isConnected = true;
            return true;
        } catch (err) {
            console.warn('[KiteChain] Connection failed:', err);
            this.isConnected = false;
            return false;
        }
    }

    // ── Log a turn action (in-memory, batched on match end) ───────────────
    logTurn(record: TurnRecord): void {
        this.turnLog.push(record);
        console.log(`[KiteChain] Turn ${record.turn} logged — PoAI contribution ≈ ${(record.confidence * 10).toFixed(1)}`);
    }

    // ── Calculate total PoAI delta from logged turns ───────────────────────
    calculatePoAIDelta(): number {
        // GDD §3.4: PoAI delta = sum(confidence_i * 10) per action, capped at 100 per match
        const raw = this.turnLog.reduce((sum, t) => sum + t.confidence * t.actionsCount * 10, 0);
        return Math.min(Math.round(raw), 100);
    }

    // ── Record final match result to chain ────────────────────────────────
    async finalizeMatch(result: MatchResult): Promise<void> {
        const poaiDelta = result.totalPoAIDelta || this.calculatePoAIDelta();
        this.turnLog = []; // Reset for next match

        console.log(`[KiteChain] Finalizing match — won: ${result.won}, PoAI delta: +${poaiDelta}`);

        if (!this.isConnected) {
            console.warn('[KiteChain] Not connected — match result not recorded on-chain');
            return;
        }

        try {
            // Need a signer for write operations
            if (!this.provider || !this.provider.getSigner) {
                console.warn('[KiteChain] No wallet signer available for write tx');
                return;
            }

            const signer = await this.provider.getSigner();

            // Record to GameRegistry if deployed
            if (this.registryContract && REGISTRY_ADDR) {
                const registryWithSigner = this.registryContract.connect(signer);
                const tx = await (registryWithSigner as any).recordMatch(
                    result.playerAddress,
                    result.characterType,
                    result.won,
                    poaiDelta,
                );
                console.log(`[KiteChain] GameRegistry tx: ${tx.hash}`);
                await tx.wait(1);
                console.log(`[KiteChain] Match recorded on-chain ✓`);
            }

            // Update AgentNFT PoAI score if token ID is known
            if (this.nftContract && NFT_ADDRESS && result.agentNFTTokenId !== undefined) {
                const nftWithSigner = this.nftContract.connect(signer);
                const tx = await (nftWithSigner as any).updatePoAI(
                    result.agentNFTTokenId,
                    poaiDelta,
                );
                console.log(`[KiteChain] AgentNFT updatePoAI tx: ${tx.hash}`);
                await tx.wait(1);
                console.log(`[KiteChain] AgentNFT PoAI updated ✓`);
            }
        } catch (err: any) {
            // Chain errors never break the game
            console.warn('[KiteChain] On-chain recording failed (non-fatal):', err?.message ?? err);
        }
    }

    // ── Read current PoAI score for a token ──────────────────────────────
    async getAgentPoAI(tokenId: number): Promise<number | null> {
        if (!this.nftContract) return null;
        try {
            const data = await (this.nftContract as any).agents(tokenId);
            return Number(data.poaiScore);
        } catch {
            return null;
        }
    }
}
