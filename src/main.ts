/**
 * main.ts — Thin orchestrator. Imports modules, wires events, boots game.
 */

// ─── GLOBAL ERROR REPORTER + REPORT UI ──────────────────────────────
import { initErrorReporter } from './ui/ErrorReporter';
import { initReportUI } from './ui/ReportUI';
initErrorReporter();
initReportUI();

// ─── MODULE IMPORTS ─────────────────────────────────────────────────
import { ctx, type GameMode } from './game/GameContext';
import { showScreen, setModeSelectBadgeCallback, difficultyScreen, _initScreen } from './ui/ScreenRouter';
import { initWalletUI, showWalletModal, lockGameUntilProfile } from './ui/WalletUI';
import { initProfileLeaderboard } from './ui/ProfileLeaderboard';
import { initCharacterSelect, selectCharacter } from './ui/CharacterSelectUI';
import { initLobbyBackHandlers, showToast } from './ui/LobbyUI';
import { initMiniPlayer, initGlobalKeybindCapture } from './ui/SettingsUI';
import { initEscMenu } from './ui/EscMenuUI';
import { boot, cleanupGame } from './game/GameBoot';
import { t, setLang, getLang, Lang } from './i18n';
import { restoreTrackPreference, setBGMVolume, setSFXVolume } from './audio/SoundManager';
import { startGLBWarmCache } from './glbCache';
import { profileService } from './chain/ProfileService';
// Register character abilities at startup
import './ecs/abilities/characterAbilities';

// ─── GLB WARM-CACHE (EAGER) ────────────────────────────────────────
startGLBWarmCache();

// ─── RESTORE USER PREFERENCES ──────────────────────────────────────
restoreTrackPreference();
const savedMusicVol = parseFloat(localStorage.getItem('a2_music_volume') ?? '0.3');
const savedSfxVol = parseFloat(localStorage.getItem('a2_sfx_volume') ?? '0.5');
setBGMVolume(savedMusicVol);
setSFXVolume(savedSfxVol);

// ─── INIT MINI PLAYER ──────────────────────────────────────────────
setTimeout(() => initMiniPlayer(), 100);

// ─── LAZY VIDEO LOADER ─────────────────────────────────────────────
setTimeout(() => {
    document.querySelectorAll<HTMLVideoElement>('.home-video').forEach(v => {
        v.querySelectorAll<HTMLSourceElement>('source[data-src]').forEach(s => {
            s.src = s.dataset.src!;
        });
        v.load();
        v.play().catch(() => { });
    });
}, 2000);

// ─── WINDOW GLOBALS (cross-module callbacks) ────────────────────────
(window as any).__cleanupGame = () => cleanupGame();
(window as any).__bootGame = (mode: GameMode) => boot(mode).catch(console.error);
(window as any).__startMultiplayerBoot = () => {
    document.getElementById('loading-screen')!.style.display = 'flex';
    showScreen('game');
    boot('multiplayer').catch(console.error);
};

// ─── TEAM SELECTION ─────────────────────────────────────────────────
document.querySelectorAll<HTMLElement>('.team-half').forEach(card => {
    card.addEventListener('click', () => {
        ctx.selectedTeam = card.dataset.team as 'fire' | 'ice';
        console.log('[DEBUG] Team selected:', ctx.selectedTeam, 'gameMode:', ctx.gameMode);
        if (ctx.gameMode === 'realtime') {
            difficultyScreen.style.display = 'flex';
        } else if (ctx.gameMode === 'multiplayer') {
            showScreen('lobby');
        } else {
            document.getElementById('loading-screen')!.style.display = 'flex';
            showScreen('game');
            boot('twoplayer').catch(console.error);
        }
    });
});

// ─── MODE SELECT BADGE ─────────────────────────────────────────────
function updateModeSelectTeamBadge(): void {
    let badge = document.getElementById('mode-team-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'mode-team-badge';
        badge.style.cssText = `
            display:inline-flex; align-items:center; gap:8px;
            font-family:'Cinzel',serif; font-size:11px;
            font-weight:700; letter-spacing:2px;
            padding:5px 14px; border-radius:3px;
            text-transform:uppercase;
            margin-top:12px;
        `;
        const header = document.querySelector('.mode-select-header');
        if (header) header.appendChild(badge);
    }
    if (ctx.selectedTeam === 'fire') {
        badge.style.color = 'rgba(255,85,32,0.55)';
        badge.style.background = 'rgba(255,85,32,0.05)';
        badge.style.border = '1px solid rgba(255,85,32,0.15)';
        badge.innerHTML = 'Ates Klani';
    } else {
        badge.style.color = 'rgba(56,170,255,0.55)';
        badge.style.background = 'rgba(56,170,255,0.05)';
        badge.style.border = '1px solid rgba(56,170,255,0.15)';
        badge.innerHTML = 'Buz Klani';
    }
}
setModeSelectBadgeCallback(updateModeSelectTeamBadge);

// ─── MODE SELECT WIRING ────────────────────────────────────────────
const modeBtns = document.querySelectorAll<HTMLButtonElement>('.mode-btn');
console.log('[DEBUG] Mode buttons found:', modeBtns.length);
modeBtns.forEach(btn => {
    console.log('[DEBUG] Wiring mode-btn:', btn.dataset.mode);
    btn.addEventListener('click', () => {
        console.log('[DEBUG] Mode clicked:', btn.dataset.mode);
        ctx.gameMode = btn.dataset.mode as GameMode;
        if (ctx.gameMode === 'multiplayer') {
            showScreen('lobby');
        } else {
            showScreen('team-select');
        }
    });
});

// ─── DIFFICULTY BUTTONS ────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        console.log('[DEBUG] Difficulty clicked:', btn.dataset.diff);
        ctx.difficultyLevel = parseInt(btn.dataset.diff ?? '1');
        difficultyScreen.style.display = 'none';
        document.getElementById('loading-screen')!.style.display = 'flex';
        showScreen('game');
        boot('realtime').catch(err => console.error('[DEBUG] boot() error:', err));
    });
});

document.getElementById('diff-sky')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const wrap = document.getElementById('diff-sky')!.closest('.diff-sky-btn-wrap')!;
    wrap.classList.toggle('revealed');
});

document.addEventListener('click', () => {
    document.querySelector('.diff-sky-btn-wrap.revealed')?.classList.remove('revealed');
});

document.getElementById('diff-back')?.addEventListener('click', () => {
    difficultyScreen.style.display = 'none';
    showScreen('team-select');
});

// ─── NAV WIRING ────────────────────────────────────────────────────
document.getElementById('nav-play')!.addEventListener('click', () => {
    console.log('[DEBUG] nav-play clicked, walletAddress:', ctx.walletAddress, 'profile:', profileService.currentProfile?.username);
    if (!ctx.walletAddress || !profileService.currentProfile) {
        console.log('[DEBUG] Blocked — showing wallet modal');
        showWalletModal();
        showToast('Oyuna girmek icin cuzdanini bagla ve profil olustur!');
        return;
    }
    console.log('[DEBUG] Showing mode-select');
    showScreen('mode-select');
});

document.getElementById('nav-characters-header')?.addEventListener('click', () => showScreen('characters'));
document.getElementById('nav-story-header')?.addEventListener('click', () => showScreen('story'));
document.getElementById('nav-map-header')?.addEventListener('click', () => showScreen('map'));
document.getElementById('nav-leaderboard-header')?.addEventListener('click', () => showScreen('leaderboard'));
document.getElementById('nav-profile-header')?.addEventListener('click', () => showScreen('profile'));
document.getElementById('nav-settings-header')?.addEventListener('click', () => showScreen('settings'));
document.getElementById('header-logo')?.addEventListener('click', () => showScreen('home'));
document.getElementById('mode-back')!.addEventListener('click', () => showScreen('home'));
document.getElementById('team-back')?.addEventListener('click', () => showScreen('mode-select'));
document.getElementById('settings-back')?.addEventListener('click', () => showScreen('home'));
document.getElementById('cs-back-lobby')?.addEventListener('click', () => showScreen('home'));

// ─── I18N ───────────────────────────────────────────────────────────
function applyI18n(): void {
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
        if (el.id === 'wallet-label' && document.getElementById('wallet-btn')?.classList.contains('connected')) return;
        const key = el.dataset.i18n as any;
        el.textContent = t(key);
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => {
        const key = el.dataset.i18nHtml as any;
        el.innerHTML = t(key);
    });
    document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder as any;
        el.placeholder = t(key);
    });
    selectCharacter(ctx.currentCharId);
}

function updateLangBtnStyles(activeLang: string): void {
    document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach(b => {
        const active = b.dataset.lang === activeLang;
        b.style.background = active ? 'rgba(255,255,255,0.1)' : 'transparent';
        b.style.color = active ? '#fff' : 'rgba(255,255,255,0.5)';
        b.style.borderColor = active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)';
        b.style.fontWeight = active ? '700' : '400';
    });
}

document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const lang = btn.dataset.lang as Lang;
        setLang(lang);
        applyI18n();
        updateLangBtnStyles(lang);
    });
});

// Apply saved language on load
applyI18n();
updateLangBtnStyles(getLang());

// ─── INIT MODULES ───────────────────────────────────────────────────
initWalletUI();
initProfileLeaderboard();
initCharacterSelect();
initLobbyBackHandlers();
initGlobalKeybindCapture();
initEscMenu();
lockGameUntilProfile(true);

// ─── START ──────────────────────────────────────────────────────────
showScreen(_initScreen);
