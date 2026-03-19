/**
 * PromptCard.ts — Skill Card + Tower Card definitions for A2.
 */
import type { PromptCardDef } from './types';

/** Takıma göre topçu kulesi kartı oluştur (45. saniyede otomatik eklenir). */
export function getTowerCard(team: 'fire' | 'ice'): PromptCardDef {
    return {
        id: 'tower_place',
        name: 'Topçu Kulesi',
        description: 'Savunma kulesi kur. Her 5 AVX ile seviye atla (max 5).',
        manaCost: 0,
        avxCost: 5,
        effectType: 'tower_place',
        magnitude: 0,
        duration: 0,
        cooldown: 0,
        targetTeam: 'self',
        imagePath: team === 'ice'
            ? '/assets/game%20asset/ayaztop.png'
            : '/assets/game%20asset/alaztop.png',
    };
}

/** Takıma göre çiçek kartı oluştur (oyun başından itibaren mevcut). */
export function getFlowerCard(team: 'fire' | 'ice'): PromptCardDef {
    return {
        id: 'flower_place',
        name: team === 'fire' ? 'Alaz Çiçeği' : 'Ayaz Çiçeği',
        description: 'Düşman kulesini yok eden çiçek ek. 15s büyür, 3 vuruşta kule yıkar.',
        manaCost: 0,
        avxCost: 3,
        effectType: 'flower_place',
        magnitude: 0,
        duration: 0,
        cooldown: 0,
        targetTeam: 'enemy',
        imagePath: team === 'fire'
            ? '/assets/game%20asset/cicekler/alazcicek.png'
            : '/assets/game%20asset/cicekler/ayazcicek.png',
    };
}

/** Secilen agac tipine gore agac karti olustur. */
export function getTreeCard(treeType: 'mana' | 'avx'): PromptCardDef {
    return {
        id: 'tree_place',
        name: treeType === 'mana' ? 'Mana Agaci' : 'AVX Agaci',
        description: treeType === 'mana'
            ? 'Mana ureten agac dik (5 AVX). 15s sonra aktif.'
            : 'AVX ureten agac dik (5 Mana). 15s sonra aktif.',
        manaCost: treeType === 'avx' ? 5 : 0,
        avxCost: treeType === 'mana' ? 5 : 0,
        effectType: 'tree_place',
        magnitude: 0,
        duration: 0,
        cooldown: 0,
        targetTeam: 'self',
        imagePath: treeType === 'mana'
            ? '/assets/game%20asset/cicekler/manaagaci.png'
            : '/assets/game%20asset/cicekler/avxagaci.png',
    };
}

export const PROMPT_DEFS: PromptCardDef[] = [
    {
        id: 'skill_mana_fill',
        nameKey: 'manaFill',
        descKey: 'manaFillDesc',
        name: '', description: '', // filled by i18n at render
        manaCost: 0,
        effectType: 'mana_fill',
        magnitude: 0,
        duration: 0,
        cooldown: 30,
        targetTeam: 'self',
        imagePath: '/assets/images/skills/mana1.webp',
    },
    {
        id: 'skill_mana_freeze',
        nameKey: 'manaFreeze',
        descKey: 'manaFreezeDesc',
        name: '', description: '',
        manaCost: 0,
        effectType: 'mana_freeze',
        magnitude: 0,
        duration: 5,
        cooldown: 20,
        targetTeam: 'self',
        imagePath: '/assets/images/skills/mana2.webp',
    },
    {
        id: 'skill_ouroboros',
        nameKey: 'ouroboros',
        descKey: 'ouroborosDesc',
        name: '', description: '',
        manaCost: 5,
        effectType: 'ouroboros',
        magnitude: 0,
        duration: 0,
        cooldown: 45,
        targetTeam: 'enemy',
        imagePath: '/assets/images/skills/ouroboros.webp',
    },
    {
        id: 'skill_autocollect',
        nameKey: 'autoCollect',
        descKey: 'autoCollectDesc',
        name: '', description: '',
        manaCost: 0,
        effectType: 'autocollect',
        magnitude: 0,
        duration: 30,
        cooldown: 40,
        targetTeam: 'self',
        imagePath: '/assets/images/skills/autocollect.webp',
    },
    {
        id: 'skill_bancollect',
        nameKey: 'banCollect',
        descKey: 'banCollectDesc',
        name: '', description: '',
        manaCost: 0,
        effectType: 'bancollect',
        magnitude: 0,
        duration: 45,
        cooldown: 50,
        targetTeam: 'enemy',
        imagePath: '/assets/images/skills/bancollect.webp',
    },
    {
        id: 'skill_heal_home',
        nameKey: 'healHome',
        descKey: 'healHomeDesc',
        name: '', description: '',
        manaCost: 0,
        effectType: 'healthome',
        magnitude: 75,
        duration: 30,
        cooldown: 60,
        targetTeam: 'self',
        imagePath: '/assets/images/skills/healthome.webp',
    },
    {
        id: 'skill_recall',
        nameKey: 'recall',
        descKey: 'recallDesc',
        name: '', description: '',
        manaCost: 0,
        effectType: 'recall',
        magnitude: 0,
        duration: 0,
        cooldown: 9999,
        targetTeam: 'self',
        imagePath: '/assets/images/skills/recall.webp',
    },
    {
        id: 'skill_unlucky',
        nameKey: 'unlucky',
        descKey: 'unluckyDesc',
        name: '', description: '',
        manaCost: 0,
        effectType: 'unlucky',
        magnitude: 0,
        duration: 30,
        cooldown: 60,
        targetTeam: 'enemy',
        imagePath: '/assets/images/skills/unlucky.webp',
    },
];
