// Main.js - Phaser Oyun Yapılandırması
// Fire vs Ice - Avalanche Strateji Oyunu

// Oyun yapılandırması
const gameConfig = {
    type: Phaser.AUTO,
    width: 1200,
    height: 800,
    parent: 'game-canvas',
    backgroundColor: '#1a1a2e',
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: []
};

// Global oyun değişkeni
let game = null;

// Oyunu başlat fonksiyonu
function initGame(gameState) {
    console.log('🎮 Oyun başlatılıyor...', gameState);
    
    // Eğer oyun zaten varsa, yok et
    if (game) {
        game.destroy(true);
    }
    
    // Yeni oyun oluştur
    game = new Phaser.Game(gameConfig);
    
    // HexGameScene'i ekle ve başlat
    game.scene.add('HexGameScene', HexGameScene, true, {
        team: gameState.selectedTeam,
        walletAddress: gameState.walletAddress
    });
    
    console.log('✅ Oyun başlatıldı!');
}

// Sayfa yüklendiğinde
document.addEventListener('DOMContentLoaded', () => {
    console.log('🔥 Fire vs Ice - Avalanche Strategy Game');
    console.log('📋 Oyun yüklenmeye hazır');
    
    // Phaser kontrolü
    if (typeof Phaser === 'undefined') {
        console.error('❌ Phaser yüklenemedi! Lütfen phaser.js dosyasını kontrol edin.');
        document.getElementById('gameStatus').textContent = 'Hata: Phaser yüklenemedi';
        return;
    }
    
    console.log('✅ Phaser version:', Phaser.VERSION);
});

// Debug fonksiyonları
window.debugGame = {
    getState: () => gameState,
    getGame: () => game,
    restart: () => {
        if (game) {
            game.scene.getScene('GameScene').scene.restart();
        }
    }
};
