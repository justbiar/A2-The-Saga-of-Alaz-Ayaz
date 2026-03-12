/**
 * main.ts — Multi-mode card strategy game entry point.
 * Modes: realtime (vs AI) | twoplayer (local 2P) | multiplayer (online P2P)
 */

// ─── GLOBAL ERROR HANDLER (DEBUG) ───────────────────────────────────
window.addEventListener('error', (e) => {
    console.error('[GLOBAL ERROR]', e.message, e.filename, 'line:', e.lineno);
    const debugDiv = document.createElement('div');
    debugDiv.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:99999;background:rgba(255,0,0,0.9);color:#fff;padding:12px;font-size:12px;font-family:monospace;max-width:80vw;word-break:break-all;border-radius:8px;';
    debugDiv.textContent = `ERROR: ${e.message} (${e.filename}:${e.lineno})`;
    document.body.appendChild(debugDiv);
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('[UNHANDLED PROMISE]', e.reason);
    const debugDiv = document.createElement('div');
    debugDiv.style.cssText = 'position:fixed;bottom:50px;left:10px;z-index:99999;background:rgba(200,0,100,0.9);color:#fff;padding:12px;font-size:12px;font-family:monospace;max-width:80vw;word-break:break-all;border-radius:8px;';
    debugDiv.textContent = `PROMISE: ${e.reason}`;
    document.body.appendChild(debugDiv);
});

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { createScene } from './scene/createScene';
import { createAvaxMap } from './scene/map/createAvaxMap';
import { exportMapGLB } from './scene/map/exportMapGLB';
import { createHero } from './scene/units/createHero';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CameraSystem } from './scene/systems/cameraSystem';
import { UnitManager } from './ecs/UnitManager';
import { CARD_DEFS, AI_CARDS, AI_PROFILES_MAP, CardDef, UnitType } from './ecs/Unit';
import { AvaShardManager } from './scene/map/AvaShard';
import { BaseBuilding } from './scene/map/BaseBuilding';
import '@babylonjs/loaders/glTF';
import { WinConditionSystem } from './scene/systems/winConditionSystem';
import { WinCondition, calcManaGain, calcBoardControl, checkEquilibriumSurge } from './game/GameState';
import { PROMPT_DEFS } from './ecs/PromptCard';
import type { PromptCardDef } from './ecs/types';
import { applyStatusEffect } from './ecs/abilities/AbilitySystem';
// ethers loaded from CDN (window.ethers)
const ethers = (window as any).ethers;
import { kiteService, KiteService } from './ai/KiteService';
// Register character abilities at startup
import './ecs/abilities/characterAbilities';
import { t, setLang, getLang, Lang, TransKey } from './i18n';
import { switchBGM, lowerBGMForGame, setBGMVolume, toggleBGMMute, getBGMVolume, isBGMMuted, setSFXVolume, toggleSFXMute, getSFXVolume, isSFXMuted, playCoinDrop, playCoinCollect, preloadSFX, getPlaylist, getCurrentTrack, playTrack, restoreTrackPreference } from './audio/SoundManager';
import { profileService } from './chain/ProfileService';
import { mpService } from './multiplayer/MultiplayerService';
import { betService, BET_FEE_PERCENT, MIN_BET, MAX_BET } from './chain/BetService';
import { leaderboardService } from './chain/LeaderboardService';
import avxCoinUrl from '../assets/avxcoin.png';
import { startGLBWarmCache, waitForCache, getCachedUrl } from './glbCache';

// ─── GLB WARM-CACHE (EAGER) ──────────────────────────────────────────
// Sayfa açılır açılmaz GLB dosyalarını indirip bellekte tutar.
// boot() → UnitManager.preload() cache'den objectURL ile yükler → sıfır network.
startGLBWarmCache();

// ─── RESTORE USER PREFERENCES ────────────────────────────────────────
restoreTrackPreference();
// Restore volume settings
const savedMusicVol = parseFloat(localStorage.getItem('a2_music_volume') ?? '0.3');
const savedSfxVol = parseFloat(localStorage.getItem('a2_sfx_volume') ?? '0.5');
setBGMVolume(savedMusicVol);
setSFXVolume(savedSfxVol);

// ─── INIT MINI PLAYER ────────────────────────────────────────────────
// Sayfa yüklendikten sonra mini player'ı başlat
setTimeout(() => initMiniPlayer(), 100);

// ─── LAZY VIDEO LOADER ───────────────────────────────────────────────
// Videolari 2 saniye sonra yukle (sayfa hizli acilsin, sonra videolar gelsin)
setTimeout(() => {
    document.querySelectorAll<HTMLVideoElement>('.home-video').forEach(v => {
        v.querySelectorAll<HTMLSourceElement>('source[data-src]').forEach(s => {
            s.src = s.dataset.src!;
        });
        v.load();
        v.play().catch(() => { });
    });
}, 2000);

// ─── DOM REFS ─────────────────────────────────────────────────────────
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const dbgFps = document.getElementById('dbg-fps')!;
const dbgHero = document.getElementById('dbg-hero')!;
const dbgUnits = document.getElementById('dbg-units')!;
const dbgFire = document.getElementById('dbg-fire')!;
const dbgIce = document.getElementById('dbg-ice')!;
const turnBanner = document.getElementById('turn-banner')!;
const manaRow = document.getElementById('mana-row')!;
const cardContainer = document.getElementById('card-container')!;
const promptContainer = document.getElementById('prompt-container')!;
const turnCountEl = document.getElementById('turn-count')!;
const fireBaseFill = document.getElementById('fire-base-fill') as HTMLElement;
const iceBaseFill = document.getElementById('ice-base-fill') as HTMLElement;
const fireBaseHpText = document.getElementById('fire-base-hp') as HTMLElement;
const iceBaseHpText = document.getElementById('ice-base-hp') as HTMLElement;
const winOverlay = document.getElementById('win-overlay') as HTMLElement;
const winTitle = document.getElementById('win-title') as HTMLElement;
const winMessage = document.getElementById('win-message') as HTMLElement;
const surgeIndicator = document.getElementById('surge-indicator') as HTMLElement;
const bcmFill = document.getElementById('bcm-fill') as HTMLElement;
const modeSelectEl = document.getElementById('mode-select') as HTMLElement;

// Menu screen refs
const appHeader = document.getElementById('app-header') as HTMLElement;
const homeScreen = document.getElementById('home-screen') as HTMLElement;
const charactersScreen = document.getElementById('characters-screen') as HTMLElement;
const storyScreen = document.getElementById('story-screen') as HTMLElement;
const mapScreen = document.getElementById('map-screen') as HTMLElement;
const teamSelectScreen = document.getElementById('team-select-screen') as HTMLElement;
const leaderboardScreen = document.getElementById('leaderboard-screen') as HTMLElement;
const profileScreen = document.getElementById('profile-screen') as HTMLElement;
const walletBtn = document.getElementById('wallet-btn') as HTMLButtonElement;
const walletLabel = document.getElementById('wallet-label') as HTMLElement;

// ─── MAP PREVIEW ENGINE ─────────────────────────────────────────────
let _mapEngine: Engine | null = null;

function startMapPreview(): void {
    const previewCanvas = document.getElementById('map-preview-canvas') as HTMLCanvasElement;
    if (!previewCanvas || _mapEngine) return;

    const engine = new Engine(previewCanvas, true, { adaptToDeviceRatio: true, useHighPrecisionFloats: true });
    _mapEngine = engine;

    const mapScene = new Scene(engine);
    mapScene.clearColor = new Color4(0.04, 0.04, 0.06, 1);

    // Kuş bakışı kamera — sol tık döndür, scroll zoom, sağ tık kaydır
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

    // Dummy shadow generator — createAvaxMap ShadowGenerator bekliyor
    const dummySG = { addShadowCaster: () => { } } as any;
    createAvaxMap(mapScene, dummySG);

    // Base buildings (GLB modeller)
    new BaseBuilding(mapScene, 'fire');
    new BaseBuilding(mapScene, 'ice');
    console.log('[MapPreview] Map loaded');

    // GLB export — console'dan window.exportMapGLB() ile çağır
    (window as any).exportMapGLB = () => exportMapGLB(mapScene);

    engine.runRenderLoop(() => {
        if (mapScene.activeCamera) mapScene.render();
    });
    window.addEventListener('resize', () => engine.resize());
}

function stopMapPreview(): void {
    if (_mapEngine) { _mapEngine.dispose(); _mapEngine = null; }
}

// ─── SCREEN ROUTER ──────────────────────────────────────────────────
type Screen = 'home' | 'characters' | 'story' | 'map' | 'team-select' | 'mode-select' | 'lobby' | 'game' | 'leaderboard' | 'profile' | 'settings';

const difficultyScreen = document.getElementById('difficulty-select') as HTMLElement;
const lobbyScreen = document.getElementById('lobby-screen') as HTMLElement;
const settingsScreen = document.getElementById('settings-screen') as HTMLElement;
const MENU_SCREENS = [homeScreen, charactersScreen, storyScreen, mapScreen, teamSelectScreen, modeSelectEl, difficultyScreen, lobbyScreen, leaderboardScreen, profileScreen, settingsScreen].filter(Boolean) as HTMLElement[];
const GAME_HUD = ['top-hud', 'board-control-meter', 'debug-ui', 'card-tray', 'surge-indicator', 'kite-panel'];

function showScreen(screen: Screen): void {
    console.log('[DEBUG] showScreen:', screen);
    // Hide all menu screens
    for (const el of MENU_SCREENS) {
        if (el) el.style.display = 'none';
    }

    // Map preview engine'ini kapat (map dışındaki her screen'de)
    if (screen !== 'map') stopMapPreview();

    // Header visible on menu screens, hidden in game
    appHeader.style.display = screen === 'game' ? 'none' : 'flex';

    // Hide game HUD on menu screens
    const inGame = screen === 'game';
    for (const id of GAME_HUD) {
        const el = document.getElementById(id);
        if (el) el.style.display = inGame ? '' : 'none';
    }
    canvas.style.display = inGame ? 'block' : 'none';

    // Update active nav highlight
    document.querySelectorAll('.header-nav-item').forEach(btn => btn.classList.remove('active'));
    const navMap: Partial<Record<Screen, string>> = {
        characters: 'nav-characters-header',
        story: 'nav-story-header',
        map: 'nav-map-header',
        leaderboard: 'nav-leaderboard-header',
        profile: 'nav-profile-header',
        settings: 'nav-settings-header',
    };
    if (navMap[screen]) document.getElementById(navMap[screen]!)?.classList.add('active');

    // Varsayılan menü müziği (Avaland Theme)
    const playDefaultMusic = () => switchBGM('/assets/sound/storymusic.mp3', 0.25);
    // Karakter sayfası müziği (Heroes of Fire & Ice)
    const playCharacterMusic = () => switchBGM('/assets/sound/character.mp3', 0.25);
    // Story sayfası müziği (Battle Drums)
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
            updateModeSelectTeamBadge();
            break;
        case 'lobby':
            lobbyScreen.style.display = 'flex';
            initLobbyScreen();
            break;
        case 'leaderboard':
            leaderboardScreen.style.display = 'flex';
            playDefaultMusic();
            // On-chain'den çek ve render et
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

// ─── WALLET CONNECTION (AVAX Fuji Testnet) ──────────────────────────
const FUJI_CHAIN = {
    chainId: '0xa869',
    chainName: 'Avalanche Fuji Testnet',
    rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'],
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    blockExplorerUrls: ['https://testnet.snowtrace.io'],
};

let walletAddress: string | null = null;
let _activeProvider: any = null;

// ─── EIP-6963 WALLET DISCOVERY ──────────────────────────────────────
interface EIP6963Provider {
    info: { uuid: string; name: string; icon: string; rdns: string };
    provider: any;
}

const discoveredWallets: EIP6963Provider[] = [];

window.addEventListener('eip6963:announceProvider', ((e: CustomEvent) => {
    const detail = e.detail as EIP6963Provider;
    // Phantom isMetaMask=true diyor, rdns ile ayırt et
    if (!discoveredWallets.find(w => w.info.rdns === detail.info.rdns)) {
        discoveredWallets.push(detail);
    }
}) as EventListener);

// Keşfi başlat
window.dispatchEvent(new Event('eip6963:requestProvider'));

// ─── AUTO-RECONNECT: sayfa yenilendiğinde önceki cüzdanı sessizce bağla ──
setTimeout(async () => {
    const savedAddr = localStorage.getItem('a2_wallet_address');
    if (!savedAddr) {
        console.log('[AutoConnect] No saved wallet');
        return;
    }
    const savedRdns = localStorage.getItem('a2_wallet_rdns') || '';
    // Kayıtlı rdns ile eşleşen cüzdanı bul
    let autoProvider: any = null;
    let matchedRdns = '';
    if (savedRdns && discoveredWallets.length > 0) {
        const match = discoveredWallets.find(w => w.info.rdns === savedRdns);
        if (match) {
            autoProvider = match.provider;
            matchedRdns = match.info.rdns;
            console.log('[AutoConnect] Matched wallet by rdns:', savedRdns);
        }
    }
    // Fallback: rdns eşleşmezse window.ethereum dene
    if (!autoProvider) {
        autoProvider = (window as any).ethereum;
    }
    if (!autoProvider) {
        console.log('[AutoConnect] No provider found');
        return;
    }
    try {
        const accounts: string[] = await autoProvider.request({ method: 'eth_requestAccounts' });
        if (accounts.length > 0) {
            await connectWithProvider(autoProvider, true, matchedRdns);
            console.log('[AutoConnect] Reconnected:', walletAddress);
        }
    } catch (e) {
        console.warn('[AutoConnect] Failed:', e);
        localStorage.removeItem('a2_wallet_address');
        localStorage.removeItem('a2_wallet_rdns');
    }
}, 500);

// ─── WALLET SELECT MODAL ────────────────────────────────────────────
const walletModal = document.getElementById('wallet-modal')!;
const walletModalClose = document.getElementById('wallet-modal-close')!;
const walletOptionsDiv = walletModal.querySelector('.wallet-options')!;

function showWalletModal() {
    walletOptionsDiv.innerHTML = '';

    if (discoveredWallets.length === 0) {
        // Hiç cüzdan bulunamadı
        walletOptionsDiv.innerHTML = `
            <div class="wallet-no-wallets">
                <div class="wallet-no-wallets-icon">🦊</div>
                <div class="wallet-no-wallets-text">Desteklenen bir cüzdan bulunamadı.<br>Devam etmek için MetaMask kurun.</div>
                <a href="https://metamask.io/download/" target="_blank" class="wallet-install-btn">MetaMask İndir →</a>
            </div>`;
    } else {
        // Keşfedilen cüzdanları listele
        for (const w of discoveredWallets) {
            const opt = document.createElement('div');
            opt.className = 'wallet-option detected';
            opt.innerHTML = `
                <img src="${w.info.icon}" class="wallet-option-icon" style="width:36px;height:36px;border-radius:8px;" alt="${w.info.name}" />
                <div class="wallet-option-info">
                    <div class="wallet-option-name">${w.info.name}</div>
                </div>
                <div class="wallet-option-arrow">›</div>`;
            opt.addEventListener('click', async () => {
                walletModal.classList.remove('show');
                await connectWithProvider(w.provider, false, w.info.rdns);
            });
            walletOptionsDiv.appendChild(opt);
        }
    }

    walletModal.classList.add('show');
}

walletModalClose.addEventListener('click', () => walletModal.classList.remove('show'));
walletModal.addEventListener('click', (e) => {
    if (e.target === walletModal) walletModal.classList.remove('show');
});

// ─── WRONG CHAIN DETECTION ──────────────────────────────────────────
async function ensureFujiChain(provider: any): Promise<boolean> {
    try {
        const chainId = await provider.request({ method: 'eth_chainId' });
        if (chainId === FUJI_CHAIN.chainId) return true;

        // Wrong chain — switch
        try {
            await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: FUJI_CHAIN.chainId }] });
            return true;
        } catch (switchErr: any) {
            if (switchErr.code === 4902) {
                await provider.request({ method: 'wallet_addEthereumChain', params: [FUJI_CHAIN] });
                return true;
            }
            throw switchErr;
        }
    } catch (err: any) {
        console.error('Chain switch failed:', err);
        return false;
    }
}

async function connectWithProvider(provider: any, silent = false, rdns = ''): Promise<void> {
    const _ethers = (window as any).ethers;
    if (!_ethers) {
        if (!silent) alert('ethers kütüphanesi yüklenemedi!');
        return;
    }

    try {
        if (silent) {
            // Silent reconnect — popup açmadan mevcut bağlı hesapları sor
            const accounts: string[] = await provider.request({ method: 'eth_accounts' });
            if (!accounts.length) return; // Daha önce bağlanmamış, sessizce çık
        } else {
            // wallet_requestPermissions ile her seferinde hesap seçim popup'ı aç
            try {
                await provider.request({
                    method: 'wallet_requestPermissions',
                    params: [{ eth_accounts: {} }],
                });
            } catch (permErr: any) {
                if (permErr.code === 4001) return;
                await provider.request({ method: 'eth_requestAccounts' });
            }
        }

        // Chain kontrolü
        const onFuji = await ensureFujiChain(provider);
        if (!onFuji) {
            walletLabel.textContent = '⚠ Wrong Chain';
            walletBtn.classList.add('connected');
            walletBtn.style.borderColor = 'rgba(255,180,0,0.5)';
            walletBtn.style.color = '#ffaa00';
            return;
        }

        _activeProvider = provider;
        (window as any).__activeProvider = provider;
        const ethProvider = new _ethers.BrowserProvider(provider);
        const signer = await ethProvider.getSigner();
        walletAddress = await signer.getAddress();
        (window as any).__walletAddress = walletAddress;
        localStorage.setItem('a2_wallet_address', walletAddress!);
        if (rdns) localStorage.setItem('a2_wallet_rdns', rdns);
        const balance = await ethProvider.getBalance(walletAddress);
        const balStr = parseFloat(_ethers.formatEther(balance)).toFixed(3);

        // Update UI
        const short = walletAddress!.slice(0, 6) + '...' + walletAddress!.slice(-4);
        walletLabel.textContent = `${short} · ${balStr} AVAX`;
        walletBtn.classList.add('connected');
        walletBtn.style.borderColor = '';
        walletBtn.style.color = '';

        // Register in local leaderboard (username = short address until profile created)
        leaderboardService.upsertPlayer(walletAddress!, short);

        // Profil kontrolü — yoksa kayıt formunu aç, oyuna girilemez
        profileService.walletAddress = walletAddress;
        profileService.isConnected = true;
        await profileService.loadProfile();
        if (!profileService.currentProfile) {
            // Profil yok → profil ekranını aç (register formu göster)
            lockGameUntilProfile(true);
            showScreen('profile');
        } else {
            // Profil var → leaderboard'da gerçek isimle güncelle
            leaderboardService.upsertPlayer(walletAddress!, profileService.currentProfile.username);
            lockGameUntilProfile(false);
        }

        // Sync on-chain leaderboard in background
        syncOnChainLeaderboard().catch(() => { });

        // Lobby açıksa wallet durumunu güncelle
        if (lobbyScreen.style.display !== 'none') {
            initLobbyScreen();
        }

        // Chain değişikliğini dinle
        provider.on?.('chainChanged', async (newChainId: string) => {
            if (newChainId !== FUJI_CHAIN.chainId) {
                walletLabel.textContent = '⚠ Wrong Chain';
                walletBtn.style.borderColor = 'rgba(255,180,0,0.5)';
                walletBtn.style.color = '#ffaa00';
            } else {
                // Doğru chain'e döndü, bilgileri güncelle
                const ep = new _ethers.BrowserProvider(provider);
                const s = await ep.getSigner();
                const bal = await ep.getBalance(await s.getAddress());
                const bs = parseFloat(_ethers.formatEther(bal)).toFixed(3);
                const sh = walletAddress!.slice(0, 6) + '...' + walletAddress!.slice(-4);
                walletLabel.textContent = `${sh} · ${bs} AVAX`;
                walletBtn.style.borderColor = '';
                walletBtn.style.color = '';
            }
        });

        // Hesap değişikliğini dinle
        provider.on?.('accountsChanged', async (accounts: string[]) => {
            if (!accounts.length) {
                walletAddress = null;
                (window as any).__walletAddress = null;
                _activeProvider = null;
                (window as any).__activeProvider = null;
                localStorage.removeItem('a2_wallet_address');
                localStorage.removeItem('a2_wallet_rdns');
                profileService.walletAddress = null;
                profileService.isConnected = false;
                profileService.currentProfile = null;
                walletLabel.textContent = t('connectWallet' as any);
                walletBtn.classList.remove('connected');
                walletBtn.style.borderColor = '';
                walletBtn.style.color = '';
                if (lobbyScreen.style.display !== 'none') initLobbyScreen();
            } else {
                // Yeni hesaba geçiş — bilgileri güncelle (reload yok)
                const ep = new _ethers.BrowserProvider(provider);
                const s = await ep.getSigner();
                walletAddress = await s.getAddress();
                (window as any).__walletAddress = walletAddress;
                localStorage.setItem('a2_wallet_address', walletAddress!);
                const bal = await ep.getBalance(walletAddress);
                const bs = parseFloat(_ethers.formatEther(bal)).toFixed(3);
                const sh = walletAddress!.slice(0, 6) + '...' + walletAddress!.slice(-4);
                walletLabel.textContent = `${sh} · ${bs} AVAX`;
                walletBtn.classList.add('connected');
                walletBtn.style.borderColor = '';
                walletBtn.style.color = '';
                // Profil güncelle
                leaderboardService.upsertPlayer(walletAddress!, sh);
                profileService.walletAddress = walletAddress;
                profileService.isConnected = true;
                profileService.currentProfile = null;
                await profileService.loadProfile();
                if (!profileService.currentProfile) {
                    lockGameUntilProfile(true);
                    showScreen('profile');
                } else {
                    lockGameUntilProfile(false);
                }
                if (lobbyScreen.style.display !== 'none') initLobbyScreen();
            }
        });
    } catch (err: any) {
        console.error('Wallet connection failed:', err);
        if (!silent) alert('Cüzdan bağlantısı başarısız: ' + (err.message || err));
    }
}

walletBtn.addEventListener('click', () => {
    if (!walletAddress) {
        // Wrong chain durumunda tıklayınca düzelt
        if (walletLabel.textContent === '⚠ Wrong Chain' && _activeProvider) {
            ensureFujiChain(_activeProvider).then(ok => {
                if (ok) connectWithProvider(_activeProvider);
            });
            return;
        }
        showWalletModal();
    } else {
        // Bağlıyken dropdown aç/kapa
        const dd = document.getElementById('wallet-dropdown')!;
        dd.classList.toggle('show');
    }
});

// ─── WALLET DROPDOWN ────────────────────────────────────────────────
const ddProfile = document.getElementById('dd-profile')!;
const ddDisconnect = document.getElementById('dd-disconnect')!;
const walletDropdown = document.getElementById('wallet-dropdown')!;

ddProfile.addEventListener('click', () => {
    walletDropdown.classList.remove('show');
    showScreen('profile');
});

ddDisconnect.addEventListener('click', () => {
    walletDropdown.classList.remove('show');
    // State sıfırla
    walletAddress = null;
    (window as any).__walletAddress = null;
    _activeProvider = null;
    (window as any).__activeProvider = null;
    localStorage.removeItem('a2_wallet_address');
    localStorage.removeItem('a2_wallet_rdns');
    profileService.walletAddress = null;
    profileService.isConnected = false;
    profileService.currentProfile = null;
    // UI sıfırla
    walletLabel.textContent = t('connectWallet' as any);
    walletBtn.classList.remove('connected');
    walletBtn.style.borderColor = '';
    walletBtn.style.color = '';
    lockGameUntilProfile(true);
    showScreen('home');
});

// Dropdown dışına tıklayınca kapat
document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('wallet-wrapper')!;
    if (!wrapper.contains(e.target as Node)) {
        walletDropdown.classList.remove('show');
    }
});

// ─── PROFILE MODAL ──────────────────────────────────────────────────
const profileModal = document.getElementById('profile-modal')!;
const profileCloseBtn = document.getElementById('profile-close')!;
const profileRegisterDiv = document.getElementById('profile-register')!;
const profileViewDiv = document.getElementById('profile-view')!;
const profileNotConnected = document.getElementById('profile-not-connected')!;
const profileConnectBtn = document.getElementById('profile-connect-btn')!;
const profileRegisterBtn = document.getElementById('profile-register-btn') as HTMLButtonElement;
const profileNameInput = document.getElementById('profile-name-input') as HTMLInputElement;
const profileAvatarInput = document.getElementById('profile-avatar-input') as HTMLInputElement;
const avatarPreview = document.getElementById('avatar-preview') as HTMLImageElement;

/** Profil olmadan oyuna girişi engelle / aç */
function lockGameUntilProfile(locked: boolean) {
    const playBtn = document.getElementById('nav-play');
    if (playBtn) {
        (playBtn as HTMLButtonElement).disabled = locked;
        playBtn.style.opacity = locked ? '0.35' : '';
        playBtn.style.cursor = locked ? 'not-allowed' : '';
        playBtn.title = locked ? 'Oyuna girmek için profil oluştur' : '';
    }
}

profileCloseBtn.addEventListener('click', () => {
    // Profil yokken modal kapatılamaz
    if (walletAddress && !profileService.currentProfile) return;
    profileModal.classList.remove('show');
});
profileModal.addEventListener('click', (e) => {
    // Profil yokken dışarı tıklayınca kapatılmaz
    if (walletAddress && !profileService.currentProfile) return;
    if (e.target === profileModal) profileModal.classList.remove('show');
});

profileConnectBtn.addEventListener('click', () => {
    profileModal.classList.remove('show');
    showWalletModal();
});

profileAvatarInput.addEventListener('input', () => {
    const url = profileAvatarInput.value.trim();
    if (url) avatarPreview.src = url;
    else avatarPreview.src = '/assets/images/logo.png';
});

profileRegisterBtn.addEventListener('click', async () => {
    const username = profileNameInput.value.trim();
    if (!username || username.length > 32) {
        profileNameInput.style.borderColor = '#ff5555';
        return;
    }
    profileNameInput.style.borderColor = '';
    const avatarURI = profileAvatarInput.value.trim();

    profileRegisterBtn.disabled = true;
    profileRegisterBtn.textContent = 'KAYDEDİLİYOR...';

    const ok = await profileService.registerProfile(username, avatarURI);
    profileRegisterBtn.disabled = false;
    profileRegisterBtn.textContent = 'KAYIT OL';

    if (ok) {
        // Leaderboard'a ekle
        leaderboardService.upsertPlayer(walletAddress!, username);
        // Kilidi aç
        lockGameUntilProfile(false);
        // Profil view'ı göster
        openProfileModal();
    } else {
        alert('Kayıt başarısız.');
    }
});

/** Haftalık ödül havuzu banner'ını güncelle */
function updatePrizePoolBanner() {
    const info = leaderboardService.getPrizePoolInfo();
    const banner = document.getElementById('weekly-prize-banner');
    const totalEl = document.getElementById('wpb-total-amount');
    const prize1El = document.getElementById('wpb-prize-1');
    const prize2El = document.getElementById('wpb-prize-2');
    const prize3El = document.getElementById('wpb-prize-3');
    const noteEl = document.getElementById('wpb-note');

    if (!banner) return;

    if (!info.enabled) {
        banner.classList.add('wpb-disabled');
    } else {
        banner.classList.remove('wpb-disabled');
    }

    if (totalEl) totalEl.textContent = info.totalFee.toFixed(4);
    if (prize1El) prize1El.textContent = info.prizes[0]?.avax.toFixed(4) ?? '—';
    if (prize2El) prize2El.textContent = info.prizes[1]?.avax.toFixed(4) ?? '—';
    if (prize3El) prize3El.textContent = info.prizes[2]?.avax.toFixed(4) ?? '—';
    if (noteEl && !info.enoughForDistribution && info.totalFee > 0) {
        noteEl.textContent = `Minimum ${info.minPool} AVAX gerekli · Şu an: ${info.totalFee.toFixed(4)} AVAX`;
    }
}

/** Leaderboard render (on-chain + localStorage fallback) */
async function renderLocalLeaderboard(sortBy: 'wins' | 'weeklyWins' | 'betWon' = 'wins') {
    const lbBody = document.getElementById('leaderboard-body')!;
    let entries: any[];
    try {
        const onChain = await profileService.getLeaderboard();
        if (onChain.length > 0) {
            entries = onChain.map((e: any) => {
                const local = leaderboardService.getPlayer(e.address);
                return {
                    ...e,
                    weeklyWins: local?.weeklyWins ?? 0,
                    totalBetWon: local?.totalBetWon ?? 0,
                };
            });
            if (sortBy === 'weeklyWins') entries.sort((a: any, b: any) => b.weeklyWins - a.weeklyWins);
            else if (sortBy === 'betWon') entries.sort((a: any, b: any) => b.totalBetWon - a.totalBetWon);
            else entries.sort((a: any, b: any) => b.wins - a.wins || b.winRate - a.winRate);
            entries.forEach((e: any, i: number) => e.rank = i + 1);
        } else {
            entries = leaderboardService.getLeaderboard(sortBy);
        }
    } catch {
        entries = leaderboardService.getLeaderboard(sortBy);
    }
    lbBody.innerHTML = '';

    for (const e of entries) {
        const isMe = e.address.toLowerCase() === (walletAddress ?? '').toLowerCase();
        const tr = document.createElement('tr');
        if (isMe) tr.className = 'is-me';

        const prizeCell = e.weeklyPrize && e.weeklyPrize > 0
            ? `<td class="lb-prize-cell">${e.weeklyPrize.toFixed(4)}</td>`
            : `<td class="lb-prize-none">—</td>`;

        const gamesPlayed = e.wins + e.losses + e.draws;
        tr.innerHTML = `
            <td class="lb-rank ${e.rank <= 3 ? 'lb-rank-' + e.rank : ''}">${e.rank}</td>
            <td>${e.username}</td>
            <td>${sortBy === 'weeklyWins' ? e.weeklyWins : e.wins}</td>
            <td>${gamesPlayed}</td>
            <td class="lb-winrate">${e.winRate}%</td>
            ${prizeCell}
        `;
        lbBody.appendChild(tr);
    }

    if (entries.length === 0) {
        lbBody.innerHTML = `<tr><td colspan="6" style="color:rgba(255,255,255,0.25);padding:12px;text-align:center;">${t('lbTableEmpty' as TransKey)}</td></tr>`;
    }
}

async function openProfileModal() {
    profileViewDiv.style.display = 'none';
    profileNotConnected.style.display = 'none';

    if (!walletAddress) {
        profileNotConnected.style.display = '';
        profileModal.classList.add('show');
        return;
    }

    // Connect ProfileService if not already
    if (!profileService.isConnected) {
        profileService.walletAddress = walletAddress;
        profileService.isConnected = true;
        await profileService.loadProfile();
    }

    let profile = profileService.currentProfile;

    if (!profile) {
        // Profil yok → register formunu göster
        profileRegisterDiv.style.display = '';
        profileViewDiv.style.display = 'none';
        profileNotConnected.style.display = 'none';
        profileModal.classList.add('show');
        return;
    }

    // Show profile + leaderboard
    const profAvatar = document.getElementById('profile-avatar') as HTMLImageElement;
    const profName = document.getElementById('profile-display-name')!;
    const profAddr = document.getElementById('profile-display-addr')!;

    profName.textContent = profile.username;
    profAddr.textContent = profileService.shortAddress();
    profAvatar.src = profile.avatarURI || '/assets/images/logo.png';

    document.getElementById('prof-games')!.textContent = String(profile.gamesPlayed);
    document.getElementById('prof-wins')!.textContent = String(profile.wins);
    document.getElementById('prof-losses')!.textContent = String(profile.losses);
    document.getElementById('prof-draws')!.textContent = String(profile.draws);

    // Load leaderboard
    const lbBody = document.getElementById('leaderboard-body')!;
    lbBody.innerHTML = '<tr><td colspan="6" style="color:rgba(255,255,255,0.3);padding:12px;">...</td></tr>';

    profileViewDiv.style.display = '';
    profileModal.classList.add('show');

    // Rename handler
    const renameBtn = document.getElementById('profile-rename-btn');
    const renameInput = document.getElementById('profile-rename-input') as HTMLInputElement;
    if (renameBtn && renameInput) {
        renameBtn.onclick = async () => {
            const newName = renameInput.value.trim();
            if (!newName || newName.length > 32) return;
            await profileService.registerProfile(newName, profile!.avatarURI ?? '');
            profName.textContent = newName;
            renameInput.value = '';
            // Update leaderboard entry
            leaderboardService.upsertPlayer(walletAddress!, newName);
            renderLocalLeaderboard('wins');
            showToast('İsim güncellendi ✓', 2000);
        };
    }

    // Wire sort tabs
    document.querySelectorAll<HTMLButtonElement>('.lb-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            void renderLocalLeaderboard(tab.dataset.sort as any);
        });
    });

    // On-chain leaderboard render
    void renderLocalLeaderboard('wins');
}

// ─── TEAM SELECTION ──────────────────────────────────────────────────
let selectedTeam: 'fire' | 'ice' = 'fire';

document.querySelectorAll<HTMLElement>('.team-half').forEach(card => {
    card.addEventListener('click', () => {
        selectedTeam = card.dataset.team as 'fire' | 'ice';
        console.log('[DEBUG] Team selected:', selectedTeam, 'gameMode:', gameMode);
        // Seçilen moda göre devam et
        if (gameMode === 'realtime') {
            teamSelectScreen.style.display = 'none';
            difficultyScreen.style.display = 'flex';
        } else if (gameMode === 'multiplayer') {
            showScreen('lobby');
        } else {
            // twoplayer
            showScreen('game');
            boot('twoplayer').catch(console.error);
        }
    });
});

// Update mode-select screen with selected team indicator
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
    if (selectedTeam === 'fire') {
        badge.style.color = 'rgba(255,85,32,0.55)';
        badge.style.background = 'rgba(255,85,32,0.05)';
        badge.style.border = '1px solid rgba(255,85,32,0.15)';
        badge.innerHTML = 'Ateş Klanı';
    } else {
        badge.style.color = 'rgba(56,170,255,0.55)';
        badge.style.background = 'rgba(56,170,255,0.05)';
        badge.style.border = '1px solid rgba(56,170,255,0.15)';
        badge.innerHTML = 'Buz Klanı';
    }
}

// ─── ON-CHAIN LEADERBOARD SYNC ──────────────────────────────────────
async function syncOnChainLeaderboard(): Promise<void> {
    try {
        const entries = await profileService.getLeaderboard();
        if (entries.length > 0) {
            for (const e of entries) {
                leaderboardService.upsertPlayer(e.address, e.username);
                // On-chain stats'ları da localStorage'a sync et
                const existing = leaderboardService.getPlayer(e.address);
                if (existing && e.wins > existing.wins) {
                    // On-chain daha güncel — wins farkı kadar recordResult çağır
                    const diff = e.wins - existing.wins;
                    for (let i = 0; i < diff; i++) {
                        leaderboardService.recordResult(e.address, 'win');
                    }
                }
            }
        }
    } catch {
        // Contract not deployed or RPC error — silently ignore
    }
}

// ─── LEADERBOARD SCREEN RENDER ──────────────────────────────────────
async function renderLeaderboardScreen(sortBy: 'wins' | 'weeklyWins' | 'betWon' = 'wins') {
    // Prize pool
    const info = leaderboardService.getPrizePoolInfo();
    const totalEl = document.getElementById('lb-screen-total');
    if (totalEl) totalEl.textContent = info.totalFee.toFixed(4);

    // On-chain'den çek, fallback localStorage
    let entries: any[];
    try {
        const onChain = await profileService.getLeaderboard();
        if (onChain.length > 0) {
            // On-chain entries'e leaderboardService'den weekly/bet bilgisi ekle
            entries = onChain.map((e: any, i: number) => {
                const local = leaderboardService.getPlayer(e.address);
                return {
                    ...e,
                    weeklyWins: local?.weeklyWins ?? 0,
                    weeklyBetWon: local?.weeklyBetWon ?? 0,
                    totalBetWon: local?.totalBetWon ?? 0,
                    totalBetLost: local?.totalBetLost ?? 0,
                    weeklyPrize: undefined as number | undefined,
                };
            });
            // Sort
            if (sortBy === 'weeklyWins') entries.sort((a: any, b: any) => b.weeklyWins - a.weeklyWins || b.wins - a.wins);
            else if (sortBy === 'betWon') entries.sort((a: any, b: any) => b.totalBetWon - a.totalBetWon);
            else entries.sort((a: any, b: any) => b.wins - a.wins || b.winRate - a.winRate);
            entries.forEach((e: any, i: number) => {
                e.rank = i + 1;
                if (info.enabled && info.totalFee >= info.minPool && i < 3) {
                    const ratios = leaderboardService.prizeConfig.prizeRatios;
                    e.weeklyPrize = +(info.totalFee * (ratios[i] / 100)).toFixed(4);
                }
            });
        } else {
            entries = leaderboardService.getLeaderboard(sortBy);
        }
    } catch {
        entries = leaderboardService.getLeaderboard(sortBy);
    }

    // ── Podium (top 3 cards) ──
    const podiumEl = document.getElementById('lb-podium')!;
    podiumEl.innerHTML = '';

    if (entries.length === 0) {
        podiumEl.innerHTML = `<div class="lb-podium-empty">${t('lbPodiumEmpty' as TransKey)}</div>`;
    } else {
        const podiumOrder = [1, 0, 2]; // visual order: 2nd, 1st, 3rd
        for (const idx of podiumOrder) {
            if (idx >= entries.length) continue;
            const e = entries[idx];
            const pClass = idx === 0 ? 'p1' : idx === 1 ? 'p2' : 'p3';
            const rankLabel = idx === 0 ? '1' : idx === 1 ? '2' : '3';
            const gamesPlayed = e.wins + e.losses + e.draws;
            const winVal = sortBy === 'weeklyWins' ? e.weeklyWins : e.wins;
            const winLabel = sortBy === 'weeklyWins' ? t('lbPodiumWeek' as TransKey) : t('lbPodiumWins' as TransKey);
            const prizeHtml = e.weeklyPrize && e.weeklyPrize > 0
                ? `<div class="lb-podium-prize">${e.weeklyPrize.toFixed(4)} AVAX</div>
                   <div class="lb-podium-prize-lbl">${t('lbPodiumPrize' as TransKey)}</div>`
                : '';

            const card = document.createElement('div');
            card.className = `lb-podium-card ${pClass}`;
            card.innerHTML = `
                <div class="lb-podium-rank">${rankLabel}</div>
                <img class="lb-podium-avatar" src="/assets/images/logo.png" alt="" onerror="this.src='/assets/images/logo.png'" />
                <div class="lb-podium-name">${e.username}</div>
                <div class="lb-podium-addr">${e.address.slice(0, 6)}…${e.address.slice(-4)}</div>
                <div class="lb-podium-stats">
                    <div class="lb-podium-stat">
                        <div class="lb-podium-stat-val">${winVal}</div>
                        <div class="lb-podium-stat-lbl">${winLabel}</div>
                    </div>
                    <div class="lb-podium-stat">
                        <div class="lb-podium-stat-val" style="color:rgba(255,255,255,0.5);font-size:14px;">${gamesPlayed}</div>
                        <div class="lb-podium-stat-lbl">${t('lbPodiumGames' as TransKey)}</div>
                    </div>
                </div>
                <div class="lb-podium-winrate">${e.winRate}% W/R</div>
                ${prizeHtml}
            `;
            podiumEl.appendChild(card);
        }
    }

    // ── Table (rank 4+) ──
    const lbBody = document.getElementById('lb-screen-body')!;
    const remaining = entries.slice(3);
    lbBody.innerHTML = '';

    if (entries.length <= 3 && entries.length > 0) {
        // All in podium, show a subtle message in table
        lbBody.innerHTML = `<tr><td colspan="6" style="color:rgba(255,255,255,0.12);padding:24px;text-align:center;font-size:11px;">${t('lbTableWaiting' as TransKey)}</td></tr>`;
    } else if (entries.length === 0) {
        lbBody.innerHTML = `<tr><td colspan="6"><div class="lb-empty-state"><div class="lb-empty-state-icon">--</div>${t('lbTableEmpty' as TransKey)}</div></td></tr>`;
    }

    for (const e of remaining) {
        const isMe = e.address.toLowerCase() === (walletAddress ?? '').toLowerCase();
        const tr = document.createElement('tr');
        if (isMe) tr.className = 'lb-me';

        const gamesPlayed = e.wins + e.losses + e.draws;
        const winVal = sortBy === 'weeklyWins' ? e.weeklyWins : e.wins;
        const prize = e.weeklyPrize && e.weeklyPrize > 0
            ? `<span class="lb-prize-val">${e.weeklyPrize.toFixed(4)}</span>`
            : `<span class="lb-prize-empty">—</span>`;

        const rateClass = e.winRate >= 60 ? 'high' : e.winRate >= 40 ? 'mid' : '';

        tr.innerHTML = `
            <td><span class="lb-rank-num lb-rank-4up">${e.rank}</span></td>
            <td>
              <div class="lb-player-cell">
                <img class="lb-player-avatar" src="/assets/images/logo.png" alt="" onerror="this.src='/assets/images/logo.png'" />
                <div>
                  <div class="lb-player-name">${e.username}</div>
                  <div class="lb-player-addr">${e.address.slice(0, 6)}…${e.address.slice(-4)}</div>
                </div>
              </div>
            </td>
            <td><span class="lb-win-count">${winVal}</span></td>
            <td><span class="lb-games-count">${gamesPlayed}</span></td>
            <td><span class="lb-rate-pill ${rateClass}">${e.winRate}%</span></td>
            <td>${prize}</td>
        `;
        lbBody.appendChild(tr);
    }
}

// Wire leaderboard screen sort tabs
document.querySelectorAll<HTMLButtonElement>('.lb-sort-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.lb-sort-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        void renderLeaderboardScreen(tab.dataset.sort as any);
    });
});

// ─── PROFILE SCREEN RENDER ───────────────────────────────────────────
function renderProfileScreen() {
    const notConn = document.getElementById('pfs-not-connected')!;
    const regWrap = document.getElementById('pfs-register')!;
    const viewWrap = document.getElementById('pfs-view')!;

    notConn.style.display = 'none';
    regWrap.style.display = 'none';
    viewWrap.style.display = 'none';

    if (!walletAddress) {
        notConn.style.display = '';
        return;
    }

    const profile = profileService.currentProfile;
    if (!profile) {
        // Show register form
        regWrap.style.display = '';

        const nameInput = document.getElementById('pfs-name-input') as HTMLInputElement;
        const avatarInput = document.getElementById('pfs-avatar-input') as HTMLInputElement;
        const avatarPreviewEl = document.getElementById('pfs-avatar-preview') as HTMLImageElement;
        const regBtn = document.getElementById('pfs-register-btn') as HTMLButtonElement;

        avatarInput.oninput = () => {
            const url = avatarInput.value.trim();
            avatarPreviewEl.src = url || '/assets/images/logo.png';
        };

        regBtn.onclick = async () => {
            const username = nameInput.value.trim();
            if (!username || username.length > 32) { nameInput.style.borderColor = '#ff5555'; return; }
            nameInput.style.borderColor = '';
            regBtn.disabled = true;
            regBtn.textContent = 'KAYDEDİLİYOR...';
            const ok = await profileService.registerProfile(username, avatarInput.value.trim());
            regBtn.disabled = false;
            regBtn.textContent = 'KAYIT OL';
            if (ok) {
                leaderboardService.upsertPlayer(walletAddress!, username);
                lockGameUntilProfile(false);
                renderProfileScreen();
            } else {
                alert('Kayıt başarısız.');
            }
        };
        return;
    }

    // Show profile view
    viewWrap.style.display = '';
    const avatarImg = document.getElementById('pfs-avatar-img') as HTMLImageElement;
    avatarImg.src = profile.avatarURI || '/assets/images/logo.png';
    document.getElementById('pfs-display-name')!.textContent = profile.username;
    document.getElementById('pfs-display-addr')!.textContent = profileService.shortAddress();
    document.getElementById('pfs-games')!.textContent = String(profile.gamesPlayed);
    document.getElementById('pfs-wins')!.textContent = String(profile.wins);
    document.getElementById('pfs-losses')!.textContent = String(profile.losses);
    document.getElementById('pfs-draws')!.textContent = String(profile.draws);

    // Rename
    const renameInput = document.getElementById('pfs-rename-input') as HTMLInputElement;
    const renameBtn = document.getElementById('pfs-rename-btn')!;
    renameBtn.onclick = async () => {
        const newName = renameInput.value.trim();
        if (!newName || newName.length > 32) return;
        await profileService.registerProfile(newName, profile.avatarURI ?? '');
        document.getElementById('pfs-display-name')!.textContent = newName;
        renameInput.value = '';
        leaderboardService.upsertPlayer(walletAddress!, newName);
        showToast('İsim güncellendi ✓', 2000);
    };
}

// Profile screen connect button
document.getElementById('pfs-connect-btn')?.addEventListener('click', () => showWalletModal());

// ─── NAV WIRING ─────────────────────────────────────────────────────
document.getElementById('nav-play')!.addEventListener('click', () => {
    console.log('[DEBUG] nav-play clicked, walletAddress:', walletAddress, 'profile:', profileService.currentProfile?.username);
    if (!walletAddress || !profileService.currentProfile) {
        console.log('[DEBUG] Blocked — showing wallet modal');
        showWalletModal();
        showToast('Oyuna girmek icin cuzdanini bagla ve profil olustur!');
        return;
    }
    console.log('[DEBUG] Showing mode-select');
    showScreen('mode-select');
});

// Sayfa açılışında: cüzdan/profil yoksa OYNA butonunu kilitle
lockGameUntilProfile(true);

// Header nav items
document.getElementById('nav-characters-header')?.addEventListener('click', () => showScreen('characters'));
document.getElementById('nav-story-header')?.addEventListener('click', () => showScreen('story'));
document.getElementById('nav-map-header')?.addEventListener('click', () => showScreen('map'));
document.getElementById('nav-leaderboard-header')?.addEventListener('click', () => showScreen('leaderboard'));
document.getElementById('nav-profile-header')?.addEventListener('click', () => showScreen('profile'));
document.getElementById('nav-settings-header')?.addEventListener('click', () => showScreen('settings'));
document.getElementById('header-logo')?.addEventListener('click', () => showScreen('home'));

// ─── CHARACTER SELECT SCREEN LOGIC ──────────────────────────────────
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
    tepegoz: { name: 'TEPEGÖZ', roleKey: 'roleTank', faction: 'merc', hp: 300, atk: 20, arm: 12, spd: 3, abilityNameKey: 'tepegozAbilName', abilityDescKey: 'tepegozAbilDesc', loreKey: 'tepegozLore' },
    sahmeran: { name: 'ŞAHMERAN', roleKey: 'rolePoisoner', faction: 'merc', hp: 130, atk: 32, arm: 1, spd: 7, abilityNameKey: 'sahmeranAbilName', abilityDescKey: 'sahmeranAbilDesc', loreKey: 'sahmeranLore' },
    boru: { name: 'BÖRÜ', roleKey: 'roleSpiritWolf', faction: 'merc', hp: 180, atk: 28, arm: 5, spd: 6, abilityNameKey: 'boruAbilName', abilityDescKey: 'boruAbilDesc', loreKey: 'boruLore' },
};

const CS_MAX = { hp: 300, atk: 35, arm: 12, spd: 10 };
const CS_BLOCKS = 12; // segmented bar block count

function buildSegBar(containerId: string, value: number, max: number, faction: string) {
    const el = document.getElementById(containerId)!;
    const filled = Math.round((value / max) * CS_BLOCKS);
    el.innerHTML = '';
    for (let i = 0; i < CS_BLOCKS; i++) {
        const block = document.createElement('div');
        block.className = i < filled ? `cs-seg-block filled ${faction}` : 'cs-seg-block empty';
        el.appendChild(block);
    }
}

// ─── CHARACTER SELECT ────────────────────────────────────────────────
let currentCharId = 'korhan';

function selectCharacter(charId: string) {
    currentCharId = charId;
    const d = CS_DATA[charId];
    if (!d) return;

    const f = d.faction;
    const imgOverrides: Record<string, string> = { boru: 'börü' };
    const imgName = imgOverrides[charId] ?? charId;
    const imgUrl = `/assets/images/characters/${imgName}.png`;

    // Background blur
    (document.getElementById('cs-bg')! as HTMLElement).style.backgroundImage = `url('${imgUrl}')`;

    // Hero PNG — fade geçişi
    const heroImg = document.getElementById('cs-hero-img') as HTMLImageElement;
    heroImg.style.opacity = '0';
    setTimeout(() => {
        heroImg.src = imgUrl;
        heroImg.style.opacity = '1';
    }, 150);

    // Glow
    document.getElementById('cs-hero-glow')!.className = 'cs-hero-glow ' + f;

    // Left: class badge, name, lore
    const badge = document.getElementById('cs-class-badge')!;
    badge.className = 'cs-class-badge ' + f;
    badge.innerHTML = `${t(d.roleKey)}`;

    document.getElementById('cs-hero-name')!.textContent = d.name;
    document.getElementById('cs-hero-lore-text')!.textContent = t(d.loreKey);

    // Right: segmented bars
    buildSegBar('cs-seg-hp', d.hp, CS_MAX.hp, f);
    buildSegBar('cs-seg-atk', d.atk, CS_MAX.atk, f);
    buildSegBar('cs-seg-arm', d.arm, CS_MAX.arm, f);
    buildSegBar('cs-seg-spd', d.spd, CS_MAX.spd, f);

    // Ability box
    const abilBox = document.getElementById('cs-ability-box')!;
    abilBox.className = 'cs-ability-box ' + f;
    document.getElementById('cs-ability-name')!.textContent = t(d.abilityNameKey);
    document.getElementById('cs-ability-desc')!.textContent = t(d.abilityDescKey);

    // Carousel active
    document.querySelectorAll<HTMLElement>('.cs-carousel-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.char === charId) item.classList.add('active');
    });
}

// Wire carousel clicks
document.querySelectorAll<HTMLElement>('.cs-carousel-item').forEach(item => {
    item.addEventListener('click', () => selectCharacter(item.dataset.char!));
});

// Back to lobby from bottom
document.getElementById('cs-back-lobby')?.addEventListener('click', () => showScreen('home'));

// Default selection
selectCharacter('korhan');

document.getElementById('header-logo')!.addEventListener('click', () => showScreen('home'));
document.getElementById('mode-back')!.addEventListener('click', () => showScreen('home'));
document.getElementById('team-back')?.addEventListener('click', () => showScreen('mode-select'));
document.getElementById('settings-back')?.addEventListener('click', () => showScreen('home'));

// Start at home
showScreen('home');

// ─── GAME STATE ──────────────────────────────────────────────────────
type GameMode = 'realtime' | 'twoplayer' | 'multiplayer';
type Phase = 'player' | 'enemy';

let gameMode: GameMode = 'realtime';
let phase: Phase = 'player';
let playerMana = 0;
let iceMana = 0;           // 2P mode ice player mana
const MAX_MANA = 12;
let playerAvx = 0;        // AVX currency for mercenary units
let iceAvx = 0;           // 2P mode ice player AVX
/** Multiplayer: her iki taraf yüklenince true, prompt/kart kullanımını korur */
let mpGameStarted = false;
let turnCount = 1;
let selectedPromptId: string | null = null;
let bonusMana = 0;
let pendingCard: CardDef | null = null;

// Realtime / 2P accumulators
const MANA_REGEN_INTERVAL = 3.0;  // saniye — her bu kadar sürede +1 mana
let realtimeManaAccum = 0;
let realtimeAiAccum = 0;
let iceManaAccum = 0;
let selectedIceCardId: UnitType | null = null;
let difficultyLevel = 1; // 1-7, affects AI speed/strength

// ─── MODE SELECT WIRING ───────────────────────────────────────────────
const modeBtns = document.querySelectorAll<HTMLButtonElement>('.mode-btn');
console.log('[DEBUG] Mode buttons found:', modeBtns.length);
modeBtns.forEach(btn => {
    console.log('[DEBUG] Wiring mode-btn:', btn.dataset.mode);
    btn.addEventListener('click', () => {
        console.log('[DEBUG] Mode clicked:', btn.dataset.mode);
        gameMode = btn.dataset.mode as GameMode;
        // Tüm modlarda önce takım seçimine git
        showScreen('team-select');
    });
});

// Difficulty buttons
document.querySelectorAll<HTMLButtonElement>('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        console.log('[DEBUG] Difficulty clicked:', btn.dataset.diff);
        difficultyLevel = parseInt(btn.dataset.diff ?? '1');
        difficultyScreen.style.display = 'none';
        showScreen('game');
        boot('realtime').catch(err => console.error('[DEBUG] boot() error:', err));
    });
});

// Gökyüzü butonu — ironik mesaj toast olarak açılır/kapanır
document.getElementById('diff-sky')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const wrap = document.getElementById('diff-sky')!.closest('.diff-sky-btn-wrap')!;
    wrap.classList.toggle('revealed');
});

// Toast dışına tıklanınca kapat
document.addEventListener('click', () => {
    document.querySelector('.diff-sky-btn-wrap.revealed')?.classList.remove('revealed');
});

document.getElementById('diff-back')?.addEventListener('click', () => {
    difficultyScreen.style.display = 'none';
    showScreen('team-select');
});

// ─── LOBİ EKRANI ─────────────────────────────────────────────────────
let lobbyTeam: 'fire' | 'ice' | null = null;

function showLobbyError(msg: string) {
    const el = document.getElementById('lobby-error')!;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}

/** Generic floating toast — top center */
function showToast(msg: string, durationMs = 4000) {
    const existing = document.getElementById('a2-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'a2-toast';
    el.textContent = msg;
    el.style.cssText = `
        position:fixed;top:72px;left:50%;transform:translateX(-50%);
        z-index:9999;
        background:rgba(4,3,16,0.95);
        border:1px solid rgba(255,185,50,0.4);
        border-radius:8px;padding:10px 20px;
        color:#ffc94d;font-family:'Cinzel',serif;
        font-size:11px;letter-spacing:1px;
        box-shadow:0 0 20px rgba(255,185,50,0.15);
        animation:fadeUp 0.3s ease;
        pointer-events:none;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), durationMs);
}

function setLobbyState(state: 'team-pick' | 'actions' | 'waiting' | 'connected' | 'qm-waiting') {
    document.getElementById('lobby-team-pick')!.style.display = state === 'team-pick' ? 'block' : 'none';
    document.getElementById('lobby-actions')!.style.display = state === 'actions' ? 'flex' : 'none';
    document.getElementById('lobby-waiting')!.style.display = state === 'waiting' ? 'block' : 'none';
    document.getElementById('lobby-connected')!.style.display = state === 'connected' ? 'block' : 'none';
    const qmWaiting = document.getElementById('lobby-qm-waiting');
    if (qmWaiting) qmWaiting.style.display = state === 'qm-waiting' ? 'block' : 'none';
}

function updateLobbyConnectedUI() {
    const myName = (lobbyTeam === 'fire' ? t('lobbyFireName') : t('lobbyIceName')) + ' ' + t('lobbyMySuffix');
    const oppTeam = mpService.opponentTeam ?? (lobbyTeam === 'fire' ? 'ice' : 'fire');
    const oppName = (oppTeam === 'fire' ? t('lobbyFireName') : t('lobbyIceName')) + ' ' + t('lobbyOppSuffix');

    document.getElementById('lc-my-team')!.innerHTML = `<span class="lct-name">${myName}</span>`;
    document.getElementById('lc-opp-team')!.innerHTML = `<span class="lct-name">${oppName}</span>`;
    document.getElementById('lc-opp-label')!.textContent = t('lobbyConnected');
}

// ─── BET PANEL STATE ─────────────────────────────────────────────────
type BetPanelState =
    | 'host-idle'       // host can enter amount
    | 'host-depositing' // MetaMask tx in progress
    | 'host-waiting'    // waiting for guest response
    | 'guest-incoming'  // guest sees offer
    | 'guest-depositing'// guest MetaMask tx in progress
    | 'guest-wait'      // guest waiting for host to offer
    | 'locked'          // both deposited
    | 'no-wallet'       // wallet not connected
    | 'no-bet';         // bet skipped

function showBetPanel(state: BetPanelState) {
    const hostSection = document.getElementById('bet-host-section');
    const offerSent = document.getElementById('bet-offer-sent');
    const incoming = document.getElementById('bet-incoming');
    const locked = document.getElementById('bet-locked');
    const skipNote = document.getElementById('bet-skip-note');
    const noWallet = document.getElementById('bet-no-wallet');
    const guestWait = document.getElementById('bet-guest-wait');

    if (!hostSection) return; // panel not in DOM yet

    hostSection.style.display = 'none';
    offerSent!.style.display = 'none';
    incoming!.style.display = 'none';
    locked!.style.display = 'none';
    skipNote!.style.display = 'none';
    if (noWallet) noWallet.style.display = 'none';
    if (guestWait) guestWait.style.display = 'none';

    const sendBtn = document.getElementById('bet-send-btn') as HTMLButtonElement | null;

    switch (state) {
        case 'host-idle':
            hostSection.style.display = 'block';
            if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Bahis Teklif Et'; }
            break;
        case 'host-depositing':
            hostSection.style.display = 'block';
            if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Yatırılıyor…'; }
            break;
        case 'host-waiting':
            offerSent!.style.display = 'block';
            break;
        case 'guest-incoming':
            incoming!.style.display = 'block';
            break;
        case 'guest-depositing': {
            incoming!.style.display = 'block';
            const acceptBtn = document.getElementById('bet-accept-btn') as HTMLButtonElement;
            if (acceptBtn) { acceptBtn.disabled = true; acceptBtn.textContent = 'Yatırılıyor…'; }
            break;
        }
        case 'guest-wait':
            if (guestWait) guestWait.style.display = 'block';
            break;
        case 'locked': {
            locked!.style.display = 'block';
            const lockedText = document.getElementById('bet-locked-text');
            const lockedAmt = document.getElementById('bet-locked-amount');
            const totalPot = betService.state.amount * 2;
            const fee = totalPot * (BET_FEE_PERCENT / 100);
            const prize = totalPot - fee;
            if (lockedText) lockedText.textContent = 'Bahis kilitlendi — Kazanan alır:';
            if (lockedAmt) lockedAmt.textContent = `${prize.toFixed(4)} AVAX (%${100 - BET_FEE_PERCENT} · ${BET_FEE_PERCENT}% fee)`;
            break;
        }
        case 'no-wallet':
            if (noWallet) noWallet.style.display = 'block';
            break;
        case 'no-bet':
            skipNote!.style.display = 'block';
            break;
    }
}

// ── Quick Match state ────────────────────────────────────────────────
let _qmPollTimer: number | null = null;
let _qmCode: string = '';
let _qmAcceptTimer: number | null = null;

async function fetchPublicLobbies() {
    const listEl = document.getElementById('lobby-list');
    if (!listEl) return;
    try {
        const res = await fetch('/api/lobbies');
        const data = await res.json();
        if (!data.ok || !data.lobbies?.length) {
            listEl.innerHTML = '<div class="lb-empty">Aktif lobi yok</div>';
            return;
        }
        listEl.innerHTML = data.lobbies.map((l: any) => `
            <div class="lb-item" data-code="${l.code}">
                <span class="lb-item-team ${l.team}">${l.team === 'fire' ? 'ALAZ' : 'AYAZ'}</span>
                <div class="lb-item-info">
                    <div class="lb-item-nick">${l.nickname || 'Anonim'}</div>
                    <div class="lb-item-meta">${l.age}s önce</div>
                </div>
                <div class="lb-item-avax">${l.betAmount > 0 ? l.betAmount + ' AVAX' : '—'}</div>
                <button class="lb-item-join" data-code="${l.code}">KATIL</button>
            </div>
        `).join('');
        // Join butonları
        listEl.querySelectorAll('.lb-item-join').forEach((btn: Element) => {
            (btn as HTMLButtonElement).onclick = () => {
                const code = btn.getAttribute('data-code') ?? '';
                if (!lobbyTeam) return showLobbyError('Önce tarafını seç!');
                joinLobbyByCode(code);
            };
        });
    } catch {
        listEl.innerHTML = '<div class="lb-empty">Bağlantı hatası</div>';
    }
}

async function joinLobbyByCode(code: string) {
    if (!lobbyTeam) return showLobbyError('Önce tarafını seç!');
    try {
        document.getElementById('lobby-status-text')!.textContent = 'Bağlanıyor…';
        setLobbyState('waiting');
        mpService.init(handleMPMessage, handleMPStatus);
        await mpService.joinLobby(code, lobbyTeam);
    } catch (e: any) {
        setLobbyState('actions');
        showLobbyError('Bağlantı başarısız: ' + (e?.message ?? e));
    }
}

function startQuickMatch() {
    if (!lobbyTeam) return showLobbyError('Önce tarafını seç!');
    if (!walletAddress) return showLobbyError('Quick Match için cüzdan bağla!');

    // Önce bir lobi oluştur (ama bekleme ekranına geçme), quick match kuyruğuna at
    mpService.init(handleMPMessage, handleMPStatus);
    mpService.createLobby(lobbyTeam, 0, false).then(code => {
        _qmCode = code;
        setLobbyState('qm-waiting');

        // Kuyruğa katıl
        const nick = profileService?.currentProfile?.username || 'Anonim';
        fetch('/api/quickmatch/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet: walletAddress, team: lobbyTeam, code, nickname: nick }),
        }).catch(() => { });

        // Poll başlat
        _qmPollTimer = window.setInterval(async () => {
            try {
                const res = await fetch(`/api/quickmatch/poll?wallet=${walletAddress}`);
                const data = await res.json();
                if (data.ok && data.matched) {
                    stopQuickMatchPoll();
                    showQmNotification(data.opponentCode, data.opponentTeam, data.opponentNickname);
                }
            } catch { /* ignore */ }
        }, 2000);
    }).catch(e => {
        showLobbyError('Quick match başlatılamadı: ' + (e?.message ?? e));
    });
}

function stopQuickMatchPoll() {
    if (_qmPollTimer !== null) {
        clearInterval(_qmPollTimer);
        _qmPollTimer = null;
    }
}

function leaveQuickMatch() {
    stopQuickMatchPoll();
    if (walletAddress) {
        fetch('/api/quickmatch/leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet: walletAddress }),
        }).catch(() => { });
    }
    mpService.disconnect();
    setLobbyState('actions');
}

function showQmNotification(opponentCode: string, opponentTeam: string, opponentNick: string) {
    const notifEl = document.getElementById('qm-notification')!;
    const nameEl = document.getElementById('qmn-opponent-name')!;
    const timerEl = document.getElementById('qmn-timer')!;
    notifEl.style.display = 'flex';
    nameEl.textContent = `${opponentNick || 'Anonim'} · ${opponentTeam === 'fire' ? 'ALAZ' : 'AYAZ'}`;

    let timeLeft = 15;
    timerEl.textContent = String(timeLeft);
    if (_qmAcceptTimer) clearInterval(_qmAcceptTimer);
    _qmAcceptTimer = window.setInterval(() => {
        timeLeft--;
        timerEl.textContent = String(timeLeft);
        if (timeLeft <= 0) {
            clearInterval(_qmAcceptTimer!);
            _qmAcceptTimer = null;
            notifEl.style.display = 'none';
            leaveQuickMatch();
            showToast('Eşleşme zaman aşımı.');
        }
    }, 1000);

    document.getElementById('qm-accept-btn')!.onclick = async () => {
        if (_qmAcceptTimer) { clearInterval(_qmAcceptTimer); _qmAcceptTimer = null; }
        notifEl.style.display = 'none';
        // Rakibin lobisine bağlan
        try {
            document.getElementById('lobby-status-text')!.textContent = 'Bağlanıyor…';
            setLobbyState('waiting');
            await mpService.joinLobby(opponentCode, lobbyTeam!);
        } catch (e: any) {
            setLobbyState('actions');
            showLobbyError('Bağlantı başarısız: ' + (e?.message ?? e));
        }
    };

    document.getElementById('qm-decline-btn')!.onclick = () => {
        if (_qmAcceptTimer) { clearInterval(_qmAcceptTimer); _qmAcceptTimer = null; }
        notifEl.style.display = 'none';
        leaveQuickMatch();
    };
}

function initLobbyScreen() {
    // Takım zaten team-select'te seçildi, direkt actions'a geç
    lobbyTeam = selectedTeam;
    setLobbyState('actions');
    document.getElementById('lobby-error')!.style.display = 'none';

    // ── Update lobby info bar ──
    const walletStatusEl = document.getElementById('lib-wallet-status');
    const walletTextEl = document.getElementById('lib-wallet-text');
    const balanceEl = document.getElementById('lib-balance');
    const balanceTextEl = document.getElementById('lib-balance-text');

    if (walletAddress) {
        if (walletStatusEl) walletStatusEl.classList.add('lib-wallet-connected');
        if (walletTextEl) walletTextEl.textContent = `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;
        // Show balance
        if (balanceEl && balanceTextEl) {
            balanceEl.style.display = 'flex';
            const ethers = (window as any).ethers;
            if (ethers && (window as any).ethereum) {
                const provider = new ethers.BrowserProvider((window as any).ethereum);
                provider.getBalance(walletAddress).then((bal: any) => {
                    balanceTextEl.textContent = `${parseFloat(ethers.formatEther(bal)).toFixed(4)} AVAX`;
                }).catch(() => {
                    balanceTextEl.textContent = '— AVAX';
                });
            }
        }
    } else {
        if (walletStatusEl) walletStatusEl.classList.remove('lib-wallet-connected');
        if (walletTextEl) walletTextEl.textContent = 'Cüzdan bağlı değil';
        if (balanceEl) balanceEl.style.display = 'none';
    }

    // Takım seçim butonları — önceki seçimi temizle
    document.getElementById('lobby-pick-fire')!.classList.remove('selected-fire');
    document.getElementById('lobby-pick-ice')!.classList.remove('selected-ice');

    document.getElementById('lobby-pick-fire')!.onclick = () => {
        lobbyTeam = 'fire';
        document.getElementById('lobby-pick-fire')!.classList.add('selected-fire');
        document.getElementById('lobby-pick-ice')!.classList.remove('selected-ice');
        setLobbyState('actions');
    };
    document.getElementById('lobby-pick-ice')!.onclick = () => {
        lobbyTeam = 'ice';
        document.getElementById('lobby-pick-ice')!.classList.add('selected-ice');
        document.getElementById('lobby-pick-fire')!.classList.remove('selected-fire');
        setLobbyState('actions');
    };

    // ── Privacy toggle (public/private) ──
    const pubBtn = document.getElementById('lobby-privacy-public');
    const prvBtn = document.getElementById('lobby-privacy-private');
    if (pubBtn && prvBtn) {
        pubBtn.onclick = () => { pubBtn.classList.add('active'); prvBtn.classList.remove('active'); };
        prvBtn.onclick = () => { prvBtn.classList.add('active'); pubBtn.classList.remove('active'); };
    }

    // ── Lobi oluştur (AVAX + public/private destekli) ──
    document.getElementById('lobby-create-btn')!.onclick = async () => {
        if (!lobbyTeam) return showLobbyError('Önce tarafını seç!');
        const amountInput = document.getElementById('lobby-avax-input') as HTMLInputElement;
        const amount = amountInput?.value ? parseFloat(amountInput.value) : 0;
        if (amount && (amount < MIN_BET || amount > MAX_BET)) {
            return showLobbyError(`Bahis ${MIN_BET} – ${MAX_BET} AVAX aralığında olmalı.`);
        }

        // ── Bahis varsa: cüzdan bağlı mı kontrol et + deposit yap ──
        if (amount > 0) {
            if (!walletAddress) {
                showWalletModal();
                return showLobbyError('Bahis için önce cüzdanını bağla!');
            }

            // Geçici matchId oluştur (lobi kodu henüz yok, timestamp ile)
            const tempMatchId = 'PRE_' + Date.now();

            // Loading göster
            const createBtn = document.getElementById('lobby-create-btn') as HTMLButtonElement;
            const origText = createBtn.textContent;
            createBtn.disabled = true;
            createBtn.textContent = 'MetaMask onayı bekleniyor…';

            try {
                const txHash = await betService.depositBet(amount, tempMatchId);
                if (!txHash) {
                    createBtn.disabled = false;
                    createBtn.textContent = origText;
                    return showLobbyError(betService.lastError || 'Bahis yatırımı başarısız. MetaMask\'ı kontrol et.');
                }

                // Deposit başarılı — şimdi lobi aç
                const isPublic = document.getElementById('lobby-privacy-public')?.classList.contains('active') ?? true;
                mpService.init(handleMPMessage, handleMPStatus);
                const code = await mpService.createLobby(lobbyTeam, amount, isPublic);
                document.getElementById('lobby-display-code')!.textContent = code;
                setLobbyState('waiting');
                document.getElementById('lobby-status-text')!.textContent = 'Bahis yatırıldı. Rakip bekleniyor…';
                showBetPanel('host-waiting');

                createBtn.disabled = false;
                createBtn.textContent = origText;
            } catch (e: any) {
                createBtn.disabled = false;
                createBtn.textContent = origText;
                showLobbyError('Lobi oluşturulamadı: ' + (e?.message ?? e));
            }
        } else {
            // Bahissiz lobi — direkt aç
            const isPublic = document.getElementById('lobby-privacy-public')?.classList.contains('active') ?? true;
            try {
                mpService.init(handleMPMessage, handleMPStatus);
                const code = await mpService.createLobby(lobbyTeam, amount, isPublic);
                document.getElementById('lobby-display-code')!.textContent = code;
                setLobbyState('waiting');
                document.getElementById('lobby-status-text')!.textContent = 'Rakip bekleniyor…';
            } catch (e: any) {
                showLobbyError('Lobi oluşturulamadı: ' + (e?.message ?? e));
            }
        }
    };

    // Kopyala butonu
    document.getElementById('lobby-copy-btn')!.onclick = () => {
        const code = document.getElementById('lobby-display-code')!.textContent ?? '';
        const copyBtn = document.getElementById('lobby-copy-btn')!;
        const copySpan = copyBtn.querySelector('span') as HTMLElement | null;
        navigator.clipboard.writeText(code).then(() => {
            if (copySpan) {
                const orig = copySpan.textContent ?? '';
                copySpan.textContent = '✓ Kopyalandı';
                setTimeout(() => { copySpan.textContent = orig; }, 1500);
            }
        });
    };

    // ── Kod ile katıl ──
    document.getElementById('lobby-join-btn')!.onclick = async () => {
        if (!lobbyTeam) return showLobbyError('Önce tarafını seç!');
        const code = (document.getElementById('lobby-code-input') as HTMLInputElement).value.trim().toUpperCase();
        if (code.length !== 6) return showLobbyError('6 karakterli bir kod gir.');
        joinLobbyByCode(code);
    };

    // ── Quick Match ──
    document.getElementById('lobby-qm-btn')!.onclick = () => startQuickMatch();
    document.getElementById('lobby-qm-cancel')!.onclick = () => leaveQuickMatch();

    // ── Public lobiler: ilk yükleme + yenile butonu ──
    fetchPublicLobbies();
    document.getElementById('lobby-refresh-btn')!.onclick = () => fetchPublicLobbies();
    // Auto-refresh her 8 saniye
    const _lobbyRefreshTimer = setInterval(() => {
        const lobbyScreen = document.getElementById('lobby-screen');
        if (lobbyScreen && lobbyScreen.style.display !== 'none') {
            fetchPublicLobbies();
        } else {
            clearInterval(_lobbyRefreshTimer);
        }
    }, 8000);

    // Oyunu başlat (host için)
    document.getElementById('lobby-start-btn')!.onclick = () => {
        if (mpService.status !== 'connected') return;

        // Bahis teklif edildi ama henüz kabul/ret edilmediyse başlatma
        if (betService.isActive() && betService.state.status !== 'locked') {
            return showLobbyError('Bahis teklifi yanıtlanmadan oyun başlatılamaz!');
        }

        startMultiplayerGame();
    };

    // ── BET PANEL LOGIC ──────────────────────────────────────────────
    betService.reset();
    // Initial state: will be overridden when connected
    showBetPanel(walletAddress ? 'host-idle' : 'no-wallet');

    document.getElementById('bet-send-btn')!.onclick = async () => {
        if (!walletAddress) return showLobbyError('Önce cüzdanını bağla!');
        const amountInput = document.getElementById('bet-amount-input') as HTMLInputElement;
        const amount = parseFloat(amountInput.value);
        if (!amount || amount < MIN_BET || amount > MAX_BET) {
            return showLobbyError(`Geçerli bir miktar gir (${MIN_BET}–${MAX_BET} AVAX)`);
        }

        const matchId = mpService.lobbyCode + '_' + Date.now();
        showBetPanel('host-depositing');

        const txHash = await betService.depositBet(amount, matchId);
        if (!txHash) {
            showBetPanel('host-idle');
            return showLobbyError(betService.lastError || 'Bahis yatırımı başarısız. MetaMask\'ı kontrol et.');
        }

        // Notify guest via P2P
        mpService.sendBetOffer(amount, matchId, walletAddress!);
        showBetPanel('host-waiting');
    };

    document.getElementById('bet-cancel-btn')!.onclick = async () => {
        mpService.sendBetCancel();
        await betService.cancelAndRefund(walletAddress!);
        betService.reset();
        showBetPanel('host-idle');
    };

    document.getElementById('bet-accept-btn')!.onclick = async () => {
        if (!walletAddress) return showLobbyError('Önce cüzdanını bağla!');
        const amount = betService.state.amount;
        const matchId = betService.state.matchId ?? '';

        showBetPanel('guest-depositing');
        const txHash = await betService.acceptBet(amount, matchId);
        if (!txHash) {
            showBetPanel('guest-incoming');
            return showLobbyError(betService.lastError || 'Bahis yatırımı başarısız. MetaMask\'ı kontrol et.');
        }

        mpService.sendBetAccept(txHash, walletAddress!);
        betService.state.status = 'locked';
        showBetPanel('locked');
    };

    document.getElementById('bet-decline-btn')!.onclick = () => {
        mpService.sendBetReject();
        betService.reset();
        showBetPanel('no-bet');
    };
}

// Lobby back butonu
document.getElementById('lobby-back')?.addEventListener('click', async () => {
    // Eğer bet deposit yapılmış ama guest gelmemişse refund iste
    if (betService.isActive() && ['pending_host', 'host_deposited'].includes(betService.state.status ?? '')) {
        const btn = document.getElementById('lobby-back') as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = 'Bahis iade ediliyor…';
        const result = await betService.cancelBet();
        btn.disabled = false;
        btn.textContent = '← Geri';
        if (result.ok && result.txHash) {
            console.log(`[Lobby] Bet refunded: ${result.refundAVAX} AVAX`);
        }
    } else {
        betService.reset();
    }
    leaveQuickMatch();
    mpService.disconnect();
    showScreen('team-select');
});

// Sayfa kapatılırken aktif bet varsa cancel et (beacon API ile)
window.addEventListener('beforeunload', () => {
    if (betService.isActive() && ['pending_host', 'host_deposited'].includes(betService.state.status ?? '')) {
        const matchId = betService.state.matchId;
        const address = (window as any).__walletAddress;
        if (matchId && address) {
            navigator.sendBeacon('/api/cancel-bet', new Blob(
                [JSON.stringify({ matchId, address })],
                { type: 'application/json' }
            ));
        }
    }
});

// MP status callback
function handleMPStatus(status: string) {
    if (status === 'connected') {
        updateLobbyConnectedUI();
        setLobbyState('connected');

        // ── Bahis varsa ve host zaten deposit yaptıysa → guest'e otomatik teklif gönder ──
        if (mpService.role === 'host' && betService.isActive() && betService.state.status === 'pending_host') {
            mpService.sendBetOffer(betService.state.amount, betService.state.matchId!, walletAddress!);
            showBetPanel('host-waiting');
        } else if (mpService.role === 'host') {
            showBetPanel(walletAddress ? 'host-idle' : 'no-wallet');
        } else {
            // Guest waits for host's bet offer
            showBetPanel(walletAddress ? 'guest-wait' : 'no-wallet');
        }

        // Start butonu: sadece host görür, guest "Hazırım" bekler
        const startBtn = document.getElementById('lobby-start-btn') as HTMLButtonElement;
        if (startBtn) {
            if (mpService.role === 'host') {
                startBtn.textContent = 'OYUNU BAŞLAT →';
                startBtn.style.display = 'block';
            } else {
                startBtn.textContent = 'Host oyunu başlatsın…';
                startBtn.style.opacity = '0.5';
                startBtn.style.pointerEvents = 'none';
            }
        }

        // Ping göster
        const pingInterval = setInterval(() => {
            if (mpService.status !== 'connected') { clearInterval(pingInterval); return; }
            const el = document.getElementById('lc-ping');
            if (el) el.textContent = `Ping: ${mpService.ping ?? '—'} ms`;
        }, 500);
    } else if (status === 'disconnected' || status === 'error') {
        if (gameMode === 'multiplayer') {
            // Oyun sırasında bağlantı kesildi
            triggerWin(lobbyTeam === 'fire' ? 'fire' : 'ice', 'Rakip bağlantısı kesildi!');
        } else {
            setLobbyState('actions');
            showLobbyError(t('lobbyErrDisconn'));
        }
        // Start butonunu resetle
        const startBtn = document.getElementById('lobby-start-btn') as HTMLButtonElement;
        if (startBtn) {
            startBtn.textContent = 'OYUNU BAŞLAT →';
            startBtn.style.opacity = '1';
            startBtn.style.pointerEvents = 'auto';
        }
    }
}

// Multiplayer callback stubs — boot() tarafından doldurulur
let _mpSpawnUnit: ((team: 'fire' | 'ice', cardId: UnitType, lane: 'left' | 'mid' | 'right') => void) | null = null;
let _mpApplyPrompt: ((team: 'fire' | 'ice', promptId: string) => void) | null = null;
let _mpTriggerWin: ((winner: 'fire' | 'ice', msg: string) => void) | null = null;
let _mpStartGame: (() => void) | null = null;   // her iki taraf hazır olunca çağrılır
let _mpGameEnded = false;                        // double-fire guard

const MP_LANE_MAP: Record<'left' | 'mid' | 'right', number> = { left: 0, mid: 1, right: 2 };

function spawnUnitForTeam(team: 'fire' | 'ice', cardId: UnitType, lane: 'left' | 'mid' | 'right') {
    _mpSpawnUnit?.(team, cardId, lane);
}
function applyPromptForTeam(team: 'fire' | 'ice', promptId: string) {
    _mpApplyPrompt?.(team, promptId);
}
function triggerWin(winner: 'fire' | 'ice', msg: string) {
    _mpTriggerWin?.(winner, msg);
}

// MP message handler
function handleMPMessage(msg: import('./multiplayer/MultiplayerService').MPMessage) {
    // ── BET MESSAGES (lobby phase — gameMode may still be 'realtime' at this point) ──
    if (msg.type === 'bet_offer') {
        // Guest receives offer
        betService.state = {
            amount: msg.amountAvax,
            status: 'pending_guest',
            matchId: msg.matchId,
        };
        const amtEl = document.getElementById('bet-incoming-amount');
        if (amtEl) amtEl.textContent = `${msg.amountAvax} AVAX`;
        showBetPanel('guest-incoming');
        return;
    }
    if (msg.type === 'bet_accept') {
        // Host: guest deposited
        betService.state.status = 'locked';
        betService.state.guestTxHash = msg.txHash;
        showBetPanel('locked');
        return;
    }
    if (msg.type === 'bet_reject' || msg.type === 'bet_cancel') {
        betService.reset();
        // If host, show idle again; if guest, show waiting
        showBetPanel(mpService.role === 'host' ? 'host-idle' : 'guest-wait');
        return;
    }
    if (msg.type === 'bet_claim') {
        // Legacy: bet_claim artık kullanılmıyor, sonuçlar /api/report-result ile çözülüyor
        // Her iki taraf da kendi sonucunu bildiriyor, server mutabakat arıyor
        console.log('[Bet] Received legacy bet_claim — ignored (dual-confirm active)');
        return;
    }

    if (gameMode !== 'multiplayer') return;

    if (msg.type === 'loaded') {
        // Rakip yüklemeyi bitirdi — sadece host start gönderir
        if (mpService.role === 'host') {
            mpService.send({ type: 'start' });
            _mpStartGame?.();
        }
    } else if (msg.type === 'start') {
        // Guest, host'tan start aldı → oyun başlasın
        _mpStartGame?.();
    } else if (msg.type === 'place') {
        const { cardId, lane } = msg;
        const oppTeam = mpService.opponentTeam ?? (lobbyTeam === 'fire' ? 'ice' : 'fire');
        spawnUnitForTeam(oppTeam as 'fire' | 'ice', cardId as UnitType, lane);
    } else if (msg.type === 'prompt') {
        const { promptId } = msg;
        const oppTeam = mpService.opponentTeam ?? (lobbyTeam === 'fire' ? 'ice' : 'fire');
        applyPromptForTeam(oppTeam as 'fire' | 'ice', promptId);
    } else if (msg.type === 'surrender') {
        const winner = lobbyTeam === 'fire' ? 'fire' : 'ice';
        triggerWin(winner as 'fire' | 'ice', 'Rakip teslim oldu!');
    } else if (msg.type === 'game_over') {
        // Karşıdan gelen kazanma bildirimi — sadece biz tetiklemediyse uygula
        triggerWin(msg.winner, msg.reason);
    }
}

function startMultiplayerGame() {
    _mpGameEnded = false;
    showScreen('game');
    gameMode = 'multiplayer';
    boot('multiplayer').catch(console.error);
}

// ─── GAME CLEANUP (location.reload yerine) ──────────────────────────
function cleanupGame(): void {
    console.log('[Cleanup] Oyun temizleniyor...');
    // 1. BabylonJS engine ve scene'i kapat
    if (_engine) {
        _engine.stopRenderLoop();
        if (_engine.scenes) {
            for (const s of [..._engine.scenes]) {
                s.dispose();
            }
        }
        _engine.dispose();
        _engine = null;
    }
    _scene = null;
    _um = null;
    _shards = null;

    // 2. Cooldown ticker durdur
    if (cooldownRAF) { cancelAnimationFrame(cooldownRAF); cooldownRAF = null; }

    // 3. AVX coin DOM elementlerini temizle
    document.querySelectorAll('.avx-coin-float').forEach(el => el.remove());

    // 4. Resize listener temizle
    const resizeHandler = (window as any).__a2ResizeHandler;
    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        (window as any).__a2ResizeHandler = null;
    }

    // 5. Multiplayer bağlantısını kapat
    mpService.disconnect();

    // 5. Win overlay kapat
    winOverlay.classList.remove('show');

    // 6. Canvas gizle, header göster
    canvas.style.display = 'none';

    // 7. Game state sıfırla
    playerMana = 3;
    playerAvx = 0;
    turnCount = 1;
    realtimeManaAccum = 0;
    realtimeAiAccum = 0;
    iceManaAccum = 0;
    _mpGameEnded = false;
    mpGameStarted = false;

    // 8. Mini player'ı gizle
    hideMiniPlayer();

    // 9. Ana sayfaya dön
    showScreen('home');
    console.log('[Cleanup] Temizlendi — ana sayfaya dönüldü');
}

// ─── BOOT ─────────────────────────────────────────────────────────────
async function boot(mode: GameMode): Promise<void> {
    console.log('[DEBUG] boot() called with mode:', mode);

    // Loading screen'i hemen goster
    const loadingScreen = document.getElementById('loading-screen')!;
    const loadingBar = document.getElementById('loading-bar')!;
    const loadingStatus = document.getElementById('loading-status')!;
    const loadingTipEl = document.getElementById('loading-tip')!;
    const loadingTipLabel = document.getElementById('loading-tip-label')!;
    const loadingSlowEl = document.getElementById('loading-slow')!;
    loadingScreen.style.display = 'flex';
    loadingBar.style.width = '5%';
    loadingStatus.textContent = t('loadingScene');
    loadingSlowEl.textContent = t('loadingSlow');
    const tipLabelMap: Record<string, string> = { tr: 'BİLGİ', en: 'DID YOU KNOW?', es: 'DATO' };
    loadingTipLabel.textContent = tipLabelMap[getLang()] ?? tipLabelMap['en'];
    const tipKeys: TransKey[] = ['loadingTip1', 'loadingTip2', 'loadingTip3', 'loadingTip4', 'loadingTip5',
        'loadingTip6', 'loadingTip7', 'loadingTip8', 'loadingTip9', 'loadingTip10'];
    let tipIdx = Math.floor(Math.random() * tipKeys.length);
    loadingTipEl.textContent = t(tipKeys[tipIdx]);
    const tipInterval = setInterval(() => {
        loadingTipEl.style.opacity = '0';
        setTimeout(() => {
            tipIdx = (tipIdx + 1) % tipKeys.length;
            loadingTipEl.textContent = t(tipKeys[tipIdx]);
            loadingTipEl.style.opacity = '1';
        }, 500);
    }, 4000);

    // Bir frame bekle ki loading screen renderlansin
    await new Promise(r => requestAnimationFrame(r));

    gameMode = mode;
    playerMana = calcManaGain(1);
    turnCount = 1;
    realtimeManaAccum = 0;
    realtimeAiAccum = 0;
    iceManaAccum = 0;

    // Skill kartı cooldown'larını sıfırla ve ticker'ı başlat
    resetAllCooldowns();
    if (cooldownRAF) { cancelAnimationFrame(cooldownRAF); cooldownRAF = null; }
    startCooldownTicker();

    loadingBar.style.width = '10%';
    loadingStatus.textContent = t('loadingScene');

    const engine = new Engine(canvas, true, {
        adaptToDeviceRatio: true,
        doNotHandleContextLost: true,
        useHighPrecisionFloats: true,
    });
    engine.setHardwareScalingLevel(1 / (window.devicePixelRatio > 1 ? 1.5 : 1));
    const { scene, shadowGenerator } = createScene(engine);

    loadingBar.style.width = '15%';

    // Oyun içi müzik: Kullanıcının seçtiği şarkı veya varsayılan (Battle Drums)
    const userTrack = getCurrentTrack();
    if (userTrack) {
        switchBGM(userTrack.src, 0.2);
    } else {
        switchBGM('/assets/sound/war.mp3', 0.2);
    }

    // Show mini player for in-game audio controls
    showMiniPlayer();

    const mapData = createAvaxMap(scene, shadowGenerator);

    // GLB export — console'dan window.exportMapGLB() ile çağır (game scene)
    (window as any).exportMapGLB = () => exportMapGLB(scene);

    // Kamera odaklayıcısı için görünmez küp
    const hero = MeshBuilder.CreateBox('heroAnchor', { size: 1 }, scene);
    hero.position = new Vector3(0, 5, 0);
    hero.isVisible = false;
    const cam = new CameraSystem(scene, hero, canvas);

    const um = new UnitManager(scene, shadowGenerator);
    const shards = new AvaShardManager(scene);
    const fireBase = new BaseBuilding(scene, 'fire');
    const iceBase = new BaseBuilding(scene, 'ice');
    const winSystem = new WinConditionSystem(fireBase, iceBase, shards);
    um.setBaseRefs(fireBase, iceBase);
    shards.setUnitManager(um);

    // AVX coin drop refs
    _scene = scene;
    _engine = engine;
    preloadSFX();
    um.onUnitDeath = (unit) => {
        // The team that killed this unit gets the coin
        const killerTeam = unit.team === 'fire' ? 'ice' : 'fire';
        const wasCrit = !!unit.abilityState._critKill;
        const coinCount = wasCrit ? 2 : 1;
        for (let i = 0; i < coinCount; i++) {
            spawnAvxCoin(unit.mesh.position, killerTeam, i);
        }
    };

    // Börü spawn callback — show spirit wolf card UI
    shards.onBoruSpawn = (event) => {
        showBoruCard(event.spirit, event.team, event.triggerTeam);
    };

    // Set module-level refs for prompt effects
    _um = um;
    _shards = shards;

    // Kite AI + Chain — non-blocking init; update panel when ready
    kiteService.init().then(() => kiteUpdatePanel()).catch(() => kiteUpdatePanel());

    // Build shared UI
    buildCardUI(um);
    buildPromptUI();
    updateManaUI();
    setupLaneOverlay(um);
    setupPlayerKeyboard();

    // ── Mode-specific setup ───────────────────────────────────────────
    if (mode === 'realtime') {
        phase = 'player';
        turnBanner.textContent = t('realtime');
        turnBanner.className = 'turn-banner player-turn';
        turnCountEl.textContent = t('vsAi');
        const betHud = document.getElementById('bet-hud');
        if (betHud) betHud.style.display = 'none';

    } else if (mode === 'twoplayer') {
        phase = 'player';
        turnBanner.textContent = t('fireVsIce');
        turnBanner.className = 'turn-banner player-turn';
        turnCountEl.textContent = t('twoPlayer');
        const betHud2 = document.getElementById('bet-hud');
        if (betHud2) betHud2.style.display = 'none';
        iceMana = calcManaGain(1);
        setup2Player(um);

    } else if (mode === 'multiplayer') {
        phase = 'player';
        const myLabel = lobbyTeam === 'fire' ? 'ALAZ' : 'AYAZ';
        turnBanner.textContent = `ONLİNE — ${myLabel}`;
        turnBanner.className = 'turn-banner player-turn';
        turnCountEl.textContent = 'ONLINE PvP';

        // Show bet HUD if bet is active
        const betHud = document.getElementById('bet-hud');
        if (betHud) {
            if (betService.isActive() && betService.state.status === 'locked') {
                const totalPot = betService.state.amount * 2;
                const prize = totalPot * 0.98;
                betHud.style.display = 'inline-flex';
                const betHudText = document.getElementById('bet-hud-text');
                if (betHudText) betHudText.textContent = `${prize.toFixed(4)} AVAX bahis aktif`;
            } else {
                betHud.style.display = 'none';
            }
        }

        // Wire MP callbacks to boot-scoped closures
        _mpSpawnUnit = (team, cardId, lane) => {
            um.spawnUnit(cardId, team, MP_LANE_MAP[lane]);
        };
        _mpApplyPrompt = (team, promptId) => {
            const def = PROMPT_DEFS.find(p => p.id === promptId);
            if (def) applyPromptEffect(def, team);
        };
        _mpTriggerWin = (winner, msg) => {
            if (_mpGameEnded) return;   // guard against double-fire
            _mpGameEnded = true;

            winTitle.textContent = winner === 'fire' ? 'ALAZ KAZANDI' : 'AYAZ KAZANDI';
            winMessage.textContent = msg;
            winOverlay.classList.add('show');
            engine.stopRenderLoop();

            // ── Bet settlement (dual-confirm) ──────────────────────────
            if (betService.isActive() && betService.state.status === 'locked') {
                const myTeam = lobbyTeam;
                const didWin = myTeam === winner;
                const myAddr = walletAddress;

                if (myAddr) {
                    const totalPrize = betService.state.amount * 2 * 0.98;
                    // Both players report their result to the server
                    betService.reportResult(myAddr, didWin).then(async (res) => {
                        if (!res) {
                            showToast('Sonuc bildirimi basarisiz');
                            return;
                        }

                        if (res.status === 'settled') {
                            // Server settled immediately (both reported)
                            if (didWin) {
                                showToast(`Bahis odendi! TX: ${res.txHash?.slice(0, 10)}…`);
                                showBetResultOnWin(true, res.prizeAVAX ?? totalPrize, res.txHash ?? null);
                                leaderboardService.recordResult(myAddr, 'win', res.prizeAVAX ?? totalPrize, 0);
                            } else {
                                showBetResultOnWin(false, betService.state.amount, null);
                                leaderboardService.recordResult(myAddr, 'loss', 0, betService.state.amount);
                            }
                        } else if (res.status === 'disputed') {
                            showToast('Anlaşmazlık — her iki tarafa iade yapılıyor');
                            showBetResultOnWin(false, 0, null);
                        } else if (res.status === 'waiting') {
                            // Opponent hasn't reported yet — poll every 3s for up to 30s
                            showToast('Rakibin sonuc bildirmesi bekleniyor…');
                            let polls = 0;
                            const pollTimer = setInterval(async () => {
                                polls++;
                                const match = await betService.pollMatchStatus();
                                if (match && match.status === 'settled') {
                                    clearInterval(pollTimer);
                                    betService.state.status = 'settled';
                                    if (didWin) {
                                        showToast(`Bahis odendi! TX: ${(match as any).txHash?.slice(0, 10) ?? ''}…`);
                                        showBetResultOnWin(true, totalPrize, (match as any).txHash ?? null);
                                        leaderboardService.recordResult(myAddr, 'win', totalPrize, 0);
                                    } else {
                                        showBetResultOnWin(false, betService.state.amount, null);
                                        leaderboardService.recordResult(myAddr, 'loss', 0, betService.state.amount);
                                    }
                                } else if (match && ['disputed', 'refunded'].includes(match.status)) {
                                    clearInterval(pollTimer);
                                    betService.state.status = 'cancelled';
                                    showToast('Anlaşmazlık — iade yapılıyor');
                                    showBetResultOnWin(false, 0, null);
                                } else if (polls >= 10) {
                                    clearInterval(pollTimer);
                                    showToast('Rakip sonuc bildirmedi — otomatik cozum bekleniyor');
                                }
                            }, 3000);
                        }
                    });
                }
            } else if (walletAddress) {
                // No bet — just record result
                const didWin = lobbyTeam === winner;
                leaderboardService.recordResult(walletAddress, didWin ? 'win' : 'loss');
            }
        };
    }

    let isGameReady = false;

    // ── Render loop ───────────────────────────────────────────────────
    let last = performance.now();
    let uiAccum = 0;
    engine.runRenderLoop(() => {
        const now = performance.now();
        const delta = Math.min(now - last, 66);
        const dt = delta / 1000;
        last = now;

        cam.update();

        if (!isGameReady) {
            scene.render();
            return;
        }

        // Pass shard bonuses to UnitManager for combat
        um.fireShard = shards.getBonus('fire');
        um.iceShard = shards.getBonus('ice');
        um.update(delta);
        shards.update(dt, um.units);
        fireBase.update(dt, um.units);
        iceBase.update(dt, um.units);

        const wc = winSystem.check();
        if (wc !== WinCondition.None) {
            if (mode === 'multiplayer') {
                // Multiplayer'da kazananı tespit edip karşıya bildir
                const winner = winSystem.getWinner();
                if (winner) {
                    mpService.sendGameOver(winner, winSystem.getWinMessage());
                    triggerWin(winner, winSystem.getWinMessage());
                }
            } else {
                showWinScreen(winSystem);
                engine.stopRenderLoop();
            }
        }

        if (mode === 'realtime') tickRealtime(dt, um);
        if (mode === 'twoplayer') tick2P(dt);

        // Throttle heavy UI/debug updates to ~8 per second
        uiAccum += dt;
        if (uiAccum >= 0.12) {
            uiAccum = 0;
            dbgFps.textContent = String(Math.round(engine.getFps()));
            dbgHero.textContent = `${hero.position.x.toFixed(1)}, ${hero.position.y.toFixed(1)}, ${hero.position.z.toFixed(1)}`;
            dbgUnits.textContent = String(um.units.length);
            dbgFire.textContent = String(um.units.filter(u => u.team === 'fire').length);
            dbgIce.textContent = String(um.units.filter(u => u.team === 'ice').length);
            updateBaseHpUI(fireBase, iceBase);
            updateBoardControlUI(um);
        }

        scene.render();
    });

    // Preload characters
    loadingBar.style.width = '20%';
    try {
        loadingStatus.textContent = t('loadingChars');
        loadingBar.style.width = '30%';
        um.onProgress = (loaded, total) => {
            const pct = 30 + Math.round((loaded / total) * 65);
            loadingBar.style.width = `${pct}%`;
            loadingStatus.textContent = `${t('loadingChars')} ${Math.round((loaded / total) * 100)}%`;
        };
        await um.preload();
        loadingBar.style.width = '95%';
        loadingStatus.textContent = t('loadingReady');
    } catch {
        console.warn('preload failed, using procedural meshes');
    }

    loadingBar.style.width = '100%';
    await new Promise(r => setTimeout(r, 300));
    clearInterval(tipInterval);
    loadingScreen.style.display = 'none';

    if (mode === 'multiplayer') {
        // "Rakip bekleniyor…" overlay'i göster
        const waitOverlay = document.createElement('div');
        waitOverlay.id = 'mp-wait-overlay';
        waitOverlay.innerHTML = `
            <div class="mp-wait-box">
                <div class="mp-wait-spinner"></div>
                <div class="mp-wait-text">Rakip bekleniyor…</div>
            </div>`;
        document.body.appendChild(waitOverlay);

        // Her iki taraf hazır olunca isGameReady=true yapacak callback
        _mpStartGame = () => {
            const ov = document.getElementById('mp-wait-overlay');
            if (ov) ov.remove();
            isGameReady = true;
            mpGameStarted = true;
            lowerBGMForGame();
            _mpStartGame = null;
        };

        // Kendi yüklememiz bitti → rakibe bildir
        mpService.send({ type: 'loaded' });

        // Eğer host ise ve rakip zaten 'loaded' gönderdiyse,
        // handleMPMessage tetiklendi ama _mpStartGame henüz null'dı.
        // Bu race condition'ı önlemek için: host kendi loaded'ını da takip et.
        if (mpService.role === 'host' && (mpService as any)._opponentLoaded) {
            mpService.send({ type: 'start' });
            _mpStartGame();
        }
    } else {
        isGameReady = true;
        lowerBGMForGame();
    }

    const _resizeHandler = () => engine.resize();
    window.addEventListener('resize', _resizeHandler);
    // Cleanup'ta kaldırılacak referans
    (window as any).__a2ResizeHandler = _resizeHandler;
}

// ─── REALTIME TICK ────────────────────────────────────────────────────
// Difficulty 1=easy, 7=hardest. AI deploys faster & in bigger groups at higher levels.
function getAiDeployInterval(): number {
    // Level 1: 8s, Level 4: 5s, Level 7: 2.5s
    return Math.max(2.5, 8 - (difficultyLevel - 1) * 0.9);
}
function getAiMaxUnits(): number {
    // Level 1: 6, Level 7: 18
    return 6 + difficultyLevel * 2;
}
function getAiStatMult(): number {
    // Level 1: 0.8x, Level 4: 1.0x, Level 7: 1.5x
    return 0.8 + (difficultyLevel - 1) * 0.12;
}

let realtimeSurgeAccum = 0;

function tickRealtime(dt: number, um: UnitManager): void {
    realtimeManaAccum += dt;
    if (realtimeManaAccum >= MANA_REGEN_INTERVAL && playerMana < MAX_MANA) {
        realtimeManaAccum -= MANA_REGEN_INTERVAL;
        playerMana = Math.min(MAX_MANA, playerMana + 1);
        updateManaUI();
    }
    // Equilibrium Surge: check every 5s, grant +2 mana to weaker side
    realtimeSurgeAccum += dt;
    if (realtimeSurgeAccum >= 5.0) {
        realtimeSurgeAccum = 0;
        const fireCount = um.units.filter(u => u.team === 'fire' && u.state !== 'dead').length;
        const iceCount = um.units.filter(u => u.team === 'ice' && u.state !== 'dead').length;
        const surge = checkEquilibriumSurge(fireCount, iceCount);
        if (surge.triggered && surge.beneficiary === selectedTeam) {
            playerMana = Math.min(MAX_MANA, playerMana + surge.manaBonus);
            updateManaUI();
        }
    }
    realtimeAiAccum += dt;
    if (realtimeAiAccum >= getAiDeployInterval()) {
        realtimeAiAccum = 0;
        const pool = aiPool();
        const eTeam = enemyTeam();
        const maxUnits = getAiMaxUnits();
        if (um.units.filter(u => u.team === eTeam && u.state !== 'dead').length < maxUnits) {
            const unit = um.spawnUnit(pool[Math.floor(Math.random() * pool.length)], eTeam);
            // Apply difficulty stat multiplier
            const mult = getAiStatMult();
            unit.hp = Math.round(unit.hp * mult);
            unit.stats.maxHp = Math.round(unit.stats.maxHp * mult);
            unit.stats.attack = Math.round(unit.stats.attack * mult);
            // At level 6-7, AI deploys 2 units at once
            if (difficultyLevel >= 6 && um.units.filter(u => u.team === eTeam && u.state !== 'dead').length < maxUnits) {
                const u2 = um.spawnUnit(pool[Math.floor(Math.random() * pool.length)], eTeam);
                u2.hp = Math.round(u2.hp * mult);
                u2.stats.maxHp = Math.round(u2.stats.maxHp * mult);
                u2.stats.attack = Math.round(u2.stats.attack * mult);
            }
        }
    }
}

// ─── 2P TICK ──────────────────────────────────────────────────────────
let twoPlayerSurgeAccum = 0;

function tick2P(dt: number): void {
    realtimeManaAccum += dt;
    if (realtimeManaAccum >= MANA_REGEN_INTERVAL && playerMana < MAX_MANA) {
        realtimeManaAccum -= MANA_REGEN_INTERVAL;
        playerMana = Math.min(MAX_MANA, playerMana + 1);
        updateManaUI();
    }
    iceManaAccum += dt;
    if (iceManaAccum >= MANA_REGEN_INTERVAL && iceMana < MAX_MANA) {
        iceManaAccum -= MANA_REGEN_INTERVAL;
        iceMana = Math.min(MAX_MANA, iceMana + 1);
        updateIceManaUI();
    }
    // Equilibrium Surge: check every 5s, grant +2 mana to weaker side
    twoPlayerSurgeAccum += dt;
    if (twoPlayerSurgeAccum >= 5.0 && _um) {
        twoPlayerSurgeAccum = 0;
        const fireCount = _um.units.filter(u => u.team === 'fire' && u.state !== 'dead').length;
        const iceCount = _um.units.filter(u => u.team === 'ice' && u.state !== 'dead').length;
        const surge = checkEquilibriumSurge(fireCount, iceCount);
        if (surge.triggered) {
            if (surge.beneficiary === 'fire') {
                playerMana = Math.min(MAX_MANA, playerMana + surge.manaBonus);
                updateManaUI();
            } else {
                iceMana = Math.min(MAX_MANA, iceMana + surge.manaBonus);
                updateIceManaUI();
            }
        }
    }
}

// ─── TEAM HELPERS ─────────────────────────────────────────────────────
function playerCardDefs(): CardDef[] {
    return selectedTeam === 'ice' ? AI_CARDS : CARD_DEFS;
}

function enemyTeam(): 'fire' | 'ice' {
    return selectedTeam === 'fire' ? 'ice' : 'fire';
}

const FIRE_AI_POOL: UnitType[] = ['korhan', 'erlik', 'od'];
const ICE_AI_POOL: UnitType[] = ['ayaz', 'tulpar', 'umay'];

function aiPool(): UnitType[] {
    return selectedTeam === 'fire' ? ICE_AI_POOL : FIRE_AI_POOL;
}

// ─── 2P SETUP ─────────────────────────────────────────────────────────
// Ice player gets ice + one neutral card
const ICE_CARDS = AI_CARDS;

function setup2Player(um: UnitManager): void {
    const iceTray = document.getElementById('ice-card-tray')!;
    iceTray.style.display = 'flex';
    buildIceCardUI(um);
    // Z/X/C = lanes 0/1/2  |  1-4 = card select  |  Escape = deselect
    window.addEventListener('keydown', (e) => handleIceKeyboard(e, um));
}

function buildIceCardUI(um: UnitManager): void {
    const cont = document.getElementById('ice-card-container')!;
    cont.innerHTML = '';

    ICE_CARDS.forEach((card, idx) => {
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

    // Ice mana gems
    const iceArea = document.getElementById('ice-card-area')!;
    const iceManaDiv = document.createElement('div');
    iceManaDiv.id = 'ice-mana-row';
    iceManaDiv.style.cssText = 'display:flex;gap:3px;align-items:center;padding:0 6px;';
    iceArea.appendChild(iceManaDiv);

    // Keyboard hint
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:9px;color:rgba(150,200,255,0.3);letter-spacing:0.5px;margin-left:10px;align-self:center;white-space:nowrap;';
    hint.textContent = t('cardHint');
    iceArea.appendChild(hint);

    updateIceManaUI();
}

function canAffordIceCard(card: CardDef): boolean {
    if (card.avxCost > 0) return iceAvx >= card.avxCost;
    return iceMana >= card.manaCost;
}

function selectIceCard(cardId: UnitType, el: HTMLElement): void {
    const card = CARD_DEFS.find(c => c.id === cardId);
    if (!card || !canAffordIceCard(card)) { pulseRed(el); return; }

    const same = selectedIceCardId === cardId;
    clearIceSelection();
    if (!same) {
        selectedIceCardId = cardId;
        el.style.outline = '2px solid rgba(80,180,255,0.9)';
        el.style.transform = 'translateY(-10px) scale(1.06)';
        el.style.boxShadow = '0 0 28px rgba(40,150,255,0.7)';
    }
}

function clearIceSelection(): void {
    selectedIceCardId = null;
    document.querySelectorAll<HTMLElement>('[id^="ice-card-"]').forEach(c => {
        c.style.outline = '';
        c.style.transform = '';
        c.style.boxShadow = '';
    });
}

function updateIceManaUI(): void {
    const row = document.getElementById('ice-mana-row');
    if (!row) return;
    let html = '';
    for (let i = 0; i < MAX_MANA; i++) {
        if (i < iceMana)
            html += `<div class="mana-gem" style="background:#2288ff;box-shadow:0 0 6px rgba(40,150,255,0.9)"></div>`;
        else
            html += `<div class="mana-gem empty"></div>`;
    }
    row.innerHTML = html;

    ICE_CARDS.forEach(card => {
        const el = document.getElementById(`ice-card-${card.id}`) as HTMLElement | null;
        if (!el) return;
        const canPlay = canAffordIceCard(card);
        el.classList.toggle('card-disabled', !canPlay);
        el.style.opacity = canPlay ? '1' : '0.4';
        el.style.filter = canPlay ? '' : 'grayscale(50%) brightness(0.7)';
    });
}

function handleIceKeyboard(e: KeyboardEvent, um: UnitManager): void {
    // Settings keybind capture aktifse yoksay
    if (_listeningEl) return;

    const key = e.key;
    const kl = key.toLowerCase();
    const ib = keybinds.ice;

    // Kart seçimi (card1-card6)
    const cardKeys = [ib.card1, ib.card2, ib.card3, ib.card4, ib.card5, ib.card6];
    const cardIdx = cardKeys.findIndex(k => k.toLowerCase() === kl);
    if (cardIdx !== -1 && cardIdx < ICE_CARDS.length) {
        const card = ICE_CARDS[cardIdx];
        const el = document.getElementById(`ice-card-${card.id}`) as HTMLElement;
        if (el) selectIceCard(card.id as UnitType, el);
        return;
    }

    // Lane deploy
    let lane = -1;
    if (kl === ib.laneLeft.toLowerCase()) lane = 0;
    else if (kl === ib.laneMid.toLowerCase()) lane = 1;
    else if (kl === ib.laneRight.toLowerCase()) lane = 2;

    if (lane !== -1 && selectedIceCardId) {
        e.preventDefault();
        const card = CARD_DEFS.find(c => c.id === selectedIceCardId);
        if (!card) return;
        if (!canAffordIceCard(card)) {
            const el = document.getElementById(`ice-card-${card.id}`) as HTMLElement | null;
            if (el) pulseRed(el);
            return;
        }
        if (card.avxCost > 0) {
            iceAvx -= card.avxCost;
        } else {
            iceMana -= card.manaCost;
        }
        um.spawnUnit(selectedIceCardId, 'ice', lane);
        clearIceSelection();
        updateIceManaUI();
    }

    if (key === ib.cancel) clearIceSelection();
}

// ─── BASE HP UI — MK style ────────────────────────────────────────────
// Ghost bar: güncellemeyi geciktir → sarı izi oluştur
let _fireGhostTimeout: ReturnType<typeof setTimeout> | null = null;
let _iceGhostTimeout: ReturnType<typeof setTimeout> | null = null;
let _prevFireRatio = 1;
let _prevIceRatio = 1;

function updateBaseHpUI(fireBase: BaseBuilding, iceBase: BaseBuilding): void {
    const fr = fireBase.hpRatio * 100;
    const ir = iceBase.hpRatio * 100;

    const fireGhost = document.getElementById('fire-base-ghost') as HTMLElement;
    const iceGhost = document.getElementById('ice-base-ghost') as HTMLElement;

    // ── Fire ──────────────────────────────────────────────
    if (fr < _prevFireRatio) {
        // Hasar aldı: ghost hemen dur, live bar azal, ghost 900ms sonra takip et
        if (_fireGhostTimeout) clearTimeout(_fireGhostTimeout);
        _fireGhostTimeout = setTimeout(() => {
            if (fireGhost) fireGhost.style.width = `${fr.toFixed(1)}%`;
        }, 900);
        // Hit flash
        fireBaseFill.classList.remove('mk-hit');
        void (fireBaseFill as HTMLElement).offsetWidth; // reflow
        fireBaseFill.classList.add('mk-hit');
        setTimeout(() => fireBaseFill.classList.remove('mk-hit'), 260);
    }
    fireBaseFill.style.width = `${fr.toFixed(1)}%`;
    fireBaseFill.classList.toggle('mk-danger', fr <= 20);

    // ── Ice ───────────────────────────────────────────────
    if (ir < _prevIceRatio) {
        if (_iceGhostTimeout) clearTimeout(_iceGhostTimeout);
        _iceGhostTimeout = setTimeout(() => {
            if (iceGhost) iceGhost.style.width = `${ir.toFixed(1)}%`;
        }, 900);
        iceBaseFill.classList.remove('mk-hit');
        void (iceBaseFill as HTMLElement).offsetWidth;
        iceBaseFill.classList.add('mk-hit');
        setTimeout(() => iceBaseFill.classList.remove('mk-hit'), 260);
    }
    iceBaseFill.style.width = `${ir.toFixed(1)}%`;
    iceBaseFill.classList.toggle('mk-danger', ir <= 20);

    _prevFireRatio = fr;
    _prevIceRatio = ir;

    // Sayı gösterimi
    fireBaseHpText.textContent = `${Math.ceil(fireBase.hp)}`;
    iceBaseHpText.textContent = `${Math.ceil(iceBase.hp)}`;
}

// ─── BOARD CONTROL UI ─────────────────────────────────────────────────
function updateBoardControlUI(um: UnitManager): void {
    const ctrl = calcBoardControl(um.units);
    const total = ctrl.fireScore + ctrl.iceScore;
    if (total === 0) {
        bcmFill.style.left = '50%';
        bcmFill.style.width = '0%';
        return;
    }
    const fireRatio = ctrl.fireScore / total;
    const barWidth = Math.abs(0.5 - fireRatio) * 100;
    if (fireRatio > 0.5) {
        bcmFill.style.left = '50%';
        bcmFill.style.width = `${barWidth}%`;
        (bcmFill.style as any).background = 'linear-gradient(90deg, transparent, #4488ff)';
    } else {
        bcmFill.style.left = `${50 - barWidth}%`;
        bcmFill.style.width = `${barWidth}%`;
        (bcmFill.style as any).background = 'linear-gradient(90deg, #ff4400, transparent)';
    }

    const surge = checkEquilibriumSurge(ctrl.fireScore, ctrl.iceScore);
    surgeIndicator.style.display = surge.triggered ? 'block' : 'none';
}

// ─── WIN SCREEN ───────────────────────────────────────────────────────
const UNIT_TR_NAMES: Record<string, string> = {
    korhan: 'Korhan', erlik: 'Erlik', od: 'Od',
    ayaz: 'Ayaz', tulpar: 'Tulpar', umay: 'Umay',
    albasti: 'Albastı', tepegoz: 'Tepegöz', sahmeran: 'Şahmeran',
};

/** Show bet payout/loss info on the win overlay */
function showBetResultOnWin(didWin: boolean, amountAvax: number, txHash: string | null) {
    const row = document.getElementById('bet-result-row');
    const icon = document.getElementById('bet-result-icon');
    const text = document.getElementById('bet-result-text');
    const tx = document.getElementById('bet-result-tx');
    if (!row || !icon || !text || !tx) return;

    row.style.display = 'block';
    row.className = didWin ? 'bet-win' : 'bet-loss';

    if (didWin) {
        icon.textContent = 'KAZANDIN';
        text.textContent = `+${amountAvax.toFixed(4)} AVAX kazandın!`;
        if (txHash) {
            tx.innerHTML = `TX: <a href="https://testnet.snowtrace.io/tx/${txHash}" target="_blank" rel="noopener">${txHash.slice(0, 18)}…</a>`;
        } else {
            tx.textContent = 'Ödeme işleniyor…';
        }
    } else {
        icon.textContent = '💸';
        text.textContent = `-${amountAvax.toFixed(4)} AVAX kaybettin`;
        tx.textContent = '';
    }
}

function showWinScreen(sys: WinConditionSystem): void {
    // Reset bet result display (not relevant in AI games)
    const betRow = document.getElementById('bet-result-row');
    if (betRow) betRow.style.display = 'none';

    const winner = sys.getWinner();
    const playerWon = winner === selectedTeam;

    // Kazanma / kaybetme başlığı
    winTitle.textContent = playerWon ? t('victory') : t('defeat');
    winTitle.className = winner === 'fire' ? 'fire-win' : 'ice-win';
    winMessage.textContent = sys.getWinMessage();

    // Record local leaderboard stats (VS AI only)
    if (walletAddress && gameMode !== 'multiplayer') {
        leaderboardService.recordResult(walletAddress, playerWon ? 'win' : 'loss');
    }

    // Stats tablo başlıkları
    const thead = document.querySelector('#win-stats-table thead tr');
    if (thead) {
        thead.innerHTML = `
            <th>${t('winStatChar')}</th>
            <th>${t('winStatTeam')}</th>
            <th>${t('winStatDep')}</th>
            <th>${t('winStatDead')}</th>
            <th>${t('winStatAlive')}</th>
            <th>${t('winStatPoai')}</th>
        `;
    }

    // Fill stats table
    if (_um) {
        const stats = _um.getStats();
        const tbody = document.getElementById('win-stats-body')!;
        tbody.innerHTML = '';

        const rows = Object.entries(stats).sort(([a], [b]) => a.localeCompare(b));

        for (const [key, s] of rows) {
            const type = key.split('_')[0];
            const alive = s.deployed - s.deaths;
            const tr = document.createElement('tr');
            tr.className = s.team === 'fire' ? 'team-fire' : 'team-ice';
            tr.innerHTML = `
                <td class="stat-name">${UNIT_TR_NAMES[type] ?? type}</td>
                <td>${s.team === 'fire' ? t('teamFire') : t('teamIce')}</td>
                <td>${s.deployed}</td>
                <td class="${s.deaths > 0 ? 'stat-dead' : 'stat-zero'}">${s.deaths}</td>
                <td class="${alive > 0 ? 'stat-alive' : 'stat-zero'}">${alive}</td>
                <td>${s.bestPoAI}</td>
            `;
            tbody.appendChild(tr);
        }
    }

    // Buton metinleri
    const winRestartBtn = document.getElementById('win-restart-btn');
    if (winRestartBtn) {
        winRestartBtn.textContent = t('winReplay');
        winRestartBtn.onclick = () => {
            // Engine temizle → aynı mod ile yeniden başlat
            const restartMode = gameMode;
            cleanupGame();
            boot(restartMode);
        };
    }
    const winHomeBtn = document.getElementById('win-home-btn');
    if (winHomeBtn) {
        winHomeBtn.textContent = t('winHome');
        winHomeBtn.onclick = () => {
            cleanupGame();
        };
        winHomeBtn.onmouseenter = () => { (winHomeBtn as HTMLElement).style.color = '#fff'; (winHomeBtn as HTMLElement).style.borderColor = 'rgba(255,255,255,0.3)'; };
        winHomeBtn.onmouseleave = () => { (winHomeBtn as HTMLElement).style.color = ''; (winHomeBtn as HTMLElement).style.borderColor = ''; };
    }

    winOverlay.classList.add('show');

    // Record match result to Kite Chain (non-blocking)
    void kiteService.finalizeMatch({
        playerAddress: (window as any).__walletAddress ?? '0x0',
        characterType: selectedTeam === 'fire' ? 'korhan' : 'ayaz',
        won: playerWon,
        turnsPlayed: turnCount,
        totalPoAIDelta: 0,
    });

    // Submit game result on-chain (non-blocking)
    if (profileService.isConnected && profileService.currentProfile) {
        const result = playerWon ? 'win' : 'loss';
        void profileService.submitGameResult(result);
    }
}

// ─── CARD UI ─────────────────────────────────────────────────────────
function buildCardUI(um: UnitManager): void {
    cardContainer.innerHTML = '';
    playerCardDefs().forEach((card, idx) => {
        cardContainer.appendChild(createCardEl(card, um, idx));
    });
}

function canAffordCard(card: CardDef): boolean {
    if (card.avxCost > 0) return playerAvx >= card.avxCost;
    return playerMana >= card.manaCost;
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
        if (phase !== 'player' || !canAffordCard(card)) {
            pulseRed(el); return;
        }
        pendingCard = card;
        showLaneOverlay(el);
    });

    el.addEventListener('mouseenter', () => {
        if (!el.classList.contains('card-disabled'))
            el.style.boxShadow = `0 0 28px ${card.glowColor}, 0 4px 18px rgba(0,0,0,0.6)`;
    });
    el.addEventListener('mouseleave', () => { el.style.boxShadow = ''; });

    return el;
}

// ─── SKILL CARD UI ───────────────────────────────────────────────────
let manaFrozen = false;
let manaFreezeTimer = 0;
let ouroborosMode = false;
let autoCollectActive = false;
let autoCollectTimer: ReturnType<typeof setTimeout> | null = null;
let banCollectActive = false;
let banCollectTimer: ReturnType<typeof setTimeout> | null = null;

// ─── SKILL COOLDOWN TRACKING ─────────────────────────────────────────
/** Kalan cooldown süresi (saniye cinsinden). 0 = kullanılabilir */
const skillCooldowns: Record<string, number> = {};
/** Cooldown'u her frame güncelleyen timer ID (requestAnimationFrame) */
let cooldownRAF: number | null = null;

/** Cooldown geri sayımını başlat (oyun başında çağrılır) */
function startCooldownTicker(): void {
    let lastTime = performance.now();
    function tick(): void {
        const now = performance.now();
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        let anyActive = false;
        for (const id of Object.keys(skillCooldowns)) {
            if (skillCooldowns[id] > 0) {
                skillCooldowns[id] = Math.max(0, skillCooldowns[id] - dt);
                anyActive = true;
                updateCooldownOverlay(id, skillCooldowns[id]);
            }
        }
        if (anyActive) updatePromptStates();
        cooldownRAF = requestAnimationFrame(tick);
    }
    cooldownRAF = requestAnimationFrame(tick);
}

/** Cooldown sıfırla (oyun bittiğinde veya yeni oyun başında) */
function resetAllCooldowns(): void {
    for (const id of Object.keys(skillCooldowns)) {
        skillCooldowns[id] = 0;
        updateCooldownOverlay(id, 0);
    }
}

/** Kart üzerindeki cooldown overlay'ini güncelle */
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

function buildPromptUI(): void {
    promptContainer.innerHTML = '';
    PROMPT_DEFS.forEach(def => {
        promptContainer.appendChild(createPromptCardEl(def));
    });
}

function createPromptCardEl(def: PromptCardDef): HTMLElement {
    const cardName = def.nameKey ? t(def.nameKey as any) : def.name;
    const cardDesc = def.descKey ? t(def.descKey as any) : def.description;
    const el = document.createElement('div');
    el.className = 'prompt-card';
    el.id = `prompt-${def.id}`;
    el.innerHTML = `
        <div class="prompt-card-cost">${def.manaCost > 0 ? def.manaCost : ''}</div>
        <div class="prompt-card-icon"><img src="${def.imagePath}" alt="${cardName}" /></div>
        <div class="prompt-card-footer">
            <div class="prompt-card-name">${cardName}</div>
        </div>
    `;
    el.title = cardDesc;

    el.addEventListener('click', () => {
        // Multiplayer: oyun henüz başlamadıysa engelle
        if (gameMode === 'multiplayer' && !mpGameStarted) { pulseRed(el); return; }
        if (phase !== 'player' || playerMana < def.manaCost) {
            pulseRed(el); return;
        }
        // Cooldown kontrolü — bekleme süresindeyse engelle
        if ((skillCooldowns[def.id] ?? 0) > 0) {
            pulseRed(el); return;
        }
        applyPromptEffect(def);
        if (!manaFrozen) playerMana -= def.manaCost;
        // Cooldown'u başlat
        skillCooldowns[def.id] = def.cooldown;
        // Multiplayer: rakibe skill bildir
        if (gameMode === 'multiplayer') {
            mpService.sendPrompt(def.id);
        }
        clearPromptSelections();
        updateManaUI();
        updatePromptStates();
        playCardAnim(el);
    });

    return el;
}

function clearPromptSelections(): void {
    document.querySelectorAll('.prompt-card').forEach(el => el.classList.remove('selected'));
}

// ─── ACTIVE EFFECT BAR ────────────────────────────────────────────────
const activeEffectsEl = document.getElementById('active-effects')!;

const EFFECT_DISPLAY: Record<string, { labelKey: string; color: string }> = {
    mana_fill: { labelKey: 'manaFill', color: '#aaff55' },
    mana_freeze: { labelKey: 'manaFreeze', color: '#55ccff' },
    ouroboros: { labelKey: 'ouroboros', color: '#cc55ff' },
    autocollect: { labelKey: 'autoCollect', color: '#ffcc00' },
    bancollect: { labelKey: 'banCollect', color: '#ff4444' },
};

function showActiveEffect(def: PromptCardDef): void {
    // Instant effects (duration = 0) still show briefly
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

function applyPromptEffect(def: PromptCardDef, forTeam?: 'fire' | 'ice'): void {
    showActiveEffect(def);
    const um = _um;
    if (!um) return;
    // forTeam: multiplayer'da rakibin komutu gelince onun takımını geçeriz
    const playerTeam = forTeam ?? selectedTeam;
    const enemyTeam = playerTeam === 'fire' ? 'ice' : 'fire';

    switch (def.effectType) {
        case 'mana_fill':
            playerMana = MAX_MANA;
            updateManaUI();
            break;

        case 'mana_freeze':
            manaFrozen = true;
            manaFreezeTimer = def.duration;
            setTimeout(() => { manaFrozen = false; }, def.duration * 1000);
            break;

        case 'ouroboros': {
            const enemies = um.units.filter(u => u.team === enemyTeam && u.state !== 'dead');
            if (enemies.length === 0) break;
            ouroborosMode = true;
            showEnemyPicker(enemies, um, playerTeam);
            break;
        }

        case 'autocollect':
            if (autoCollectTimer) clearTimeout(autoCollectTimer);
            autoCollectActive = true;
            autoCollectTimer = setTimeout(() => { autoCollectActive = false; }, def.duration * 1000);
            break;

        case 'bancollect':
            if (banCollectTimer) clearTimeout(banCollectTimer);
            banCollectActive = true;
            banCollectTimer = setTimeout(() => { banCollectActive = false; }, def.duration * 1000);
            break;
    }
}
function showEnemyPicker(enemies: import('./ecs/Unit').Unit[], um: UnitManager, playerTeam: 'fire' | 'ice'): void {
    let overlay = document.getElementById('ouroboros-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'ouroboros-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div style="color:#cc55ff;font-size:22px;font-weight:bold;margin-bottom:8px;">${t('ouroborosTitle')}</div>`;

    for (const enemy of enemies) {
        const btn = document.createElement('button');
        btn.style.cssText = 'padding:10px 24px;font-size:16px;background:#1a1a2e;color:#fff;border:2px solid #cc55ff;border-radius:8px;cursor:pointer;';
        btn.textContent = `${enemy.type.toUpperCase()} (HP: ${Math.round(enemy.hp)}, ATK: ${enemy.stats.attack})`;
        btn.addEventListener('click', () => {
            enemy.team = playerTeam;
            // Change mesh color to indicate conversion
            enemy.mesh.getChildMeshes().forEach(c => {
                if (c.material && 'emissiveColor' in c.material) {
                    (c.material as any).emissiveColor = playerTeam === 'fire'
                        ? { r: 0.6, g: 0.15, b: 0.05 }
                        : { r: 0.1, g: 0.3, b: 0.6 };
                }
            });
            ouroborosMode = false;
            overlay!.remove();
        });
        overlay.appendChild(btn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = 'padding:8px 20px;font-size:14px;background:#333;color:#aaa;border:1px solid #555;border-radius:6px;cursor:pointer;margin-top:10px;';
    cancelBtn.textContent = t('cancel');
    cancelBtn.addEventListener('click', () => {
        ouroborosMode = false;
        playerMana += 5; // refund
        overlay!.remove();
    });
    overlay.appendChild(cancelBtn);
}

function updatePromptStates(): void {
    PROMPT_DEFS.forEach(def => {
        const el = document.getElementById(`prompt-${def.id}`);
        if (!el) return;
        const onCooldown = (skillCooldowns[def.id] ?? 0) > 0;
        const canPlay = phase === 'player' && playerMana >= def.manaCost && !onCooldown;
        el.classList.toggle('card-disabled', !canPlay);
        el.style.opacity = canPlay ? '1' : '0.4';
        el.style.cursor = canPlay ? 'pointer' : 'not-allowed';
    });
}

// ─── MODULE-LEVEL REFS (for prompt effects / shard) ──────────────────
let _um: UnitManager | null = null;
let _shards: AvaShardManager | null = null;

// ─── BÖRÜ SPIRIT WOLF CARD UI ────────────────────────────────────────
/** Active börü cards currently shown on screen */
const activeBoruCards: HTMLElement[] = [];

function showBoruCard(spirit: 'good' | 'bad', boruTeam: 'fire' | 'ice', _triggerTeam: 'fire' | 'ice'): void {
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
            <img src="/assets/images/characters/boru.png" alt="Börü"
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

    // Entrance animation
    card.style.transform = 'translateX(-50px)';
    card.style.opacity = '0';
    requestAnimationFrame(() => {
        card.style.transform = 'translateX(0)';
        card.style.opacity = '1';
    });

    // Listen for börü death — remove card
    if (_um) {
        const checkDeath = setInterval(() => {
            if (!_um) { clearInterval(checkDeath); return; }
            const boruAlive = _um.units.some(u => u.type === 'boru' && u.team === boruTeam && u.state !== 'dead');
            if (!boruAlive) {
                clearInterval(checkDeath);
                card.style.opacity = '0';
                card.style.transform = 'translateX(-50px)';
                setTimeout(() => {
                    card.remove();
                    const idx = activeBoruCards.indexOf(card);
                    if (idx >= 0) activeBoruCards.splice(idx, 1);
                    // Reposition remaining cards
                    activeBoruCards.forEach((c, i) => {
                        c.style.top = `${180 + i * 130}px`;
                    });
                }, 400);
            }
        }, 500);
    }
}

// ─── LANE OVERLAY ────────────────────────────────────────────────────
const laneOverlay = document.getElementById('lane-overlay') as HTMLElement;
let _laneUm: UnitManager | null = null;

// ─── PLAYER KEYBOARD SHORTCUTS ───────────────────────────────────────
function setupPlayerKeyboard(): void {
    window.addEventListener('keydown', (e) => {
        // Settings keybind capture aktifse yoksay
        if (_listeningEl) return;
        // Input alanı odaklanmışsa çalıştırma
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        // Oyun aktif değilse yoksay
        if (phase !== 'player') return;

        const key = e.key;
        const kl = key.toLowerCase();
        const fb = keybinds.fire;

        // Kart seçimi (card1-card6)
        const cardKeys = [fb.card1, fb.card2, fb.card3, fb.card4, fb.card5, fb.card6];
        const cardIdx = cardKeys.findIndex(k => k.toLowerCase() === kl);
        if (cardIdx !== -1) {
            const cards = playerCardDefs();
            const card = cards[cardIdx];
            if (!card) return;
            const el = document.getElementById(`card-${card.id}`);
            if (!el) return;
            if (!canAffordCard(card)) { pulseRed(el); return; }
            if (pendingCard?.id === card.id) {
                pendingCard = null;
                laneOverlay.style.display = 'none';
                highlightCard(null);
                return;
            }
            pendingCard = card;
            highlightCard(card.id);
            showLaneOverlay(el);
            e.preventDefault();
            return;
        }

        // Lane deploy
        if (pendingCard) {
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

        // İptal
        if (key === fb.cancel && pendingCard) {
            pendingCard = null;
            laneOverlay.style.display = 'none';
            highlightCard(null);
        }
    });
}

// Seçili kartı vurgula / vurguyu kaldır
function highlightCard(cardId: string | null): void {
    playerCardDefs().forEach(c => {
        const el = document.getElementById(`card-${c.id}`);
        if (!el) return;
        if (c.id === cardId) {
            el.style.outline = '2px solid rgba(255,220,50,0.9)';
            el.style.transform = 'translateY(-14px) scale(1.07)';
            el.style.boxShadow = `0 0 28px rgba(255,200,0,0.7), 0 4px 18px rgba(0,0,0,0.6)`;
        } else {
            el.style.outline = '';
            el.style.transform = '';
            el.style.boxShadow = '';
        }
    });
}

function setupLaneOverlay(um: UnitManager): void {
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
        pendingCard = null;
        laneOverlay.style.display = 'none';
        highlightCard(null);
    });
}

function showLaneOverlay(cardEl: HTMLElement): void {
    laneOverlay.style.display = 'flex';
    cardEl.animate([
        { transform: 'translateY(-22px) scale(1.05)' },
        { transform: 'translateY(-28px) scale(1.07)' },
        { transform: 'translateY(-22px) scale(1.05)' },
    ], { duration: 600, iterations: Infinity });
}

function deployPendingCard(lane: number): void {
    if (!pendingCard || !_laneUm) return;
    // Multiplayer: oyun henüz başlamadıysa engelle
    if (gameMode === 'multiplayer' && !mpGameStarted) return;
    const card = pendingCard;
    pendingCard = null;
    laneOverlay.style.display = 'none';

    if (card.avxCost > 0) {
        playerAvx -= card.avxCost;
        updateAvxUI();
    } else if (!manaFrozen) {
        playerMana -= card.manaCost;
    }
    _laneUm.spawnUnit(card.id as UnitType, selectedTeam, lane);

    // Multiplayer: rakibe haber ver
    if (gameMode === 'multiplayer') {
        const laneKey = (['left', 'mid', 'right'] as const)[lane] ?? 'mid';
        mpService.sendPlace(card.id, laneKey);
    }

    const el = document.getElementById(`card-${card.id}`);
    if (el) playCardAnim(el);
    updateManaUI();
    updateCardStates();
}

// ─── SHARED CARD HELPERS ─────────────────────────────────────────────
function playCardAnim(el: HTMLElement): void {
    el.animate([
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(-35px) scale(1.1)' },
        { transform: 'translateY(0) scale(1)' },
    ], { duration: 300, easing: 'ease-out' });
}

function pulseRed(el: HTMLElement): void {
    el.animate([
        { boxShadow: '0 0 0px rgba(255,0,0,0)' },
        { boxShadow: '0 0 24px rgba(255,0,0,0.9), inset 0 0 14px rgba(255,0,0,0.5)' },
        { boxShadow: '0 0 0px rgba(255,0,0,0)' },
    ], { duration: 400 });
}

function updateCardStates(): void {
    playerCardDefs().forEach(card => {
        const el = document.getElementById(`card-${card.id}`) as HTMLElement | null;
        if (!el) return;
        const canPlay = phase === 'player' && canAffordCard(card);
        el.classList.toggle('card-disabled', !canPlay);
        el.style.opacity = canPlay ? '1' : '0.4';
        el.style.cursor = canPlay ? 'pointer' : 'not-allowed';
        el.style.filter = canPlay ? '' : 'grayscale(55%) brightness(0.7)';
    });
    updatePromptStates();
}

function updateManaUI(): void {
    const filled = Math.min(playerMana, MAX_MANA);
    let html = '';
    for (let i = 0; i < MAX_MANA; i++) {
        html += `<div class="mana-gem ${i < filled ? 'full' : 'empty'}"></div>`;
    }
    manaRow.innerHTML = html;
    updateCardStates();
}

function updateAvxUI(): void {
    const el = document.getElementById('avx-counter');
    if (el) el.textContent = String(playerAvx);
}

// ─── AVX COIN DROP SYSTEM ────────────────────────────────────────────
let _scene: any = null;
let _engine: any = null;

function spawnAvxCoin(worldPos: { x: number; y: number; z: number }, killerTeam: 'fire' | 'ice', index: number): void {
    if (!_scene || !_engine) return;
    if (index === 0) playCoinDrop();

    const cam = _scene.activeCamera;
    if (!cam) return;

    // Use a temporary mesh to get screen coordinates
    let sx: number, sy: number;
    try {
        const tempPos = new Vector3(worldPos.x, worldPos.y + 1.5, worldPos.z);
        const screenPos = Vector3.Project(
            tempPos,
            _scene.getTransformMatrix(),
            cam.getTransformationMatrix(),
            cam.viewport.toGlobal(_engine.getRenderWidth(), _engine.getRenderHeight()),
        );
        // Canvas might be scaled vs CSS pixels
        const canvas = _engine.getRenderingCanvas()!;
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / _engine.getRenderWidth();
        const scaleY = rect.height / _engine.getRenderHeight();
        sx = rect.left + screenPos.x * scaleX;
        sy = rect.top + screenPos.y * scaleY;
        if (isNaN(sx) || isNaN(sy)) throw new Error('NaN');
    } catch {
        sx = window.innerWidth / 2;
        sy = window.innerHeight / 2;
    }

    // Offset for multiple coins
    sx += index * 40 + (Math.random() - 0.5) * 20;
    sy += (Math.random() - 0.5) * 20;

    const coin = document.createElement('div');
    coin.className = 'avx-coin';
    coin.style.left = `${sx}px`;
    coin.style.top = `${sy}px`;
    coin.style.opacity = '1';
    coin.style.pointerEvents = 'auto';
    coin.innerHTML = `<img src="${avxCoinUrl}" alt="AVX">`;
    document.body.appendChild(coin);

    // Drop animation
    const anim = coin.animate([
        { transform: 'translate(-50%, -50%) scale(0.3)', opacity: '0.3' },
        { transform: 'translate(-50%, -50%) scale(1.15)', opacity: '1', offset: 0.65 },
        { transform: 'translate(-50%, -50%) scale(0.95)', opacity: '1', offset: 0.85 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: '1' },
    ], { duration: 400, fill: 'forwards', easing: 'ease-out' });

    anim.onfinish = () => {
        coin.style.transform = 'translate(-50%, -50%) scale(1)';
        coin.style.opacity = '1';
    };

    // ── autocollect: oyuncu tarafı için otomatik topla ──
    if (autoCollectActive && gameMode !== 'twoplayer') {
        setTimeout(() => {
            if (!coin.parentNode) return;
            playCoinCollect();
            playerAvx++;
            updateAvxUI();
            updateCardStates();
            // Hızlı parlama animasyonu
            const autoAnim = coin.animate([
                { transform: 'translate(-50%, -50%) scale(1)', opacity: '1' },
                { transform: 'translate(-50%, -50%) scale(1.8)', opacity: '0' },
            ], { duration: 250, fill: 'forwards' });
            autoAnim.onfinish = () => coin.remove();
        }, 300);
        return; // manuel click listener'a gerek yok
    }

    function collectCoin(): void {
        playCoinCollect();
        // bancollect aktifse düşman takımı (killerTeam dışındaki) toplayamaz
        if (gameMode === 'twoplayer') {
            const isEnemy = (killerTeam === 'fire' && banCollectActive)
                || (killerTeam === 'ice' && banCollectActive);
            if (isEnemy) return; // engellendi
            if (killerTeam === 'fire') playerAvx++;
            else iceAvx++;
        } else {
            playerAvx++;
        }
        updateAvxUI();
        updateCardStates();
        const collectAnim = coin.animate([
            { transform: 'translate(-50%, -50%) scale(1)', opacity: '1' },
            { transform: 'translate(-50%, -50%) scale(1.5)', opacity: '0' },
        ], { duration: 200, fill: 'forwards' });
        collectAnim.onfinish = () => coin.remove();
    }

    // bancollect aktifse sikkeler tıklanamaz hale gelir (enemy coin)
    const isEnemyCoin = gameMode === 'twoplayer' && killerTeam !== selectedTeam;
    if (banCollectActive && isEnemyCoin) {
        // Düşmanın sikkeleri soluk ve tıklanamaz görünür
        coin.style.opacity = '0.3';
        coin.style.filter = 'grayscale(100%)';
        coin.style.cursor = 'not-allowed';
        coin.title = 'Ban Collect aktif';
    } else {
        coin.addEventListener('click', collectCoin);
    }

    // Auto-expire after 8s
    setTimeout(() => {
        if (coin.parentNode) {
            const fadeAnim = coin.animate([{ opacity: '1' }, { opacity: '0' }], { duration: 400, fill: 'forwards' });
            fadeAnim.onfinish = () => coin.remove();
        }
    }, 8000);
}

// ─── KITE UI HELPERS ─────────────────────────────────────────────────
function kiteUpdatePanel(): void {
    const aiDot = document.getElementById('kite-ai-dot');
    const chainDot = document.getElementById('kite-chain-dot');
    const srcLbl = document.getElementById('kite-source-label');
    const chainLbl = document.getElementById('kite-chain-label');
    const panel = document.getElementById('kite-panel');
    if (!aiDot || !chainDot || !srcLbl || !chainLbl) return;

    if (kiteService.isLiveAI) {
        aiDot.className = 'kite-status-dot live';
        srcLbl.textContent = t('kiteLlm');
        srcLbl.className = 'kite-row-val green';
        panel?.classList.add('live');
    } else {
        aiDot.className = 'kite-status-dot mock';
        srcLbl.textContent = t('mockAi');
        srcLbl.className = 'kite-row-val orange';
    }

    if (kiteService.isChainActive) {
        chainDot.className = 'kite-status-dot chain';
        chainLbl.textContent = t('connected');
        chainLbl.className = 'kite-row-val blue';
        panel?.classList.add('chain');
    } else {
        chainDot.className = 'kite-status-dot';
        chainLbl.textContent = t('offline');
        chainLbl.className = 'kite-row-val';
    }
}

// ─── I18N ────────────────────────────────────────────────────────────
function applyI18n(): void {
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
        // Skip wallet-label — its text is set programmatically after connect
        if (el.id === 'wallet-label' && walletBtn.classList.contains('connected')) return;
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
    // Re-render character screen with new language
    selectCharacter(currentCharId);
}

// Lang button wiring
document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const lang = btn.dataset.lang as Lang;
        setLang(lang);
        applyI18n();
        // Update button styles
        document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach(b => {
            const active = b.dataset.lang === lang;
            b.style.background = active ? 'rgba(255,255,255,0.1)' : 'transparent';
            b.style.color = active ? '#fff' : 'rgba(255,255,255,0.5)';
            b.style.borderColor = active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)';
            b.style.fontWeight = active ? '700' : '400';
        });
    });
});

// Apply saved language on load
(() => {
    const lang = getLang();
    applyI18n();
    document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach(b => {
        const active = b.dataset.lang === lang;
        b.style.background = active ? 'rgba(255,255,255,0.1)' : 'transparent';
        b.style.color = active ? '#fff' : 'rgba(255,255,255,0.5)';
        b.style.borderColor = active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)';
        b.style.fontWeight = active ? '700' : '400';
    });
})();

// ─── KEYBINDING SYSTEM ──────────────────────────────────────────────
interface KeyBindings {
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

function loadBindings(): KeyBindings {
    try {
        const raw = localStorage.getItem('a2keybinds');
        if (raw) return JSON.parse(raw) as KeyBindings;
    } catch { /* ignore */ }
    return JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
}

function saveBindings(b: KeyBindings): void {
    localStorage.setItem('a2keybinds', JSON.stringify(b));
}

let keybinds = loadBindings();

/** Returns display label for a key */
function keyLabel(key: string): string {
    if (key === ' ') return 'SPACE';
    if (key === 'Escape') return 'ESC';
    if (key === 'ArrowLeft') return '←';
    if (key === 'ArrowRight') return '→';
    if (key === 'ArrowUp') return '↑';
    if (key === 'ArrowDown') return '↓';
    return key.length === 1 ? key.toUpperCase() : key;
}

// ─── SETTINGS SCREEN ────────────────────────────────────────────────
let _stgDraft: KeyBindings = loadBindings();
let _listeningEl: HTMLElement | null = null;
let _listeningKey: { player: 'fire' | 'ice'; action: string } | null = null;

// ─── PLAYLIST UI ─────────────────────────────────────────────────────
function renderPlaylist(): void {
    const grid = document.getElementById('playlist-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const playlist = getPlaylist();
    const currentTrack = getCurrentTrack();

    for (const track of playlist) {
        const isActive = currentTrack?.id === track.id;
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
            renderPlaylist(); // UI güncelle
        };
        grid.appendChild(el);
    }
}

function initSettingsScreen(): void {
    _stgDraft = loadBindings();
    _listeningEl = null;
    _listeningKey = null;
    renderKeybindGrid('fire', 'stg-fire-binds');
    renderKeybindGrid('ice', 'stg-ice-binds');

    // Music volume slider (general panel)
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

    // SFX volume slider (general panel)
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

    // Render playlist
    renderPlaylist();

    // Tabs
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

    // Save button
    document.getElementById('stg-save-btn')!.onclick = () => {
        keybinds = JSON.parse(JSON.stringify(_stgDraft));
        saveBindings(keybinds);
        // Save volumes
        const musicVol = parseInt((document.getElementById('stg-music-volume') as HTMLInputElement)?.value ?? '30') / 100;
        const sfxVol = parseInt((document.getElementById('stg-sfx-volume') as HTMLInputElement)?.value ?? '50') / 100;
        localStorage.setItem('a2_music_volume', String(musicVol));
        localStorage.setItem('a2_sfx_volume', String(sfxVol));
        stgToast(t('settingsSaved'));
    };

    // Reset button
    document.getElementById('stg-reset-btn')!.onclick = () => {
        _stgDraft = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
        renderKeybindGrid('fire', 'stg-fire-binds');
        renderKeybindGrid('ice', 'stg-ice-binds');
        // Reset volume sliders
        if (musicVolSlider) { musicVolSlider.value = '30'; musicVolVal.textContent = '30'; setBGMVolume(0.3); }
        if (sfxVolSlider) { sfxVolSlider.value = '50'; sfxVolVal.textContent = '50'; setSFXVolume(0.5); }
    };
}

function initMiniPlayer(): void {
    const btn = document.getElementById('mini-player-btn');
    const panel = document.getElementById('mini-player-panel');
    const closeBtn = panel?.querySelector('.mp-close');
    const tracklist = document.getElementById('mp-tracklist');
    const bgmSlider = document.getElementById('mp-bgm-volume') as HTMLInputElement;
    const sfxSlider = document.getElementById('mp-sfx-volume') as HTMLInputElement;

    if (!btn || !panel || !tracklist) return;

    // Toggle panel
    btn.onclick = () => {
        panel.classList.toggle('show');
    };

    // Close button
    closeBtn?.addEventListener('click', () => {
        panel.classList.remove('show');
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        const miniPlayer = document.getElementById('mini-player');
        if (miniPlayer && !miniPlayer.contains(e.target as Node)) {
            panel.classList.remove('show');
        }
    });

    // Render tracks
    const playlist = getPlaylist();
    tracklist.innerHTML = '';
    const currentTrack = getCurrentTrack();

    playlist.forEach(track => {
        const item = document.createElement('div');
        item.className = 'mp-track' + (track.id === currentTrack?.id ? ' active' : '');
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
            // Animate button bars when track is selected
            btn.classList.add('playing');
            // Sync settings playlist if open
            document.querySelectorAll('.playlist-track').forEach(el => {
                el.classList.toggle('active', el.getAttribute('data-track') === track.id);
            });
        };
        tracklist.appendChild(item);
    });

    // BGM Volume slider
    if (bgmSlider) {
        bgmSlider.value = String(getBGMVolume());
        bgmSlider.oninput = () => {
            const vol = parseFloat(bgmSlider.value);
            setBGMVolume(vol);
            localStorage.setItem('a2_music_volume', String(vol));
            // Sync settings slider if open
            const settingsSlider = document.getElementById('stg-music-volume') as HTMLInputElement;
            const settingsVal = document.getElementById('stg-music-volume-val');
            if (settingsSlider) settingsSlider.value = String(Math.round(vol * 100));
            if (settingsVal) settingsVal.textContent = String(Math.round(vol * 100));
        };
    }

    // SFX Volume slider
    if (sfxSlider) {
        sfxSlider.value = String(getSFXVolume());
        sfxSlider.oninput = () => {
            const vol = parseFloat(sfxSlider.value);
            setSFXVolume(vol);
            localStorage.setItem('a2_sfx_volume', String(vol));
            // Sync settings slider if open
            const settingsSlider = document.getElementById('stg-sfx-volume') as HTMLInputElement;
            const settingsVal = document.getElementById('stg-sfx-volume-val');
            if (settingsSlider) settingsSlider.value = String(Math.round(vol * 100));
            if (settingsVal) settingsVal.textContent = String(Math.round(vol * 100));
        };
    }

    // Animate bars when music is playing (initial load)
    if (currentTrack) {
        btn.classList.add('playing');
    }
}

// ─── MINI PLAYER SHOW/HIDE ───────────────────────────────────────────
function showMiniPlayer(): void {
    const miniPlayer = document.getElementById('mini-player');
    if (miniPlayer) {
        miniPlayer.style.display = 'flex';
        // Re-init sliders with current values
        const bgmSlider = document.getElementById('mp-bgm-volume') as HTMLInputElement;
        const sfxSlider = document.getElementById('mp-sfx-volume') as HTMLInputElement;
        if (bgmSlider) bgmSlider.value = String(getBGMVolume());
        if (sfxSlider) sfxSlider.value = String(getSFXVolume());
    }
}

function hideMiniPlayer(): void {
    const miniPlayer = document.getElementById('mini-player');
    if (miniPlayer) {
        miniPlayer.style.display = 'none';
        // Close panel if open
        document.getElementById('mini-player-panel')?.classList.remove('show');
    }
}

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
    // Clear previous listener
    if (_listeningEl) _listeningEl.classList.remove('listening');

    _listeningEl = el;
    _listeningKey = { player, action };
    el.classList.add('listening');
    el.textContent = t('settingsPressKey');
}

// Global keydown listener for keybind capture
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
