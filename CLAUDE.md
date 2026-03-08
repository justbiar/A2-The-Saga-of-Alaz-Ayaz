# A2: The Saga of Alaz & Ayaz — Claude Context

## Deployment (CANLI)
- **Domain**: a2saga.me (Namecheap BasicDNS, A record → 34.56.130.155)
- **VM**: GCP `selfbiar@34.56.130.155` (instance: a2saga, zone: us-central1-c)
- **SSH**: `gcloud compute ssh a2saga --zone=us-central1-c` veya GCP Console SSH
- **SCP**: `gcloud compute scp <dosya> a2saga:/tmp/ --zone=us-central1-c`
- **Web server**: nginx, root = `/var/www/html`
- **SSL**: certbot + nginx
- **GitHub**: https://github.com/justbiar/A2-The-Saga-of-Alaz-Ayaz.git

### Deploy komutu (her değişiklikte):
```bash
# 1. Lokal build
npx vite build

# 2. Dosyaları VM'e gönder
gcloud compute scp dist/index.html a2saga:/tmp/index.html --zone=us-central1-c
gcloud compute ssh a2saga --zone=us-central1-c --command="rm -rf /tmp/dist-js/*; mkdir -p /tmp/dist-js"
gcloud compute scp dist/assets/*.js a2saga:/tmp/dist-js/ --zone=us-central1-c

# 3. VM'de deploy
gcloud compute ssh a2saga --zone=us-central1-c --command="
  sudo cp /tmp/index.html /var/www/html/
  sudo cp /tmp/dist-js/*.js /var/www/html/assets/
  sudo chmod -R 755 /var/www/html/assets/
"

# 4. Yeni asset varsa (resim, ses, glb):
gcloud compute scp <dosya> a2saga:/tmp/ --zone=us-central1-c
gcloud compute ssh a2saga --zone=us-central1-c --command="sudo cp /tmp/<dosya> /var/www/html/assets/<yol>/"
```

## Stack
- TypeScript, BabylonJS 7, Vite, HTML5 Canvas
- Solidity/Hardhat (contracts/ — ayrı)
- ethers CDN'den yükleniyor (npm'den kaldırıldı, esbuild hang ediyor)

## Vite Config (kritik - elleme)
- `noDiscovery: true` + explicit `include` listesi
- ethers npm'den kaldırıldı, CDN'den yükleniyor (index.html'de script tag)
- `optimizeDeps.include` → tüm BabylonJS deep importlar listelenmeli

## Oyun Akışı
1. **Ana Sayfa** → OYNA / KARAKTERLER / HİKAYE
2. **Takım Seç** → Ateş veya Buz
3. **Mod Seç** → Gerçek Zamanlı (VS AI) / 2 Oyunculu
4. **Zorluk Seç** (sadece VS AI) → 7 kat (Türk mitolojisi yeraltı katları)
5. **Oyun** → Kart tabanlı birim yerleştirme, 3 lane, üs yıkma

## i18n (Çok Dil Desteği)
- `src/i18n.ts`: TR / EN / ES
- `t(key)` fonksiyonu, `setLang()`, `getLang()`
- `data-i18n` ve `data-i18n-html` attribute'ları HTML'de
- localStorage'da `a2lang` key'i ile saklanıyor

## Müzik Sistemi
- `src/audio/SoundManager.ts`
- `switchBGM(src, volume)` — ekranlar arası müzik değişimi
- 3 müzik dosyası:
  - `assets/sound/war.mp3` → Savaş ekranı (düşük ses 0.2)
  - `assets/sound/character.mp3` → Karakter ekranı
  - `assets/sound/storymusic.mp3` → Hikaye ekranı
- Sol alt köşede müzik kontrol paneli (mute + volume slider)
- SFX kaldırıldı (procedural sesler kötüydü)

## AVX Coin Sistemi
- Düşman öldüğünde sahaya AVX coin düşüyor (favicon logosu)
- Mouse ile tıklayıp topluyorsun (8s sonra kaybolur)
- **Paralı askerler AVX ile alınıyor** (mana değil):
  - Albastı: 3 AVX
  - Şahmeran: 4 AVX
  - Tepegöz: 5 AVX
- Ateş/Buz birimleri hala mana ile
- HUD'da mana altında AVX sayacı
- Kart üzerinde: manalı = mavi elmas rozet, AVX = kırmızı rozet + favicon

## 7 Kat Zorluk Sistemi
VS AI modunda "Yerin Yedi Katı" ekranı:
| Kat | İsim | Zorluk |
|-----|------|--------|
| I | Gölge Geçidi | AI deploy 8s, max 8, stat 0.8x |
| II | Kara Bozkır | AI deploy 7.1s, max 10, stat 0.92x |
| III | Kemik Ormanı | AI deploy 6.2s, max 12, stat 1.04x |
| IV | Demir Çöl | AI deploy 5.3s, max 14, stat 1.16x |
| V | Ateş Uçurumu | AI deploy 4.4s, max 16, stat 1.28x |
| VI | Kan Nehri | AI deploy 3.5s, max 18, stat 1.4x, 2x birim |
| VII | Erlik Han'ın Tahtı | AI deploy 2.5s, max 20, stat 1.52x, 2x birim |

## Skill Kartları
- `src/ecs/PromptCard.ts`: 3 skill kart
- Mana Doldur (mana1.png) → Manayı tamamen doldurur
- Mana Dondur (mana2.png) → 5 saniye mana harcanmaz
- Ouroboros (ouroboros.png) → Düşman birimi senin tarafına geçer
- Tek tıkla çalışır, karakter kartlarından "ATEŞ/BUZ" tag kaldırıldı

## Karakterler
| Karakter | Takım | Mana/AVX | Armor | Yetenek |
|---|---|---|---|---|
| Korhan | Ateş | 4 mana | 8 | Iron Armor (every 3rd hit -40% dmg) |
| Erlik | Ateş | 5 mana | 1 | Dark Flame (30% burn on attack) |
| Od | Ateş | 7 mana | 2 | Yalın Ateş (20% +50% dmg proc) |
| Ayaz | Buz | 3 mana | 10 | Hoarfrost (4th attack = frozen 2s) |
| Tulpar | Buz | 3 mana | 1 | Charge (first attack = 2x dmg) |
| Umay | Buz | 4 mana | 2 | Mercy (heal nearest ally 15HP/5s) |
| Albastı | Paralı | 3 AVX | 2 | — |
| Tepegöz | Paralı | 5 AVX | 12 | Earth Tremor (stun AOE/8s) |
| Şahmeran | Paralı | 4 AVX | 1 | Serpent Venom (poison on every attack) |

## Kart UI
- Karakter kartları: 110x175px, görsel 80px üstte, altında isim + rol + 2x2 stat grid (HP/ATK/DEF/SPD)
- Skill kartları: 150x210px, görsel cover, altında isim + açıklama

## Dosya Haritası
```
src/
  main.ts                      # Boot, loading, turn, kart UI, skill kart, AVX, zorluk, win screen
  i18n.ts                      # TR/EN/ES çeviri sistemi
  audio/
    SoundManager.ts            # BGM switch, volume/mute kontrol
  ecs/
    Unit.ts                    # Tipler, CARD_DEFS, STATS_MAP, AI_PROFILES_MAP, avxCost
    UnitManager.ts             # Spawn/combat, preload, animasyon, onUnitDeath callback
    types.ts                   # StatusEffect, AIProfile, PromptCardDef
    PromptCard.ts              # 3 skill kart (PROMPT_DEFS)
    abilities/
      AbilitySystem.ts         # Registry, tickPassives, tickStatusEffects
      characterAbilities.ts    # 8 karakter yeteneği + UNIT_ABILITY_MAP
  ai/
    MockKiteAI.ts              # Rule-based AI
    KiteChainService.ts        # ethers CDN üzerinden
  game/
    GameState.ts               # calcManaGain, calcBoardControl, checkEquilibriumSurge
  scene/
    createScene.ts             # Scene, lights, shadows
    map/
      createAvaxMap.ts         # AVAX diamond harita
      AvaShard.ts              # 3 kristal, capture loop
      BaseBuilding.ts          # HP=1000, dt-based attack
    systems/
      winConditionSystem.ts    # Win koşulları
      cameraSystem.ts          # ArcRotateCamera
    units/
      createHero.ts            # GLB hero loader
contracts/                     # Hardhat (ayrı npm install)
```

## Assets (.gitignore'da)
```
assets/
  sound/                      # war.mp3, character.mp3, storymusic.mp3
  images/
    characters/               # 9 karakter PNG
    skills/                   # mana1.png, mana2.png, ouroboros.png
    textures/                 # lava/ice texture'lar
    gameplay/                 # korhan.glb (tek 3D model)
  character animation/        # GLB animasyonlar (çoğu eksik — sadece korhan.glb var)
```

## Loading Screen
- `index.html`'de `#loading-screen` div (fixed, z-index 10000)
- `main.ts` boot(): preload() bitene kadar yüzdelik loading bar
- preload timeout: 30 saniye (UnitManager.ts)
- Bitince `loadingScreen.remove()` (display:none değil)

## Bilinen Sorunlar
- GLB animasyon dosyaları çoğu eksik (sadece korhan.glb var, diğerleri yok)
- Mac RAM 15/16GB dolu → git/disk yavaş
- Kaspersky disk I/O'yu öldürüyor → kapat
- nginx assets 403 verirse: `sudo chmod -R 755 /var/www/html/assets/`
- `dist/assets/` hem JS chunk hem game assets içerir — üst üste yazma dikkat

## Kullanıcı Tercihleri
- Türkçe konuş
- Kısa ve direkt ol, uzun açıklama yapma
- VM komutlarını direkt ver, neden açıklama
- Hata olunca döngüye girme, farklı yol dene
