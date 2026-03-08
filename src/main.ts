/**
 * main.ts — Multi-mode card strategy game entry point.
 * Modes: realtime (vs AI) | twoplayer (local 2P)
 */
import { Engine } from '@babylonjs/core/Engines/engine';
import { createScene } from './scene/createScene';
import { createAvaxMap } from './scene/map/createAvaxMap';
import { createHero } from './scene/units/createHero';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CameraSystem } from './scene/systems/cameraSystem';
import { UnitManager } from './ecs/UnitManager';
import { CARD_DEFS, AI_CARDS, AI_PROFILES_MAP, CardDef, UnitType } from './ecs/Unit';
import { AvaShardManager } from './scene/map/AvaShard';
import { BaseBuilding } from './scene/map/BaseBuilding';
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
import { switchBGM, lowerBGMForGame, setBGMVolume, toggleBGMMute, getBGMVolume, isBGMMuted, setSFXVolume, toggleSFXMute, getSFXVolume, isSFXMuted, playCoinDrop, playCoinCollect, preloadSFX } from './audio/SoundManager';
import { profileService } from './chain/ProfileService';

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
const teamSelectScreen = document.getElementById('team-select-screen') as HTMLElement;
const walletBtn = document.getElementById('wallet-btn') as HTMLButtonElement;
const walletLabel = document.getElementById('wallet-label') as HTMLElement;

// ─── SCREEN ROUTER ──────────────────────────────────────────────────
type Screen = 'home' | 'characters' | 'story' | 'team-select' | 'mode-select' | 'game';

const difficultyScreen = document.getElementById('difficulty-select') as HTMLElement;
const MENU_SCREENS = [homeScreen, charactersScreen, storyScreen, teamSelectScreen, modeSelectEl, difficultyScreen];
const GAME_HUD = ['top-hud', 'board-control-meter', 'debug-ui', 'card-tray', 'surge-indicator', 'kite-panel'];

function showScreen(screen: Screen): void {
    // Hide all menu screens
    for (const el of MENU_SCREENS) el.style.display = 'none';

    // Header visible on menu screens, hidden in game
    appHeader.style.display = screen === 'game' ? 'none' : 'flex';

    // Hide game HUD on menu screens
    const inGame = screen === 'game';
    for (const id of GAME_HUD) {
        const el = document.getElementById(id);
        if (el) el.style.display = inGame ? '' : 'none';
    }
    canvas.style.display = inGame ? 'block' : 'none';

    switch (screen) {
        case 'home':
            homeScreen.style.display = 'flex';
            switchBGM('/assets/sound/storymusic.mp3', 0.25);
            break;
        case 'characters':
            charactersScreen.style.display = 'flex';
            switchBGM('/assets/sound/character.mp3', 0.3);
            break;
        case 'story':
            storyScreen.style.display = 'flex';
            switchBGM('/assets/sound/storymusic.mp3', 0.3);
            break;
        case 'team-select':
            teamSelectScreen.style.display = 'flex';
            switchBGM('/assets/sound/storymusic.mp3', 0.25);
            break;
        case 'mode-select':
            modeSelectEl.style.display = 'flex';
            updateModeSelectTeamBadge();
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

// ─── WALLET SELECT MODAL ────────────────────────────────────────────
const walletModal = document.getElementById('wallet-modal')!;
const walletModalClose = document.getElementById('wallet-modal-close')!;
const walletOptionsDiv = walletModal.querySelector('.wallet-options')!;

function showWalletModal() {
    walletOptionsDiv.innerHTML = '';

    if (discoveredWallets.length === 0) {
        // Hiç cüzdan bulunamadı
        walletOptionsDiv.innerHTML = `
            <div style="text-align:center;padding:20px 0;">
                <div style="font-size:36px;margin-bottom:12px;">🔗</div>
                <div style="color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:16px;">Cüzdan bulunamadı</div>
                <a href="https://metamask.io/download/" target="_blank" class="profile-btn" style="display:block;text-decoration:none;text-align:center;">MetaMask İndir</a>
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
                    <div class="wallet-option-desc">${w.info.rdns}</div>
                </div>
                <div class="wallet-option-arrow">›</div>`;
            opt.addEventListener('click', async () => {
                walletModal.classList.remove('show');
                await connectWithProvider(w.provider);
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

async function connectWithProvider(provider: any): Promise<void> {
    const _ethers = (window as any).ethers;
    if (!_ethers) {
        alert('ethers kütüphanesi yüklenemedi!');
        return;
    }

    try {
        await provider.request({ method: 'eth_requestAccounts' });

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
        const ethProvider = new _ethers.BrowserProvider(provider);
        const signer = await ethProvider.getSigner();
        walletAddress = await signer.getAddress();
        (window as any).__walletAddress = walletAddress;
        const balance = await ethProvider.getBalance(walletAddress);
        const balStr = parseFloat(_ethers.formatEther(balance)).toFixed(3);

        // Update UI
        const short = walletAddress!.slice(0, 6) + '...' + walletAddress!.slice(-4);
        walletLabel.textContent = `${short} · ${balStr} AVAX`;
        walletBtn.classList.add('connected');
        walletBtn.style.borderColor = '';
        walletBtn.style.color = '';

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
        provider.on?.('accountsChanged', (accounts: string[]) => {
            if (!accounts.length) {
                walletAddress = null;
                walletLabel.textContent = t('connectWallet' as any);
                walletBtn.classList.remove('connected');
            } else {
                location.reload();
            }
        });
    } catch (err: any) {
        console.error('Wallet connection failed:', err);
        alert('Cüzdan bağlantısı başarısız: ' + (err.message || err));
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
        openProfileModal();
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

profileCloseBtn.addEventListener('click', () => {
    profileModal.classList.remove('show');
});
profileModal.addEventListener('click', (e) => {
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
    profileRegisterBtn.textContent = t('profileRegistering' as any);

    const ok = await profileService.registerProfile(username, avatarURI);
    profileRegisterBtn.disabled = false;
    profileRegisterBtn.textContent = t('profileRegister' as any);

    if (ok) {
        openProfileModal(); // refresh view
    } else {
        alert('Kayıt başarısız — kontrat adresini kontrol et.');
    }
});

async function openProfileModal() {
    profileRegisterDiv.style.display = 'none';
    profileViewDiv.style.display = 'none';
    profileNotConnected.style.display = 'none';

    if (!walletAddress) {
        profileNotConnected.style.display = '';
        profileModal.classList.add('show');
        return;
    }

    // Connect ProfileService if not already
    if (!profileService.isConnected) {
        await profileService.connectWallet();
    }

    const profile = profileService.currentProfile;

    if (!profile) {
        // Show register form
        profileRegisterDiv.style.display = '';
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
    lbBody.innerHTML = '<tr><td colspan="5" style="color:rgba(255,255,255,0.3);padding:12px;">...</td></tr>';

    profileViewDiv.style.display = '';
    profileModal.classList.add('show');

    // Fetch leaderboard async
    const entries = await profileService.getLeaderboard();
    lbBody.innerHTML = '';
    for (const e of entries) {
        const isMe = e.address.toLowerCase() === walletAddress!.toLowerCase();
        const tr = document.createElement('tr');
        if (isMe) tr.className = 'is-me';
        tr.innerHTML = `
            <td class="lb-rank ${e.rank <= 3 ? 'lb-rank-' + e.rank : ''}">${e.rank}</td>
            <td>${e.username}</td>
            <td>${e.wins}</td>
            <td>${e.gamesPlayed}</td>
            <td class="lb-winrate">${e.winRate}%</td>
        `;
        lbBody.appendChild(tr);
    }
    if (entries.length === 0) {
        lbBody.innerHTML = '<tr><td colspan="5" style="color:rgba(255,255,255,0.25);padding:12px;">Henüz oyuncu yok</td></tr>';
    }
}

// ─── TEAM SELECTION ──────────────────────────────────────────────────
let selectedTeam: 'fire' | 'ice' = 'fire';

document.querySelectorAll<HTMLElement>('.team-half').forEach(card => {
    card.addEventListener('click', () => {
        selectedTeam = card.dataset.team as 'fire' | 'ice';
        showScreen('mode-select');
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
        badge.style.color = '#FF4D00';
        badge.style.background = 'rgba(255,77,0,0.1)';
        badge.style.border = '1px solid rgba(255,77,0,0.3)';
        badge.innerHTML = 'Ateş Klanı';
    } else {
        badge.style.color = '#00E5FF';
        badge.style.background = 'rgba(0,229,255,0.08)';
        badge.style.border = '1px solid rgba(0,229,255,0.25)';
        badge.innerHTML = 'Buz Klanı';
    }
}

// ─── NAV WIRING ─────────────────────────────────────────────────────
document.getElementById('nav-play')!.addEventListener('click', () => showScreen('team-select'));

// Header nav items
document.getElementById('nav-characters-header')?.addEventListener('click', () => showScreen('characters'));
document.getElementById('nav-story-header')?.addEventListener('click', () => showScreen('story'));
document.getElementById('header-logo')?.addEventListener('click', () => showScreen('home'));

// ─── CHARACTER SELECT SCREEN LOGIC ──────────────────────────────────
const CS_DATA: Record<string, {
    name: string; roleKey: TransKey; faction: 'fire' | 'ice' | 'merc';
    hp: number; atk: number; arm: number; spd: number;
    abilityNameKey: TransKey; abilityDescKey: TransKey; loreKey: TransKey;
}> = {
    korhan:   { name: 'KORHAN',   roleKey: 'roleWarrior', faction: 'fire', hp: 220, atk: 24, arm: 8,  spd: 4,  abilityNameKey: 'korhanAbilName',   abilityDescKey: 'korhanAbilDesc',   loreKey: 'korhanLore'   },
    erlik:    { name: 'ERLİK',    roleKey: 'roleMage',    faction: 'fire', hp: 100, atk: 35, arm: 1,  spd: 7,  abilityNameKey: 'erlikAbilName',    abilityDescKey: 'erlikAbilDesc',    loreKey: 'erlikLore'    },
    od:       { name: 'OD',       roleKey: 'roleSupport', faction: 'fire', hp: 70,  atk: 0,  arm: 2,  spd: 10, abilityNameKey: 'odAbilName',       abilityDescKey: 'odAbilDesc',       loreKey: 'odLore'       },
    ayaz:     { name: 'AYAZ',     roleKey: 'roleWarrior', faction: 'ice',  hp: 240, atk: 18, arm: 10, spd: 3,  abilityNameKey: 'ayazAbilName',     abilityDescKey: 'ayazAbilDesc',     loreKey: 'ayazLore'     },
    tulpar:   { name: 'TULPAR',   roleKey: 'roleSupport', faction: 'ice',  hp: 70,  atk: 0,  arm: 1,  spd: 10, abilityNameKey: 'tulparAbilName',   abilityDescKey: 'tulparAbilDesc',   loreKey: 'tulparLore'   },
    umay:     { name: 'UMAY',     roleKey: 'roleMage',    faction: 'ice',  hp: 120, atk: 22, arm: 2,  spd: 5,  abilityNameKey: 'umayAbilName',     abilityDescKey: 'umayAbilDesc',     loreKey: 'umayLore'     },
    albasti:  { name: 'ALBASTI',  roleKey: 'roleNeutral', faction: 'merc', hp: 140, atk: 26, arm: 2,  spd: 8,  abilityNameKey: 'albastiAbilName',  abilityDescKey: 'albastiAbilDesc',  loreKey: 'albastiLore'  },
    tepegoz:  { name: 'TEPEGÖZ',  roleKey: 'roleTank',    faction: 'merc', hp: 300, atk: 20, arm: 12, spd: 3,  abilityNameKey: 'tepegozAbilName',  abilityDescKey: 'tepegozAbilDesc',  loreKey: 'tepegozLore'  },
    sahmeran: { name: 'ŞAHMERAN', roleKey: 'rolePoisoner',faction: 'merc', hp: 130, atk: 32, arm: 1,  spd: 7,  abilityNameKey: 'sahmeranAbilName', abilityDescKey: 'sahmeranAbilDesc', loreKey: 'sahmeranLore' },
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
    const imgUrl = `/assets/images/characters/${charId}.png`;

    // Background blur
    (document.getElementById('cs-bg')! as HTMLElement).style.backgroundImage = `url('${imgUrl}')`;

    // Hero image
    (document.getElementById('cs-hero-img') as HTMLImageElement).src = imgUrl;

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
document.getElementById('mode-back')!.addEventListener('click', () => showScreen('team-select'));

// Start at home
showScreen('home');

// ─── GAME STATE ──────────────────────────────────────────────────────
type GameMode = 'realtime' | 'twoplayer';
type Phase = 'player' | 'enemy';

let gameMode: GameMode = 'realtime';
let phase: Phase = 'player';
let playerMana = 0;
let iceMana = 0;           // 2P mode ice player mana
const MAX_MANA = 12;
let playerAvx = 0;        // AVX currency for mercenary units
let iceAvx = 0;           // 2P mode ice player AVX
let turnCount = 1;
let selectedPromptId: string | null = null;
let bonusMana = 0;
let pendingCard: CardDef | null = null;

// Realtime / 2P accumulators
let realtimeManaAccum = 0;
let realtimeAiAccum = 0;
let iceManaAccum = 0;
let selectedIceCardId: UnitType | null = null;
let difficultyLevel = 1; // 1-7, affects AI speed/strength

// ─── MODE SELECT WIRING ───────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.mode as GameMode;
        if (mode === 'realtime') {
            // Show difficulty select for VS AI
            modeSelectEl.style.display = 'none';
            difficultyScreen.style.display = 'flex';
        } else {
            showScreen('game');
            boot(mode).catch(console.error);
        }
    });
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-8px) scale(1.04)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
});

// Difficulty buttons
document.querySelectorAll<HTMLButtonElement>('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        difficultyLevel = parseInt(btn.dataset.diff ?? '1');
        difficultyScreen.style.display = 'none';
        showScreen('game');
        boot('realtime').catch(console.error);
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
    showScreen('mode-select');
});

// ─── AUDIO CONTROLS ──────────────────────────────────────────────────
function setupAudioControls(): void {
    const wrapper    = document.getElementById('audio-controls')!;
    const settingsBtn = document.getElementById('audio-settings-btn')!;
    const bgmIcon    = document.getElementById('bgm-toggle') as HTMLElement;
    const bgmSlider  = document.getElementById('bgm-volume') as HTMLInputElement;
    const sfxIcon    = document.getElementById('sfx-toggle') as HTMLElement;
    const sfxSlider  = document.getElementById('sfx-volume') as HTMLInputElement;

    // ── Ayar butonu: paneli aç/kapat ──
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        wrapper.classList.toggle('open');
    });

    // ── Dışarı tıklanınca kapat ──
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target as Node)) {
            wrapper.classList.remove('open');
        }
    });

    // ── BGM ──
    if (bgmSlider) {
        bgmSlider.value = String(Math.round(getBGMVolume() * 100));
        bgmSlider.addEventListener('input', () => {
            setBGMVolume(Number(bgmSlider.value) / 100);
            if (isBGMMuted() && Number(bgmSlider.value) > 0) {
                toggleBGMMute();
                bgmIcon.textContent = '🎵';
                bgmIcon.classList.remove('muted');
            }
        });
    }
    if (bgmIcon) {
        bgmIcon.addEventListener('click', () => {
            const muted = toggleBGMMute();
            bgmIcon.textContent = muted ? '🔇' : '🎵';
            bgmIcon.classList.toggle('muted', muted);
        });
    }

    // ── SFX ──
    if (sfxSlider) {
        sfxSlider.value = String(Math.round(getSFXVolume() * 100));
        sfxSlider.addEventListener('input', () => {
            setSFXVolume(Number(sfxSlider.value) / 100);
            if (isSFXMuted() && Number(sfxSlider.value) > 0) {
                toggleSFXMute();
                sfxIcon.textContent = '🔊';
                sfxIcon.classList.remove('muted');
            }
        });
    }
    if (sfxIcon) {
        sfxIcon.addEventListener('click', () => {
            const muted = toggleSFXMute();
            sfxIcon.textContent = muted ? '🔇' : '🔊';
            sfxIcon.classList.toggle('muted', muted);
        });
    }
}

// ─── BOOT ─────────────────────────────────────────────────────────────
async function boot(mode: GameMode): Promise<void> {
    gameMode = mode;
    playerMana = calcManaGain(1);
    turnCount = 1;
    realtimeManaAccum = 0;
    realtimeAiAccum = 0;
    iceManaAccum = 0;

    const engine = new Engine(canvas, true, {
        adaptToDeviceRatio: true,
        doNotHandleContextLost: true,
    });
    engine.setHardwareScalingLevel(1 / (window.devicePixelRatio > 1 ? 1.5 : 1));
    const { scene, shadowGenerator } = createScene(engine);

    // War music for game screen
    switchBGM('/assets/sound/war.mp3', 0.2);

    // Audio controls
    setupAudioControls();

    const mapData = createAvaxMap(scene, shadowGenerator);

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

    // ── Mode-specific setup ───────────────────────────────────────────
    if (mode === 'realtime') {
        phase = 'player';
        turnBanner.textContent = t('realtime');
        turnBanner.className = 'turn-banner player-turn';
        turnCountEl.textContent = t('vsAi');

    } else if (mode === 'twoplayer') {
        phase = 'player';
        turnBanner.textContent = t('fireVsIce');
        turnBanner.className = 'turn-banner player-turn';
        turnCountEl.textContent = t('twoPlayer');
        iceMana = calcManaGain(1);
        setup2Player(um);
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
            showWinScreen(winSystem);
            engine.stopRenderLoop();
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

    // Loading screen
    const loadingScreen = document.getElementById('loading-screen')!;
    const loadingBar = document.getElementById('loading-bar')!;
    const loadingStatus = document.getElementById('loading-status')!;
    loadingScreen.style.display = 'flex';

    loadingStatus.textContent = t('loadingScene');
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
    loadingScreen.remove();
    isGameReady = true;
    lowerBGMForGame();

    window.addEventListener('resize', () => engine.resize());
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
    if (realtimeManaAccum >= 2.0 && playerMana < MAX_MANA) {
        realtimeManaAccum -= 2.0;
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
    if (realtimeManaAccum >= 2.0 && playerMana < MAX_MANA) {
        realtimeManaAccum -= 2.0;
        playerMana = Math.min(MAX_MANA, playerMana + 1);
        updateManaUI();
    }
    iceManaAccum += dt;
    if (iceManaAccum >= 2.0 && iceMana < MAX_MANA) {
        iceManaAccum -= 2.0;
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
                ? `<div class="card-avx-badge">${card.avxCost}<img src="/assets/avxcoin.png" class="avx-icon" alt="AVX"></div>`
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
    // 1-4: select card
    const num = parseInt(e.key);
    if (!isNaN(num) && num >= 1 && num <= ICE_CARDS.length) {
        const card = ICE_CARDS[num - 1];
        const el = document.getElementById(`ice-card-${card.id}`) as HTMLElement;
        if (el) selectIceCard(card.id as UnitType, el);
        return;
    }

    // Z/X/C: deploy to lane 0/1/2
    const key = e.key.toUpperCase();
    let lane = -1;
    if (key === 'Z') lane = 0;
    else if (key === 'X') lane = 1;
    else if (key === 'C') lane = 2;

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

    if (e.key === 'Escape') clearIceSelection();
}

// ─── BASE HP UI ───────────────────────────────────────────────────────
function updateBaseHpUI(fireBase: BaseBuilding, iceBase: BaseBuilding): void {
    const fr = fireBase.hpRatio * 100;
    const ir = iceBase.hpRatio * 100;
    fireBaseFill.style.width = `${fr.toFixed(1)}%`;
    iceBaseFill.style.width = `${ir.toFixed(1)}%`;
    fireBaseHpText.textContent = `${fireBase.hp} / ${fireBase.maxHp}`;
    iceBaseHpText.textContent = `${iceBase.hp} / ${iceBase.maxHp}`;
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

function showWinScreen(sys: WinConditionSystem): void {
    const winner = sys.getWinner();
    const playerWon = winner === selectedTeam;

    // Kazanma / kaybetme başlığı
    winTitle.textContent = playerWon ? t('victory') : t('defeat');
    winTitle.className = winner === 'fire' ? 'fire-win' : 'ice-win';
    winMessage.textContent = sys.getWinMessage();

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
    if (winRestartBtn) winRestartBtn.textContent = t('winReplay');
    const winHomeBtn = document.getElementById('win-home-btn');
    if (winHomeBtn) {
        winHomeBtn.textContent = t('winHome');
        winHomeBtn.onclick = () => {
            winOverlay.classList.remove('show');
            location.reload();
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
    playerCardDefs().forEach(card => {
        cardContainer.appendChild(createCardEl(card, um));
    });
}

function canAffordCard(card: CardDef): boolean {
    if (card.avxCost > 0) return playerAvx >= card.avxCost;
    return playerMana >= card.manaCost;
}

function createCardEl(card: CardDef, um: UnitManager): HTMLElement {
    const el = document.createElement('div');
    el.className = 'game-card';
    el.id = `card-${card.id}`;
    el.style.borderColor = card.borderColor;
    el.style.boxShadow = `0 0 8px ${card.glowColor}`;
    const isAvx = card.avxCost > 0;
    const costBadge = isAvx
        ? `<div class="card-avx-badge">${card.avxCost}<img src="/assets/avxcoin.png" class="avx-icon" alt="AVX"></div>`
        : `<div class="card-mana-badge">${card.manaCost}<span class="mana-icon">◆</span></div>`;
    el.innerHTML = `
        ${costBadge}
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

function buildPromptUI(): void {
    promptContainer.innerHTML = '';
    PROMPT_DEFS.forEach(def => {
        promptContainer.appendChild(createPromptCardEl(def));
    });
}

function createPromptCardEl(def: PromptCardDef): HTMLElement {
    const el = document.createElement('div');
    el.className = 'prompt-card';
    el.id = `prompt-${def.id}`;
    el.innerHTML = `
        <div class="prompt-card-cost">${def.manaCost > 0 ? def.manaCost : ''}</div>
        <div class="prompt-card-icon"><img src="${def.imagePath}" alt="${def.name}" /></div>
        <div class="prompt-card-footer">
            <div class="prompt-card-name">${def.name}</div>
        </div>
    `;
    el.title = def.description;

    el.addEventListener('click', () => {
        if (phase !== 'player' || playerMana < def.manaCost) {
            pulseRed(el); return;
        }
        applyPromptEffect(def);
        if (!manaFrozen) playerMana -= def.manaCost;
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

const EFFECT_DISPLAY: Record<string, { label: string; color: string }> = {
    mana_fill:   { label: 'Mana Doldur',   color: '#aaff55' },
    mana_freeze: { label: 'Mana Dondur',   color: '#55ccff' },
    ouroboros:   { label: 'Ouroboros',      color: '#cc55ff' },
    autocollect: { label: 'Auto Collect',   color: '#ffcc00' },
    bancollect:  { label: 'Ban Collect',    color: '#ff4444' },
};

function showActiveEffect(def: PromptCardDef): void {
    // Instant effects (duration = 0) still show briefly
    const displaySec = def.duration > 0 ? def.duration * 10 : 3;
    const info = EFFECT_DISPLAY[def.effectType];
    const color = info?.color ?? '#cc99ff';

    const entry = document.createElement('div');
    entry.className = 'effect-entry';
    entry.innerHTML = `
        <div class="effect-name" style="color:${color}">${def.name}</div>
        <div class="effect-desc">${def.description}</div>
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

function applyPromptEffect(def: PromptCardDef): void {
    showActiveEffect(def);
    const um = _um;
    if (!um) return;
    const playerTeam = selectedTeam;
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
        const canPlay = phase === 'player' && playerMana >= def.manaCost;
        el.classList.toggle('card-disabled', !canPlay);
        el.style.opacity = canPlay ? '1' : '0.4';
        el.style.cursor = canPlay ? 'pointer' : 'not-allowed';
    });
}

// ─── MODULE-LEVEL REFS (for prompt effects / shard) ──────────────────
let _um: UnitManager | null = null;
let _shards: AvaShardManager | null = null;

// ─── LANE OVERLAY ────────────────────────────────────────────────────
const laneOverlay = document.getElementById('lane-overlay') as HTMLElement;
let _laneUm: UnitManager | null = null;

function setupLaneOverlay(um: UnitManager): void {
    _laneUm = um;
    document.querySelectorAll('.lane-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const lane = parseInt((e.currentTarget as HTMLElement).dataset.lane ?? '1');
            deployPendingCard(lane);
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
    coin.innerHTML = `<img src="/assets/avxcoin.png" alt="AVX">`;
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
        const key = el.dataset.i18n as any;
        el.textContent = t(key);
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => {
        const key = el.dataset.i18nHtml as any;
        el.innerHTML = t(key);
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
