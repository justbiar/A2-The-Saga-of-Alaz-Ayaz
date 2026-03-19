import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:3001',
                changeOrigin: true,
            },
        },
    },
    build: {
        assetsInlineLimit: 0,
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                manualChunks(id: string) {
                    if (id.includes('@babylonjs/loaders')) return 'babylon-loaders';
                    if (id.includes('@babylonjs/core')) return 'babylon-core';
                    if (id.includes('node_modules')) return 'vendor';
                },
            },
        },
    },
    plugins: [
        viteStaticCopy({
            targets: [
                { src: 'assets/images',              dest: 'assets' },
                { src: 'assets/sound',               dest: 'assets' },
                { src: 'assets/sfx',                 dest: 'assets' },
                { src: 'assets/character animation',  dest: 'assets' },
                // { src: 'assets/*.glb',               dest: 'assets' },
                { src: 'assets/base',                dest: 'assets' },
                { src: 'assets/game asset',          dest: 'assets' },
                { src: 'assets/video',               dest: 'assets' },
                { src: 'assets/Effect and FX Pixel Part 12 Free', dest: 'assets' },
            ],
        }),
    ],
    optimizeDeps: {
        include: [
            'earcut',
            '@babylonjs/core/Engines/engine',
            '@babylonjs/core/scene',
            '@babylonjs/core/Meshes/meshBuilder',
            '@babylonjs/core/Meshes/mesh',
            '@babylonjs/core/Meshes/transformNode',
            '@babylonjs/core/Meshes/polygonMesh',
            '@babylonjs/core/Maths/math.vector',
            '@babylonjs/core/Maths/math.color',
            '@babylonjs/core/Materials/standardMaterial',
            '@babylonjs/core/Materials/PBR/pbrMaterial',
            '@babylonjs/core/Materials/Textures/dynamicTexture',
            '@babylonjs/core/Materials/Textures/texture',
            '@babylonjs/core/Materials/Textures/baseTexture',
            '@babylonjs/core/Lights/hemisphericLight',
            '@babylonjs/core/Lights/directionalLight',
            '@babylonjs/core/Lights/pointLight',
            '@babylonjs/core/Lights/Shadows/shadowGenerator',
            '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent',
            '@babylonjs/core/Cameras/arcRotateCamera',
            '@babylonjs/core/Cameras/universalCamera',
            '@babylonjs/core/Loading/sceneLoader',
            '@babylonjs/core/assetContainer',
            '@babylonjs/core/Animations/animationGroup',
            '@babylonjs/core/Events/keyboardEvents',
            '@babylonjs/core/Events/pointerEvents',
            '@babylonjs/core/Culling/ray',
            '@babylonjs/core/Meshes/Compression/dracoCompression',
            '@babylonjs/core/Layers/glowLayer',
            '@babylonjs/core/Particles/particleSystem',
            '@babylonjs/core/Particles/particleSystemComponent',
            '@babylonjs/loaders/glTF',
        ],
    },
});
