/**
 * TwoPlayerSetup.ts — 2P card UI, ice player keyboard handling.
 */

import { ctx, MAX_MANA } from './GameContext';
import { CARD_DEFS, AI_CARDS, CardDef, UnitType } from '../ecs/Unit';
import { t } from '../i18n';
import { pulseRed } from '../ui/CardUI';
import { loadBindings } from '../ui/SettingsUI';
import type { UnitManager } from '../ecs/UnitManager';
import avxCoinUrl from '../../assets/avxcoin.webp';

// P2 always gets the opposite team of P1
function getP2Cards(): CardDef[] {
    return ctx.selectedTeam === 'fire' ? AI_CARDS : CARD_DEFS;
}

function getP2Team(): 'fire' | 'ice' {
    return ctx.selectedTeam === 'fire' ? 'ice' : 'fire';
}

export function setup2Player(um: UnitManager): void {
    const iceTray = document.getElementById('ice-card-tray')!;
    iceTray.style.display = 'flex';
    buildIceCardUI(um);
    window.addEventListener('keydown', (e) => handleIceKeyboard(e, um));
}

function buildIceCardUI(um: UnitManager): void {
    const cont = document.getElementById('ice-card-container')!;
    cont.innerHTML = '';

    getP2Cards().forEach((card, idx) => {
        const el = document.createElement('div');
        el.className = 'game-card';
        el.id = `ice-card-${card.id}`;
        el.style.cssText = `border-color:${card.borderColor};height:130px;`;
        el.innerHTML = `
            ${card.avxCost > 0
                ? `<div class="card-avx-badge">${card.avxCost}<img src="${avxCoinUrl}" class="avx-icon" alt="AVX"></div>`
                : `<div class="card-mana-badge" style="background:radial-gradient(circle at 40% 35%,#2288ff,#004499)">${card.manaCost}<span class="mana-icon">◆</span></div>`}
            <div style="color:#aaddff;font-size:11px;font-weight:700;position:absolute;top:8px;right:8px;">[${idx + 1}]</div>
            <div class="card-art-zone" style="flex:0 0 72px"><img src="${card.imagePath}" alt="${card.name}" /></div>
            <div class="card-footer">
                <div class="card-name">${card.name}</div>
                <div class="card-stats-row">
                    <span class="stat-hp"><span class="stat-lbl">HP</span>${card.stats.maxHp}</span>
                    <span class="stat-atk"><span class="stat-lbl">ATK</span>${card.stats.attack}</span>
                    <span class="stat-def"><span class="stat-lbl">DEF</span>${card.stats.armor}</span>
                    <span class="stat-spd"><span class="stat-lbl">SPD</span>${card.stats.speed}</span>
                </div>
            </div>
        `;
        el.addEventListener('click', () => selectIceCard(card.id as UnitType, el));
        cont.appendChild(el);
    });

    const readyBtn = document.getElementById('ice-ready-btn');
    if (readyBtn) readyBtn.style.display = 'none';

    const iceArea = document.getElementById('ice-card-area')!;
    const iceManaDiv = document.createElement('div');
    iceManaDiv.id = 'ice-mana-row';
    iceManaDiv.style.cssText = 'display:flex;gap:3px;align-items:center;padding:0 6px;';
    iceArea.appendChild(iceManaDiv);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:9px;color:rgba(150,200,255,0.3);letter-spacing:0.5px;margin-left:10px;align-self:center;white-space:nowrap;';
    hint.textContent = t('cardHint');
    iceArea.appendChild(hint);

    updateIceManaUI();
}

function canAffordIceCard(card: CardDef): boolean {
    if (card.avxCost > 0) return ctx.iceAvx >= card.avxCost;
    return ctx.iceMana >= card.manaCost;
}

function selectIceCard(cardId: UnitType, el: HTMLElement): void {
    const card = CARD_DEFS.find(c => c.id === cardId);
    if (!card || !canAffordIceCard(card)) { pulseRed(el); return; }

    const same = ctx.selectedIceCardId === cardId;
    clearIceSelection();
    if (!same) {
        ctx.selectedIceCardId = cardId;
        el.style.outline = '2px solid rgba(80,180,255,0.9)';
        el.style.transform = 'translateY(-10px) scale(1.06)';
        el.style.boxShadow = '0 0 28px rgba(40,150,255,0.7)';
    }
}

function clearIceSelection(): void {
    ctx.selectedIceCardId = null;
    document.querySelectorAll<HTMLElement>('[id^="ice-card-"]').forEach(c => {
        c.style.outline = '';
        c.style.transform = '';
        c.style.boxShadow = '';
    });
}

export function updateIceManaUI(): void {
    const row = document.getElementById('ice-mana-row');
    if (!row) return;
    let html = '';
    for (let i = 0; i < MAX_MANA; i++) {
        if (i < ctx.iceMana)
            html += `<div class="mana-gem" style="background:#2288ff;box-shadow:0 0 6px rgba(40,150,255,0.9)"></div>`;
        else
            html += `<div class="mana-gem empty"></div>`;
    }
    row.innerHTML = html;

    getP2Cards().forEach(card => {
        const el = document.getElementById(`ice-card-${card.id}`) as HTMLElement | null;
        if (!el) return;
        const canPlay = canAffordIceCard(card);
        el.classList.toggle('card-disabled', !canPlay);
        el.style.opacity = canPlay ? '1' : '0.4';
        el.style.filter = canPlay ? '' : 'grayscale(50%) brightness(0.7)';
    });
}

function handleIceKeyboard(e: KeyboardEvent, um: UnitManager): void {
    if (ctx._listeningEl) return;

    const key = e.key;
    const kl = key.toLowerCase();
    const keybinds = loadBindings();
    const ib = keybinds.ice;

    const p2Cards = getP2Cards();
    const cardKeys = [ib.card1, ib.card2, ib.card3, ib.card4, ib.card5, ib.card6];
    const cardIdx = cardKeys.findIndex(k => k.toLowerCase() === kl);
    if (cardIdx !== -1 && cardIdx < p2Cards.length) {
        const card = p2Cards[cardIdx];
        const el = document.getElementById(`ice-card-${card.id}`) as HTMLElement;
        if (el) selectIceCard(card.id as UnitType, el);
        return;
    }

    let lane = -1;
    if (kl === ib.laneLeft.toLowerCase()) lane = 0;
    else if (kl === ib.laneMid.toLowerCase()) lane = 1;
    else if (kl === ib.laneRight.toLowerCase()) lane = 2;

    if (lane !== -1 && ctx.selectedIceCardId) {
        e.preventDefault();
        const card = CARD_DEFS.find(c => c.id === ctx.selectedIceCardId);
        if (!card) return;
        if (!canAffordIceCard(card)) {
            const el = document.getElementById(`ice-card-${card.id}`) as HTMLElement | null;
            if (el) pulseRed(el);
            return;
        }
        if (card.avxCost > 0) {
            ctx.iceAvx -= card.avxCost;
        } else {
            ctx.iceMana -= card.manaCost;
        }
        um.spawnUnit(ctx.selectedIceCardId, getP2Team(), lane);
        clearIceSelection();
        updateIceManaUI();
    }

    if (key === ib.cancel) clearIceSelection();
}
