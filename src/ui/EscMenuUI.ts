/**
 * EscMenuUI.ts — ESC pause menu for non-multiplayer modes.
 */

import { ctx } from '../game/GameContext';
import { t, TransKey } from '../i18n';

const escOverlay = document.getElementById('esc-overlay');
const escResume = document.getElementById('esc-resume');
const escSettings = document.getElementById('esc-settings');
const escHome = document.getElementById('esc-home');

let _quitConfirmPending = false;
let _settingsBackHandler: ((e: Event) => void) | null = null;

export function isEscMenuOpen(): boolean {
    return escOverlay?.classList.contains('show') ?? false;
}

export function openEscMenu(): void {
    if (ctx.gameMode === 'multiplayer') return;

    ctx.isPaused = true;
    _quitConfirmPending = false;
    if (escHome) escHome.textContent = t('escHome' as TransKey);
    escOverlay?.classList.add('show');
}

export function closeEscMenu(): void {
    ctx.isPaused = false;
    _quitConfirmPending = false;
    if (escHome) escHome.textContent = t('escHome' as TransKey);
    escOverlay?.classList.remove('show');
}

function handleQuit(): void {
    if (!_quitConfirmPending) {
        _quitConfirmPending = true;
        if (escHome) escHome.textContent = t('escQuitConfirm' as TransKey);
        return;
    }
    closeEscMenu();
    (window as any).__cleanupGame?.();
}

export function initEscMenu(): void {
    if (!escOverlay || !escResume || !escSettings || !escHome) return;
    escResume.addEventListener('click', () => closeEscMenu());

    escSettings.addEventListener('click', () => {
        closeEscMenu();
        const settingsScreen = document.getElementById('settings-screen');
        if (!settingsScreen) return;
        settingsScreen.style.display = 'flex';

        // Override back button: return to game, not home
        const backBtn = document.getElementById('settings-back');
        if (backBtn) {
            // Remove previous handler if exists
            if (_settingsBackHandler) backBtn.removeEventListener('click', _settingsBackHandler, true);
            _settingsBackHandler = (e: Event) => {
                e.stopImmediatePropagation();
                e.preventDefault();
                settingsScreen.style.display = 'none';
                _settingsBackHandler = null;
            };
            backBtn.addEventListener('click', _settingsBackHandler, true);
        }
    });

    escHome.addEventListener('click', () => handleQuit());

    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;

        // Settings ekrani aciksa, onu kapat
        const settingsScreen = document.getElementById('settings-screen');
        if (settingsScreen && settingsScreen.style.display === 'flex') {
            const canvas = document.getElementById('renderCanvas');
            if (canvas && canvas.style.display !== 'none') {
                settingsScreen.style.display = 'none';
                if (_settingsBackHandler) {
                    const backBtn = document.getElementById('settings-back');
                    if (backBtn) backBtn.removeEventListener('click', _settingsBackHandler, true);
                    _settingsBackHandler = null;
                }
                return;
            }
        }

        // Win overlay aciksa ESC'yi yoksay
        const winOverlay = document.getElementById('win-overlay');
        if (winOverlay?.classList.contains('show')) return;

        // Oyun sahnesinde degilse yoksay
        const canvas = document.getElementById('renderCanvas');
        if (!canvas || canvas.style.display === 'none') return;

        // Draft popup aciksa yoksay
        if (ctx.draftPopupOpen) return;

        if (isEscMenuOpen()) {
            closeEscMenu();
        } else {
            openEscMenu();
        }
    });
}
