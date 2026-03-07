/**
 * createEngine.ts — Babylon.js WebGL2 engine factory.
 * Kept thin so it's easy to swap for WebGPU later.
 */
import { Engine } from '@babylonjs/core/Engines/engine';

export function createEngine(canvas: HTMLCanvasElement): Engine {
    const engine = new Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        antialias: true,
    });
    engine.setHardwareScalingLevel(1 / window.devicePixelRatio);
    return engine;
}
