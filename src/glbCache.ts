/**
 * glbCache.ts — Sayfa açılır açılmaz GLB dosyalarını arka planda indirir
 * ve bellekte (objectURL) tutar. UnitManager.preload() bu cache'den yükler.
 */

const BASE = '/assets/character%20animation/';
const BORU_BASE = '/assets/character%20animation/Meshy_AI_biped/';

const GLB_FILES = [
    'korhanwalk.glb', 'Korhanattack.glb', 'korhandie.glb',
    'erlik.glb', 'erlikattack.glb', 'erlikdie.glb',
    'odwalk.glb', 'odattack.glb', 'oddie.glb',
    'tepegozwalk.glb', 'tepegozattack.glb', 'tepegozdie.glb',
    'albastiwalk.glb', 'albastiattack.glb', 'albastidie.glb',
    'umaywalk.glb', 'umayattack.glb', 'umaydie.glb',
    'ayazwalk.glb', 'ayazattack.glb', 'ayazdie.glb',
    'tulpar.glb',
    'sahmeranwalk.glb', 'sahmeranattack.glb', 'sahmerandie.glb',
];
const BORU_FILES = ['boruwalk.glb', 'boruattack.glb', 'borudie.glb'];

/** file adı → objectURL (blob:...) eşlemesi */
const cache = new Map<string, string>();

/** Orijinal dosya adını objectURL'den geri alma */
const urlToFile = new Map<string, string>();

/** İndirme tamamlandı mı */
let _done = false;
let _promise: Promise<void> | null = null;

/** Cache'den objectURL al. Yoksa orijinal URL döner (fallback). */
export function getCachedUrl(file: string, boru = false): string {
    const cached = cache.get(file);
    if (cached) return cached;
    // Fallback — cache'de yoksa orijinal URL
    return (boru ? BORU_BASE : BASE) + file;
}

/** objectURL → orijinal dosya adı (plugin seçimi için) */
export function getOriginalFileName(objectUrl: string): string | undefined {
    return urlToFile.get(objectUrl);
}

/** Cache hazır mı? */
export function isCacheReady(): boolean {
    return _done;
}

/** Toplam dosya sayısı ve inmiş dosya sayısı */
export function getCacheProgress(): { loaded: number; total: number } {
    const total = GLB_FILES.length + BORU_FILES.length;
    return { loaded: cache.size, total };
}

/** Cache promise — boot() bu bitmesini bekleyebilir */
export function waitForCache(): Promise<void> {
    return _promise ?? Promise.resolve();
}

/** Sayfa açılınca çağır — arka planda tüm GLB'leri indirir */
export function startGLBWarmCache(): void {
    if (_promise) return; // Zaten başlatıldı (veya bitti)
    _promise = _downloadAll();
}

async function _downloadAll(): Promise<void> {
    console.log('📦 GLB warm-cache başlatılıyor...');
    const t0 = performance.now();

    const allEntries = [
        ...GLB_FILES.map(f => ({ file: f, url: BASE + f })),
        ...BORU_FILES.map(f => ({ file: f, url: BORU_BASE + f })),
    ];

    let done = 0;
    const total = allEntries.length;
    const BATCH = 4;

    for (let i = 0; i < allEntries.length; i += BATCH) {
        const batch = allEntries.slice(i, i + BATCH);
        await Promise.all(batch.map(async ({ file, url }) => {
            // Zaten cache'de varsa (sayfa reload olmadan tekrar çağrıldı) atla
            if (cache.has(file)) { done++; return; }
            try {
                // force-cache: tarayıcı disk cache'inde varsa network'e gitme
                const resp = await fetch(url, { cache: 'force-cache' });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const blob = await resp.blob();
                const objectUrl = URL.createObjectURL(blob);
                cache.set(file, objectUrl);
                urlToFile.set(objectUrl, file);
                done++;
                const mb = (blob.size / 1024 / 1024).toFixed(1);
                console.log(`  [${done}/${total}] ${file} — ${mb} MB`);
            } catch (err) {
                done++;
                console.warn(`  [${done}/${total}] ${file} basarisiz:`, err);
            }
        }));
    }

    _done = true;
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`🔥 GLB warm-cache tamamlandı — ${cache.size}/${total} dosya, ${elapsed}s`);
}
