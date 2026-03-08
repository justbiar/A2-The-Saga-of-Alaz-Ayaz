/**
 * PromptCard.ts — 3 Skill Card definitions for A2.
 */
import type { PromptCardDef } from './types';

export const PROMPT_DEFS: PromptCardDef[] = [
    {
        id: 'skill_mana_fill',
        name: 'Mana Doldur',
        description: 'Manayı tamamen doldurur.',
        manaCost: 0,
        effectType: 'mana_fill',
        magnitude: 0,
        duration: 0,
        targetTeam: 'self',
        imagePath: '/assets/images/skills/mana1.png',
    },
    {
        id: 'skill_mana_freeze',
        name: 'Mana Dondur',
        description: '5 saniye boyunca mana harcanmaz.',
        manaCost: 0,
        effectType: 'mana_freeze',
        magnitude: 0,
        duration: 5,
        targetTeam: 'self',
        imagePath: '/assets/images/skills/mana2.png',
    },
    {
        id: 'skill_ouroboros',
        name: 'Ouroboros',
        description: 'Bir düşman birimi seç, sana katılsın.',
        manaCost: 5,
        effectType: 'ouroboros',
        magnitude: 0,
        duration: 0,
        targetTeam: 'enemy',
        imagePath: '/assets/images/skills/ouroboros.png',
    },
    {
        id: 'skill_autocollect',
        name: 'Auto Collect',
        description: '30 saniye boyunca AVX otomatik toplanır.',
        manaCost: 0,
        effectType: 'autocollect',
        magnitude: 0,
        duration: 30,
        targetTeam: 'self',
        imagePath: '/assets/images/skills/autocollect.png',
    },
    {
        id: 'skill_bancollect',
        name: 'Ban Collect',
        description: '45 saniye boyunca düşmanın AVX toplaması engellenir.',
        manaCost: 0,
        effectType: 'bancollect',
        magnitude: 0,
        duration: 45,
        targetTeam: 'enemy',
        imagePath: '/assets/images/skills/bancollect.png',
    },
];
