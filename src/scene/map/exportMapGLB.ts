/**
 * exportMapGLB.ts — Harita geometrisini GLB dosyası olarak export eder.
 *
 * Kullanım:
 *   1. Oyunu çalıştır (npm run dev)
 *   2. Tarayıcı console'unda şunu yaz:
 *        window.exportMapGLB()
 *   3. avax_map.glb dosyası indirilir.
 *
 * Not: Particle'lar, GlowLayer, ışıklar GLB'ye dahil edilmez —
 *      bunlar runtime'da eklenir (createAvaxMapFromGLB).
 */
import { Scene } from '@babylonjs/core/scene';
import { GLTF2Export } from '@babylonjs/serializers/glTF/2.0';

// Exclude edilecek mesh isimleri (sky, void gibi runtime-only)
const EXCLUDE_NAMES = new Set([
    'skySphere',
    'voidGround',
]);

// Exclude edilecek prefixler
const EXCLUDE_PREFIXES: string[] = [
    // Particle emitter'lar zaten GLB'ye girmez
];

function shouldExclude(name: string): boolean {
    if (EXCLUDE_NAMES.has(name)) return true;
    return EXCLUDE_PREFIXES.some(p => name.startsWith(p));
}

/**
 * Sahneyi GLB olarak export eder.
 * Sadece harita mesh'lerini alır (karakterler, UI vb. hariç).
 */
export async function exportMapGLB(scene: Scene): Promise<void> {
    console.log('[MapExport] Starting GLB export...');
    console.log(`[MapExport] Scene meshes: ${scene.meshes.length}`);

    // Hangi mesh'lerin dahil edileceğini listele
    const includedMeshes = scene.meshes.filter(m => {
        // Karakter / unit mesh'lerini hariç tut
        if (m.name.startsWith('unit_') || m.name.startsWith('hero_')) return false;
        // Coin model hariç
        if (m.name.includes('coin')) return false;
        // Exclude listesi
        if (shouldExclude(m.name)) return false;
        return true;
    });

    console.log(`[MapExport] Including ${includedMeshes.length} meshes:`);
    includedMeshes.forEach(m => console.log(`  - ${m.name}`));

    try {
        // shouldExportNode callback ile filtreleme
        const glb = await GLTF2Export.GLBAsync(scene, 'avax_map', {
            shouldExportNode: (node) => {
                // Mesh ise filtre uygula
                if ('geometry' in node && node.name) {
                    if (shouldExclude(node.name)) return false;
                    if (node.name.startsWith('unit_') || node.name.startsWith('hero_')) return false;
                    if (node.name.includes('coin')) return false;
                }
                return true;
            },
        });

        // GLB dosyasını indir
        glb.downloadFiles();
        console.log('[MapExport] ✅ GLB download started!');
    } catch (err) {
        console.error('[MapExport] ❌ Export failed:', err);
        throw err;
    }
}

// window'a bağla — console'dan çağırılabilir
if (typeof window !== 'undefined') {
    (window as any).__exportMapGLBFn = exportMapGLB;
}
