// Start.js - Oyun Başlangıç Sahnesi (Opsiyonel Phaser menü sahnesi)
// Bu sahne HTML menü yerine kullanılabilir

class StartScene extends Phaser.Scene {
    constructor() {
        super({ key: 'StartScene' });
    }

    preload() {
        // Logo ve arka plan yükle
        this.createLoadingBar();
    }

    createLoadingBar() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Yükleniyor yazısı
        const loadingText = this.add.text(width / 2, height / 2 - 50, 'Yükleniyor...', {
            fontSize: '24px',
            fontFamily: 'Arial',
            color: '#FFFFFF'
        });
        loadingText.setOrigin(0.5);

        // Progress bar arka planı
        const progressBg = this.add.rectangle(width / 2, height / 2, 400, 30, 0x333333);
        progressBg.setStrokeStyle(2, 0x666666);

        // Progress bar
        const progressBar = this.add.rectangle(width / 2 - 195, height / 2, 0, 20, 0xFF6B35);
        progressBar.setOrigin(0, 0.5);

        // Yükleme olayları
        this.load.on('progress', (value) => {
            progressBar.width = 390 * value;
        });

        this.load.on('complete', () => {
            loadingText.destroy();
            progressBg.destroy();
            progressBar.destroy();
        });
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Arka plan gradient
        const bgGraphics = this.add.graphics();
        bgGraphics.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x0f3460, 0x0f3460, 1);
        bgGraphics.fillRect(0, 0, width, height);

        // Başlık
        const title = this.add.text(width / 2, 150, '🔥 Fire vs Ice ❄️', {
            fontSize: '64px',
            fontFamily: 'Arial',
            fontStyle: 'bold',
            color: '#FFFFFF'
        });
        title.setOrigin(0.5);

        // Alt başlık
        const subtitle = this.add.text(width / 2, 220, 'Avalanche Strateji Savaşı', {
            fontSize: '24px',
            fontFamily: 'Arial',
            color: '#AAAAAA'
        });
        subtitle.setOrigin(0.5);

        // Başlat butonu
        this.createButton(width / 2, height / 2 + 50, 'Oyunu Başlat', () => {
            this.scene.start('GameScene', { team: 'fire', walletAddress: '' });
        });

        // Versiyon
        const version = this.add.text(width - 10, height - 10, 'v0.1.0 Alpha', {
            fontSize: '12px',
            fontFamily: 'Arial',
            color: '#666666'
        });
        version.setOrigin(1, 1);
    }

    createButton(x, y, text, callback) {
        const button = this.add.container(x, y);

        const bg = this.add.rectangle(0, 0, 250, 60, 0x4CAF50);
        bg.setStrokeStyle(3, 0x8BC34A);
        bg.setInteractive({ useHandCursor: true });

        const label = this.add.text(0, 0, text, {
            fontSize: '24px',
            fontFamily: 'Arial',
            color: '#FFFFFF'
        });
        label.setOrigin(0.5);

        button.add([bg, label]);

        bg.on('pointerover', () => {
            bg.setFillStyle(0x66BB6A);
            this.tweens.add({
                targets: button,
                scale: 1.05,
                duration: 100
            });
        });

        bg.on('pointerout', () => {
            bg.setFillStyle(0x4CAF50);
            this.tweens.add({
                targets: button,
                scale: 1,
                duration: 100
            });
        });

        bg.on('pointerdown', callback);

        return button;
    }
}

// Export
window.StartScene = StartScene;
