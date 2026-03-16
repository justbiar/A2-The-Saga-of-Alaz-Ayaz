/**
 * SettingsUI.ts — Settings screen, keybindings, playlist, mini player.
 */

import { t } from '../i18n';
import { getBGMVolume, setBGMVolume, getSFXVolume, setSFXVolume, getPlaylist, getCurrentTrack, playTrack } from '../audio/SoundManager';

// ─── KEYBINDING SYSTEM ─────────────────────────────────────────────
export interface KeyBindings {
    fire: {
        card1: string; card2: string; card3: string; card4: string; card5: string; card6: string;
        laneLeft: string; laneMid: string; laneRight: string; cancel: string;
    };
    ice: {
        card1: string; card2: string; card3: string; card4: string; card5: string; card6: string;
        laneLeft: string; laneMid: string; laneRight: string; cancel: string;
    };
}

const DEFAULT_BINDINGS: KeyBindings = {
    fire: {
        card1: '1', card2: '2', card3: '3', card4: '4', card5: '5', card6: '6',
        laneLeft: 'q', laneMid: 'w', laneRight: 'e', cancel: 'Escape',
    },
    ice: {
        card1: '1', card2: '2', card3: '3', card4: '4', card5: '5', card6: '6',
        laneLeft: 'z', laneMid: 'x', laneRight: 'c', cancel: 'Escape',
    },
};

export function loadBindings(): KeyBindings {
    try {
        const raw = localStorage.getItem('a2keybinds');
        if (raw) return JSON.parse(raw) as KeyBindings;
    } catch { /* ignore */ }
    return JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
}

function saveBindings(b: KeyBindings): void {
    localStorage.setItem('a2keybinds', JSON.stringify(b));
}

export let keybinds = loadBindings();

function keyLabel(key: string): string {
    if (key === ' ') return 'SPACE';
    if (key === 'Escape') return 'ESC';
    if (key === 'ArrowLeft') return '←';
    if (key === 'ArrowRight') return '→';
    if (key === 'ArrowUp') return '↑';
    if (key === 'ArrowDown') return '↓';
    return key.length === 1 ? key.toUpperCase() : key;
}

// ─── SETTINGS SCREEN STATE ─────────────────────────────────────────
let _stgDraft: KeyBindings = loadBindings();
let _listeningEl: HTMLElement | null = null;
let _listeningKey: { player: 'fire' | 'ice'; action: string } | null = null;

const BIND_ACTIONS = [
    { key: 'card1', labelKey: 'settingsCard', suffix: ' 1' },
    { key: 'card2', labelKey: 'settingsCard', suffix: ' 2' },
    { key: 'card3', labelKey: 'settingsCard', suffix: ' 3' },
    { key: 'card4', labelKey: 'settingsCard', suffix: ' 4' },
    { key: 'card5', labelKey: 'settingsCard', suffix: ' 5' },
    { key: 'card6', labelKey: 'settingsCard', suffix: ' 6' },
    { key: 'laneLeft', labelKey: 'settingsLaneL', suffix: '' },
    { key: 'laneMid', labelKey: 'settingsLaneM', suffix: '' },
    { key: 'laneRight', labelKey: 'settingsLaneR', suffix: '' },
    { key: 'cancel', labelKey: 'settingsCancel', suffix: '' },
];

function renderKeybindGrid(player: 'fire' | 'ice', containerId: string): void {
    const container = document.getElementById(containerId)!;
    container.innerHTML = '';
    const binds = _stgDraft[player];

    for (const action of BIND_ACTIONS) {
        const row = document.createElement('div');
        row.className = 'stg-bind-row';

        const label = document.createElement('span');
        label.className = 'stg-bind-label';
        label.textContent = t(action.labelKey as any) + action.suffix;

        const keyBtn = document.createElement('button');
        keyBtn.className = 'stg-bind-key';
        keyBtn.textContent = keyLabel((binds as any)[action.key]);
        keyBtn.onclick = () => startListening(keyBtn, player, action.key);

        row.appendChild(label);
        row.appendChild(keyBtn);
        container.appendChild(row);
    }
}

function startListening(el: HTMLElement, player: 'fire' | 'ice', action: string): void {
    if (_listeningEl) _listeningEl.classList.remove('listening');
    _listeningEl = el;
    _listeningKey = { player, action };
    el.classList.add('listening');
    el.textContent = t('settingsPressKey');
}

function stgToast(msg: string): void {
    let toast = document.querySelector('.stg-toast') as HTMLElement;
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'stg-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

// ─── PLAYLIST UI ───────────────────────────────────────────────────
function renderPlaylist(): void {
    const grid = document.getElementById('playlist-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const playlist = getPlaylist();
    const currentTrackItem = getCurrentTrack();

    for (const track of playlist) {
        const isActive = currentTrackItem?.id === track.id;
        const el = document.createElement('div');
        el.className = `playlist-track${isActive ? ' active' : ''}`;
        el.innerHTML = `
            <div class="playlist-icon">
                <span class="playlist-icon-static">♪</span>
                <div class="playlist-playing">
                    <div class="playlist-bar"></div>
                    <div class="playlist-bar"></div>
                    <div class="playlist-bar"></div>
                </div>
            </div>
            <div class="playlist-info">
                <div class="playlist-title">${track.title}</div>
                <div class="playlist-artist">${track.artist}</div>
            </div>
            <div class="playlist-duration">${track.duration ?? ''}</div>
        `;
        el.onclick = () => {
            playTrack(track.id, 0.3);
            renderPlaylist();
        };
        grid.appendChild(el);
    }
}

// ─── INIT SETTINGS ─────────────────────────────────────────────────
export function initSettingsScreen(): void {
    _stgDraft = loadBindings();
    _listeningEl = null;
    _listeningKey = null;
    renderKeybindGrid('fire', 'stg-fire-binds');
    renderKeybindGrid('ice', 'stg-ice-binds');

    const musicVolSlider = document.getElementById('stg-music-volume') as HTMLInputElement;
    const musicVolVal = document.getElementById('stg-music-volume-val')!;
    if (musicVolSlider && musicVolVal) {
        const currentMusicVol = Math.round(getBGMVolume() * 100);
        musicVolSlider.value = String(currentMusicVol);
        musicVolVal.textContent = String(currentMusicVol);
        musicVolSlider.oninput = () => {
            const vol = parseInt(musicVolSlider.value) / 100;
            musicVolVal.textContent = musicVolSlider.value;
            setBGMVolume(vol);
            localStorage.setItem('a2_music_volume', String(vol));
        };
    }

    const sfxVolSlider = document.getElementById('stg-sfx-volume') as HTMLInputElement;
    const sfxVolVal = document.getElementById('stg-sfx-volume-val')!;
    if (sfxVolSlider && sfxVolVal) {
        const currentSfxVol = Math.round(getSFXVolume() * 100);
        sfxVolSlider.value = String(currentSfxVol);
        sfxVolVal.textContent = String(currentSfxVol);
        sfxVolSlider.oninput = () => {
            const vol = parseInt(sfxVolSlider.value) / 100;
            sfxVolVal.textContent = sfxVolSlider.value;
            setSFXVolume(vol);
            localStorage.setItem('a2_sfx_volume', String(vol));
        };
    }

    renderPlaylist();

    document.querySelectorAll<HTMLButtonElement>('.stg-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.stg-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.stgTab!;
            document.getElementById('stg-panel-keybinds')!.style.display = target === 'keybinds' ? '' : 'none';
            document.getElementById('stg-panel-music')!.style.display = target === 'music' ? '' : 'none';
            document.getElementById('stg-panel-general')!.style.display = target === 'general' ? '' : 'none';
        };
    });

    document.getElementById('stg-save-btn')!.onclick = () => {
        keybinds = JSON.parse(JSON.stringify(_stgDraft));
        saveBindings(keybinds);
        const musicVol = parseInt((document.getElementById('stg-music-volume') as HTMLInputElement)?.value ?? '30') / 100;
        const sfxVol = parseInt((document.getElementById('stg-sfx-volume') as HTMLInputElement)?.value ?? '50') / 100;
        localStorage.setItem('a2_music_volume', String(musicVol));
        localStorage.setItem('a2_sfx_volume', String(sfxVol));
        stgToast(t('settingsSaved'));
    };

    document.getElementById('stg-reset-btn')!.onclick = () => {
        _stgDraft = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
        renderKeybindGrid('fire', 'stg-fire-binds');
        renderKeybindGrid('ice', 'stg-ice-binds');
        if (musicVolSlider) { musicVolSlider.value = '30'; musicVolVal.textContent = '30'; setBGMVolume(0.3); }
        if (sfxVolSlider) { sfxVolSlider.value = '50'; sfxVolVal.textContent = '50'; setSFXVolume(0.5); }
    };
}

// ─── MINI PLAYER ───────────────────────────────────────────────────
export function initMiniPlayer(): void {
    const btn = document.getElementById('mini-player-btn');
    const panel = document.getElementById('mini-player-panel');
    const closeBtn = panel?.querySelector('.mp-close');
    const tracklist = document.getElementById('mp-tracklist');
    const bgmSlider = document.getElementById('mp-bgm-volume') as HTMLInputElement;
    const sfxSlider = document.getElementById('mp-sfx-volume') as HTMLInputElement;

    if (!btn || !panel || !tracklist) return;

    btn.onclick = () => { panel.classList.toggle('show'); };
    closeBtn?.addEventListener('click', () => { panel.classList.remove('show'); });

    document.addEventListener('click', (e) => {
        const miniPlayer = document.getElementById('mini-player');
        if (miniPlayer && !miniPlayer.contains(e.target as Node)) {
            panel.classList.remove('show');
        }
    });

    const playlist = getPlaylist();
    tracklist.innerHTML = '';
    const currentTrackItem = getCurrentTrack();

    playlist.forEach(track => {
        const item = document.createElement('div');
        item.className = 'mp-track' + (track.id === currentTrackItem?.id ? ' active' : '');
        item.innerHTML = `
            <div class="mp-track-playing">
                <span class="mp-track-bar"></span>
                <span class="mp-track-bar"></span>
                <span class="mp-track-bar"></span>
            </div>
            <span class="mp-track-icon">♪</span>
            <span class="mp-track-name">${track.title}</span>
        `;
        item.onclick = () => {
            playTrack(track.id);
            tracklist.querySelectorAll('.mp-track').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            btn.classList.add('playing');
            document.querySelectorAll('.playlist-track').forEach(el => {
                el.classList.toggle('active', el.getAttribute('data-track') === track.id);
            });
        };
        tracklist.appendChild(item);
    });

    if (bgmSlider) {
        bgmSlider.value = String(getBGMVolume());
        bgmSlider.oninput = () => {
            const vol = parseFloat(bgmSlider.value);
            setBGMVolume(vol);
            localStorage.setItem('a2_music_volume', String(vol));
            const settingsSlider = document.getElementById('stg-music-volume') as HTMLInputElement;
            const settingsVal = document.getElementById('stg-music-volume-val');
            if (settingsSlider) settingsSlider.value = String(Math.round(vol * 100));
            if (settingsVal) settingsVal.textContent = String(Math.round(vol * 100));
        };
    }

    if (sfxSlider) {
        sfxSlider.value = String(getSFXVolume());
        sfxSlider.oninput = () => {
            const vol = parseFloat(sfxSlider.value);
            setSFXVolume(vol);
            localStorage.setItem('a2_sfx_volume', String(vol));
            const settingsSlider = document.getElementById('stg-sfx-volume') as HTMLInputElement;
            const settingsVal = document.getElementById('stg-sfx-volume-val');
            if (settingsSlider) settingsSlider.value = String(Math.round(vol * 100));
            if (settingsVal) settingsVal.textContent = String(Math.round(vol * 100));
        };
    }

    if (currentTrackItem) {
        btn.classList.add('playing');
    }
}

export function showMiniPlayer(): void {
    const miniPlayer = document.getElementById('mini-player');
    if (miniPlayer) {
        miniPlayer.style.display = 'flex';
        const bgmSlider = document.getElementById('mp-bgm-volume') as HTMLInputElement;
        const sfxSlider = document.getElementById('mp-sfx-volume') as HTMLInputElement;
        if (bgmSlider) bgmSlider.value = String(getBGMVolume());
        if (sfxSlider) sfxSlider.value = String(getSFXVolume());
    }
}

export function hideMiniPlayer(): void {
    const miniPlayer = document.getElementById('mini-player');
    if (miniPlayer) {
        miniPlayer.style.display = 'none';
        document.getElementById('mini-player-panel')?.classList.remove('show');
    }
}

// ─── GLOBAL KEYBIND CAPTURE ────────────────────────────────────────
export function initGlobalKeybindCapture(): void {
    window.addEventListener('keydown', (e) => {
        if (!_listeningEl || !_listeningKey) return;
        e.preventDefault();
        e.stopPropagation();

        const key = e.key;
        (_stgDraft[_listeningKey.player] as any)[_listeningKey.action] = key;
        _listeningEl.textContent = keyLabel(key);
        _listeningEl.classList.remove('listening');
        _listeningEl = null;
        _listeningKey = null;
    }, true);
}
