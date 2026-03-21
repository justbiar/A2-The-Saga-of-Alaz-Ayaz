/**
 * main.ts — Thin orchestrator. Imports modules, wires events, boots game.
 */

// ─── GLOBAL ERROR REPORTER + REPORT UI ──────────────────────────────
import { initErrorReporter } from './ui/ErrorReporter';
import { initReportUI } from './ui/ReportUI';
import { initAdminPanel } from './ui/AdminPanel';
initErrorReporter();
initReportUI();
initAdminPanel();

// ─── MODULE IMPORTS ─────────────────────────────────────────────────
import { ctx, type GameMode } from './game/GameContext';
import { showScreen, setModeSelectBadgeCallback, difficultyScreen, _initScreen } from './ui/ScreenRouter';
import { initWalletUI, showWalletModal, lockGameUntilProfile } from './ui/WalletUI';
import { initProfileLeaderboard, openFaucetModal } from './ui/ProfileLeaderboard';
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

// ─── MAINTENANCE CHECK ────────────────────────────────────────────
// Icerik gorunmeden once kontrol yap — flash onlenir
document.body.style.visibility = 'hidden';

function _mRevealContent() {
    document.body.style.visibility = '';
}

(async function checkMaintenance() {
    try {
        const res = await fetch('/api/maintenance');
        const data = await res.json();
        if (!data.active) { _mRevealContent(); return; }

        const screen = document.getElementById('maintenance-screen')!;
        const msgEl = document.getElementById('maintenance-msg')!;
        const walletSection = document.getElementById('maintenance-wallet-section')!;
        const connectBtn = document.getElementById('maintenance-connect-btn')!;
        const walletMsg = document.getElementById('maintenance-wallet-msg')!;
        const whitelist: string[] = (data.whitelist || []).map((w: string) => w.toLowerCase());

        if (data.message) msgEl.textContent = data.message;
        else msgEl.textContent = t('maintMsg' as any);
        screen.style.display = 'flex';
        walletSection.style.display = 'flex';
        _mRevealContent(); // body gorunur yap — maintenance overlay zaten uzerini kapatiyor

        // Zaten bagli cuzdan varsa kontrol et
        const connected = ctx.walletAddress;
        if (connected && whitelist.includes(connected.toLowerCase())) {
            screen.style.display = 'none';
            _mRevealContent();
            return;
        }

        connectBtn.addEventListener('click', async () => {
            const provider = ctx._activeProvider ?? (window as any).ethereum;
            if (!provider) {
                walletMsg.textContent = t('maintNoWallet' as any);
                walletMsg.style.display = 'block';
                return;
            }
            try {
                connectBtn.textContent = t('maintConnecting' as any);
                const accounts = await provider.request({ method: 'eth_requestAccounts' });
                const addr = accounts[0]?.toLowerCase();
                if (addr && whitelist.includes(addr)) {
                    screen.style.display = 'none';
                    _mRevealContent();
                } else {
                    walletMsg.textContent = t('maintNotAllowed' as any);
                    walletMsg.style.display = 'block';
                    connectBtn.textContent = t('maintConnect' as any);
                }
            } catch {
                walletMsg.textContent = t('maintFailed' as any);
                walletMsg.style.display = 'block';
                connectBtn.textContent = t('maintConnect' as any);
            }
        });
    } catch { _mRevealContent(); /* API erisilemediyse bakimi atla */ }
})();

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
(window as any).__a2ctx = ctx;
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
        badge.innerHTML = t('fireClanShort' as any);
    } else {
        badge.style.color = 'rgba(56,170,255,0.55)';
        badge.style.background = 'rgba(56,170,255,0.05)';
        badge.style.border = '1px solid rgba(56,170,255,0.15)';
        badge.innerHTML = t('iceClanShort' as any);
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
        showToast(t('walletProfileRequired' as any));
        return;
    }
    console.log('[DEBUG] Showing lobby');
    showScreen('lobby');
});

document.getElementById('nav-characters-header')?.addEventListener('click', () => showScreen('characters'));
document.getElementById('nav-story-header')?.addEventListener('click', () => showScreen('story'));
document.getElementById('nav-map-header')?.addEventListener('click', () => showScreen('map'));
document.getElementById('nav-campaign-header')?.addEventListener('click', () => showScreen('campaign'));
document.getElementById('nav-leaderboard-header')?.addEventListener('click', () => showScreen('leaderboard'));
document.getElementById('nav-profile-header')?.addEventListener('click', () => showScreen('profile'));
document.getElementById('nav-settings-header')?.addEventListener('click', () => showScreen('settings'));
document.getElementById('nav-faucet-header')?.addEventListener('click', () => openFaucetModal('donate'));
document.getElementById('nav-play-header')?.addEventListener('click', () => {
    if (!ctx.walletAddress || !profileService.currentProfile) {
        showWalletModal();
        showToast(t('walletConnectFirst' as any));
        return;
    }
    showScreen('lobby');
});
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

// ─── TUTORIAL ───────────────────────────────────────────────────────
(function initTutorial() {
    const overlay    = document.getElementById('tutorial-overlay')!;
    const slides     = Array.from(document.querySelectorAll<HTMLElement>('.tut-slide'));
    const dots       = Array.from(document.querySelectorAll<HTMLElement>('.tut-dot'));
    const prevBtn    = document.getElementById('tutorial-prev') as HTMLButtonElement;
    const nextBtn    = document.getElementById('tutorial-next') as HTMLButtonElement;
    const closeBtn   = document.getElementById('tutorial-close')!;
    const skipCheck  = document.getElementById('tutorial-skip-check') as HTMLInputElement;
    const navTutBtn  = document.getElementById('nav-tutorial-header')!;
    const TOTAL      = slides.length;
    let current      = 0;

    function goTo(idx: number): void {
        slides[current].style.display = 'none';
        dots[current].classList.remove('active');
        current = Math.max(0, Math.min(TOTAL - 1, idx));
        slides[current].style.display = '';
        dots[current].classList.add('active');
        prevBtn.style.opacity = current === 0 ? '0.3' : '1';
        
        if (current === TOTAL - 1) {
            nextBtn.removeAttribute('data-i18n');
            nextBtn.textContent = '✕';
        } else {
            nextBtn.setAttribute('data-i18n', 'tutNext');
            nextBtn.textContent = typeof t === 'function' ? t('tutNext') : 'NEXT →';
        }

        const eNum = document.getElementById('tut-eyebrow-num');
        if (eNum) eNum.textContent = `0${current + 1} / 0${TOTAL}`;
    }

    function openTutorial(): void {
        goTo(0);
        overlay.classList.add('tut-open');
        document.body.style.overflow = 'hidden';
    }

    function closeTutorial(): void {
        overlay.classList.remove('tut-open');
        document.body.style.overflow = '';
        if (skipCheck.checked) localStorage.setItem('a2_tutorial_seen', '1');
    }

    prevBtn.addEventListener('click', () => goTo(current - 1));
    nextBtn.addEventListener('click', () => {
        if (current === TOTAL - 1) { closeTutorial(); return; }
        goTo(current + 1);
    });
    closeBtn.addEventListener('click', closeTutorial);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTutorial(); });
    dots.forEach(d => d.addEventListener('click', () => goTo(parseInt(d.dataset.dot!))));

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (!overlay.classList.contains('tut-open')) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goTo(current + 1);
        if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   goTo(current - 1);
        if (e.key === 'Escape') closeTutorial();
    });

    navTutBtn.addEventListener('click', openTutorial);

    // First-time auto-open (after 1.5s, only if not dismissed before)
    if (!localStorage.getItem('a2_tutorial_seen')) {
        setTimeout(openTutorial, 1500);
    }
})();
