/**
 * KiteAIClient.ts — Real Kite AI LLM inference client.
 *
 * When VITE_KITE_ENDPOINT is set, sends board state to the Kite AI LLM
 * following the GDD §4 system-prompt format and parses the structured response.
 *
 * On any failure or if the endpoint is not configured, transparently falls
 * back to MockKiteAI so gameplay is never interrupted.
 *
 * Swap-in guide (when endpoint is ready):
 *   1. Add VITE_KITE_ENDPOINT=https://... to .env
 *   2. Add VITE_KITE_API_KEY=... to .env
 *   3. Optionally set VITE_KITE_PASSPORT_ID per agent
 */
import type { IKiteAI } from './KiteAIInterface';
import type { BoardState, ActionQueue, AIProfile, KiteAction } from '../ecs/types';
import { MockKiteAI } from './MockKiteAI';

// ─── Environment variables (Vite exposes VITE_* at build time) ─────────────
const KITE_ENDPOINT   = import.meta.env?.VITE_KITE_ENDPOINT   ?? '';
const KITE_API_KEY    = import.meta.env?.VITE_KITE_API_KEY     ?? '';
const KITE_TIMEOUT_MS = 250; // GDD §4 latency budget hard cap

// ─── System prompt template (GDD §4.2) ─────────────────────────────────────
function buildSystemPrompt(profile: AIProfile): string {
    return (
        `You are an AI agent in A2: The Saga of Alaz & Ayaz, a strategic card game. ` +
        `Your faction trait is "${profile.trait}" and your targeting priority is "${profile.targetPriority}". ` +
        `Your aggression radius is ${profile.aggressionRadius} units. ` +
        `You must output a JSON action sequence that advances your faction's position on the board. ` +
        `Available action types: "deploy" (spawn a unit), "ability" (use ability), "hold" (skip). ` +
        `Available unit types: ayaz, tulpar, umay, albasti, tepegoz, sahmeran. ` +
        `Lanes: 0=left, 1=mid, 2=right. ` +
        `Always output ONLY valid JSON, no markdown, no explanation outside JSON.`
    );
}

function buildUserPrompt(board: BoardState): string {
    return JSON.stringify({
        turn:            board.turn,
        enemyMana:       board.enemyMana,
        fireUnits:       board.fireUnits,
        iceUnits:        board.iceUnits,
        equilibrium:     board.equilibriumScore,
        shards:          board.shardControl,
        fireBaseHp:      board.fireBaseHp,
        iceBaseHp:       board.iceBaseHp,
        instruction:     'Return JSON: { "actions": [...], "reasoning": "...", "confidence": 0-1 }',
    });
}

// ─── Response parser ────────────────────────────────────────────────────────
function parseKiteResponse(raw: string, fallback: ActionQueue): ActionQueue {
    try {
        // Strip potential markdown code fences
        const clean = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(clean);

        const actions: KiteAction[] = (parsed.actions ?? []).map((a: any) => ({
            type:      a.type      ?? 'hold',
            unitType:  a.unitType  ?? a.unit_type,
            lane:      typeof a.lane === 'number' ? a.lane : undefined,
            abilityId: a.abilityId ?? a.ability_id,
        }));

        return {
            actions,
            confidence: typeof parsed.confidence === 'number'
                ? Math.min(1, Math.max(0, parsed.confidence))
                : 0.6,
            reasoning: parsed.reasoning ?? '(no reasoning)',
        };
    } catch {
        console.warn('[KiteAI] Response parse failed — using fallback', raw.slice(0, 120));
        return fallback;
    }
}

// ─── Main client ────────────────────────────────────────────────────────────
export class KiteAIClient implements IKiteAI {
    private readonly fallback = new MockKiteAI();
    public isLive = false;

    async process(board: BoardState, profile: AIProfile): Promise<ActionQueue> {
        if (!KITE_ENDPOINT) {
            return this.fallback.process(board, profile);
        }

        // Build fallback result first (used on any error)
        const fallbackResult = await this.fallback.process(board, profile);

        try {
            const body = {
                model:    'kite-game-agent-v1',
                messages: [
                    { role: 'system', content: buildSystemPrompt(profile) },
                    { role: 'user',   content: buildUserPrompt(board)     },
                ],
                temperature:  0.3,
                max_tokens:   512,
                response_format: { type: 'json_object' },
            };

            const controller = new AbortController();
            const timeoutId  = setTimeout(() => controller.abort(), KITE_TIMEOUT_MS);

            const res = await fetch(`${KITE_ENDPOINT}/v1/chat/completions`, {
                method:  'POST',
                signal:  controller.signal,
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${KITE_API_KEY}`,
                    'X-PoAI-Session': `a2_turn_${board.turn}`,
                },
                body: JSON.stringify(body),
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                throw new Error(`Kite AI HTTP ${res.status}`);
            }

            const data = await res.json();
            const content: string =
                data?.choices?.[0]?.message?.content ??
                data?.content ??          // alternate response shapes
                data?.response ?? '';

            const result = parseKiteResponse(content, fallbackResult);
            this.isLive = true;
            console.log(`[KiteAI] Live response — confidence: ${result.confidence.toFixed(2)} | ${result.reasoning?.slice(0, 80)}`);
            return result;

        } catch (err: any) {
            if (err?.name === 'AbortError') {
                console.warn('[KiteAI] Timeout (>250ms) — MockKiteAI fallback');
            } else {
                console.warn('[KiteAI] Error —', err?.message ?? err, '— MockKiteAI fallback');
            }
            this.isLive = false;
            return fallbackResult;
        }
    }
}
