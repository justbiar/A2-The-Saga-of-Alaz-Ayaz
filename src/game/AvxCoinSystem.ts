/**
 * AvxCoinSystem.ts — AVX coin drop/collect system.
 */

import { ctx } from './GameContext';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { playCoinDrop, playCoinCollect } from '../audio/SoundManager';
import { updateAvxUI, updateCardStates } from '../ui/CardUI';
import avxCoinUrl from '../../assets/avxcoin.webp';

export function worldToScreen(pos: Vector3): { x: number; y: number } | null {
    if (!ctx._scene || !ctx._engine) return null;
    const cam = ctx._scene.activeCamera;
    if (!cam) return null;
    try {
        const canvas = ctx._engine.getRenderingCanvas()!;
        const rect = canvas.getBoundingClientRect();
        const vm = cam.getViewMatrix();
        const pm = cam.getProjectionMatrix();
        const vPos = Vector3.TransformCoordinates(pos, vm);
        const cPos = Vector3.TransformCoordinates(vPos, pm);
        const x = rect.left + ((cPos.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - cPos.y) / 2) * rect.height;
        if (isNaN(x) || isNaN(y)) return null;
        return { x, y };
    } catch { return null; }
}

export function spawnAvxCoin(worldPos: { x: number; y: number; z: number }, killerTeam: 'fire' | 'ice', index: number): void {
    if (!ctx._scene || !ctx._engine) return;
    if (index === 0) playCoinDrop();

    const groundY = 0.15;
    const spawnY = worldPos.y + 3.5;
    const offsetX = (Math.random() - 0.5) * 3 + index * 1.5;
    const offsetZ = (Math.random() - 0.5) * 3;
    const finalWorldPos = new Vector3(worldPos.x + offsetX, groundY, worldPos.z + offsetZ);

    const coin = document.createElement('div');
    coin.className = 'avx-coin';
    coin.style.opacity = '0';
    coin.style.pointerEvents = 'none';
    coin.innerHTML = `<img src="${avxCoinUrl}" alt="AVX">`;
    document.body.appendChild(coin);

    const DROP_DURATION = 500;
    const BOUNCE_DURATION = 250;
    const startTime = performance.now();
    let settled = false;

    function updateCoinPosition(now: number): void {
        if (!coin.parentNode) return;
        const elapsed = now - startTime;

        let currentY: number;
        let scale: number;
        let opacity: number;

        if (elapsed < DROP_DURATION) {
            const t = elapsed / DROP_DURATION;
            const eased = t * t;
            currentY = spawnY + (groundY - spawnY) * eased;
            scale = 0.4 + 0.6 * t;
            opacity = 0.3 + 0.7 * t;
        } else if (elapsed < DROP_DURATION + BOUNCE_DURATION) {
            const t = (elapsed - DROP_DURATION) / BOUNCE_DURATION;
            const bounce = Math.sin(t * Math.PI) * 0.8;
            currentY = groundY + bounce;
            scale = 1.0 + bounce * 0.15;
            opacity = 1;
        } else {
            currentY = groundY;
            scale = 1;
            opacity = 1;
            settled = true;
        }

        const pos3d = new Vector3(finalWorldPos.x, currentY, finalWorldPos.z);
        const screen = worldToScreen(pos3d);
        if (screen) {
            coin.style.left = `${screen.x}px`;
            coin.style.top = `${screen.y}px`;
            coin.style.opacity = String(opacity);
            coin.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(2)}) rotate(${(elapsed * 0.5) % 360}deg)`;
        }

        if (!settled) {
            requestAnimationFrame(updateCoinPosition);
        } else {
            coin.style.pointerEvents = 'auto';
            coin.style.transform = 'translate(-50%, -50%) scale(1)';
            const trackId = setInterval(() => {
                if (!coin.parentNode) { clearInterval(trackId); return; }
                const s = worldToScreen(finalWorldPos);
                if (s) { coin.style.left = `${s.x}px`; coin.style.top = `${s.y}px`; }
            }, 50);
        }
    }
    requestAnimationFrame(updateCoinPosition);

    if (ctx.autoCollectActive && ctx.gameMode !== 'twoplayer') {
        setTimeout(() => {
            if (!coin.parentNode) return;
            playCoinCollect();
            ctx.playerAvx++;
            updateAvxUI();
            updateCardStates();
            const autoAnim = coin.animate([
                { transform: 'translate(-50%, -50%) scale(1)', opacity: '1' },
                { transform: 'translate(-50%, -50%) scale(1.8)', opacity: '0' },
            ], { duration: 250, fill: 'forwards' });
            autoAnim.onfinish = () => coin.remove();
        }, 300);
        return;
    }

    function collectCoin(): void {
        playCoinCollect();
        if (ctx.gameMode === 'twoplayer') {
            const isEnemy = (killerTeam === 'fire' && ctx.banCollectActive)
                || (killerTeam === 'ice' && ctx.banCollectActive);
            if (isEnemy) return;
            if (killerTeam === 'fire') ctx.playerAvx++;
            else ctx.iceAvx++;
        } else {
            ctx.playerAvx++;
        }
        updateAvxUI();
        updateCardStates();
        const collectAnim = coin.animate([
            { transform: 'translate(-50%, -50%) scale(1)', opacity: '1' },
            { transform: 'translate(-50%, -50%) scale(1.5)', opacity: '0' },
        ], { duration: 200, fill: 'forwards' });
        collectAnim.onfinish = () => coin.remove();
    }

    const isEnemyCoin = ctx.gameMode === 'twoplayer' && killerTeam !== ctx.selectedTeam;
    if (ctx.banCollectActive && isEnemyCoin) {
        coin.style.opacity = '0.3';
        coin.style.filter = 'grayscale(100%)';
        coin.style.cursor = 'not-allowed';
        coin.title = 'Ban Collect aktif';
    } else {
        coin.addEventListener('click', collectCoin);
    }

    setTimeout(() => {
        if (coin.parentNode) {
            const fadeAnim = coin.animate([{ opacity: '1' }, { opacity: '0' }], { duration: 400, fill: 'forwards' });
            fadeAnim.onfinish = () => coin.remove();
        }
    }, 8000);
}
