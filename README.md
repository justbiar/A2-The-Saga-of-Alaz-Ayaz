# 🔥 Fire vs Ice ❄️ - Avalanche Strateji Oyunu

Avalanche Fuji Testnet üzerinde çalışan 2D strateji oyunu.

## 🎮 Özellikler

- **Cüzdan Bağlantısı**: MetaMask ile Avalanche Fuji Testnet'e bağlanın
- **Takım Seçimi**: Ateş veya Buz ordusunu seçin
- **Strateji Savaşı**: Havada uçan ada üzerinde savaşın
- **Web3 Entegrasyonu**: Blockchain tabanlı oyun deneyimi

## 🚀 Kurulum

### Gereksinimler
- Modern web tarayıcı (Chrome, Firefox, Edge)
- MetaMask cüzdan uzantısı
- Node.js (opsiyonel, yerel sunucu için)

### Hızlı Başlangıç

1. **MetaMask Kurulumu**
   - [MetaMask](https://metamask.io/) uzantısını yükleyin
   - Yeni bir cüzdan oluşturun veya mevcut cüzdanı içe aktarın

2. **Avalanche Fuji Testnet**
   - Oyun otomatik olarak ağı ekleyecektir
   - Manuel eklemek için:
     - Network Name: Avalanche Fuji Testnet
     - RPC URL: https://api.avax-test.network/ext/bc/C/rpc
     - Chain ID: 43113
     - Symbol: AVAX
     - Explorer: https://testnet.snowtrace.io/

3. **Test AVAX Alın**
   - [Avalanche Faucet](https://faucet.avax.network/) adresini ziyaret edin
   - Cüzdan adresinizi girin ve test AVAX alın

4. **Oyunu Çalıştırın**
   ```bash
   # Node.js ile
   npm start
   # veya
   npx http-server -p 8080
   ```
   
   Tarayıcıda `http://localhost:8080` adresini açın

## 🎯 Nasıl Oynanır

1. **Cüzdan Bağlayın**: "MetaMask ile Bağlan" butonuna tıklayın
2. **Takım Seçin**: Ateş 🔥 veya Buz ❄️ ordusunu seçin
3. **Oyunu Başlatın**: "Oyunu Başlat" butonuna tıklayın
4. **Kontroller**:
   - Sol Tık: Ünite seç
   - Sağ Tık: Seçili üniteyi hareket ettir
   - ESC: Seçimi iptal et

## 🗺️ Oyun Haritası

Havada uçan ada iki bölgeden oluşur:
- **Sol Taraf (Ateş Bölgesi)**: Volkan ve lav
- **Sağ Taraf (Buz Bölgesi)**: Buz dağı ve kar
- **Orta Alan**: Savaş bölgesi

## ⚔️ Birimler

### Ateş Savaşçısı 🔥
- HP: 100
- Saldırı: 15
- Savunma: 8
- Hız: Yüksek

### Buz Savaşçısı ❄️
- HP: 100
- Saldırı: 12
- Savunma: 12
- Hız: Orta

## 🛠️ Teknolojiler

- **Phaser 3**: Oyun motoru
- **Ethers.js**: Web3 entegrasyonu
- **Avalanche C-Chain**: Blockchain ağı
- **HTML5 Canvas**: Render

## 📁 Proje Yapısı

```
Avx/
├── index.html          # Ana HTML dosyası
├── package.json        # Proje yapılandırması
├── README.md           # Bu dosya
├── assets/
│   ├── images/         # Görsel dosyalar
│   └── audio/          # Ses dosyaları
└── src/
    ├── main.js         # Oyun başlatıcı
    ├── utils/
    │   └── wallet.js   # Cüzdan fonksiyonları
    └── scenes/
        ├── Start.js    # Başlangıç sahnesi
        └── Game.js     # Ana oyun sahnesi
```

## 🔮 Gelecek Özellikler

- [ ] NFT karakterler
- [ ] Multiplayer desteği
- [ ] Token ödülleri
- [ ] Kale inşa etme
- [ ] Özel yetenekler
- [ ] Turnuva sistemi

## 📝 Lisans

MIT License

## 🤝 Katkıda Bulunma

Pull request'ler memnuniyetle karşılanır!

---

**🔥 Ateş mi Buz mu? Senin seçimin! ❄️**
