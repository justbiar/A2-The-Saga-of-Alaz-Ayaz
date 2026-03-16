/**
 * CharacterSelectUI.ts — Character select screen logic.
 */

import { ctx } from '../game/GameContext';
import { t, TransKey } from '../i18n';

const CS_DATA: Record<string, {
    name: string; roleKey: TransKey; faction: 'fire' | 'ice' | 'merc';
    hp: number; atk: number; arm: number; spd: number;
    abilityNameKey: TransKey; abilityDescKey: TransKey; loreKey: TransKey;
}> = {
    korhan: { name: 'KORHAN', roleKey: 'roleWarrior', faction: 'fire', hp: 220, atk: 24, arm: 8, spd: 4, abilityNameKey: 'korhanAbilName', abilityDescKey: 'korhanAbilDesc', loreKey: 'korhanLore' },
    erlik: { name: 'ERLİK', roleKey: 'roleMage', faction: 'fire', hp: 100, atk: 35, arm: 1, spd: 7, abilityNameKey: 'erlikAbilName', abilityDescKey: 'erlikAbilDesc', loreKey: 'erlikLore' },
    od: { name: 'OD', roleKey: 'roleSupport', faction: 'fire', hp: 70, atk: 0, arm: 2, spd: 10, abilityNameKey: 'odAbilName', abilityDescKey: 'odAbilDesc', loreKey: 'odLore' },
    ayaz: { name: 'AYAZ', roleKey: 'roleWarrior', faction: 'ice', hp: 240, atk: 18, arm: 10, spd: 3, abilityNameKey: 'ayazAbilName', abilityDescKey: 'ayazAbilDesc', loreKey: 'ayazLore' },
    tulpar: { name: 'TULPAR', roleKey: 'roleSupport', faction: 'ice', hp: 70, atk: 0, arm: 1, spd: 10, abilityNameKey: 'tulparAbilName', abilityDescKey: 'tulparAbilDesc', loreKey: 'tulparLore' },
    umay: { name: 'UMAY', roleKey: 'roleMage', faction: 'ice', hp: 120, atk: 22, arm: 2, spd: 5, abilityNameKey: 'umayAbilName', abilityDescKey: 'umayAbilDesc', loreKey: 'umayLore' },
    albasti: { name: 'ALBASTI', roleKey: 'roleNeutral', faction: 'merc', hp: 140, atk: 26, arm: 2, spd: 8, abilityNameKey: 'albastiAbilName', abilityDescKey: 'albastiAbilDesc', loreKey: 'albastiLore' },
    tepegoz: { name: 'TEPEGOZ', roleKey: 'roleTank', faction: 'merc', hp: 300, atk: 20, arm: 12, spd: 3, abilityNameKey: 'tepegozAbilName', abilityDescKey: 'tepegozAbilDesc', loreKey: 'tepegozLore' },
    sahmeran: { name: 'SAHMERAN', roleKey: 'rolePoisoner', faction: 'merc', hp: 130, atk: 32, arm: 1, spd: 7, abilityNameKey: 'sahmeranAbilName', abilityDescKey: 'sahmeranAbilDesc', loreKey: 'sahmeranLore' },
    boru: { name: 'BORU', roleKey: 'roleSpiritWolf', faction: 'merc', hp: 180, atk: 28, arm: 5, spd: 6, abilityNameKey: 'boruAbilName', abilityDescKey: 'boruAbilDesc', loreKey: 'boruLore' },
};

const CS_MAX = { hp: 300, atk: 35, arm: 12, spd: 10 };
const CS_BLOCKS = 12;

function buildSegBar(containerId: string, value: number, max: number, faction: string): void {
    const el = document.getElementById(containerId)!;
    const filled = Math.round((value / max) * CS_BLOCKS);
    el.innerHTML = '';
    for (let i = 0; i < CS_BLOCKS; i++) {
        const block = document.createElement('div');
        block.className = i < filled ? `cs-seg-block filled ${faction}` : 'cs-seg-block empty';
        el.appendChild(block);
    }
}

export function selectCharacter(charId: string): void {
    ctx.currentCharId = charId;
    const d = CS_DATA[charId];
    if (!d) return;

    const f = d.faction;
    const imgOverrides: Record<string, string> = { boru: 'börü' };
    const imgName = imgOverrides[charId] ?? charId;
    const imgUrl = `/assets/images/characters/${imgName}.webp`;

    (document.getElementById('cs-bg')! as HTMLElement).style.backgroundImage = `url('${imgUrl}')`;

    const heroImg = document.getElementById('cs-hero-img') as HTMLImageElement;
    heroImg.style.opacity = '0';
    setTimeout(() => {
        heroImg.src = imgUrl;
        heroImg.style.opacity = '1';
    }, 150);

    document.getElementById('cs-hero-glow')!.className = 'cs-hero-glow ' + f;

    const badge = document.getElementById('cs-class-badge')!;
    badge.className = 'cs-class-badge ' + f;
    badge.innerHTML = `${t(d.roleKey)}`;

    document.getElementById('cs-hero-name')!.textContent = d.name;
    document.getElementById('cs-hero-lore-text')!.textContent = t(d.loreKey);

    buildSegBar('cs-seg-hp', d.hp, CS_MAX.hp, f);
    buildSegBar('cs-seg-atk', d.atk, CS_MAX.atk, f);
    buildSegBar('cs-seg-arm', d.arm, CS_MAX.arm, f);
    buildSegBar('cs-seg-spd', d.spd, CS_MAX.spd, f);

    const abilBox = document.getElementById('cs-ability-box')!;
    abilBox.className = 'cs-ability-box ' + f;
    document.getElementById('cs-ability-name')!.textContent = t(d.abilityNameKey);
    document.getElementById('cs-ability-desc')!.textContent = t(d.abilityDescKey);

    document.querySelectorAll<HTMLElement>('.cs-carousel-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.char === charId) item.classList.add('active');
    });
}

export function initCharacterSelect(): void {
    document.querySelectorAll<HTMLElement>('.cs-carousel-item').forEach(item => {
        item.addEventListener('click', () => selectCharacter(item.dataset.char!));
    });
    selectCharacter('korhan');
}
