/**
 * GameBoot.ts — boot(), cleanupGame(), tick functions, HUD updates.
 */

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
import { PROMPT_DEFS } from '../ecs/PromptCard';
import { kiteService } from '../ai/KiteService';
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
import { buildCardUI, updateManaUI, setupLaneOverlay, setupPlayerKeyboard, initDraft, tickDraft, cleanupDraft, resetAllCooldowns, startCooldownTicker, applyPromptEffect, updateBoardControlUI as _noop, aiPool, enemyTeam, showBoruCard, updateAvxUI } from '../ui/CardUI';
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

// ─── KITE UI ───────────────────────────────────────────────────────
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
            const unit = um.spawnUnit(pool[Math.floor(Math.random() * pool.length)], eTeam);
            const mult = getAiStatMult();
            unit.hp = Math.round(unit.hp * mult);
            unit.stats.maxHp = Math.round(unit.stats.maxHp * mult);
            unit.stats.attack = Math.round(unit.stats.attack * mult);
            if (ctx.difficultyLevel >= 6 && um.units.filter(u => u.team === eTeam && u.state !== 'dead').length < maxUnits) {
                const u2 = um.spawnUnit(pool[Math.floor(Math.random() * pool.length)], eTeam);
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
                        triggerWin(data.winner as 'fire' | 'ice', 'Oyun sona erdi');
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

    const resizeHandler = (window as any).__a2ResizeHandler;
    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        (window as any).__a2ResizeHandler = null;
    }

    mpService.disconnect();
    winOverlay.classList.remove('show');
    canvas.style.display = 'none';

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

    kiteService.init().then(() => kiteUpdatePanel()).catch(() => kiteUpdatePanel());

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

        ctx._mpSpawnUnit = (team, cardId, lane) => {
            const MP_LANE_MAP: Record<string, number> = { left: 0, mid: 1, right: 2 };
            um.spawnUnit(cardId, team, MP_LANE_MAP[lane]);
        };
        ctx._mpApplyPrompt = (team, promptId) => {
            const def = PROMPT_DEFS.find(p => p.id === promptId);
            if (def) applyPromptEffect(def, team);
        };
        ctx._mpTriggerWin = (winner, msg) => {
            // Guard: use overlay visibility, NOT _mpGameEnded flag
            // (_mpGameEnded is set earlier in render loop to prevent re-entry,
            //  but triggerWin is called async from fetch callback — so the old
            //  guard blocked the win overlay from ever showing)
            if (winOverlay.classList.contains('show')) return;
            ctx._mpGameEnded = true;

            winTitle.textContent = winner === 'fire' ? 'ALAZ KAZANDI' : 'AYAZ KAZANDI';
            winMessage.textContent = msg;
            winOverlay.classList.add('show');
            engine.stopRenderLoop();

            const winHomeBtn = document.getElementById('win-home-btn');
            if (winHomeBtn) winHomeBtn.onclick = () => (window as any).__cleanupGame?.();

            if (betService.isActive() && betService.state.status === 'locked') {
                const myTeam = ctx.lobbyTeam;
                const didWin = myTeam === winner;
                const myAddr = ctx.walletAddress;

                if (myAddr) {
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
                                } else if (polls >= 10) {
                                    clearInterval(pollTimer);
                                    showToast('Rakip sonuc bildirmedi — otomatik cozum bekleniyor');
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
        }

        if (mode === 'realtime') tickRealtime(dt, um);
        if (mode === 'twoplayer') tick2P(dt);
        if (mode === 'multiplayer') tickMultiplayer(dt);
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
            isGameReady = true;
            ctx.mpGameStarted = true;
            lowerBGMForGame();
            ctx._mpStartGame = null;
        };

        mpService.send({ type: 'loaded' });

        if (mpService.role === 'host' && (mpService as any)._opponentLoaded) {
            // Guest zaten loaded gönderdiyse direkt başlat
            mpService.send({ type: 'start' });
            ctx._mpStartGame?.();
        } else if (mpService.role === 'guest' && (mpService as any)._startReceived) {
            // Host zaten start gönderdiyse (race condition: guest geç yüklendi) direkt başlat
            ctx._mpStartGame?.();
        }
    } else {
        isGameReady = true;
        lowerBGMForGame();
    }

    const _resizeHandler = () => engine.resize();
    window.addEventListener('resize', _resizeHandler);
    (window as any).__a2ResizeHandler = _resizeHandler;
}
