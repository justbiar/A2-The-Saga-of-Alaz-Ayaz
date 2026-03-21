/**
 * ScreenRouter.ts — Screen navigation, music switching, map preview.
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createAvaxMap } from '../scene/map/createAvaxMap';
import { BaseBuilding } from '../scene/map/BaseBuilding';
import { exportMapGLB } from '../scene/map/exportMapGLB';
import { switchBGM } from '../audio/SoundManager';
import { initLobbyScreen } from './LobbyUI';
import { setErrorReporterScreen } from './ErrorReporter';
import { renderLeaderboardScreen } from './ProfileLeaderboard';
import { renderProfileScreen } from './ProfileLeaderboard';
import { renderCampaignScreen } from './CampaignUI';
import { initSettingsScreen } from './SettingsUI';

export type Screen = 'home' | 'characters' | 'story' | 'map' | 'team-select' | 'mode-select' | 'lobby' | 'game' | 'leaderboard' | 'profile' | 'settings' | 'campaign';

// ─── DOM REFS ──────────────────────────────────────────────────────
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const appHeader = document.getElementById('app-header') as HTMLElement;
const homeScreen = document.getElementById('home-screen') as HTMLElement;
const charactersScreen = document.getElementById('characters-screen') as HTMLElement;
const storyScreen = document.getElementById('story-screen') as HTMLElement;
const mapScreen = document.getElementById('map-screen') as HTMLElement;
const teamSelectScreen = document.getElementById('team-select-screen') as HTMLElement;
const modeSelectEl = document.getElementById('mode-select') as HTMLElement;
const difficultyScreen = document.getElementById('difficulty-select') as HTMLElement;
const lobbyScreen = document.getElementById('lobby-screen') as HTMLElement;
const leaderboardScreen = document.getElementById('leaderboard-screen') as HTMLElement;
const profileScreen = document.getElementById('profile-screen') as HTMLElement;
const settingsScreen = document.getElementById('settings-screen') as HTMLElement;
const campaignScreen = document.getElementById('campaign-screen') as HTMLElement;

const MENU_SCREENS = [homeScreen, charactersScreen, storyScreen, mapScreen, teamSelectScreen, modeSelectEl, difficultyScreen, lobbyScreen, leaderboardScreen, profileScreen, settingsScreen, campaignScreen].filter(Boolean) as HTMLElement[];
const GAME_HUD = ['top-hud', 'board-control-meter', 'debug-ui', 'card-tray', 'surge-indicator', 'kite-panel'];

// ─── MAP PREVIEW ENGINE ────────────────────────────────────────────
let _mapEngine: Engine | null = null;

function startMapPreview(): void {
    const previewCanvas = document.getElementById('map-preview-canvas') as HTMLCanvasElement;
    if (!previewCanvas || _mapEngine) return;

    const engine = new Engine(previewCanvas, true, { adaptToDeviceRatio: true, useHighPrecisionFloats: true });
    _mapEngine = engine;

    const mapScene = new Scene(engine);
    mapScene.clearColor = new Color4(0.04, 0.04, 0.06, 1);

    const cam = new ArcRotateCamera('mapCam', -Math.PI / 2, 0.82, 90, Vector3.Zero(), mapScene);
    cam.lowerRadiusLimit = 30;
    cam.upperRadiusLimit = 160;
    cam.lowerBetaLimit = 0.3;
    cam.upperBetaLimit = Math.PI / 2 - 0.05;
    cam.minZ = 1;
    cam.attachControl(previewCanvas, true);

    const hemi = new HemisphericLight('mapH', new Vector3(0, 1, 0), mapScene);
    hemi.intensity = 1.1;
    hemi.diffuse = new Color3(1, 1, 1);
    hemi.groundColor = new Color3(0.3, 0.3, 0.4);

    const dir = new DirectionalLight('mapD', new Vector3(-1, -2, -1), mapScene);
    dir.intensity = 0.5;

    const dummySG = { addShadowCaster: () => { } } as any;
    createAvaxMap(mapScene, dummySG);

    new BaseBuilding(mapScene, 'fire');
    new BaseBuilding(mapScene, 'ice');

    console.log('[MapPreview] Map loaded');

    (window as any).exportMapGLB = () => exportMapGLB(mapScene);

    engine.runRenderLoop(() => {
        if (mapScene.activeCamera) mapScene.render();
    });
    window.addEventListener('resize', () => engine.resize());
}

function stopMapPreview(): void {
    if (_mapEngine) { _mapEngine.dispose(); _mapEngine = null; }
}

// ─── Callback for mode-select badge ────────────────────────────────
let _updateModeSelectTeamBadge: (() => void) | null = null;
export function setModeSelectBadgeCallback(fn: () => void): void {
    _updateModeSelectTeamBadge = fn;
}

// ─── HISTORY (back button) ─────────────────────────────────────────
let _currentScreen: Screen = 'home';

const VALID_SCREENS: Screen[] = ['home', 'characters', 'story', 'map', 'team-select', 'mode-select', 'lobby', 'leaderboard', 'profile', 'settings', 'campaign'];

// Restore screen from hash on refresh
const _hashScreen = window.location.hash.replace('#', '') as Screen;
const _initScreen: Screen = VALID_SCREENS.includes(_hashScreen) ? _hashScreen : 'home';
history.replaceState({ screen: _initScreen }, '', '#' + _initScreen);

window.addEventListener('popstate', (e) => {
    const screen: Screen = e.state?.screen ?? 'home';
    _showScreenInternal(screen);
    history.pushState({ screen }, '', '#' + screen);
});

// ─── SHOW SCREEN ───────────────────────────────────────────────────
export function showScreen(screen: Screen): void {
    history.pushState({ screen }, '', '#' + screen);
    _showScreenInternal(screen);
}

function _showScreenInternal(screen: Screen): void {
    _currentScreen = screen;
    setErrorReporterScreen(screen);
    console.log('[DEBUG] showScreen:', screen);
    for (const el of MENU_SCREENS) {
        if (el) el.style.display = 'none';
    }

    if (screen !== 'map') stopMapPreview();

    appHeader.style.display = screen === 'game' ? 'none' : 'flex';

    const inGame = screen === 'game';
    for (const id of GAME_HUD) {
        const el = document.getElementById(id);
        if (el) el.style.display = inGame ? '' : 'none';
    }
    canvas.style.display = inGame ? 'block' : 'none';

    document.querySelectorAll('.header-nav-item').forEach(btn => btn.classList.remove('active'));
    const navMap: Partial<Record<Screen, string>> = {
        characters: 'nav-characters-header',
        story: 'nav-story-header',
        map: 'nav-map-header',
        campaign: 'nav-campaign-header',
        leaderboard: 'nav-leaderboard-header',
        settings: 'nav-settings-header',
    };
    if (navMap[screen]) document.getElementById(navMap[screen]!)?.classList.add('active');

    const playDefaultMusic = () => switchBGM('/assets/sound/storymusic.mp3', 0.25);
    const playCharacterMusic = () => switchBGM('/assets/sound/character.mp3', 0.25);
    const playStoryMusic = () => switchBGM('/assets/sound/war.mp3', 0.25);

    switch (screen) {
        case 'home':
            homeScreen.style.display = 'flex';
            playDefaultMusic();
            break;
        case 'characters':
            charactersScreen.style.display = 'flex';
            playCharacterMusic();
            break;
        case 'story':
            storyScreen.style.display = 'flex';
            playStoryMusic();
            break;
        case 'map':
            mapScreen.style.display = 'flex';
            playDefaultMusic();
            startMapPreview();
            break;
        case 'team-select':
            teamSelectScreen.style.display = 'flex';
            playDefaultMusic();
            break;
        case 'mode-select':
            modeSelectEl.style.display = 'flex';
            _updateModeSelectTeamBadge?.();
            break;
        case 'lobby':
            lobbyScreen.style.display = 'flex';
            initLobbyScreen();
            break;
        case 'campaign':
            campaignScreen.style.display = 'flex';
            playDefaultMusic();
            void renderCampaignScreen();
            break;
        case 'leaderboard':
            leaderboardScreen.style.display = 'flex';
            playDefaultMusic();
            void renderLeaderboardScreen();
            break;
        case 'profile':
            profileScreen.style.display = 'flex';
            playDefaultMusic();
            renderProfileScreen();
            break;
        case 'settings':
            if (settingsScreen) {
                settingsScreen.style.display = 'flex';
                initSettingsScreen();
            }
            break;
        case 'game':
            break;
    }
}

// Export DOM refs needed by other modules
export { canvas, difficultyScreen, teamSelectScreen, lobbyScreen, _initScreen };
