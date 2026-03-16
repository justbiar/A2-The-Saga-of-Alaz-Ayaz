/**
 * glbCache.ts — GLB dosyalarını IndexedDB + bellekte cache'ler.
 * İlk ziyarette network'ten indirir, IndexedDB'ye yazar.
 * Sonraki sayfa yenilemelerinde IndexedDB'den okur (network sıfır).
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
const BORU_FILES = ['boruwalk.glb', 'boruattack.glb', 'boruattack2.glb', 'borudie.glb'];

// IndexedDB versiyonu — GLB degisirse artir, eski cache silinir
const IDB_NAME = 'a2-glb-cache';
const IDB_VERSION = 4; // v4: tepegozwalk.glb optimized (586KB)
const IDB_STORE = 'blobs';

/** file adı → objectURL (blob:...) eşlemesi */
const cache = new Map<string, string>();

/** Orijinal dosya adını objectURL'den geri alma */
const urlToFile = new Map<string, string>();

/** İndirme tamamlandı mı */
let _done = false;
let _promise: Promise<void> | null = null;

/** Download progress callback */
let _onCacheProgress: ((loaded: number, total: number) => void) | null = null;
export function setCacheProgressCallback(cb: ((loaded: number, total: number) => void) | null): void {
    _onCacheProgress = cb;
}

const FETCH_TIMEOUT_MS = 45_000;

export function getCachedUrl(file: string, boru = false): string {
    const cached = cache.get(file);
    if (cached) return cached;
    return (boru ? BORU_BASE : BASE) + file;
}

export function getOriginalFileName(objectUrl: string): string | undefined {
    return urlToFile.get(objectUrl);
}

export function isCacheReady(): boolean {
    return _done;
}

export function getCacheProgress(): { loaded: number; total: number } {
    const total = GLB_FILES.length + BORU_FILES.length;
    return { loaded: cache.size, total };
}

export function waitForCache(): Promise<void> {
    return _promise ?? Promise.resolve();
}

export function startGLBWarmCache(): void {
    if (_promise) return;
    _promise = _downloadAll();
}

// ── IndexedDB helpers ──────────────────────────────────────────────
function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idbGet(db: IDBDatabase, key: string): Promise<Blob | undefined> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result as Blob | undefined);
        req.onerror = () => reject(req.error);
    });
}

function idbPut(db: IDBDatabase, key: string, blob: Blob): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(blob, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ── Ana indirme ────────────────────────────────────────────────────
async function _downloadAll(): Promise<void> {
    console.log('📦 GLB cache başlatılıyor...');
    const t0 = performance.now();

    let db: IDBDatabase | null = null;
    try { db = await openDB(); } catch { console.warn('IndexedDB açılamadı, sadece network kullanılacak'); }

    const allEntries = [
        ...GLB_FILES.map(f => ({ file: f, url: BASE + f })),
        ...BORU_FILES.map(f => ({ file: f, url: BORU_BASE + f })),
    ];

    let done = 0;
    const total = allEntries.length;
    const BATCH = 6;

    for (let i = 0; i < allEntries.length; i += BATCH) {
        const batch = allEntries.slice(i, i + BATCH);
        await Promise.all(batch.map(async ({ file, url }) => {
            if (cache.has(file)) { done++; _onCacheProgress?.(done, total); return; }
            try {
                let blob: Blob | undefined;

                // 1) IndexedDB'den dene
                if (db) {
                    try { blob = await idbGet(db, file); } catch { /* ignore */ }
                }

                // 2) IndexedDB'de yoksa network'ten indir
                if (!blob) {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
                    const resp = await fetch(url, { cache: 'force-cache', signal: controller.signal });
                    clearTimeout(timer);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    blob = await resp.blob();
                    // IndexedDB'ye kaydet (arka planda, beklemeden)
                    if (db) { idbPut(db, file, blob).catch(() => {}); }
                }

                const objectUrl = URL.createObjectURL(blob);
                cache.set(file, objectUrl);
                urlToFile.set(objectUrl, file);
                done++;
                const mb = (blob.size / 1024 / 1024).toFixed(1);
                const src = blob ? 'idb' : 'net';
                console.log(`  [${done}/${total}] ${file} — ${mb} MB (${src})`);
            } catch (err) {
                done++;
                console.warn(`  [${done}/${total}] ${file} basarisiz:`, err);
            }
            _onCacheProgress?.(done, total);
        }));
    }

    _done = true;
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`🔥 GLB cache tamamlandı — ${cache.size}/${total} dosya, ${elapsed}s`);
}
