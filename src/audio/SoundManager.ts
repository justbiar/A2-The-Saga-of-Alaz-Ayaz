/**
 * SoundManager — Background music + procedural combat SFX
 */

let ctx: AudioContext | null = null;
function getCtx(): AudioContext {
    if (!ctx) ctx = new AudioContext();
    return ctx;
}

// ─── PLAYLIST SYSTEM ─────────────────────────────────────────────────
export interface Track {
    id: string;
    title: string;
    artist: string;
    src: string;
    duration?: string;   // "3:45" format
}

export const PLAYLIST: Track[] = [
    { id: 'storymusic',   title: 'Avaland Theme',       artist: 'A2 OST',    src: '/assets/sound/storymusic.mp3',                  duration: '4:12' },
    { id: 'character',    title: 'Heroes of Fire & Ice', artist: 'A2 OST',   src: '/assets/sound/character.mp3',                   duration: '3:58' },
    { id: 'war',          title: 'Battle Drums',        artist: 'A2 OST',    src: '/assets/sound/war.mp3',                         duration: '3:41' },
    { id: 'soundtrack1',  title: 'A2 Saga',             artist: 'A2 OST',    src: '/assets/sound/A2saga%20soundtrack%201.mp3',     duration: '2:15' },
    { id: 'rockmetal',    title: 'Alaz & Ayaz',         artist: 'Metal Ver', src: '/assets/sound/Ayaz%20and%20alaz%20rock%20metal%20ver.mp3', duration: '1:52' },
    { id: 'ayazgelir',    title: 'Ayaz Gelir Alaz Olur', artist: 'Vocal',    src: '/assets/sound/ayaz_gelir_alaz_olur.mp3', duration: '1:38' },
];

let currentTrackId = 'storymusic';

export function getCurrentTrack(): Track | undefined {
    return PLAYLIST.find(t => t.id === currentTrackId);
}

export function getPlaylist(): Track[] {
    return PLAYLIST;
}

export function playTrack(trackId: string, volume?: number): void {
    const track = PLAYLIST.find(t => t.id === trackId);
    if (!track) return;
    currentTrackId = trackId;
    // localStorage'a kaydet
    localStorage.setItem('a2_current_track', trackId);
    switchBGM(track.src, volume);
}

// Sayfa yüklenince önceki seçimi yükle
export function restoreTrackPreference(): void {
    const saved = localStorage.getItem('a2_current_track');
    if (saved && PLAYLIST.find(t => t.id === saved)) {
        currentTrackId = saved;
    }
}

// ─── BACKGROUND MUSIC ────────────────────────────────────────────────
let bgmElement: HTMLAudioElement | null = null;
let bgmCurrentSrc = '';
let bgmVolume = 0.3;
let bgmMuted = false;
let sfxVolume = 0.5;
let sfxMuted = false;

/** Switch BGM track. If same src is already playing, does nothing. */
export function switchBGM(src: string, volume?: number): void {
    if (bgmCurrentSrc === src && bgmElement) return;
    // Stop previous
    if (bgmElement) {
        bgmElement.pause();
        bgmElement.removeAttribute('src'); // Fixes NotSupportedError
        bgmElement.load();
        bgmElement = null;
    }
    if (volume !== undefined) bgmVolume = Math.max(0, Math.min(1, volume));
    bgmCurrentSrc = src;
    bgmElement = new Audio(src);
    bgmElement.loop = true;
    bgmElement.volume = bgmMuted ? 0 : bgmVolume;
    bgmElement.play().catch((err: any) => {
        if (err.name === 'NotAllowedError') { // Autoplay blocked
            const playOnce = () => { bgmElement?.play().catch(()=>{}); document.removeEventListener('click', playOnce); };
            document.addEventListener('click', playOnce);
        }
    });
}

/** @deprecated Use switchBGM instead */
export function initBGM(src: string): void { switchBGM(src); }

export function setBGMVolume(v: number): void {
    bgmVolume = Math.max(0, Math.min(1, v));
    if (bgmElement && !bgmMuted) bgmElement.volume = bgmVolume;
}

export function toggleBGMMute(): boolean {
    bgmMuted = !bgmMuted;
    if (bgmElement) bgmElement.volume = bgmMuted ? 0 : bgmVolume;
    return bgmMuted;
}

export function lowerBGMForGame(): void {
    setBGMVolume(0.12);
}

export function setSFXVolume(v: number): void {
    sfxVolume = Math.max(0, Math.min(1, v));
}

export function toggleSFXMute(): boolean {
    sfxMuted = !sfxMuted;
    return sfxMuted;
}

export function getBGMVolume(): number { return bgmVolume; }
export function getSFXVolume(): number { return sfxVolume; }
export function isBGMMuted(): boolean { return bgmMuted; }
export function isSFXMuted(): boolean { return sfxMuted; }

// ─── PROCEDURAL SFX ─────────────────────────────────────────────────
function playTone(freq: number, duration: number, type: OscillatorType, vol: number, detune = 0): void {
    if (sfxMuted) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    gain.gain.setValueAtTime(vol * sfxVolume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + duration);
}

function playNoise(duration: number, vol: number, highpass = 0): void {
    if (sfxMuted) return;
    const c = getCtx();
    const bufferSize = c.sampleRate * duration;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol * sfxVolume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    src.connect(gain);
    if (highpass > 0) {
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = highpass;
        gain.disconnect();
        src.connect(hp);
        hp.connect(gain);
        gain.connect(c.destination);
    } else {
        gain.connect(c.destination);
    }
    src.start();
}

// ─── MP3 SFX SYSTEM ─────────────────────────────────────────────────
const sfxCache = new Map<string, HTMLAudioElement>();

function playSFX(src: string, vol = 0.5): void {
    if (sfxMuted) return;
    let audio = sfxCache.get(src);
    if (audio) {
        // Clone for overlapping playback
        const clone = audio.cloneNode() as HTMLAudioElement;
        clone.volume = Math.min(1, vol * sfxVolume);
        clone.play().catch(() => {});
    } else {
        audio = new Audio(src);
        sfxCache.set(src, audio);
        audio.volume = Math.min(1, vol * sfxVolume);
        audio.play().catch(() => {});
    }
}

// ─── SFX PATHS ──────────────────────────────────────────────────────
const SFX = {
    swordSlash:  '/assets/sfx/kilickesmesi.mp3',
    swordHit:    '/assets/sfx/freesound_community-sword-hit-7160.mp3',
    albastiWing: '/assets/sfx/albastiwing.mp3',
    odWizard:    '/assets/sfx/odwizard.mp3',
    tepegozBite: '/assets/sfx/tepegoz-bite.mp3',
    umay:        '/assets/sfx/umay.mp3',
    coinDrop:    '/assets/sfx/freesound_crunchpixstudio-drop-coin-384921.mp3',
    coinCollect: '/assets/sfx/freesound_community-coins-falling-013-36967.mp3',
};

/** Preload all SFX files */
export function preloadSFX(): void {
    Object.values(SFX).forEach(src => {
        const a = new Audio();
        a.preload = 'auto';
        a.src = src;
        sfxCache.set(src, a);
    });
}

// ─── CHARACTER ATTACK SOUNDS ─────────────────────────────────────────

/** Korhan — kılıç kesmesi */
export function playHammerHit(): void { playSFX(SFX.swordSlash, 0.6); }

/** Erlik — kılıç vuruşu */
export function playBladeSlash(): void { playSFX(SFX.swordHit, 0.5); }

/** Od — büyücü sesi */
export function playFireBurst(): void { playSFX(SFX.odWizard, 0.5); }

/** Ayaz — kılıç kesmesi */
export function playIceCrack(): void { playSFX(SFX.swordSlash, 0.5); }

/** Tulpar — kılıç vuruşu */
export function playChargeHit(): void { playSFX(SFX.swordHit, 0.5); }

/** Umay — umay sesi */
export function playMagicChime(): void { playSFX(SFX.umay, 0.5); }

/** Albastı — kanat sesi */
export function playQuickSlash(): void { playSFX(SFX.albastiWing, 0.5); }

/** Tepegöz — ısırık */
export function playGroundSlam(): void { playSFX(SFX.tepegozBite, 0.6); }

/** Şahmeran — yılan zehri (kılıç vuruş fallback) */
export function playVenomSpit(): void { playSFX(SFX.swordHit, 0.4); }

/** Death sound — low thud + fade */
export function playDeathSound(): void {
    playTone(60, 0.4, 'sine', 0.5);
    playTone(45, 0.5, 'sine', 0.3);
    playNoise(0.2, 0.2, 200);
}

/** Deploy/spawn whoosh */
export function playSpawnSound(): void {
    playTone(200, 0.15, 'sine', 0.2);
    playTone(400, 0.2, 'triangle', 0.15);
    playNoise(0.1, 0.15, 1000);
}

/** Coin düşme sesi */
export function playCoinDrop(): void { playSFX(SFX.coinDrop, 0.6); }

/** Coin toplama sesi */
export function playCoinCollect(): void { playSFX(SFX.coinCollect, 0.7); }

/** Get attack sound by unit type */
export function playAttackSound(type: string): void {
    switch (type) {
        case 'korhan': playHammerHit(); break;
        case 'erlik': playBladeSlash(); break;
        case 'od': playFireBurst(); break;
        case 'ayaz': playIceCrack(); break;
        case 'tulpar': playChargeHit(); break;
        case 'umay': playMagicChime(); break;
        case 'albasti': playQuickSlash(); break;
        case 'tepegoz': playGroundSlam(); break;
        case 'sahmeran': playVenomSpit(); break;
    }
}
