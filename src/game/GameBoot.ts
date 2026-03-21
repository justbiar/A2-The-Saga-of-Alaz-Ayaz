/**
 * GameBoot.ts — boot(), cleanupGame(), tick functions, HUD updates.
 */
import { GameRandom } from '../utils/Random';

import { Engine } from '@babylonjs/core/Engines/engine';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createScene } from '../scene/createScene';
import { createAvaxMap } from '../scene/map/createAvaxMap';
import { exportMapGLB } from '../scene/map/exportMapGLB';
import { CameraSystem } from '../scene/systems/cameraSystem';
import { UnitManager } from '../ecs/UnitManager';
import { CARD_DEFS, AI_CARDS, UnitType } from '../ecs/Unit';
import { AvaShardManager } from '../scene/map/AvaShard';
import { BaseBuilding } from '../scene/map/BaseBuilding';
import { WinConditionSystem } from '../scene/systems/winConditionSystem';
import { WinCondition, calcManaGain, calcBoardControl, checkEquilibriumSurge } from '../game/GameState';
import { PROMPT_DEFS, getTreeCard } from '../ecs/PromptCard';
import { DefenseTower, UPGRADE_COST } from '../scene/units/DefenseTower';
import { DefenseFlower, FLOWER_SLOTS, FLOWER_AVX_COST } from '../scene/units/DefenseFlower';
import { ResourceTree, TREE_SLOTS, TREE_PLANT_COST, TREE_UPGRADE_COST } from '../scene/units/ResourceTree';
import { switchBGM, lowerBGMForGame, getCurrentTrack, preloadSFX } from '../audio/SoundManager';
import { mpService } from '../multiplayer/MultiplayerService';
import { betService, BET_FEE_PERCENT } from '../chain/BetService';
import { leaderboardService } from '../chain/LeaderboardService';
import { t, getLang, TransKey } from '../i18n';
import { setCacheProgressCallback, isCacheReady } from '../glbCache';

import { ctx, resetGameState, MAX_MANA, MANA_REGEN_INTERVAL, type GameMode } from './GameContext';
import { showScreen, canvas } from '../ui/ScreenRouter';
import { showToast, triggerWin } from '../ui/LobbyUI';
import { showBetResultOnWin, showWinScreen, winOverlay, winTitle, winMessage } from '../ui/WinScreenUI';
import { buildCardUI, buildPromptUI, updateManaUI, updateAvxUI, setupLaneOverlay, setupPlayerKeyboard, initDraft, tickDraft, cleanupDraft, resetAllCooldowns, startCooldownTicker, applyPromptEffect, aiPool, enemyTeam, showBoruCard, logCardPlay } from '../ui/CardUI';
import { setup2Player, updateIceManaUI } from './TwoPlayerSetup';
import { spawnAvxCoin } from './AvxCoinSystem';
import { showMiniPlayer, hideMiniPlayer } from '../ui/SettingsUI';
import '@babylonjs/loaders/glTF';

// ─── DOM REFS ──────────────────────────────────────────────────────
const dbgFps = document.getElementById('dbg-fps')!;
const dbgHero = document.getElementById('dbg-hero')!;
const dbgUnits = document.getElementById('dbg-units')!;
const dbgFire = document.getElementById('dbg-fire')!;
const dbgIce = document.getElementById('dbg-ice')!;
const turnBanner = document.getElementById('turn-banner')!;
const turnCountEl = document.getElementById('turn-count')!;
const fireBaseFill = document.getElementById('fire-base-fill') as HTMLElement;
const iceBaseFill = document.getElementById('ice-base-fill') as HTMLElement;
const fireBaseHpText = document.getElementById('fire-base-hp') as HTMLElement;
const iceBaseHpText = document.getElementById('ice-base-hp') as HTMLElement;
const surgeIndicator = document.getElementById('surge-indicator') as HTMLElement;
const bcmFill = document.getElementById('bcm-fill') as HTMLElement;

// ─── COUNTDOWN ─────────────────────────────────────────────────────
function showCountdown(team: 'fire' | 'ice'): Promise<void> {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.id = 'countdown-overlay';
        overlay.style.cssText = `
            position:fixed;inset:0;z-index:9999;
            display:flex;align-items:center;justify-content:center;
            pointer-events:none;
        `;
        document.body.appendChild(overlay);

        const glow = team === 'fire' ? '#ff6633' : '#66ccff';
        const label = document.createElement('div');
        label.style.cssText = `
            font-family:'Cinzel',serif;font-size:120px;font-weight:900;
            color:#fff;letter-spacing:4px;
            text-shadow:0 0 30px ${glow},0 0 70px ${glow}88;
            opacity:0;transform:scale(1.6);
            transition:transform 0.18s ease-out,opacity 0.12s ease-out;
        `;
        overlay.appendChild(label);

        const steps = ['3', '2', '1', t('countdownFight')];
        let i = 0;
        function tick() {
            if (i >= steps.length) {
                label.style.opacity = '0';
                label.style.transform = 'scale(1.6)';
                setTimeout(() => { overlay.remove(); resolve(); }, 350);
                return;
            }
            label.textContent = steps[i];
            label.style.transition = 'none';
            label.style.opacity = '0';
            label.style.transform = 'scale(1.6)';
            requestAnimationFrame(() => requestAnimationFrame(() => {
                label.style.transition = 'transform 0.18s ease-out,opacity 0.12s ease-out';
                label.style.opacity = '1';
                label.style.transform = 'scale(1)';
            }));
            i++;
            setTimeout(tick, i < steps.length ? 1000 : 850);
        }
        tick();
    });
}

// ─── BASE HP UI ────────────────────────────────────────────────────
let _fireGhostTimeout: ReturnType<typeof setTimeout> | null = null;
let _iceGhostTimeout: ReturnType<typeof setTimeout> | null = null;
let _prevFireRatio = 1;
let _prevIceRatio = 1;

function updateBaseHpUI(fireBase: BaseBuilding, iceBase: BaseBuilding): void {
    const fr = fireBase.hpRatio * 100;
    const ir = iceBase.hpRatio * 100;

    const fireGhost = document.getElementById('fire-base-ghost') as HTMLElement;
    const iceGhost = document.getElementById('ice-base-ghost') as HTMLElement;

    if (fr < _prevFireRatio) {
        if (_fireGhostTimeout) clearTimeout(_fireGhostTimeout);
        _fireGhostTimeout = setTimeout(() => {
            if (fireGhost) fireGhost.style.width = `${fr.toFixed(1)}%`;
        }, 900);
        fireBaseFill.classList.remove('mk-hit');
        void (fireBaseFill as HTMLElement).offsetWidth;
        fireBaseFill.classList.add('mk-hit');
        setTimeout(() => fireBaseFill.classList.remove('mk-hit'), 260);
    }
    fireBaseFill.style.width = `${fr.toFixed(1)}%`;
    fireBaseFill.classList.toggle('mk-danger', fr <= 20);

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

    fireBaseHpText.textContent = `${Math.ceil(fireBase.hp)}`;
    iceBaseHpText.textContent = `${Math.ceil(iceBase.hp)}`;
}

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


// ─── AI DIFFICULTY ─────────────────────────────────────────────────
function getAiDeployInterval(): number {
    return Math.max(2.5, 8 - (ctx.difficultyLevel - 1) * 0.9);
}
function getAiMaxUnits(): number {
    return 6 + ctx.difficultyLevel * 2;
}
function getAiStatMult(): number {
    return 0.8 + (ctx.difficultyLevel - 1) * 0.12;
}

// ─── TICK FUNCTIONS ────────────────────────────────────────────────
let realtimeSurgeAccum = 0;

function tickRealtime(dt: number, um: UnitManager): void {
    ctx.realtimeManaAccum += dt;
    if (ctx.realtimeManaAccum >= MANA_REGEN_INTERVAL && ctx.playerMana < MAX_MANA) {
        ctx.realtimeManaAccum -= MANA_REGEN_INTERVAL;
        ctx.playerMana = Math.min(MAX_MANA, ctx.playerMana + 1);
        updateManaUI();
    }
    realtimeSurgeAccum += dt;
    if (realtimeSurgeAccum >= 5.0) {
        realtimeSurgeAccum = 0;
        const fireCount = um.units.filter(u => u.team === 'fire' && u.state !== 'dead').length;
        const iceCount = um.units.filter(u => u.team === 'ice' && u.state !== 'dead').length;
        const surge = checkEquilibriumSurge(fireCount, iceCount);
        if (surge.triggered && surge.beneficiary === ctx.selectedTeam) {
            ctx.playerMana = Math.min(MAX_MANA, ctx.playerMana + surge.manaBonus);
            updateManaUI();
        }
    }
    ctx.realtimeAiAccum += dt;
    if (ctx.realtimeAiAccum >= getAiDeployInterval()) {
        ctx.realtimeAiAccum = 0;
        const pool = aiPool();
        const eTeam = enemyTeam();
        const maxUnits = getAiMaxUnits();
        if (um.units.filter(u => u.team === eTeam && u.state !== 'dead').length < maxUnits) {
            const cardId = GameRandom.choice(pool);
            const unit = um.spawnUnit(cardId, eTeam);
            
            const cDef = [...CARD_DEFS, ...AI_CARDS].find(c => c.id === cardId);
            if (cDef) {
                const nameStr = (cDef as any).nameKey ? t((cDef as any).nameKey) : cDef.name;
                const descStr = (cDef as any).descKey ? t((cDef as any).descKey) : cDef.description;
                // logCardPlay(eTeam, nameStr, descStr, cDef.imagePath); // Disabled unit logs
            }

            const mult = getAiStatMult();
            unit.hp = Math.round(unit.hp * mult);
            unit.stats.maxHp = Math.round(unit.stats.maxHp * mult);
            unit.stats.attack = Math.round(unit.stats.attack * mult);
            if (ctx.difficultyLevel >= 6 && um.units.filter(u => u.team === eTeam && u.state !== 'dead').length < maxUnits) {
                const cardId2 = GameRandom.choice(pool);
                const u2 = um.spawnUnit(cardId2, eTeam);

                const cDef2 = [...CARD_DEFS, ...AI_CARDS].find(c => c.id === cardId2);
                if (cDef2) {
                    const nameStr2 = (cDef2 as any).nameKey ? t((cDef2 as any).nameKey) : cDef2.name;
                    const descStr2 = (cDef2 as any).descKey ? t((cDef2 as any).descKey) : cDef2.description;
                    // setTimeout(() => logCardPlay(eTeam, nameStr2, descStr2, cDef2.imagePath), 400); // Disabled unit logs
                }

                u2.hp = Math.round(u2.hp * mult);
                u2.stats.maxHp = Math.round(u2.stats.maxHp * mult);
                u2.stats.attack = Math.round(u2.stats.attack * mult);
            }
        }
    }
}

let _mpWinPollAccum = 0;

function tickMultiplayer(dt: number): void {
    ctx.realtimeManaAccum += dt;
    if (ctx.realtimeManaAccum >= MANA_REGEN_INTERVAL && ctx.playerMana < MAX_MANA) {
        ctx.realtimeManaAccum -= MANA_REGEN_INTERVAL;
        ctx.playerMana = Math.min(MAX_MANA, ctx.playerMana + 1);
        updateManaUI();
    }

    // Fallback: poll server every 3s in case P2P game_over message was lost
    if (!ctx._mpGameEnded) {
        _mpWinPollAccum += dt;
        if (_mpWinPollAccum >= 3.0) {
            _mpWinPollAccum = 0;
            fetch(`/api/win-status/${mpService.lobbyCode}`)
                .then(r => r.json())
                .then(data => {
                    if (data.winner && !ctx._mpGameEnded) {
                        triggerWin(data.winner as 'fire' | 'ice', t('gameEnded' as any));
                    }
                })
                .catch(() => {});
        }
    }
}

let twoPlayerSurgeAccum = 0;

function tick2P(dt: number): void {
    ctx.realtimeManaAccum += dt;
    if (ctx.realtimeManaAccum >= MANA_REGEN_INTERVAL && ctx.playerMana < MAX_MANA) {
        ctx.realtimeManaAccum -= MANA_REGEN_INTERVAL;
        ctx.playerMana = Math.min(MAX_MANA, ctx.playerMana + 1);
        updateManaUI();
    }
    ctx.iceManaAccum += dt;
    if (ctx.iceManaAccum >= MANA_REGEN_INTERVAL && ctx.iceMana < MAX_MANA) {
        ctx.iceManaAccum -= MANA_REGEN_INTERVAL;
        ctx.iceMana = Math.min(MAX_MANA, ctx.iceMana + 1);
        updateIceManaUI();
    }
    twoPlayerSurgeAccum += dt;
    if (twoPlayerSurgeAccum >= 5.0 && ctx._um) {
        twoPlayerSurgeAccum = 0;
        const fireCount = ctx._um.units.filter(u => u.team === 'fire' && u.state !== 'dead').length;
        const iceCount = ctx._um.units.filter(u => u.team === 'ice' && u.state !== 'dead').length;
        const surge = checkEquilibriumSurge(fireCount, iceCount);
        if (surge.triggered) {
            if (surge.beneficiary === 'fire') {
                ctx.playerMana = Math.min(MAX_MANA, ctx.playerMana + surge.manaBonus);
                updateManaUI();
            } else {
                ctx.iceMana = Math.min(MAX_MANA, ctx.iceMana + surge.manaBonus);
                updateIceManaUI();
            }
        }
    }
}

// ─── CLEANUP ───────────────────────────────────────────────────────
export function cleanupGame(): void {
    console.log('[Cleanup] Oyun temizleniyor...');
    ctx.isPaused = false;
    document.getElementById('esc-overlay')?.classList.remove('show');
    if (ctx._engine) {
        ctx._engine.stopRenderLoop();
        if (ctx._engine.scenes) {
            for (const s of [...ctx._engine.scenes]) {
                s.dispose();
            }
        }
        ctx._engine.dispose();
        ctx._engine = null;
    }
    ctx._scene = null;
    ctx._um = null;
    ctx._shards = null;

    if (ctx.cooldownRAF) { cancelAnimationFrame(ctx.cooldownRAF); ctx.cooldownRAF = null; }
    cleanupDraft();

    document.querySelectorAll('.avx-coin-float').forEach(el => el.remove());
    document.getElementById('top-wolf-container')?.remove();
    document.getElementById('ouroboros-banner')?.remove();
    ctx.ouroborosMode = false;

    const resizeHandler = (window as any).__a2ResizeHandler;
    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        (window as any).__a2ResizeHandler = null;
    }

    mpService.disconnect();
    betService.reset(); // Oyun bitti, bet state temizle (yeni oyun icin)
    winOverlay.classList.remove('show');
    canvas.style.display = 'none';

    // Multiplayer callback'leri temizle — gecikmeli mesajlar triggerWin yapmasin
    ctx._mpTriggerWin = null;
    ctx._mpSpawnUnit = null;
    ctx._mpApplyPrompt = null;
    ctx._mpApplyUnitSync = null;
    ctx._mpStartGame = null;
    ctx._fireBase = null;
    ctx._iceBase = null;
    ctx.gameMode = 'realtime'; // multiplayer'dan cik — gecikmeli disconnect triggerWin yapmasin

    resetGameState();
    ctx.playerMana = 3;

    hideMiniPlayer();
    showScreen('home');
    console.log('[Cleanup] Temizlendi — ana sayfaya donuldu');
}

// ─── BOOT ──────────────────────────────────────────────────────────
export async function boot(mode: GameMode): Promise<void> {
    console.log('[DEBUG] boot() called with mode:', mode);

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
    const tipLabelMap: Record<string, string> = { tr: 'BILGI', en: 'DID YOU KNOW?', es: 'DATO' };
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

    await new Promise(r => requestAnimationFrame(r));

    ctx.gameMode = mode;
    ctx.playerMana = calcManaGain(1);
    ctx.turnCount = 1;
    ctx.realtimeManaAccum = 0;
    ctx.realtimeAiAccum = 0;
    ctx.iceManaAccum = 0;

    resetAllCooldowns();
    if (ctx.cooldownRAF) { cancelAnimationFrame(ctx.cooldownRAF); ctx.cooldownRAF = null; }
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

    const userTrack = getCurrentTrack();
    if (userTrack) {
        switchBGM(userTrack.src, 0.2);
    } else {
        switchBGM('/assets/sound/war.mp3', 0.2);
    }

    showMiniPlayer();

    const mapData = createAvaxMap(scene, shadowGenerator);
    (window as any).exportMapGLB = () => exportMapGLB(scene);

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

    // ── Tower sistemi ──────────────────────────────────────────────
    const towers: { fire: [DefenseTower | null, DefenseTower | null]; ice: [DefenseTower | null, DefenseTower | null] } = {
        fire: [null, null],
        ice:  [null, null],
    };

    ctx.spawnTower = (): boolean => {
        const team = ctx.selectedTeam as 'fire' | 'ice';
        const slots = towers[team];
        // Yok edilen kuleleri null'a çevir
        if (slots[0] && slots[0].isDestroyed) slots[0] = null;
        if (slots[1] && slots[1].isDestroyed) slots[1] = null;
        const slot = slots[0] === null ? 0 : slots[1] === null ? 1 : -1;
        if (slot === -1) { showToast('Maksimum 2 kule', 1500); return false; }
        const tower = new DefenseTower(scene, team, slot as 0 | 1);
        tower.onUpgradeRequest = () => {
            const cost = UPGRADE_COST[tower.level] ?? 99;
            if (ctx.playerAvx >= cost && tower.levelUp()) {
                ctx.playerAvx -= cost;
                updateAvxUI();
            } else {
                showToast(`Yeterli AVX yok (${cost} AVX lazım)`, 1500);
            }
        };
        slots[slot] = tower;
        return true;
    };

    ctx.disposeTowers = (): void => {
        for (const team of ['fire', 'ice'] as const) {
            for (let i = 0; i < 2; i++) {
                towers[team][i]?.dispose();
                towers[team][i] = null;
            }
        }
    };

    // ── Çiçek sistemi ──────────────────────────────────────────────
    const flowers: DefenseFlower[] = [];

    ctx.spawnFlower = (): boolean => {
        const team = ctx.selectedTeam as 'fire' | 'ice';
        const slots = FLOWER_SLOTS[team];
        // Dolu olmayan slot bul
        const usedPositions = flowers.filter(f => f.team === team && !f.isDestroyed).map(f => f.position);
        const freeSlot = slots.find(s => !usedPositions.some(u => Vector3.Distance(u, s) < 1));
        if (!freeSlot) { showToast('Tüm çiçek slotları dolu', 1500); return false; }
        const flower = new DefenseFlower(scene, team, freeSlot);
        flowers.push(flower);
        return true;
    };

    ctx.disposeFlowers = (): void => {
        for (const f of flowers) f.dispose();
        flowers.length = 0;
    };

    // ── Tree (Agac) sistemi ──────────────────────────────────────────
    const trees: ResourceTree[] = [];

    ctx.spawnTree = (): boolean => {
        if (!ctx.selectedTreeType) return false;
        const team = ctx.selectedTeam as 'fire' | 'ice';
        const slots = TREE_SLOTS[team];
        const usedPositions = trees.filter(t => t.team === team && !t.isDestroyed).map(t => t.position);
        if (usedPositions.length >= 2) { showToast('Maksimum 2 agac', 1500); return false; }
        const freeSlot = slots.find(s => !usedPositions.some(u => Vector3.Distance(u, s) < 1));
        if (!freeSlot) { showToast('Bos slot yok', 1500); return false; }
        const tree = new ResourceTree(scene, team, ctx.selectedTreeType, freeSlot);
        tree.onUpgradeRequest = () => upgradeTreeDirect(tree);
        trees.push(tree);
        return true;
    };

    function upgradeTreeDirect(tree: ResourceTree): boolean {
        if (tree.isDestroyed || tree.level >= 5) { showToast('Maksimum seviye', 1500); return false; }
        const cost = TREE_UPGRADE_COST[tree.level] ?? 99;
        // Mana ağacı AVX ile, AVX ağacı mana ile upgrade
        if (tree.treeType === 'mana') {
            if (ctx.playerAvx < cost) { showToast(`Yeterli AVX yok (${cost} AVX lazim)`, 1500); return false; }
            if (tree.startUpgrade()) { ctx.playerAvx -= cost; updateAvxUI(); return true; }
        } else {
            if (ctx.playerMana < cost) { showToast(`Yeterli Mana yok (${cost} Mana lazim)`, 1500); return false; }
            if (tree.startUpgrade()) { ctx.playerMana -= cost; updateManaUI(); return true; }
        }
        return false;
    }

    ctx.upgradeTree = (index: number): boolean => {
        const myTrees = trees.filter(t => t.team === (ctx.selectedTeam as 'fire' | 'ice') && !t.isDestroyed);
        const tree = myTrees[index];
        if (!tree) return false;
        return upgradeTreeDirect(tree);
    };

    ctx.disposeTrees = (): void => {
        for (const t of trees) t.dispose();
        trees.length = 0;
    };

    // ── AI tower/flower spawn (bot için) ──────────────────────────
    function aiSpawnTower(team: 'fire' | 'ice'): boolean {
        const slots = towers[team];
        if (slots[0] && slots[0].isDestroyed) slots[0] = null;
        if (slots[1] && slots[1].isDestroyed) slots[1] = null;
        const slot = slots[0] === null ? 0 : slots[1] === null ? 1 : -1;
        if (slot === -1) return false;
        const tower = new DefenseTower(scene, team, slot as 0 | 1);
        tower.onUpgradeRequest = () => {}; // AI upgrade ayrı handle edilir
        slots[slot] = tower;
        return true;
    }

    function aiUpgradeTower(team: 'fire' | 'ice'): boolean {
        for (const t of towers[team]) {
            if (t && !t.isDestroyed && t.level < 5) {
                t.levelUp();
                return true;
            }
        }
        return false;
    }

    function aiSpawnFlower(team: 'fire' | 'ice'): boolean {
        const slots = FLOWER_SLOTS[team];
        const usedPositions = flowers.filter(f => f.team === team && !f.isDestroyed).map(f => f.position);
        const freeSlot = slots.find(s => !usedPositions.some(u => Vector3.Distance(u, s) < 1));
        if (!freeSlot) return false;
        flowers.push(new DefenseFlower(scene, team, freeSlot));
        return true;
    }

    // ── AI strateji: tower + flower + upgrade zamanlama ──────────
    let aiTowerAccum = 0;
    let aiFlowerAccum = 0;
    let aiUpgradeAccum = 0;
    const AI_TOWER_DELAY  = 50;  // 50s sonra ilk tower (draft sonrası)
    const AI_FLOWER_DELAY = 75;  // 75s sonra ilk çiçek
    const AI_UPGRADE_INTERVAL = 30; // her 30s upgrade dene

    function tickAiStructures(dt: number): void {
        if (ctx.gameMode !== 'realtime') return;
        const eTeam = enemyTeam();

        aiTowerAccum += dt;
        aiFlowerAccum += dt;
        aiUpgradeAccum += dt;

        // Tower kur (max 2)
        if (aiTowerAccum >= AI_TOWER_DELAY) {
            const towerCount = towers[eTeam].filter(t => t !== null && !t.isDestroyed).length;
            if (towerCount < 2) {
                aiSpawnTower(eTeam);
                aiTowerAccum = AI_TOWER_DELAY - 15; // sonraki 15s sonra
            }
        }

        // Tower upgrade
        if (aiUpgradeAccum >= AI_UPGRADE_INTERVAL) {
            aiUpgradeAccum = 0;
            aiUpgradeTower(eTeam);
        }

        // Çiçek ek (oyuncu tower'ı varsa)
        if (aiFlowerAccum >= AI_FLOWER_DELAY) {
            const playerTeam = ctx.selectedTeam as 'fire' | 'ice';
            const playerHasTower = towers[playerTeam].some(t => t !== null && !t.isDestroyed);
            if (playerHasTower) {
                aiSpawnFlower(eTeam);
                aiFlowerAccum = AI_FLOWER_DELAY - 20; // sonraki 20s sonra
            }
        }
    }
    // Multiplayer guest: base hasari host'tan gelir, lokal hesaplama yapma
    if (mode === 'multiplayer' && mpService.role === 'guest') {
        um.skipBaseDamage = true;
    }
    shards.setUnitManager(um);

    ctx._scene = scene;
    ctx._engine = engine;
    preloadSFX();
    um.onUnitDeath = (unit) => {
        const killerTeam = unit.team === 'fire' ? 'ice' : 'fire';
        // 2 oyunculu modda her iki taraf da coin toplayabilir;
        // diğer modlarda sadece oyuncu düşmanı öldürünce coin düşer
        if (mode !== 'twoplayer' && killerTeam !== ctx.selectedTeam) return;
        const wasCrit = !!unit.abilityState._critKill;
        const coinCount = wasCrit ? 2 : 1;
        unit.mesh.computeWorldMatrix(true);
        const deathPos = unit.mesh.absolutePosition.clone();
        for (let i = 0; i < coinCount; i++) {
            spawnAvxCoin(deathPos, killerTeam, i);
        }
    };

    shards.onBoruSpawn = (event) => {
        showBoruCard(event.spirit, event.team, event.triggerTeam);
    };

    ctx._um = um;
    ctx._shards = shards;
    ctx._fireBase = fireBase;
    ctx._iceBase = iceBase;

    buildCardUI(um);
    initDraft();
    updateManaUI();
    setupLaneOverlay(um);
    setupPlayerKeyboard();

    if (mode === 'realtime') {
        ctx.phase = 'player';
        turnBanner.textContent = t('realtime');
        turnBanner.className = 'turn-banner player-turn';
        turnCountEl.textContent = t('vsAi');
        const betHud = document.getElementById('bet-hud');
        if (betHud) betHud.style.display = 'none';

    } else if (mode === 'twoplayer') {
        ctx.phase = 'player';
        turnBanner.textContent = t('fireVsIce');
        turnBanner.className = 'turn-banner player-turn';
        turnCountEl.textContent = t('twoPlayer');
        const betHud2 = document.getElementById('bet-hud');
        if (betHud2) betHud2.style.display = 'none';
        ctx.iceMana = calcManaGain(1);
        setup2Player(um);

    } else if (mode === 'multiplayer') {
        ctx.phase = 'player';
        const myLabel = ctx.lobbyTeam === 'fire' ? 'ALAZ' : 'AYAZ';
        turnBanner.textContent = `ONLINE — ${myLabel}`;
        turnBanner.className = 'turn-banner player-turn';
        turnCountEl.textContent = 'ONLINE PvP';

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

        ctx._mpSpawnUnit = (team, cardId, lane, unitId) => {
            const MP_LANE_MAP: Record<string, number> = { left: 0, mid: 1, right: 2 };
            um.spawnUnit(cardId, team, MP_LANE_MAP[lane], unitId);
        };
        ctx._mpApplyPrompt = (team, promptId) => {
            const def = PROMPT_DEFS.find(p => p.id === promptId);
            if (def) applyPromptEffect(def, team);
        };
        ctx._mpApplyUnitSync = (data) => {
            um.syncUnits(data);
        };
        ctx._mpTriggerWin = (winner, msg, isDisconnect) => {
            // Guard: use overlay visibility, NOT _mpGameEnded flag
            if (winOverlay.classList.contains('show')) return;
            ctx._mpGameEnded = true;

            cleanupDraft();
            winTitle.textContent = winner === 'fire' ? t('winFireBase' as any) : t('winIceBase' as any);
            winMessage.textContent = msg;
            winOverlay.classList.add('show');
            engine.stopRenderLoop();

            const winHomeBtn = document.getElementById('win-home-btn');
            if (winHomeBtn) winHomeBtn.onclick = () => (window as any).__cleanupGame?.();

            if (betService.isActive() && betService.state.status === 'locked') {
                const myTeam = ctx.lobbyTeam;
                const didWin = myTeam === winner;
                const myAddr = ctx.walletAddress;

                if (myAddr && isDisconnect) {
                    // ── Disconnect: oyuncuya sor ──
                    const totalPrize = betService.state.amount * 2 * 0.98;
                    const dialog = document.createElement('div');
                    dialog.id = 'disconnect-bet-dialog';
                    dialog.style.cssText = 'margin:20px auto 0;padding:22px 24px;background:rgba(20,18,30,0.95);border:1px solid rgba(255,185,50,0.3);border-radius:14px;text-align:center;max-width:420px;';
                    dialog.innerHTML = `
                        <div style="color:rgba(255,255,255,0.65);font-family:'Inter',sans-serif;font-size:12px;line-height:1.7;margin-bottom:14px">${t('disconnBetExplain')}</div>
                        <div style="color:#ffc94d;font-family:'Cinzel',serif;font-size:18px;font-weight:700;margin-bottom:18px">${betService.state.amount} AVAX</div>
                        <div style="display:flex;gap:10px;justify-content:center">
                            <button id="dbd-split-btn" style="flex:1;padding:11px 16px;border:1px solid rgba(85,255,153,0.3);background:rgba(85,255,153,0.08);border-radius:8px;color:#55ff99;font-family:'Inter',sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;cursor:pointer;transition:all 0.2s">${t('disconnBetSplit')}</button>
                            <button id="dbd-claim-btn" style="flex:1;padding:11px 16px;border:1px solid rgba(255,185,50,0.3);background:rgba(255,185,50,0.08);border-radius:8px;color:#ffc94d;font-family:'Inter',sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;cursor:pointer;transition:all 0.2s">${t('disconnBetClaim')}</button>
                        </div>
                        <div id="dbd-status" style="margin-top:12px;font-size:11px;color:rgba(255,255,255,0.4);display:none"></div>
                    `;
                    winOverlay.appendChild(dialog);

                    const disableBtns = () => {
                        (document.getElementById('dbd-split-btn') as HTMLButtonElement).disabled = true;
                        (document.getElementById('dbd-claim-btn') as HTMLButtonElement).disabled = true;
                        document.getElementById('dbd-status')!.style.display = 'block';
                    };

                    // Paralar esit dagilsin
                    document.getElementById('dbd-split-btn')!.onclick = async () => {
                        disableBtns();
                        document.getElementById('dbd-status')!.textContent = t('disconnBetSplitDone');
                        try {
                            await fetch(`/api/match/${betService.state.matchId}/refund-both`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ address: myAddr }),
                            });
                        } catch {
                            await betService.reportResult(myAddr, false);
                        }
                        betService.state.status = 'cancelled';
                        showBetResultOnWin(false, 0, null);
                        dialog.remove();
                    };

                    // Galibiyetimi ilan et
                    document.getElementById('dbd-claim-btn')!.onclick = async () => {
                        disableBtns();
                        document.getElementById('dbd-status')!.textContent = t('disconnBetWaiting');
                        const res = await betService.reportResult(myAddr, true);
                        if (res?.status === 'settled') {
                            showToast(`${t('disconnBetClaimDone')} TX: ${res.txHash?.slice(0, 10)}…`);
                            showBetResultOnWin(true, res.prizeAVAX ?? totalPrize, res.txHash ?? null);
                            leaderboardService.recordResult(myAddr, 'win', res.prizeAVAX ?? totalPrize, 0, 'online');
                            dialog.remove();
                        } else if (res?.status === 'disputed') {
                            showBetResultOnWin(false, 0, null);
                            dialog.remove();
                        } else if (res?.status === 'waiting') {
                            let polls = 0;
                            const pollTimer = setInterval(async () => {
                                polls++;
                                const match = await betService.pollMatchStatus();
                                if (match && match.status === 'settled') {
                                    clearInterval(pollTimer);
                                    betService.state.status = 'settled';
                                    showToast(`${t('disconnBetClaimDone')} TX: ${(match as any).txHash?.slice(0, 10) ?? ''}…`);
                                    showBetResultOnWin(true, totalPrize, (match as any).txHash ?? null);
                                    leaderboardService.recordResult(myAddr, 'win', totalPrize, 0, 'online');
                                    dialog.remove();
                                } else if (match && ['disputed', 'refunded'].includes(match.status)) {
                                    clearInterval(pollTimer);
                                    betService.state.status = 'cancelled';
                                    showBetResultOnWin(false, 0, null);
                                    dialog.remove();
                                } else if (polls >= 50) {
                                    clearInterval(pollTimer);
                                    document.getElementById('dbd-status')!.textContent = t('disconnBetWaiting');
                                }
                            }, 3000);
                        }
                    };
                    return; // Dialog acildi, auto-report yapma
                }

                if (myAddr) {
                    // ── Normal oyun sonu (disconnect degil) — otomatik rapor ──
                    const totalPrize = betService.state.amount * 2 * 0.98;
                    betService.reportResult(myAddr, didWin).then(async (res) => {
                        if (!res) {
                            showToast('Sonuc bildirimi basarisiz');
                            return;
                        }

                        if (res.status === 'settled') {
                            if (didWin) {
                                showToast(`Bahis odendi! TX: ${res.txHash?.slice(0, 10)}…`);
                                showBetResultOnWin(true, res.prizeAVAX ?? totalPrize, res.txHash ?? null);
                                leaderboardService.recordResult(myAddr, 'win', res.prizeAVAX ?? totalPrize, 0, 'online');
                            } else {
                                showBetResultOnWin(false, betService.state.amount, null);
                                leaderboardService.recordResult(myAddr, 'loss', 0, betService.state.amount, 'online');
                            }
                        } else if (res.status === 'disputed') {
                            showToast('Anlasmazlik — her iki tarafa iade yapiliyor');
                            showBetResultOnWin(false, 0, null);
                        } else if (res.status === 'waiting') {
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
                                        leaderboardService.recordResult(myAddr, 'win', totalPrize, 0, 'online');
                                    } else {
                                        showBetResultOnWin(false, betService.state.amount, null);
                                        leaderboardService.recordResult(myAddr, 'loss', 0, betService.state.amount, 'online');
                                    }
                                } else if (match && ['disputed', 'refunded'].includes(match.status)) {
                                    clearInterval(pollTimer);
                                    betService.state.status = 'cancelled';
                                    showToast('Anlasmazlik — iade yapiliyor');
                                    showBetResultOnWin(false, 0, null);
                                } else if (polls >= 50) {
                                    clearInterval(pollTimer);
                                    showToast('Sunucu otomatik cozecek — birkaç dakika bekleyin');
                                }
                            }, 3000);
                        }
                    });
                }
            } else if (ctx.walletAddress) {
                const didWin = ctx.lobbyTeam === winner;
                leaderboardService.recordResult(ctx.walletAddress, didWin ? 'win' : 'loss', 0, 0, 'online');
            }
        };
    }

    let isGameReady = false;

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

        if (ctx.isPaused) {
            scene.render();
            return;
        }

        um.fireShard = shards.getBonus('fire');
        um.iceShard = shards.getBonus('ice');
        um.update(delta);
        shards.update(dt, um.units);
        fireBase.update(dt, um.units);
        iceBase.update(dt, um.units);

        // Tower tick
        for (const team of ['fire', 'ice'] as const) {
            const enemyT = team === 'fire' ? 'ice' : 'fire';
            const enemyBase = team === 'fire' ? iceBase : fireBase;
            const enemyTower = (towers[enemyT][0] ?? towers[enemyT][1]) ?? null;
            for (const tower of towers[team]) {
                if (tower && !tower.isDestroyed) tower.tick(dt, um.units, enemyTower, enemyBase);
            }
        }

        // Flower tick
        for (const f of flowers) {
            if (f.isDestroyed) continue;
            const enemyT = f.team === 'fire' ? 'ice' : 'fire';
            const enemyTowers = [towers[enemyT][0], towers[enemyT][1]];
            f.tick(dt, enemyTowers);
        }

        // Tree tick
        for (const tree of trees) {
            if (tree.isDestroyed) continue;
            const result = tree.tick(dt);
            if (result) {
                const isPlayer = tree.team === (ctx.selectedTeam as 'fire' | 'ice');
                if (result.type === 'mana') {
                    if (isPlayer) {
                        ctx.playerMana = Math.min(MAX_MANA, ctx.playerMana + result.amount);
                        updateManaUI();
                    } else {
                        ctx.iceMana = Math.min(MAX_MANA, ctx.iceMana + result.amount);
                    }
                } else {
                    if (isPlayer) {
                        ctx.playerAvx += result.amount;
                        updateAvxUI();
                    } else {
                        ctx.iceAvx += result.amount;
                    }
                }
                tree.showProducePopup(result.amount);
            }
        }

        // Multiplayer: sadece HOST win condition kontrol eder (desync onleme)
        // Guest sadece game_over P2P mesajini veya server poll'u dinler
        const isHost = mode === 'multiplayer' && mpService.role === 'host';
        const isGuest = mode === 'multiplayer' && mpService.role === 'guest';

        if (!isGuest) {
            const wc = winSystem.check();
            if (wc !== WinCondition.None && !ctx._mpGameEnded) {
                if (mode === 'multiplayer') {
                    const localWinner = winSystem.getWinner();
                    if (localWinner) {
                        console.log(`[MP-WIN] Host win detected: ${localWinner}, wc=${wc}`);
                        ctx._mpGameEnded = true;
                        // Win aninda son base HP'leri gonder — guest desync olmasin
                        mpService.sendBaseSync(fireBase.hp, iceBase.hp);
                        fetch('/api/win-report', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ lobbyCode: mpService.lobbyCode, winner: localWinner }),
                        })
                            .then(r => r.json())
                            .then(data => {
                                const confirmedWinner: 'fire' | 'ice' = data.winner ?? localWinner;
                                mpService.sendGameOver(confirmedWinner, winSystem.getWinMessage());
                                triggerWin(confirmedWinner, winSystem.getWinMessage());
                            })
                            .catch(() => {
                                mpService.sendGameOver(localWinner, winSystem.getWinMessage());
                                triggerWin(localWinner, winSystem.getWinMessage());
                            });
                    }
                } else {
                    showWinScreen(winSystem);
                    engine.stopRenderLoop();
                }
            }
        }

        // Host → Guest: base HP senkronizasyonu (saniyede 4 kez)
        if (isHost && !ctx._mpGameEnded) {
            ctx._baseSyncAccum = (ctx._baseSyncAccum ?? 0) + dt;
            if (ctx._baseSyncAccum >= 0.25) {
                ctx._baseSyncAccum = 0;
                mpService.sendBaseSync(fireBase.hp, iceBase.hp);
            }

            const cc = ctx as any;
            cc._unitSyncAccum = (cc._unitSyncAccum ?? 0) + dt;
            if (cc._unitSyncAccum >= 1.0) {
                cc._unitSyncAccum = 0;
                const syncData = um.units
                    .filter(u => u.state !== 'dead')
                    .map(u => ({
                        id: String(u.id),
                        hp: Math.round(u.hp),
                        x: Number(u.mesh.position.x.toFixed(2)),
                        z: Number(u.mesh.position.z.toFixed(2)),
                        state: u.state,
                        team: u.team
                    }));
                mpService.sendUnitSync(syncData);
            }
        }

        if (mode === 'realtime') tickRealtime(dt, um);
        if (mode === 'twoplayer') tick2P(dt);
        if (mode === 'multiplayer') tickMultiplayer(dt);
        tickAiStructures(dt);
        tickDraft(dt);

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

    loadingBar.style.width = '5%';
    try {
        // Faz 1: GLB indirme (warm-cache) — %5-%25
        if (!isCacheReady()) {
            loadingStatus.textContent = t('loadingDownload');
            setCacheProgressCallback((loaded, total) => {
                const pct = 5 + Math.round((loaded / total) * 20);
                loadingBar.style.width = `${pct}%`;
                loadingStatus.textContent = `${t('loadingDownload')} ${loaded}/${total}`;
            });
        } else {
            loadingBar.style.width = '25%';
        }

        // Faz 2: GLB parse — %25-%85
        um.onProgress = (loaded, total) => {
            const pct = 25 + Math.round((loaded / total) * 60);
            loadingBar.style.width = `${pct}%`;
            loadingStatus.textContent = `${t('loadingChars')} ${Math.round((loaded / total) * 100)}%`;
        };
        await um.preload();
        loadingBar.style.width = '85%';
    } catch {
        console.warn('preload failed, using procedural meshes');
    }

    // Faz 3: Sahne hazırlığı — birkaç frame renderla ki GPU tamamen hazır olsun
    loadingStatus.textContent = t('loadingScene');
    loadingBar.style.width = '90%';
    for (let i = 0; i < 15; i++) {
        scene.render();
        await new Promise(r => requestAnimationFrame(r));
    }
    loadingBar.style.width = '100%';
    loadingStatus.textContent = t('loadingReady');
    await new Promise(r => setTimeout(r, 300));
    clearInterval(tipInterval);
    loadingScreen.style.display = 'none';

    // Agac secimi — loading bittikten sonra goster
    await new Promise<void>((resolve) => {
        const overlay = document.createElement('div');
        overlay.id = 'tree-select-overlay';
        overlay.style.cssText = `
            position:fixed; inset:0; z-index:9500; display:flex; align-items:center; justify-content:center;
            background:rgba(0,0,0,0.75);
        `;
        const box = document.createElement('div');
        box.style.cssText = `
            background:rgba(20,15,30,0.95); border:1px solid rgba(255,255,255,0.15);
            border-radius:14px; padding:28px 36px; text-align:center; min-width:320px;
            color:#eee; font-family:monospace;
        `;
        box.innerHTML = `
            <div style="font-size:16px;font-weight:bold;margin-bottom:6px;">${t('treeSelectTitle' as any)}</div>
            <div style="font-size:11px;color:#999;margin-bottom:20px;">${t('treeSelectDesc' as any)}</div>
            <div style="display:flex;gap:16px;justify-content:center;">
                <div id="tree-pick-mana" style="cursor:pointer;border:2px solid rgba(170,68,255,0.4);border-radius:12px;padding:12px;width:130px;transition:border-color 0.2s;">
                    <img src="/assets/game%20asset/cicekler/manaagaci.png" style="width:80px;height:80px;object-fit:contain;">
                    <div style="font-weight:bold;color:#cc88ff;margin-top:8px;">${t('treeManaName' as any)}</div>
                    <div style="font-size:10px;color:#aaa;margin-top:4px;">${t('treeManaDesc' as any)}</div>
                </div>
                <div id="tree-pick-avx" style="cursor:pointer;border:2px solid rgba(255,136,0,0.4);border-radius:12px;padding:12px;width:130px;transition:border-color 0.2s;">
                    <img src="/assets/game%20asset/cicekler/avxagaci.png" style="width:80px;height:80px;object-fit:contain;">
                    <div style="font-weight:bold;color:#ffaa44;margin-top:8px;">${t('treeAvxName' as any)}</div>
                    <div style="font-size:10px;color:#aaa;margin-top:4px;">${t('treeAvxDesc' as any)}</div>
                </div>
            </div>
        `;
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const pick = (type: 'mana' | 'avx') => {
            ctx.selectedTreeType = type;
            overlay.remove();
            ctx.playerDeck.push(getTreeCard(type));
            buildPromptUI();
            resolve();
        };
        box.querySelector('#tree-pick-mana')!.addEventListener('click', () => pick('mana'));
        box.querySelector('#tree-pick-avx')!.addEventListener('click', () => pick('avx'));
    });

    if (mode === 'multiplayer') {
        const waitOverlay = document.createElement('div');
        waitOverlay.id = 'mp-wait-overlay';
        waitOverlay.innerHTML = `
            <div class="mp-wait-box">
                <div class="mp-wait-spinner"></div>
                <div class="mp-wait-text">Rakip bekleniyor…</div>
            </div>`;
        document.body.appendChild(waitOverlay);

        const mpConnTimeout = setTimeout(() => {
            if (!ctx.mpGameStarted) {
                const ov = document.getElementById('mp-wait-overlay');
                if (ov) {
                    ov.innerHTML = `
                        <div class="mp-wait-box">
                            <div class="mp-wait-text" style="color:#ff6655;font-size:13px">Bağlantı başarısız.<br>Arkadaşın kodun doğru girdiğinden emin ol.</div>
                            <button onclick="window.__cleanupGame?.()" style="margin-top:16px;padding:10px 28px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.08);color:#fff;font-family:'Cinzel',serif;font-size:12px;letter-spacing:1px;border-radius:6px;cursor:pointer">Ana Menü</button>
                        </div>`;
                }
            }
        }, 60_000);

        ctx._mpStartGame = () => {
            clearTimeout(mpConnTimeout);
            const ov = document.getElementById('mp-wait-overlay');
            if (ov) ov.remove();
            const mpIntroTeam = ctx.lobbyTeam || 'fire';
            ctx.isPaused = true;
            isGameReady = true;
            ctx.mpGameStarted = true;
            lowerBGMForGame();
            ctx._mpStartGame = null;
            cam.playIntroAnimation(mpIntroTeam)
                .then(() => showCountdown(mpIntroTeam))
                .then(() => { ctx.isPaused = false; });
        };

        mpService.send({ type: 'loaded' });

        if (mpService.role === 'host' && (mpService as any)._opponentLoaded) {
            // Guest zaten loaded gonderdiyse — seed LobbyUI'da uretildi,
            // burada tekrar uretme (cift seed race condition)
            ctx._mpStartGame?.();
        } else if (mpService.role === 'guest' && (mpService as any)._startReceived) {
            // Host zaten start gönderdiyse (race condition: guest geç yüklendi) direkt başlat
            ctx._mpStartGame?.();
        }
    } else {
        const introTeam = ctx.selectedTeam || 'fire';
        ctx.isPaused = true;
        isGameReady = true;
        lowerBGMForGame();
        cam.playIntroAnimation(introTeam)
            .then(() => showCountdown(introTeam))
            .then(() => { ctx.isPaused = false; });
    }

    const _resizeHandler = () => engine.resize();
    window.addEventListener('resize', _resizeHandler);
    (window as any).__a2ResizeHandler = _resizeHandler;

    // Shift+T debug handler kaldırıldı — tower artık kart ile kurulur
}
