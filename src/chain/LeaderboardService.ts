/**
 * LeaderboardService.ts — localStorage-based player stats + weekly prize pool.
 *
 * Prize pool distribution (configurable, toggleable):
 *  - Prize pool = collected house fees for the week
 *  - Distribution ratio (default): 1st=40%, 2nd=20%, 3rd=10%
 *  - Remaining 30% stays in next week's pool (optional: burn / charity)
 *  - Admin can toggle rewards on/off and change ratios
 *
 * Stats are stored locally (no contract needed).
 * Once ProfileService contract is deployed, sync there too.
 */

export interface LocalPlayerStats {
    address: string;
    username: string;
    wins: number;
    losses: number;
    draws: number;
    totalBetWon: number;   // AVAX won from bets
    totalBetLost: number;  // AVAX lost in bets
    weeklyWins: number;    // resets each Monday
    weeklyBetWon: number;
    lastUpdated: number;
}

export interface WeeklyPrizeConfig {
    enabled: boolean;
    prizeRatios: [number, number, number]; // [1st%, 2nd%, 3rd%] — e.g. [40, 20, 10]
    minPoolToDistribute: number;           // minimum AVAX pool before distributing
    lastDistributedWeek: number;
}

export interface LeaderboardEntry extends LocalPlayerStats {
    rank: number;
    winRate: number;
    weeklyPrize?: number; // estimated prize this week
}

const STATS_KEY = 'a2_player_stats_v2';
const CONFIG_KEY = 'a2_prize_config';
const DEFAULT_CONFIG: WeeklyPrizeConfig = {
    enabled: true,
    prizeRatios: [40, 20, 10],
    minPoolToDistribute: 1.0, // 1 AVAX min
    lastDistributedWeek: 0,
};

class LeaderboardService {
    private stats: Map<string, LocalPlayerStats> = new Map();
    public prizeConfig: WeeklyPrizeConfig = DEFAULT_CONFIG;

    constructor() {
        this._load();
    }

    // ─── STATS ────────────────────────────────────────────────────────────

    /** Register/update player (call after wallet connect) */
    upsertPlayer(address: string, username: string, avatarURI?: string) {
        const addr = address.toLowerCase();
        void this._serverUpsert(address, username, avatarURI);
        if (!this.stats.has(addr)) {
            this.stats.set(addr, {
                address: addr,
                username,
                wins: 0, losses: 0, draws: 0,
                totalBetWon: 0, totalBetLost: 0,
                weeklyWins: 0, weeklyBetWon: 0,
                lastUpdated: Date.now(),
            });
        } else {
            // Update username if changed
            const p = this.stats.get(addr)!;
            p.username = username;
            p.lastUpdated = Date.now();
        }
        this._save();
    }

    recordResult(
        address: string,
        result: 'win' | 'loss' | 'draw',
        betWon: number = 0,
        betLost: number = 0,
        mode: 'online' | 'local' = 'local'
    ) {
        const addr = address.toLowerCase();

        // Sync to server (primary global store)
        void this._serverResult(address, result, betWon, betLost, mode);

        // Leaderboard sadece online maçları sayar
        if (mode === 'local') return;

        if (!this.stats.has(addr)) return;
        this._maybeResetWeekly(addr);
        const p = this.stats.get(addr)!;
        if (result === 'win') { p.wins++; p.weeklyWins++; }
        else if (result === 'loss') { p.losses++; }
        else { p.draws++; }
        if (betWon > 0) { p.totalBetWon += betWon; p.weeklyBetWon += betWon; }
        if (betLost > 0) { p.totalBetLost += betLost; }
        p.lastUpdated = Date.now();
        this._save();
    }

    /** Fetch global leaderboard from server */
    async getServerLeaderboard(): Promise<LeaderboardEntry[] | null> {
        try {
            const res = await fetch('/api/leaderboard');
            const data = await res.json();
            if (data.ok && Array.isArray(data.entries)) return data.entries;
        } catch { /* ignore */ }
        return null;
    }

    private async _serverResult(address: string, result: string, betWon: number, betLost: number, mode: string = 'local') {
        try {
            await fetch('/api/leaderboard/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, result, betWon, betLost, mode }),
            });
        } catch { /* ignore */ }
    }

    private async _serverUpsert(address: string, username: string, avatarURI?: string) {
        try {
            await fetch('/api/leaderboard/upsert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, username, ...(avatarURI ? { avatarURI } : {}) }),
            });
        } catch { /* ignore */ }
    }

    /** Get sorted leaderboard */
    getLeaderboard(sortBy: 'wins' | 'weeklyWins' | 'betWon' = 'wins'): LeaderboardEntry[] {
        const entries: LeaderboardEntry[] = [];
        const feePool = this._getFeePool();

        for (const p of this.stats.values()) {
            this._maybeResetWeekly(p.address);
            const gamesPlayed = p.wins + p.losses + p.draws;
            entries.push({
                ...p,
                rank: 0,
                winRate: gamesPlayed > 0 ? Math.round((p.wins / gamesPlayed) * 100) : 0,
            });
        }

        // Sort
        entries.sort((a, b) => {
            if (sortBy === 'weeklyWins') return b.weeklyWins - a.weeklyWins || b.wins - a.wins;
            if (sortBy === 'betWon') return b.totalBetWon - a.totalBetWon;
            return b.wins - a.wins || b.winRate - a.winRate;
        });

        // Assign ranks + weekly prizes
        entries.forEach((e, i) => {
            e.rank = i + 1;
            if (this.prizeConfig.enabled && feePool.totalFee >= this.prizeConfig.minPoolToDistribute) {
                const ratios = this.prizeConfig.prizeRatios;
                if (i < 3) {
                    e.weeklyPrize = +(feePool.totalFee * (ratios[i] / 100)).toFixed(4);
                }
            }
        });

        return entries;
    }

    getPlayer(address: string): LocalPlayerStats | null {
        return this.stats.get(address.toLowerCase()) ?? null;
    }

    // ─── PRIZE CONFIG ──────────────────────────────────────────────────────

    /** Toggle weekly prize distribution on/off */
    togglePrizes(enabled: boolean) {
        this.prizeConfig.enabled = enabled;
        this._saveConfig();
    }

    /** Update prize ratios. Values are percentages summing ≤ 100 */
    setPrizeRatios(first: number, second: number, third: number) {
        if (first + second + third > 100) {
            console.warn('[Leaderboard] Prize ratios exceed 100%');
            return;
        }
        this.prizeConfig.prizeRatios = [first, second, third];
        this._saveConfig();
    }

    setMinPool(minAvax: number) {
        this.prizeConfig.minPoolToDistribute = minAvax;
        this._saveConfig();
    }

    /** Get current week fee pool */
    private _getFeePool(): { totalFee: number; week: number } {
        const raw = localStorage.getItem('a2_fee_pool') ?? '{}';
        const pool = JSON.parse(raw);
        const currentWeek = getISOWeek();
        if (pool.week !== currentWeek) return { totalFee: 0, week: currentWeek };
        return { totalFee: pool.totalFee || 0, week: currentWeek };
    }

    /** Returns current week's total fee pool and prize breakdown — server'dan okur */
    getPrizePoolInfo(): {
        totalFee: number;
        week: number;
        enabled: boolean;
        prizes: { rank: number; avax: number; ratio: number }[];
        minPool: number;
        enoughForDistribution: boolean;
    } {
        // Sync fallback (localStorage) — async fetch için getServerPrizePool() kullan
        const pool = this._getFeePool();
        const config = this.prizeConfig;
        const prizes = config.prizeRatios.map((ratio, i) => ({
            rank: i + 1,
            avax: +(pool.totalFee * (ratio / 100)).toFixed(4),
            ratio,
        }));
        return {
            totalFee: pool.totalFee,
            week: pool.week,
            enabled: config.enabled,
            prizes,
            minPool: config.minPoolToDistribute,
            enoughForDistribution: pool.totalFee >= config.minPoolToDistribute,
        };
    }

    /** Server'dan anlık fee pool bilgisi çek */
    async getServerPrizePool(): Promise<{ totalFee: number; week: number; seasonWeek: number; prizes: { rank: number; avax: number; ratio: number }[]; matchCount: number; totalDistributed: number; remainingMs: number; nextDistribution: string } | null> {
        try {
            const res = await fetch('/api/fee-pool');
            const data = await res.json();
            if (data.ok) return data;
        } catch { /* ignore */ }
        return null;
    }

    // ─── PERSIST ──────────────────────────────────────────────────────────

    private _maybeResetWeekly(address: string) {
        const p = this.stats.get(address.toLowerCase());
        if (!p) return;
        const currentWeek = getISOWeek();
        const storedWeek = getISOWeekFromTimestamp(p.lastUpdated);
        if (storedWeek < currentWeek) {
            p.weeklyWins = 0;
            p.weeklyBetWon = 0;
        }
    }

    private _load() {
        try {
            const raw = localStorage.getItem(STATS_KEY);
            if (raw) {
                const arr: LocalPlayerStats[] = JSON.parse(raw);
                for (const s of arr) this.stats.set(s.address.toLowerCase(), s);
            }
        } catch { /* ignore */ }

        try {
            const raw = localStorage.getItem(CONFIG_KEY);
            if (raw) this.prizeConfig = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        } catch { /* ignore */ }
    }

    private _save() {
        localStorage.setItem(STATS_KEY, JSON.stringify([...this.stats.values()]));
    }

    private _saveConfig() {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(this.prizeConfig));
    }
}

function getISOWeek(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getISOWeekFromTimestamp(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export const leaderboardService = new LeaderboardService();
