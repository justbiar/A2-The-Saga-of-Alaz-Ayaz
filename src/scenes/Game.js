// Game.js - Ana oyun sahnesi
// Buz vs Ateş strateji oyunu haritası

class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.selectedTeam = null;
        this.units = [];
        this.selectedUnit = null;
        this.mapWidth = 1200;
        this.mapHeight = 800;
    }

    init(data) {
        this.selectedTeam = data.team || 'fire';
        this.walletAddress = data.walletAddress || '';
    }

    preload() {
        // Karakter sprite'ını yükle
        this.load.image('playerChar', 'assets/images/gameplay/korhan.png');
        
        // Yürüme sprite sheet (8 kare, her biri 96x53)
        this.load.spritesheet('walkAnim', 'assets/images/gameplay/walk_spritesheet.png', {
            frameWidth: 96,
            frameHeight: 53
        });
        
        console.log('🎮 GameScene preload tamamlandı');
    }

    createMapTextures() {
        // Ateş bölgesi texture
        const fireGraphics = this.make.graphics({ x: 0, y: 0, add: false });
        fireGraphics.fillStyle(0x8B0000);
        fireGraphics.fillRect(0, 0, 600, 800);
        // Lav efekti
        fireGraphics.fillStyle(0xFF4500, 0.6);
        for (let i = 0; i < 20; i++) {
            fireGraphics.fillCircle(
                Phaser.Math.Between(50, 550),
                Phaser.Math.Between(50, 750),
                Phaser.Math.Between(20, 60)
            );
        }
        fireGraphics.generateTexture('fireLand', 600, 800);

        // Buz bölgesi texture
        const iceGraphics = this.make.graphics({ x: 0, y: 0, add: false });
        iceGraphics.fillStyle(0x1E3A5F);
        iceGraphics.fillRect(0, 0, 600, 800);
        // Kar efekti
        iceGraphics.fillStyle(0x89CFF0, 0.5);
        for (let i = 0; i < 25; i++) {
            iceGraphics.fillCircle(
                Phaser.Math.Between(50, 550),
                Phaser.Math.Between(50, 750),
                Phaser.Math.Between(15, 40)
            );
        }
        iceGraphics.generateTexture('iceLand', 600, 800);

        // Floating island (havada uçan ada)
        this.createFloatingIslandTexture();

        // Ateş karakteri
        const fireUnitGraphics = this.make.graphics({ x: 0, y: 0, add: false });
        fireUnitGraphics.fillStyle(0xFF6B35);
        fireUnitGraphics.fillCircle(25, 25, 20);
        fireUnitGraphics.fillStyle(0xFFD700);
        fireUnitGraphics.fillCircle(25, 20, 8);
        // Ateş efekti
        fireUnitGraphics.fillStyle(0xFF4500);
        fireUnitGraphics.fillTriangle(25, 5, 15, 20, 35, 20);
        fireUnitGraphics.generateTexture('fireUnit', 50, 50);

        // Buz karakteri
        const iceUnitGraphics = this.make.graphics({ x: 0, y: 0, add: false });
        iceUnitGraphics.fillStyle(0x89CFF0);
        iceUnitGraphics.fillCircle(25, 25, 20);
        iceUnitGraphics.fillStyle(0xFFFFFF);
        iceUnitGraphics.fillCircle(25, 20, 8);
        // Buz kristal efekti
        iceUnitGraphics.fillStyle(0x2196F3);
        iceUnitGraphics.fillTriangle(25, 5, 18, 18, 32, 18);
        iceUnitGraphics.generateTexture('iceUnit', 50, 50);

        // Seçim halkası
        const selectGraphics = this.make.graphics({ x: 0, y: 0, add: false });
        selectGraphics.lineStyle(3, 0xFFD700);
        selectGraphics.strokeCircle(30, 30, 28);
        selectGraphics.generateTexture('selectRing', 60, 60);
    }

    createFloatingIslandTexture() {
        const islandGraphics = this.make.graphics({ x: 0, y: 0, add: false });
        
        // Ana ada gövdesi - üst kısım (çim/toprak)
        islandGraphics.fillStyle(0x4A4A4A);
        islandGraphics.fillRoundedRect(50, 100, 500, 150, 20);
        
        // Alt kısım (kaya)
        islandGraphics.fillStyle(0x3D3D3D);
        islandGraphics.beginPath();
        islandGraphics.moveTo(100, 250);
        islandGraphics.lineTo(200, 400);
        islandGraphics.lineTo(400, 420);
        islandGraphics.lineTo(500, 250);
        islandGraphics.closePath();
        islandGraphics.fillPath();
        
        // Orta çizgi (savaş hattı)
        islandGraphics.lineStyle(4, 0xFFD700);
        islandGraphics.lineBetween(300, 100, 300, 250);
        
        islandGraphics.generateTexture('floatingIsland', 600, 450);
    }

    create() {
        console.log('🎮 GameScene create başladı');
        
        // Texture'ları oluştur
        this.createMapTextures();
        
        // Yürüme animasyonu tanımla
        this.anims.create({
            key: 'walk',
            frames: this.anims.generateFrameNumbers('walkAnim', { start: 0, end: 7 }),
            frameRate: 12,
            repeat: -1
        });
        
        // Kamera ve dünya sınırları
        this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);
        
        // Arka plan gradient
        this.createBackground();
        
        // Havada uçan ana ada
        this.createFloatingIsland();
        
        // UI elemanları
        this.createUI();
        
        // Başlangıç üniteleri
        this.spawnInitialUnits();
        
        // Input kontrolları
        this.setupInput();
        
        // Parallax yıldızlar
        this.createStars();
        
        console.log('✅ GameScene create tamamlandı');
    }

    createBackground() {
        // Derin uzay arka planı
        const bgGraphics = this.add.graphics();
        bgGraphics.fillGradientStyle(0x0a0a20, 0x0a0a20, 0x1a1a40, 0x1a1a40, 1);
        bgGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);
    }

    createStars() {
        // Arka planda yıldızlar
        for (let i = 0; i < 100; i++) {
            const star = this.add.circle(
                Phaser.Math.Between(0, this.mapWidth),
                Phaser.Math.Between(0, this.mapHeight),
                Phaser.Math.Between(1, 3),
                0xFFFFFF,
                Phaser.Math.FloatBetween(0.3, 1)
            );
            star.setDepth(-10);
            
            // Yıldız parıltısı
            this.tweens.add({
                targets: star,
                alpha: { from: star.alpha, to: star.alpha * 0.3 },
                duration: Phaser.Math.Between(1000, 3000),
                yoyo: true,
                repeat: -1
            });
        }
    }

    createFloatingIsland() {
        // Ana yüzen ada
        this.island = this.add.container(this.mapWidth / 2, this.mapHeight / 2);
        
        // Ada gölgesi
        const shadow = this.add.ellipse(0, 200, 700, 100, 0x000000, 0.3);
        this.island.add(shadow);
        
        // Ateş tarafı (sol)
        const fireZone = this.add.rectangle(-200, 0, 350, 300, 0x8B0000);
        fireZone.setStrokeStyle(3, 0xFF4500);
        this.island.add(fireZone);
        
        // Volkan detayı
        const volcano = this.createVolcano();
        volcano.setPosition(-200, -100);
        this.island.add(volcano);
        
        // Buz tarafı (sağ)
        const iceZone = this.add.rectangle(200, 0, 350, 300, 0x1E3A5F);
        iceZone.setStrokeStyle(3, 0x89CFF0);
        this.island.add(iceZone);
        
        // Buz dağı detayı
        const iceMountain = this.createIceMountain();
        iceMountain.setPosition(200, -80);
        this.island.add(iceMountain);
        
        // Orta köprü/savaş alanı
        const battleZone = this.add.rectangle(0, 0, 100, 300, 0x4A4A4A);
        battleZone.setStrokeStyle(4, 0xFFD700);
        this.island.add(battleZone);
        
        // Orta sembol
        const centerSymbol = this.add.text(0, 0, '⚔️', { fontSize: '40px' });
        centerSymbol.setOrigin(0.5);
        this.island.add(centerSymbol);
        
        // Ada'yı havada yüzdür
        this.tweens.add({
            targets: this.island,
            y: this.mapHeight / 2 + 20,
            duration: 3000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // Ada altı kayalar
        this.createFloatingRocks();
    }

    createVolcano() {
        const container = this.add.container(0, 0);
        
        // Volkan gövdesi
        const volcanoGraphics = this.add.graphics();
        volcanoGraphics.fillStyle(0x4A4A4A);
        volcanoGraphics.fillTriangle(0, -80, -60, 40, 60, 40);
        volcanoGraphics.fillStyle(0x3D3D3D);
        volcanoGraphics.fillTriangle(0, -60, -40, 40, 40, 40);
        
        container.add(volcanoGraphics);
        
        // Lav parçacıkları
        for (let i = 0; i < 5; i++) {
            const lava = this.add.circle(
                Phaser.Math.Between(-20, 20),
                Phaser.Math.Between(-70, -50),
                Phaser.Math.Between(3, 8),
                0xFF4500
            );
            container.add(lava);
            
            // Lav animasyonu
            this.tweens.add({
                targets: lava,
                y: lava.y - 30,
                alpha: 0,
                duration: 1500,
                repeat: -1,
                delay: i * 300
            });
        }
        
        return container;
    }

    createIceMountain() {
        const container = this.add.container(0, 0);
        
        // Buz dağı
        const mountainGraphics = this.add.graphics();
        mountainGraphics.fillStyle(0x89CFF0);
        mountainGraphics.fillTriangle(0, -80, -70, 50, 70, 50);
        mountainGraphics.fillStyle(0xFFFFFF);
        mountainGraphics.fillTriangle(0, -80, -30, -20, 30, -20);
        
        container.add(mountainGraphics);
        
        // Kar parçacıkları
        for (let i = 0; i < 8; i++) {
            const snow = this.add.circle(
                Phaser.Math.Between(-50, 50),
                Phaser.Math.Between(-60, 40),
                Phaser.Math.Between(2, 5),
                0xFFFFFF,
                0.8
            );
            container.add(snow);
            
            // Kar animasyonu
            this.tweens.add({
                targets: snow,
                y: snow.y + 50,
                alpha: 0,
                duration: 2000,
                repeat: -1,
                delay: i * 250
            });
        }
        
        return container;
    }

    createFloatingRocks() {
        // Ada etrafında küçük uçan kayalar
        const rockPositions = [
            { x: -450, y: 100 },
            { x: 450, y: 80 },
            { x: -350, y: 250 },
            { x: 380, y: 220 },
            { x: -200, y: 280 },
            { x: 250, y: 300 }
        ];

        rockPositions.forEach((pos, i) => {
            const rock = this.add.ellipse(
                this.mapWidth / 2 + pos.x,
                this.mapHeight / 2 + pos.y,
                Phaser.Math.Between(30, 60),
                Phaser.Math.Between(20, 40),
                i < 3 ? 0x5D4037 : 0x607D8B
            );
            rock.setDepth(-1);
            
            this.tweens.add({
                targets: rock,
                y: rock.y + Phaser.Math.Between(-15, 15),
                duration: Phaser.Math.Between(2000, 4000),
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        });
    }

    createUI() {
        // Üst bilgi paneli
        const uiContainer = this.add.container(10, 10);
        uiContainer.setScrollFactor(0);
        uiContainer.setDepth(100);

        // Panel arka planı
        const panel = this.add.rectangle(0, 0, 300, 80, 0x000000, 0.7);
        panel.setOrigin(0, 0);
        panel.setStrokeStyle(2, this.selectedTeam === 'fire' ? 0xFF6B35 : 0x89CFF0);
        uiContainer.add(panel);

        // Takım ikonu ve ismi
        const teamIcon = this.selectedTeam === 'fire' ? '🔥' : '❄️';
        const teamName = this.selectedTeam === 'fire' ? 'Ateş Ordusu' : 'Buz Ordusu';
        
        const teamText = this.add.text(15, 15, `${teamIcon} ${teamName}`, {
            fontSize: '18px',
            fontFamily: 'Arial',
            color: this.selectedTeam === 'fire' ? '#FF6B35' : '#89CFF0'
        });
        uiContainer.add(teamText);

        // Cüzdan adresi (kısaltılmış)
        const shortAddress = this.walletAddress ? 
            `${this.walletAddress.slice(0, 6)}...${this.walletAddress.slice(-4)}` : 
            'Bağlı Değil';
        
        const walletText = this.add.text(15, 45, `💳 ${shortAddress}`, {
            fontSize: '14px',
            fontFamily: 'Arial',
            color: '#AAAAAA'
        });
        uiContainer.add(walletText);

        // Sağ üst - Kontroller
        const controlsPanel = this.add.container(this.mapWidth - 160, 10);
        controlsPanel.setScrollFactor(0);
        controlsPanel.setDepth(100);

        const controlsBg = this.add.rectangle(0, 0, 150, 60, 0x000000, 0.7);
        controlsBg.setOrigin(0, 0);
        controlsPanel.add(controlsBg);

        const controlsText = this.add.text(10, 10, '🖱️ Seç: Tıkla\n🎯 Hareket: Sağ Tık', {
            fontSize: '12px',
            fontFamily: 'Arial',
            color: '#FFFFFF'
        });
        controlsPanel.add(controlsText);

        // Alt bilgi paneli - Ünite bilgisi
        this.unitInfoPanel = this.add.container(10, this.mapHeight - 100);
        this.unitInfoPanel.setScrollFactor(0);
        this.unitInfoPanel.setDepth(100);
        this.unitInfoPanel.setVisible(false);

        const unitInfoBg = this.add.rectangle(0, 0, 200, 90, 0x000000, 0.8);
        unitInfoBg.setOrigin(0, 0);
        this.unitInfoPanel.add(unitInfoBg);

        this.unitInfoText = this.add.text(10, 10, '', {
            fontSize: '14px',
            fontFamily: 'Arial',
            color: '#FFFFFF',
            lineSpacing: 5
        });
        this.unitInfoPanel.add(this.unitInfoText);
    }

    spawnInitialUnits() {
        // Oyuncunun takımına göre ünite oluştur
        const isFireTeam = this.selectedTeam === 'fire';
        const startX = isFireTeam ? 
            this.mapWidth / 2 - 250 : 
            this.mapWidth / 2 + 250;

        // 2 başlangıç ünitesi (daha az, daha düzenli)
        for (let i = 0; i < 2; i++) {
            const unit = this.createUnit(
                startX,
                this.mapHeight / 2 - 60 + (i * 120), // Dikey sıralı
                this.selectedTeam
            );
            this.units.push(unit);
        }

        // Düşman üniteleri (AI)
        const enemyTeam = isFireTeam ? 'ice' : 'fire';
        const enemyStartX = isFireTeam ? 
            this.mapWidth / 2 + 250 : 
            this.mapWidth / 2 - 250;

        for (let i = 0; i < 2; i++) {
            const enemy = this.createUnit(
                enemyStartX,
                this.mapHeight / 2 - 60 + (i * 120), // Dikey sıralı
                enemyTeam,
                true
            );
            this.units.push(enemy);
        }
    }

    createUnit(x, y, team, isEnemy = false) {
        // Karakter container'ı oluştur (animasyon için)
        const unitContainer = this.add.container(x, y);
        unitContainer.setDepth(10);
        
        // Statik karakter sprite'ı (idle durumu)
        const charSprite = this.add.image(0, 0, 'playerChar');
        charSprite.setDisplaySize(64, 85);
        charSprite.setVisible(true);
        
        // Yürüme animasyonu sprite'ı
        const walkSprite = this.add.sprite(0, 0, 'walkAnim');
        walkSprite.setDisplaySize(64, 35);
        walkSprite.setVisible(false);
        
        // Düşman ise farklı renk tonu
        if (isEnemy) {
            charSprite.setTint(0x6666ff);
            walkSprite.setTint(0x6666ff);
            charSprite.setFlipX(true);
            walkSprite.setFlipX(true);
        }
        
        unitContainer.add(charSprite);
        unitContainer.add(walkSprite);
        
        // Gölge efekti
        const shadow = this.add.ellipse(0, 38, 35, 12, 0x000000, 0.4);
        unitContainer.add(shadow);
        unitContainer.sendToBack(shadow);
        
        // Interactive zone
        const hitArea = this.add.rectangle(0, 0, 64, 85, 0xffffff, 0);
        hitArea.setInteractive();
        unitContainer.add(hitArea);
        
        // Ünite verileri
        unitContainer.unitData = {
            team: team,
            isEnemy: isEnemy,
            health: 100,
            maxHealth: 100,
            attack: team === 'fire' ? 15 : 12,
            defense: team === 'fire' ? 8 : 12,
            speed: team === 'fire' ? 120 : 100,
            name: team === 'fire' ? 'Ateş Savaşçısı' : 'Buz Savaşçısı',
            isWalking: false
        };
        
        // Sprite referansları
        unitContainer.charSprite = charSprite;
        unitContainer.walkSprite = walkSprite;
        unitContainer.shadow = shadow;

        // Sağlık barı
        const healthBar = this.add.graphics();
        this.updateHealthBar(healthBar, unitContainer);
        unitContainer.healthBar = healthBar;

        // Seçim halkası (başlangıçta gizli)
        const selectRing = this.add.image(x, y, 'selectRing');
        selectRing.setVisible(false);
        selectRing.setDepth(9);
        selectRing.setScale(1.2);
        unitContainer.selectRing = selectRing;

        // Hover efekti
        hitArea.on('pointerover', () => {
            charSprite.setScale(1.05);
            walkSprite.setScale(1.05);
            this.showUnitInfo(unitContainer);
        });

        hitArea.on('pointerout', () => {
            charSprite.setScale(1);
            walkSprite.setScale(1);
            if (this.selectedUnit !== unitContainer) {
                this.unitInfoPanel.setVisible(false);
            }
        });

        // Tıklama
        hitArea.on('pointerdown', () => {
            if (!isEnemy) {
                this.selectUnit(unitContainer);
            }
        });

        // İdle animasyonu (hafif nefes alma efekti)
        this.tweens.add({
            targets: charSprite,
            scaleY: 1.02,
            y: -2,
            duration: 1500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        return unitContainer;
    }
    
    // Yürüme animasyonu başlat
    startWalkAnimation(unit) {
        if (unit.unitData.isWalking) return;
        unit.unitData.isWalking = true;
        
        // Statik sprite'ı gizle, animasyonlu sprite'ı göster
        unit.charSprite.setVisible(false);
        unit.walkSprite.setVisible(true);
        unit.walkSprite.play('walk');
        
        // Mevcut idle tweenleri durdur
        this.tweens.killTweensOf(unit.charSprite);
    }
    
    // Yürüme animasyonunu durdur
    stopWalkAnimation(unit) {
        if (!unit.unitData.isWalking) return;
        unit.unitData.isWalking = false;
        
        // Animasyonu durdur, statik sprite'ı göster
        unit.walkSprite.stop();
        unit.walkSprite.setVisible(false);
        unit.charSprite.setVisible(true);
        
        // İdle animasyonunu yeniden başlat
        this.tweens.add({
            targets: unit.charSprite,
            scaleY: 1.02,
            y: -2,
            duration: 1500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    updateHealthBar(healthBar, unit) {
        healthBar.clear();
        
        const width = 40;
        const height = 6;
        const x = unit.x - width / 2;
        const y = unit.y - 35;
        
        // Arka plan
        healthBar.fillStyle(0x333333);
        healthBar.fillRect(x, y, width, height);
        
        // Sağlık
        const healthPercent = unit.unitData.health / unit.unitData.maxHealth;
        const healthColor = healthPercent > 0.5 ? 0x00FF00 : 
                           healthPercent > 0.25 ? 0xFFFF00 : 0xFF0000;
        healthBar.fillStyle(healthColor);
        healthBar.fillRect(x, y, width * healthPercent, height);
        
        // Çerçeve
        healthBar.lineStyle(1, 0xFFFFFF);
        healthBar.strokeRect(x, y, width, height);
    }

    selectUnit(unit) {
        // Önceki seçimi kaldır
        if (this.selectedUnit) {
            this.selectedUnit.selectRing.setVisible(false);
        }

        this.selectedUnit = unit;
        unit.selectRing.setVisible(true);
        
        // Seçim animasyonu
        this.tweens.add({
            targets: unit.selectRing,
            angle: 360,
            duration: 2000,
            repeat: -1
        });

        this.showUnitInfo(unit);
    }

    showUnitInfo(unit) {
        const data = unit.unitData;
        const teamIcon = data.team === 'fire' ? '🔥' : '❄️';
        
        this.unitInfoText.setText(
            `${teamIcon} ${data.name}\n` +
            `❤️ HP: ${data.health}/${data.maxHealth}\n` +
            `⚔️ Saldırı: ${data.attack}\n` +
            `🛡️ Savunma: ${data.defense}`
        );
        
        this.unitInfoPanel.setVisible(true);
    }

    setupInput() {
        // Sağ tıklama ile hareket
        this.input.on('pointerdown', (pointer) => {
            if (pointer.rightButtonDown() && this.selectedUnit) {
                this.moveUnitTo(this.selectedUnit, pointer.worldX, pointer.worldY);
            }
        });

        // ESC ile seçimi iptal
        this.input.keyboard.on('keydown-ESC', () => {
            if (this.selectedUnit) {
                this.selectedUnit.selectRing.setVisible(false);
                this.selectedUnit = null;
                this.unitInfoPanel.setVisible(false);
            }
        });

        // Kamera kontrolü
        this.input.on('pointermove', (pointer) => {
            if (pointer.isDown && pointer.middleButtonDown()) {
                this.cameras.main.scrollX -= pointer.velocity.x / 10;
                this.cameras.main.scrollY -= pointer.velocity.y / 10;
            }
        });
    }

    moveUnitTo(unit, x, y) {
        // Hareket animasyonu
        const distance = Phaser.Math.Distance.Between(unit.x, unit.y, x, y);
        const duration = (distance / unit.unitData.speed) * 1000;

        // Yönü belirle ve karakteri döndür
        if (x < unit.x) {
            unit.charSprite.setFlipX(true);
        } else {
            unit.charSprite.setFlipX(false);
        }

        // Hareket göstergesi
        const indicator = this.add.circle(x, y, 10, 0xFFD700, 0.5);
        this.tweens.add({
            targets: indicator,
            alpha: 0,
            scale: 2,
            duration: 500,
            onComplete: () => indicator.destroy()
        });

        // Yürüme animasyonunu başlat
        this.startWalkAnimation(unit);

        // Üniteyi hareket ettir
        this.tweens.add({
            targets: unit,
            x: x,
            y: y,
            duration: duration,
            ease: 'Power2',
            onUpdate: () => {
                // Sağlık barını güncelle
                this.updateHealthBar(unit.healthBar, unit);
                // Seçim halkasını güncelle
                unit.selectRing.setPosition(unit.x, unit.y);
            },
            onComplete: () => {
                // Yürüme animasyonunu durdur
                this.stopWalkAnimation(unit);
            }
        });
    }

    update(time, delta) {
        // Sağlık barlarını güncelle
        this.units.forEach(unit => {
            if (unit.active) {
                this.updateHealthBar(unit.healthBar, unit);
                unit.selectRing.setPosition(unit.x, unit.y);
            }
        });
    }
}

// Export
window.GameScene = GameScene;
