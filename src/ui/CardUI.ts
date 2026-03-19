/**
 * CardUI.ts — Card building, mana UI, skill cards, draft system, prompt effects.
 */

import { ctx, MAX_MANA } from '../game/GameContext';
import { t, TransKey } from '../i18n';
import { CARD_DEFS, AI_CARDS, CardDef, UnitType } from '../ecs/Unit';
import { PROMPT_DEFS, getTowerCard, getFlowerCard, getTreeCard } from '../ecs/PromptCard';
import { TREE_PLANT_COST } from '../scene/units/ResourceTree';
import type { PromptCardDef } from '../ecs/types';
import type { UnitManager } from '../ecs/UnitManager';
import { mpService } from '../multiplayer/MultiplayerService';
import { loadBindings } from './SettingsUI';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import avxCoinUrl from '../../assets/avxcoin.webp';

// ─── DOM REFS ──────────────────────────────────────────────────────
const cardContainer = document.getElementById('card-container')!;
const promptContainer = document.getElementById('prompt-container')!;
const manaRow = document.getElementById('mana-row')!;
const laneOverlay = document.getElementById('lane-overlay') as HTMLElement;
const activeEffectsEl = document.getElementById('active-effects')!;
const draftTimerEl = document.getElementById('draft-timer');
const draftCountEl = draftTimerEl?.querySelector('.dt-count') as HTMLElement | null;
const draftLabelEl = draftTimerEl?.querySelector('.dt-label') as HTMLElement | null;
const draftOverlay = document.getElementById('draft-overlay');
const draftPopup = document.getElementById('draft-popup');
const draftCardsEl = document.getElementById('draft-cards');
const draftRerollBtn = document.getElementById('draft-reroll') as HTMLButtonElement | null;
const draftDeckRow = document.getElementById('draft-deck-row');
const draftPopupTitle = document.getElementById('draft-popup-title');

let _laneUm: UnitManager | null = null;
let _draftSelectedCard: PromptCardDef | null = null;
let _pendingCardAnim: Animation | null = null;

// ─── TEAM HELPERS ──────────────────────────────────────────────────
export function playerCardDefs(): CardDef[] {
    const cards = ctx.selectedTeam === 'ice' ? AI_CARDS : CARD_DEFS;
    // Sıra: savaşçılar (orta) → paralı askerler (sağ)
    const fighters = cards.filter(c => c.avxCost === 0);
    const mercs = cards.filter(c => c.avxCost > 0);
    return [...fighters, ...mercs];
}

export function enemyTeam(): 'fire' | 'ice' {
    return ctx.selectedTeam === 'fire' ? 'ice' : 'fire';
}

const FIRE_AI_POOL: UnitType[] = ['korhan', 'erlik', 'od'];
const ICE_AI_POOL: UnitType[] = ['ayaz', 'tulpar', 'umay'];

export function aiPool(): UnitType[] {
    return ctx.selectedTeam === 'fire' ? ICE_AI_POOL : FIRE_AI_POOL;
}

// ─── CARD ANIMATIONS ───────────────────────────────────────────────
export function playCardAnim(el: HTMLElement): void {
    const a = el.dataset.fanAngle ?? '0';
    const y = el.dataset.fanY ?? '0';
    const base = `rotate(${a}deg) translateY(${y}px)`;
    el.animate([
        { transform: base },
        { transform: `rotate(${a}deg) translateY(${parseFloat(y) - 35}px) scale(1.1)` },
        { transform: base },
    ], { duration: 300, easing: 'ease-out' });
}

export function pulseRed(el: HTMLElement): void {
    el.animate([
        { boxShadow: '0 0 0px rgba(255,0,0,0)' },
        { boxShadow: '0 0 24px rgba(255,0,0,0.9), inset 0 0 14px rgba(255,0,0,0.5)' },
        { boxShadow: '0 0 0px rgba(255,0,0,0)' },
    ], { duration: 400 });
}

// ─── MANA / AVX UI ─────────────────────────────────────────────────
export function updateManaUI(): void {
    const filled = Math.min(ctx.playerMana, MAX_MANA);
    let html = '';
    for (let i = 0; i < MAX_MANA; i++) {
        html += `<div class="mana-gem ${i < filled ? 'full' : 'empty'}"></div>`;
    }
    manaRow.innerHTML = html;
    updateCardStates();
}

export function updateAvxUI(): void {
    const el = document.getElementById('avx-counter');
    if (el) el.textContent = String(ctx.playerAvx);
}

export function canAffordCard(card: CardDef): boolean {
    if (card.avxCost > 0) return ctx.playerAvx >= card.avxCost;
    return ctx.playerMana >= card.manaCost;
}

export function updateCardStates(): void {
    playerCardDefs().forEach(card => {
        const el = document.getElementById(`card-${card.id}`) as HTMLElement | null;
        if (!el) return;
        const onCd = (ctx.unitCooldowns[card.id] ?? 0) > 0;
        const canPlay = ctx.phase === 'player' && canAffordCard(card) && !onCd;
        el.classList.toggle('card-disabled', !canPlay);
        el.style.opacity = canPlay ? '1' : '0.4';
        el.style.cursor = canPlay ? 'pointer' : 'not-allowed';
        el.style.filter = canPlay ? '' : 'grayscale(55%) brightness(0.7)';
    });
    updatePromptStates();
}

// ─── BUILD CARD UI ─────────────────────────────────────────────────
export function buildCardUI(um: UnitManager): void {
    cardContainer.innerHTML = '';
    playerCardDefs().forEach((card, idx) => {
        cardContainer.appendChild(createCardEl(card, um, idx));
    });
    applyFanLayout();
}

function createCardEl(card: CardDef, um: UnitManager, idx = 0): HTMLElement {
    const el = document.createElement('div');
    el.className = 'game-card';
    el.id = `card-${card.id}`;
    el.style.borderColor = card.borderColor;
    el.style.boxShadow = `0 0 8px ${card.glowColor}`;
    const isAvx = card.avxCost > 0;
    const costBadge = isAvx
        ? `<div class="card-avx-badge">${card.avxCost}<img src="${avxCoinUrl}" class="avx-icon" alt="AVX"></div>`
        : `<div class="card-mana-badge">${card.manaCost}<span class="mana-icon">◆</span></div>`;
    const hotkey = idx < 4 ? `<div class="card-hotkey">${idx + 1}</div>` : '';
    el.innerHTML = `
        ${costBadge}
        ${hotkey}
        <div class="card-art-zone">
            <img src="${card.imagePath}" alt="${card.name}" />
        </div>
        <div class="card-footer">
            <div class="card-name">${card.name}</div>
            <div class="card-role">${card.role}</div>
            <div class="card-stats-row">
                <span class="stat-hp"><span class="stat-lbl">HP</span>${card.stats.maxHp}</span>
                <span class="stat-atk"><span class="stat-lbl">ATK</span>${card.stats.attack}</span>
                <span class="stat-def"><span class="stat-lbl">DEF</span>${card.stats.armor}</span>
                <span class="stat-spd"><span class="stat-lbl">SPD</span>${card.stats.speed}</span>
            </div>
        </div>
    `;

    el.addEventListener('click', () => {
        if (ctx.phase !== 'player' || !canAffordCard(card) || (ctx.unitCooldowns[card.id] ?? 0) > 0) {
            pulseRed(el); return;
        }
        ctx.pendingCard = card;
        showLaneOverlay(el);
    });

    el.addEventListener('mouseenter', () => {
        if (!el.classList.contains('card-disabled')) {
            el.style.boxShadow = `0 0 28px ${card.glowColor}, 0 4px 18px rgba(0,0,0,0.6)`;
            el.style.transform = 'translateY(-30px) scale(1.08) rotate(0deg)';
            el.style.zIndex = '100';
        }
    });
    el.addEventListener('mouseleave', () => {
        el.style.boxShadow = '';
        if (ctx.pendingCard?.id === card.id) return;
        const a = el.dataset.fanAngle ?? '0';
        const y = el.dataset.fanY ?? '0';
        const z = el.dataset.fanZ ?? '1';
        el.style.transform = `rotate(${a}deg) translateY(${y}px)`;
        el.style.zIndex = z;
    });

    return el;
}

// ─── LANE OVERLAY ──────────────────────────────────────────────────
export function setupLaneOverlay(um: UnitManager): void {
    _laneUm = um;
    document.querySelectorAll('.lane-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const lane = parseInt((e.currentTarget as HTMLElement).dataset.lane ?? '1');
            deployPendingCard(lane);
            highlightCard(null);
        });
        (btn as HTMLElement).addEventListener('mouseenter', () => {
            (btn as HTMLElement).style.transform = 'scale(1.08) translateY(-3px)';
        });
        (btn as HTMLElement).addEventListener('mouseleave', () => {
            (btn as HTMLElement).style.transform = '';
        });
    });
    document.getElementById('lane-cancel')!.addEventListener('click', () => {
        const prev = ctx.pendingCard;
        ctx.pendingCard = null;
        laneOverlay.style.display = 'none';
        cancelPendingCardAnim();
        if (prev) restorePendingCardFan(prev.id);
        highlightCard(null);
    });
}

export function showLaneOverlay(cardEl: HTMLElement): void {
    cancelPendingCardAnim();
    laneOverlay.style.display = 'flex';
    const a = cardEl.dataset.fanAngle ?? '0';
    const y = parseFloat(cardEl.dataset.fanY ?? '0');
    _pendingCardAnim = cardEl.animate([
        { transform: `rotate(${a}deg) translateY(${y - 22}px) scale(1.05)` },
        { transform: `rotate(${a}deg) translateY(${y - 28}px) scale(1.07)` },
        { transform: `rotate(${a}deg) translateY(${y - 22}px) scale(1.05)` },
    ], { duration: 600, iterations: Infinity });
}

function cancelPendingCardAnim(): void {
    if (_pendingCardAnim) {
        _pendingCardAnim.cancel();
        _pendingCardAnim = null;
    }
}

/** Seçili/pending kartı fan pozisyonuna geri döndür */
function restorePendingCardFan(cardId: string): void {
    cancelPendingCardAnim();
    const el = document.getElementById(`card-${cardId}`);
    if (el) {
        const a = el.dataset.fanAngle ?? '0';
        const y = el.dataset.fanY ?? '0';
        const z = el.dataset.fanZ ?? '1';
        el.style.transform = `rotate(${a}deg) translateY(${y}px)`;
        el.style.zIndex = z;
        el.style.boxShadow = '';
        el.style.outline = '';
    }
}

export function deployPendingCard(lane: number): void {
    if (!ctx.pendingCard || !_laneUm) return;
    if (ctx.gameMode === 'multiplayer' && !ctx.mpGameStarted) return;
    const card = ctx.pendingCard;
    ctx.pendingCard = null;
    laneOverlay.style.display = 'none';
    restorePendingCardFan(card.id);

    if (card.avxCost > 0) {
        ctx.playerAvx -= card.avxCost;
        updateAvxUI();
    } else if (!ctx.manaFrozen) {
        ctx.playerMana -= card.manaCost;
    }
    _laneUm.spawnUnit(card.id as UnitType, ctx.selectedTeam, lane);

    if (ctx.gameMode === 'multiplayer') {
        const laneKey = (['left', 'mid', 'right'] as const)[lane] ?? 'mid';
        console.log(`[MP-SYNC] Sending place: ${card.id} lane=${laneKey} myTeam=${ctx.selectedTeam}`);
        mpService.sendPlace(card.id, laneKey);
    }

    ctx.unitCooldowns[card.id] = UNIT_DEPLOY_COOLDOWN;

    const el = document.getElementById(`card-${card.id}`);
    if (el) playCardAnim(el);
    updateManaUI();
    updateCardStates();
}

export function highlightCard(cardId: string | null): void {
    playerCardDefs().forEach(c => {
        const el = document.getElementById(`card-${c.id}`);
        if (!el) return;
        if (c.id === cardId) {
            el.style.outline = '2px solid rgba(255,220,50,0.9)';
            el.style.transform = 'translateY(-20px) scale(1.07) rotate(0deg)';
            el.style.zIndex = '50';
            el.style.boxShadow = `0 0 28px rgba(255,200,0,0.7), 0 4px 18px rgba(0,0,0,0.6)`;
        } else {
            el.style.outline = '';
            const a = el.dataset.fanAngle ?? '0';
            const y = el.dataset.fanY ?? '0';
            const z = el.dataset.fanZ ?? '1';
            el.style.transform = `rotate(${a}deg) translateY(${y}px)`;
            el.style.zIndex = z;
            el.style.boxShadow = '';
        }
    });
}

// ─── PLAYER KEYBOARD SHORTCUTS ─────────────────────────────────────
export function setupPlayerKeyboard(): void {
    window.addEventListener('keydown', (e) => {
        if (ctx._listeningEl) return;
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (ctx.phase !== 'player') return;

        const key = e.key;
        const kl = key.toLowerCase();
        const keybinds = loadBindings();
        const fb = keybinds.fire;

        const cardKeys = [fb.card1, fb.card2, fb.card3, fb.card4, fb.card5, fb.card6];
        const cardIdx = cardKeys.findIndex((k: string) => k.toLowerCase() === kl);
        if (cardIdx !== -1) {
            const cards = playerCardDefs();
            const card = cards[cardIdx];
            if (!card) return;
            const el = document.getElementById(`card-${card.id}`);
            if (!el) return;
            if (!canAffordCard(card) || (ctx.unitCooldowns[card.id] ?? 0) > 0) { pulseRed(el); return; }
            if (ctx.pendingCard?.id === card.id) {
                ctx.pendingCard = null;
                laneOverlay.style.display = 'none';
                cancelPendingCardAnim();
                restorePendingCardFan(card.id);
                highlightCard(null);
                return;
            }
            ctx.pendingCard = card;
            highlightCard(card.id);
            showLaneOverlay(el);
            e.preventDefault();
            return;
        }

        if (ctx.pendingCard) {
            let lane = -1;
            if (kl === fb.laneLeft.toLowerCase()) lane = 0;
            else if (kl === fb.laneMid.toLowerCase()) lane = 1;
            else if (kl === fb.laneRight.toLowerCase()) lane = 2;

            if (lane !== -1) {
                e.preventDefault();
                deployPendingCard(lane);
                highlightCard(null);
                return;
            }
        }

        if (key === fb.cancel && ctx.pendingCard) {
            const prev = ctx.pendingCard;
            ctx.pendingCard = null;
            laneOverlay.style.display = 'none';
            cancelPendingCardAnim();
            restorePendingCardFan(prev.id);
            highlightCard(null);
        }
    });
}

// ─── COOLDOWN SYSTEM ───────────────────────────────────────────────
const UNIT_DEPLOY_COOLDOWN = 4; // seconds

export function startCooldownTicker(): void {
    let lastTime = performance.now();
    function tick(): void {
        const now = performance.now();
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        let anyActive = false;
        for (const id of Object.keys(ctx.skillCooldowns)) {
            if (ctx.skillCooldowns[id] > 0) {
                ctx.skillCooldowns[id] = Math.max(0, ctx.skillCooldowns[id] - dt);
                anyActive = true;
                updateCooldownOverlay(id, ctx.skillCooldowns[id]);
            }
        }
        // Per-card unit deploy cooldown
        for (const id of Object.keys(ctx.unitCooldowns)) {
            if (ctx.unitCooldowns[id] > 0) {
                ctx.unitCooldowns[id] = Math.max(0, ctx.unitCooldowns[id] - dt);
                anyActive = true;
                updateUnitCooldownOverlay(id, ctx.unitCooldowns[id]);
            }
        }
        if (anyActive) { updatePromptStates(); updateCardStates(); }
        ctx.cooldownRAF = requestAnimationFrame(tick);
    }
    ctx.cooldownRAF = requestAnimationFrame(tick);
}

export function resetAllCooldowns(): void {
    for (const id of Object.keys(ctx.skillCooldowns)) {
        ctx.skillCooldowns[id] = 0;
        updateCooldownOverlay(id, 0);
    }
    ctx.unitCooldowns = {};
    playerCardDefs().forEach(card => updateUnitCooldownOverlay(card.id, 0));
}

function updateCooldownOverlay(skillId: string, remaining: number): void {
    const el = document.getElementById(`prompt-${skillId}`);
    if (!el) return;
    let overlay = el.querySelector('.cooldown-overlay') as HTMLElement | null;
    if (remaining <= 0) {
        if (overlay) overlay.remove();
        return;
    }
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'cooldown-overlay';
        overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;border-radius:inherit;pointer-events:none;z-index:5;';
        el.style.position = 'relative';
        el.appendChild(overlay);
    }
    overlay.innerHTML = `<span style="color:#ff6666;font-size:18px;font-weight:bold;text-shadow:0 0 6px #000;">${Math.ceil(remaining)}s</span>`;
}

function updateUnitCooldownOverlay(cardId: string, remaining: number): void {
    const el = document.getElementById(`card-${cardId}`);
    if (!el) return;
    let overlay = el.querySelector('.unit-cooldown-overlay') as HTMLElement | null;
    if (remaining <= 0) {
        if (overlay) overlay.remove();
        return;
    }
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'unit-cooldown-overlay';
        overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;border-radius:inherit;pointer-events:none;z-index:5;';
        el.style.position = 'relative';
        el.appendChild(overlay);
    }
    overlay.innerHTML = `<span style="color:#ffaa44;font-size:16px;font-weight:bold;text-shadow:0 0 6px #000;">${remaining.toFixed(1)}s</span>`;
}

// ─── PROMPT (SKILL) CARD UI ────────────────────────────────────────
export function buildPromptUI(): void {
    promptContainer.innerHTML = '';
    ctx.playerDeck.forEach(def => {
        promptContainer.appendChild(createPromptCardEl(def));
    });
    applyFanLayout();
}

// ─── FAN / YELPAZE LAYOUT ───────────────────────────────────────────
export function applyFanLayout(): void {
    const row = document.getElementById('card-row');
    if (!row) return;

    const divider = row.querySelector('.card-divider') as HTMLElement;
    if (divider) divider.style.display = 'none';

    const pCards = Array.from(promptContainer.querySelectorAll('.prompt-card')) as HTMLElement[];
    const cCards = Array.from(cardContainer.querySelectorAll('.game-card')) as HTMLElement[];
    const allCards = [...pCards, ...cCards];
    const n = allCards.length;
    if (n === 0) return;

    const maxAngle = 15;
    const maxYOffset = 45;
    const overlap = Math.min(50, 20 + n * 2);

    allCards.forEach((card, i) => {
        const center = (n - 1) / 2;
        const norm = n > 1 ? (i - center) / center : 0;
        const angle = norm * maxAngle;
        const yOff = norm * norm * maxYOffset;
        const zIdx = n + 1 - Math.round(Math.abs(norm) * n);

        card.dataset.fanAngle = String(angle);
        card.dataset.fanY = String(yOff);
        card.dataset.fanZ = String(zIdx);

        card.style.transformOrigin = 'bottom center';
        card.style.transform = `rotate(${angle}deg) translateY(${yOff}px)`;
        card.style.zIndex = String(zIdx);

        const isFirst = (pCards.indexOf(card) === 0) || (cCards.indexOf(card) === 0);
        card.style.marginLeft = isFirst ? '0' : `-${overlap}px`;
    });

    // Karakter kartları prompt kartlarıyla bitişik olsun
    if (cCards.length > 0 && pCards.length > 0) {
        cardContainer.style.marginLeft = `-${overlap}px`;
    } else {
        cardContainer.style.marginLeft = '0';
    }
}

function createPromptCardEl(def: PromptCardDef): HTMLElement {
    const cardName = def.nameKey ? t(def.nameKey as any) : def.name;
    const cardDesc = def.descKey ? t(def.descKey as any) : def.description;
    const el = document.createElement('div');
    el.className = 'prompt-card';
    el.id = `prompt-${def.id}`;
    const costHtml = def.avxCost
        ? `<div class="prompt-card-cost avx-cost">${def.avxCost}<img src="${avxCoinUrl}" class="avx-icon" alt="AVX" style="width:10px;height:10px;vertical-align:middle;margin-left:1px;"></div>`
        : `<div class="prompt-card-cost">${def.manaCost > 0 ? def.manaCost : ''}</div>`;
    el.innerHTML = `
        ${costHtml}
        <div class="prompt-card-icon"><img src="${def.imagePath}" alt="${cardName}" /></div>
        <div class="prompt-card-footer">
            <div class="prompt-card-name">${cardName}</div>
        </div>
    `;
    el.title = cardDesc;

    el.addEventListener('click', () => {
        if (ctx.gameMode === 'multiplayer' && !ctx.mpGameStarted) { pulseRed(el); return; }
        if (ctx.phase !== 'player') { pulseRed(el); return; }

        // Tower kart özel akışı
        if (def.effectType === 'tower_place') {
            if (ctx.playerAvx < (def.avxCost ?? 5)) { pulseRed(el); return; }
            if (!ctx.spawnTower?.()) { pulseRed(el); return; }
            ctx.playerAvx -= (def.avxCost ?? 5);
            updateAvxUI();
            updatePromptStates();
            playCardAnim(el);
            return;
        }

        // Flower kart özel akışı
        if (def.effectType === 'flower_place') {
            if (ctx.playerAvx < (def.avxCost ?? 3)) { pulseRed(el); return; }
            if (!ctx.spawnFlower?.()) { pulseRed(el); return; }
            ctx.playerAvx -= (def.avxCost ?? 3);
            updateAvxUI();
            updatePromptStates();
            playCardAnim(el);
            return;
        }

        // Tree kart özel akışı: dikili agac < 2 ise dik, yoksa upgrade dene
        if (def.effectType === 'tree_place') {
            if (!ctx.spawnTree) { pulseRed(el); return; }
            // Mana ağacı AVX ile, AVX ağacı mana ile dikilir
            const isManaTree = ctx.selectedTreeType === 'mana';
            const canAfford = isManaTree
                ? ctx.playerAvx >= TREE_PLANT_COST
                : ctx.playerMana >= TREE_PLANT_COST;
            if (canAfford && ctx.spawnTree()) {
                if (isManaTree) {
                    ctx.playerAvx -= TREE_PLANT_COST;
                } else {
                    ctx.playerMana -= TREE_PLANT_COST;
                }
            } else if (ctx.upgradeTree?.(0) || ctx.upgradeTree?.(1)) {
                // Slot doluysa upgrade dene
            } else {
                pulseRed(el); return;
            }
            updateAvxUI();
            updateManaUI();
            updatePromptStates();
            playCardAnim(el);
            return;
        }

        if (ctx.playerMana < def.manaCost) { pulseRed(el); return; }
        if ((ctx.skillCooldowns[def.id] ?? 0) > 0) { pulseRed(el); return; }

        applyPromptEffect(def);
        if (!ctx.manaFrozen) ctx.playerMana -= def.manaCost;
        ctx.skillCooldowns[def.id] = def.cooldown;
        if (ctx.gameMode === 'multiplayer') {
            mpService.sendPrompt(def.id);
        }
        clearPromptSelections();
        updateManaUI();
        updatePromptStates();
        playCardAnim(el);
    });

    el.addEventListener('mouseenter', () => {
        if (!el.classList.contains('card-disabled')) {
            el.style.transform = 'translateY(-30px) scale(1.08) rotate(0deg)';
            el.style.zIndex = '100';
            el.style.boxShadow = '0 0 28px rgba(160, 80, 255, 0.65), 0 12px 28px rgba(0, 0, 0, 0.7)';
        }
    });
    el.addEventListener('mouseleave', () => {
        const a = el.dataset.fanAngle ?? '0';
        const y = el.dataset.fanY ?? '0';
        const z = el.dataset.fanZ ?? '1';
        el.style.transform = `rotate(${a}deg) translateY(${y}px)`;
        el.style.zIndex = z;
        el.style.boxShadow = '';
    });

    return el;
}

function clearPromptSelections(): void {
    document.querySelectorAll('.prompt-card').forEach(el => el.classList.remove('selected'));
}

export function updatePromptStates(): void {
    ctx.playerDeck.forEach(def => {
        const el = document.getElementById(`prompt-${def.id}`);
        if (!el) return;

        let canPlay = ctx.phase === 'player';
        if (def.effectType === 'tower_place') {
            // tower kart: AVX yeterli mi + slot boş mu
            const hasAvx = ctx.playerAvx >= (def.avxCost ?? 5);
            const hasSlot = !!ctx.spawnTower;
            canPlay = canPlay && hasAvx && hasSlot;
        } else if (def.effectType === 'flower_place') {
            const hasAvx = ctx.playerAvx >= (def.avxCost ?? 3);
            const hasSlot = !!ctx.spawnFlower;
            canPlay = canPlay && hasAvx && hasSlot;
        } else if (def.effectType === 'tree_place') {
            const isManaTree = ctx.selectedTreeType === 'mana';
            const hasResource = isManaTree
                ? ctx.playerAvx >= TREE_PLANT_COST
                : ctx.playerMana >= TREE_PLANT_COST;
            const hasSlot = !!ctx.spawnTree;
            canPlay = canPlay && hasResource && hasSlot;
        } else {
            const onCooldown = (ctx.skillCooldowns[def.id] ?? 0) > 0;
            const isRecallUsed = def.effectType === 'recall' && ctx.recallUsed;
            canPlay = canPlay && ctx.playerMana >= def.manaCost && !onCooldown && !isRecallUsed;
        }

        el.classList.toggle('card-disabled', !canPlay);
        el.style.opacity = canPlay ? '1' : '0.4';
        el.style.cursor = canPlay ? 'pointer' : 'not-allowed';
    });
}

// ─── ACTIVE EFFECT BAR ─────────────────────────────────────────────
const EFFECT_DISPLAY: Record<string, { labelKey: string; color: string }> = {
    mana_fill: { labelKey: 'manaFill', color: '#aaff55' },
    mana_freeze: { labelKey: 'manaFreeze', color: '#55ccff' },
    ouroboros: { labelKey: 'ouroboros', color: '#cc55ff' },
    autocollect: { labelKey: 'autoCollect', color: '#ffcc00' },
    bancollect: { labelKey: 'banCollect', color: '#ff4444' },
    healthome: { labelKey: 'healHome', color: '#55ff88' },
    recall: { labelKey: 'recall', color: '#4488ff' },
    unlucky: { labelKey: 'unlucky', color: '#ffaa00' },
};

function showActiveEffect(def: PromptCardDef): void {
    const displaySec = def.duration > 0 ? def.duration : 3;
    const info = EFFECT_DISPLAY[def.effectType];
    const color = info?.color ?? '#cc99ff';

    const entry = document.createElement('div');
    entry.className = 'effect-entry';
    const eName = def.nameKey ? t(def.nameKey as any) : def.name;
    const eDesc = def.descKey ? t(def.descKey as any) : def.description;
    entry.innerHTML = `
        <div class="effect-name" style="color:${color}">${eName}</div>
        <div class="effect-desc">${eDesc}</div>
        <div class="effect-timer-track">
            <div class="effect-timer-fill" style="background:linear-gradient(90deg,${color}88,${color});width:100%"></div>
        </div>
    `;
    activeEffectsEl.appendChild(entry);

    const fill = entry.querySelector<HTMLElement>('.effect-timer-fill')!;
    const startTime = performance.now();
    const totalMs = displaySec * 1000;

    function tick(): void {
        const elapsed = performance.now() - startTime;
        const pct = Math.max(0, 1 - elapsed / totalMs);
        fill.style.width = `${pct * 100}%`;
        if (pct > 0) {
            requestAnimationFrame(tick);
        } else {
            entry.classList.add('fading');
            setTimeout(() => entry.remove(), 350);
        }
    }
    requestAnimationFrame(tick);
}

// ─── PROMPT EFFECTS ────────────────────────────────────────────────
import { worldToScreen } from '../game/AvxCoinSystem';

export function applyPromptEffect(def: PromptCardDef, forTeam?: 'fire' | 'ice'): void {
    showActiveEffect(def);
    const um = ctx._um;
    if (!um) return;
    const playerTeam = forTeam ?? ctx.selectedTeam;
    const enemySide = playerTeam === 'fire' ? 'ice' : 'fire';

    switch (def.effectType) {
        case 'mana_fill':
            ctx.playerMana = MAX_MANA;
            updateManaUI();
            break;

        case 'mana_freeze':
            ctx.manaFrozen = true;
            ctx.manaFreezeTimer = def.duration;
            setTimeout(() => { ctx.manaFrozen = false; }, def.duration * 1000);
            break;

        case 'ouroboros': {
            const enemies = um.units.filter(u => u.team === enemySide && u.state !== 'dead');
            if (enemies.length === 0) break;
            ctx.ouroborosMode = true;
            showEnemyPicker(enemies, um, playerTeam);
            break;
        }

        case 'autocollect':
            if (ctx.autoCollectTimer) clearTimeout(ctx.autoCollectTimer);
            ctx.autoCollectActive = true;
            ctx.autoCollectTimer = setTimeout(() => { ctx.autoCollectActive = false; }, def.duration * 1000);
            break;

        case 'bancollect':
            if (ctx.banCollectTimer) clearTimeout(ctx.banCollectTimer);
            ctx.banCollectActive = true;
            ctx.banCollectTimer = setTimeout(() => { ctx.banCollectActive = false; }, def.duration * 1000);
            break;

        case 'healthome': {
            if (ctx.healHomeInterval) clearInterval(ctx.healHomeInterval);
            const base = playerTeam === 'fire' ? ctx._fireBase : ctx._iceBase;
            if (!base) break;
            let ticks = 0;
            ctx.healHomeInterval = setInterval(() => {
                ticks++;
                if (base) base.hp = Math.min(base.maxHp, base.hp + 75);
                if (ticks >= 6) { clearInterval(ctx.healHomeInterval!); ctx.healHomeInterval = null; }
            }, 5000);
            break;
        }

        case 'recall': {
            ctx.recallUsed = true;
            const allies = um.units.filter(u => u.team === playerTeam && u.state !== 'dead');
            if (allies.length === 0) break;
            const baseX = 0;
            const baseZ = playerTeam === 'fire' ? -11 : 11;
            allies.forEach(u => {
                u.mesh.position.x = baseX + (Math.random() - 0.5) * 4;
                u.mesh.position.z = baseZ + (Math.random() - 0.5) * 2;
            });
            showRecallLanePicker(allies, um, playerTeam);
            break;
        }

        case 'unlucky': {
            if (ctx.unluckyInterval) clearInterval(ctx.unluckyInterval);
            let uTicks = 0;
            ctx.unluckyInterval = setInterval(() => {
                uTicks++;
                if (!ctx._um) { clearInterval(ctx.unluckyInterval!); ctx.unluckyInterval = null; return; }
                const enemies = ctx._um.units.filter(u => u.team === enemySide && u.state !== 'dead');
                if (enemies.length > 0) {
                    const count = Math.min(2, enemies.length);
                    for (let i = 0; i < count; i++) {
                        const target = enemies[Math.floor(Math.random() * enemies.length)];
                        const dmg = 25 + Math.random() * 15;
                        target.hp -= dmg;
                        showLightningVFX(target.mesh.position);
                    }
                }
                if (uTicks >= 15) { clearInterval(ctx.unluckyInterval!); ctx.unluckyInterval = null; }
            }, 2000);
            break;
        }
    }
}

function showEnemyPicker(enemies: import('../ecs/Unit').Unit[], um: UnitManager, playerTeam: 'fire' | 'ice'): void {
    // Harita üzerinden düşman seçme modu
    const banner = document.createElement('div');
    banner.id = 'ouroboros-banner';
    banner.style.cssText = `
        position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:9999;
        background:rgba(10,5,20,0.95);border:2px solid rgba(204,85,255,0.6);
        border-radius:12px;padding:12px 28px;
        display:flex;align-items:center;gap:14px;
        box-shadow:0 0 40px rgba(204,85,255,0.2);
        animation:fadeUp 0.3s ease;
    `;
    banner.innerHTML = `
        <span style="font-size:20px;">&#9866;</span>
        <span style="font-family:'Cinzel',serif;font-size:13px;color:#cc55ff;letter-spacing:1.5px;font-weight:700;">${t('ouroborosTitle' as any)}</span>
        <button id="ouroboros-cancel" style="padding:6px 14px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:rgba(255,255,255,0.5);font-size:10px;cursor:pointer;letter-spacing:1px;">${t('cancel' as any)}</button>
    `;
    document.body.appendChild(banner);

    // Düşman birimlerini highlight et (mor glow)
    const highlights = new Map<import('../ecs/Unit').Unit, any[]>();
    for (const enemy of enemies) {
        const origColors: any[] = [];
        enemy.mesh.getChildMeshes().forEach(c => {
            if (c.material && 'emissiveColor' in c.material) {
                origColors.push({ mesh: c, color: (c.material as any).emissiveColor?.clone?.() || null });
                (c.material as any).emissiveColor = { r: 0.5, g: 0.1, b: 0.7 };
            }
        });
        highlights.set(enemy, origColors);
    }

    const canvas = ctx._engine?.getRenderingCanvas();
    if (!canvas) { cleanup(false); return; }

    function cleanup(used: boolean) {
        canvas?.removeEventListener('pointerdown', onPick);
        banner.remove();
        // Glow'ları geri al
        for (const [enemy, origColors] of highlights) {
            if (enemy.state === 'dead') continue;
            for (const oc of origColors) {
                if (oc.color && oc.mesh.material && 'emissiveColor' in oc.mesh.material) {
                    (oc.mesh.material as any).emissiveColor = oc.color;
                }
            }
        }
        if (!used) {
            ctx.ouroborosMode = false;
            ctx.playerMana += 5; // iptal edince manayı geri ver
        }
    }

    function onPick(evt: PointerEvent) {
        const scene = ctx._scene;
        if (!scene) return;
        const pickResult = scene.pick(evt.offsetX, evt.offsetY);
        if (!pickResult?.hit || !pickResult.pickedMesh) return;

        // Tıklanan mesh'in hangi düşman birime ait olduğunu bul
        for (const enemy of enemies) {
            if (enemy.state === 'dead') continue;
            const isMatch = enemy.mesh === pickResult.pickedMesh
                || enemy.mesh.getChildMeshes().includes(pickResult.pickedMesh as any);
            if (isMatch) {
                um.convertUnit(enemy, playerTeam);
                ctx.ouroborosMode = false;
                cleanup(true);
                return;
            }
        }
    }

    canvas.addEventListener('pointerdown', onPick);

    document.getElementById('ouroboros-cancel')!.onclick = () => cleanup(false);
}

function showRecallLanePicker(allies: import('../ecs/Unit').Unit[], um: UnitManager, team: 'fire' | 'ice'): void {
    let overlay = document.getElementById('recall-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'recall-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div style="color:#4488ff;font-size:22px;font-weight:bold;margin-bottom:8px;">${t('draftLanePick' as any)}</div>`;
    const lanes = [
        { label: t('laneLeft' as any), lane: 0 },
        { label: t('laneMid' as any), lane: 1 },
        { label: t('laneRight' as any), lane: 2 },
    ];
    for (const l of lanes) {
        const btn = document.createElement('button');
        btn.style.cssText = 'padding:10px 32px;font-size:16px;background:#1a1a2e;color:#fff;border:2px solid #4488ff;border-radius:8px;cursor:pointer;min-width:140px;';
        btn.textContent = l.label;
        btn.addEventListener('click', () => {
            const path = um.buildLanePath(0, 24, l.lane, team);
            allies.forEach(u => {
                u.pathQueue = path.map(n => new Vector3(n.x, u.baseY, n.z));
                u.targetUnit = null;
                (u.abilityState as any)._cachedEnemy = null;
                (u.abilityState as any)._enemyLockTimer = 0;
                u.state = 'walking';
            });
            overlay!.remove();
        });
        overlay.appendChild(btn);
    }
}

/** Yıldırım VFX — canvas-based (şeffaf, pozisyon düzeltildi) */
export function showLightningAt(cx: number, cy: number): void {
    const boltH = 250;
    const boltW = 72;

    // Zigzag path — bir kez oluştur, stable
    const pts: [number, number][] = [[boltW / 2 + (Math.random() - 0.5) * 8, 0]];
    for (let i = 1; i <= 7; i++) {
        pts.push([boltW / 2 + (Math.random() - 0.5) * 28, (i / 8) * boltH]);
    }
    pts.push([boltW / 2, boltH]);

    // Canvas bolt (şeffaf arka plan)
    const cvs = document.createElement('canvas');
    cvs.width = boltW;
    cvs.height = boltH;
    // cy + 15 = birim ayaklarında; bolt yukarıdan aşağı oraya iniyor
    cvs.style.cssText = `position:fixed;left:${cx - boltW / 2}px;top:${cy - boltH + 15}px;z-index:8000;pointer-events:none;`;
    document.body.appendChild(cvs);
    const c = cvs.getContext('2d')!;

    // Çarpa parlaması — birim ayaklarında
    const fs = 110;
    const flare = document.createElement('div');
    flare.style.cssText = `
        position:fixed;width:${fs}px;height:${fs * 0.5}px;
        left:${cx - fs / 2}px;top:${cy - fs * 0.25 + 15}px;
        border-radius:50%;pointer-events:none;z-index:8001;
        background:radial-gradient(ellipse,#fff 0%,rgba(140,180,255,.95) 18%,rgba(80,120,255,.4) 50%,transparent 70%);
        filter:blur(2px);
    `;
    document.body.appendChild(flare);

    // İlk kare: flash beyaz çizgi (anlık parlama)
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.shadowBlur = 30; c.shadowColor = '#fff';
    c.strokeStyle = '#fff'; c.lineWidth = 4; c.lineJoin = 'round'; c.stroke();

    let elapsed = 0;
    const tick = setInterval(() => {
        elapsed += 16;
        const t = Math.min(elapsed / 480, 1);
        const a = Math.max(0, 1 - t * 1.4);

        c.clearRect(0, 0, boltW, boltH);
        if (a > 0) {
            c.beginPath();
            c.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
            // Dış parıltı
            c.shadowBlur = 22; c.shadowColor = `rgba(100,150,255,${a})`;
            c.strokeStyle = `rgba(160,200,255,${a * 0.55})`; c.lineWidth = 8; c.lineJoin = 'round'; c.stroke();
            // Orta
            c.shadowBlur = 7; c.strokeStyle = `rgba(220,235,255,${a * 0.9})`; c.lineWidth = 2.5; c.stroke();
            // Çekirdek beyaz
            c.shadowColor = '#fff'; c.shadowBlur = 3;
            c.strokeStyle = `rgba(255,255,255,${a})`; c.lineWidth = 1.2; c.stroke();
        }
        flare.style.opacity = String(Math.max(0, 1 - t));
        flare.style.transform = `scale(${1 + t * 0.9})`;
        if (t >= 1) { clearInterval(tick); cvs.remove(); flare.remove(); }
    }, 16);
}

function showLightningVFX(pos: import('@babylonjs/core').Vector3): void {
    const s = worldToScreen(pos);
    if (!s) return;
    showLightningAt(s.x, s.y);
}

// ─── DRAFT SYSTEM ──────────────────────────────────────────────────
export function initDraft(): void {
    ctx.playerDeck = [];
    ctx.draftTimer = 45;
    ctx.draftPopupOpen = false;
    ctx.recallUsed = false;

    // Çiçek kartı oyunun başından itibaren mevcut
    ctx.playerDeck.push(getFlowerCard(ctx.selectedTeam));

    // Agac kartı (secilen tipe göre)
    if (ctx.selectedTreeType) {
        ctx.playerDeck.push(getTreeCard(ctx.selectedTreeType));
    }

    const pool = [...PROMPT_DEFS];
    for (let i = 0; i < 2; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        ctx.playerDeck.push(pool.splice(idx, 1)[0]);
    }

    buildPromptUI();
    if (draftTimerEl) draftTimerEl.style.display = 'flex';
    if (draftLabelEl) draftLabelEl.textContent = t('nextDraft' as any);
    if (draftCountEl) draftCountEl.textContent = '45';
}

export function tickDraft(dt: number): void {
    if (ctx.draftPopupOpen) return;
    const skillCount = ctx.playerDeck.filter(d => d.effectType !== 'tower_place' && d.effectType !== 'flower_place' && d.effectType !== 'tree_place').length;
    if (skillCount >= 6 && getAvailableDraftCards().length === 0) {
        if (draftTimerEl) draftTimerEl.style.display = 'none';
        return;
    }
    ctx.draftTimer -= dt;
    if (draftCountEl) draftCountEl.textContent = String(Math.max(0, Math.ceil(ctx.draftTimer)));
    if (ctx.draftTimer <= 0) {
        // İlk draft'ta tower kartını otomatik ekle
        if (!ctx.towerCardAdded) {
            const towerCard = getTowerCard(ctx.selectedTeam);
            ctx.playerDeck.push(towerCard);
            ctx.towerCardAdded = true;
            buildPromptUI();
        }
        openDraftPopup();
    }
}

function getAvailableDraftCards(): PromptCardDef[] {
    const deckIds = new Set(ctx.playerDeck.map(d => d.id));
    return PROMPT_DEFS.filter(d => !deckIds.has(d.id));
}

function openDraftPopup(): void {
    if (!draftOverlay || !draftCardsEl) return;
    ctx.draftPopupOpen = true;
    const available = getAvailableDraftCards();
    if (available.length === 0) { ctx.draftPopupOpen = false; return; }

    const shuffled = [...available].sort(() => Math.random() - 0.5);
    let offered = shuffled.slice(0, Math.min(2, shuffled.length));

    const skillCardCount = ctx.playerDeck.filter(d => d.effectType !== 'tower_place' && d.effectType !== 'flower_place' && d.effectType !== 'tree_place').length;
    const isSwapMode = skillCardCount >= 6;
    if (draftPopupTitle) draftPopupTitle.textContent = isSwapMode ? t('draftSwapTitle' as any) : t('draftTitle' as any);

    renderDraftCards(offered, isSwapMode);

    if (draftRerollBtn) {
        draftRerollBtn.textContent = t('draftReroll' as any);
        draftRerollBtn.disabled = ctx.playerAvx < 10;
        draftRerollBtn.onclick = () => {
            if (ctx.playerAvx < 10) return;
            ctx.playerAvx -= 10;
            updateAvxUI();
            const newAvailable = getAvailableDraftCards();
            const newShuffled = [...newAvailable].sort(() => Math.random() - 0.5);
            offered = newShuffled.slice(0, Math.min(2, newShuffled.length));
            renderDraftCards(offered, isSwapMode);
            if (draftRerollBtn) draftRerollBtn.disabled = ctx.playerAvx < 10;
        };
    }

    draftOverlay.style.display = 'flex';
}

function renderDraftCards(offered: PromptCardDef[], swapMode: boolean): void {
    if (!draftCardsEl) return;
    draftCardsEl.innerHTML = '';
    _draftSelectedCard = null;
    if (draftDeckRow) { draftDeckRow.style.display = 'none'; draftDeckRow.innerHTML = ''; }

    for (const card of offered) {
        const cardName = card.nameKey ? t(card.nameKey as any) : card.name;
        const cardDesc = card.descKey ? t(card.descKey as any) : card.description;
        const el = document.createElement('div');
        el.className = 'draft-card';
        el.innerHTML = `
            <div class="draft-card-img"><img src="${card.imagePath}" alt="${cardName}" /></div>
            <div class="draft-card-info">
                <div class="dc-name">${cardName}</div>
                <div class="dc-desc">${cardDesc}</div>
            </div>
        `;
        el.addEventListener('click', () => {
            if (!swapMode) {
                ctx.playerDeck.push(card);
                closeDraftPopup();
            } else {
                _draftSelectedCard = card;
                draftCardsEl?.querySelectorAll('.draft-card').forEach(c => c.classList.remove('selected'));
                el.classList.add('selected');
                showDeckForSwap(card);
            }
        });
        draftCardsEl?.appendChild(el);
    }
}

function showDeckForSwap(newCard: PromptCardDef): void {
    if (!draftDeckRow) return;
    draftDeckRow.innerHTML = '';
    draftDeckRow.style.display = 'flex';
    // Tower ve flower kartları değiştirilemez (sabit)
    const swappable = ctx.playerDeck.filter(d => d.effectType !== 'tower_place' && d.effectType !== 'flower_place' && d.effectType !== 'tree_place');
    for (const deckCard of swappable) {
        const cardName = deckCard.nameKey ? t(deckCard.nameKey as any) : deckCard.name;
        const el = document.createElement('div');
        el.className = 'draft-deck-card';
        el.innerHTML = `<img src="${deckCard.imagePath}" alt="${cardName}" /><span>${cardName}</span>`;
        el.addEventListener('click', () => {
            const idx = ctx.playerDeck.indexOf(deckCard);
            if (idx !== -1) ctx.playerDeck.splice(idx, 1);
            ctx.playerDeck.push(newCard);
            closeDraftPopup();
        });
        draftDeckRow.appendChild(el);
    }
}

function closeDraftPopup(): void {
    ctx.draftPopupOpen = false;
    if (draftOverlay) draftOverlay.style.display = 'none';
    ctx.draftTimer = 45;
    _draftSelectedCard = null;
    buildPromptUI();
    updatePromptStates();
}

export function cleanupDraft(): void {
    ctx.playerDeck = [];
    ctx.draftTimer = 45;
    ctx.draftPopupOpen = false;
    ctx.recallUsed = false;
    if (ctx.healHomeInterval) { clearInterval(ctx.healHomeInterval); ctx.healHomeInterval = null; }
    if (ctx.unluckyInterval) { clearInterval(ctx.unluckyInterval); ctx.unluckyInterval = null; }
    ctx._fireBase = null;
    ctx._iceBase = null;
    if (draftTimerEl) draftTimerEl.style.display = 'none';
    if (draftOverlay) draftOverlay.style.display = 'none';
}

// ─── BORU SPIRIT WOLF CARD UI ──────────────────────────────────────
const activeBoruCards: HTMLElement[] = [];

export function showBoruCard(spirit: 'good' | 'bad', boruTeam: 'fire' | 'ice', _triggerTeam: 'fire' | 'ice'): void {
    const isGood = spirit === 'good';
    const spiritLabel = isGood ? t('boruGoodSpirit' as any) : t('boruBadSpirit' as any);
    const spiritColor = isGood ? '#55ff88' : '#ff4444';
    const borderColor = isGood ? '#22aa44' : '#aa2222';
    const glowColor = isGood ? 'rgba(85,255,136,0.5)' : 'rgba(255,68,68,0.5)';
    const teamLabel = boruTeam === 'fire' ? t('fire') : t('ice');
    const teamColor = boruTeam === 'fire' ? '#ff6600' : '#4488ff';
    const teamSuffix = t('boruTeamSuffix' as any);

    const card = document.createElement('div');
    card.className = 'boru-spirit-card';
    card.style.cssText = `
        position: fixed;
        left: 12px;
        top: ${180 + activeBoruCards.length * 130}px;
        width: 120px;
        background: rgba(15,10,25,0.92);
        border: 2px solid ${borderColor};
        border-radius: 10px;
        padding: 8px;
        z-index: 800;
        box-shadow: 0 0 16px ${glowColor}, 0 4px 12px rgba(0,0,0,0.6);
        transition: opacity 0.4s ease, transform 0.3s ease;
        pointer-events: none;
    `;
    card.innerHTML = `
        <div style="text-align:center;">
            <img src="/assets/images/characters/boru.webp" alt="Boru"
                 style="width:70px;height:70px;object-fit:contain;filter:drop-shadow(0 0 6px ${spiritColor});" />
        </div>
        <div style="text-align:center;margin-top:4px;">
            <div style="font-size:11px;font-weight:700;color:${spiritColor};text-shadow:0 0 6px ${glowColor};letter-spacing:0.5px;">
                ${spiritLabel}
            </div>
            <div style="font-size:9px;color:${teamColor};margin-top:2px;">
                → ${teamLabel} ${teamSuffix}
            </div>
        </div>
    `;

    document.body.appendChild(card);
    activeBoruCards.push(card);

    card.style.transform = 'translateX(-50px)';
    card.style.opacity = '0';
    requestAnimationFrame(() => {
        card.style.transform = 'translateX(0)';
        card.style.opacity = '1';
    });

    if (ctx._um) {
        const checkDeath = setInterval(() => {
            if (!ctx._um) { clearInterval(checkDeath); return; }
            const boruAlive = ctx._um.units.some(u => u.type === 'boru' && u.team === boruTeam && u.state !== 'dead');
            if (!boruAlive) {
                clearInterval(checkDeath);
                card.style.opacity = '0';
                card.style.transform = 'translateX(-50px)';
                setTimeout(() => {
                    card.remove();
                    const idx = activeBoruCards.indexOf(card);
                    if (idx >= 0) activeBoruCards.splice(idx, 1);
                    activeBoruCards.forEach((c, i) => {
                        c.style.top = `${180 + i * 130}px`;
                    });
                }, 400);
            }
        }, 500);
    }
}
