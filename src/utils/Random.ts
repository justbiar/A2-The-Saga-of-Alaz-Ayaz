/**
 * Deterministic Pseudo-Random Number Generator (PRNG)
 * based on Mulberry32.
 * Used for keeping lockstep synchronization in multiplayer mode.
 */
export class A2DeterministicRandom {
    private seed: number;

    constructor(seed: number = 0) {
        this.seed = seed;
    }

    /**
     * Set the current seed
     */
    public setSeed(seed: number) {
        this.seed = seed;
    }

    /**
     * Get the next random float in [0, 1)
     */
    public value(): number {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    /**
     * Get a random integer in [min, max] (inclusive)
     */
    public rangeInt(min: number, max: number): number {
        return Math.floor(this.value() * (max - min + 1)) + min;
    }

    /**
     * Get a random float in [min, max)
     */
    public rangeFloat(min: number, max: number): number {
        return this.value() * (max - min) + min;
    }

    /**
     * Choose a random element from an array
     */
    public choice<T>(array: T[]): T {
        return array[Math.floor(this.value() * array.length)];
    }

    /**
     * Shuffle an array in-place (Fisher-Yates)
     */
    public shuffle<T>(array: T[]): T[] {
        let m = array.length, t, i;
        while (m) {
            i = Math.floor(this.value() * m--);
            t = array[m];
            array[m] = array[i];
            array[i] = t;
        }
        return array;
    }
}

// Global deterministic random instance
export const GameRandom = new A2DeterministicRandom(Date.now());
