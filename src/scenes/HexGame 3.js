// HexGame.js - Basit tıkla-hareket sistemi
// Ateş vs Buz savaşı

class HexGameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'HexGameScene' });
        this.selectedTeam = null;
        this.units = [];
        this.selectedUnit = null;
    }

    init(data) {
        this.selectedTeam = data.team || 'fire';
        this.walletAddress = data.walletAddress || '';
    }

    preload() {
        // Harita görseli
        this.load.image('battleMap', 'assets/images/MAP/5.png');
        
        // Karakter görselleri
        this.load.image('playerChar', 'assets/images/gameplay/korhan.png');
        
        // Yürüme sprite sheet
        this.load.spritesheet('walkAnim', 'assets/images/gameplay/walk_spritesheet.png', {
            frameWidth: 96,
            frameHeight: 53
        });
        
        console.log('🎮 HexGameScene preload tamamlandı');
    }

    create() {
        console.log('🎮 HexGameScene create başladı');
        
        // Anti-aliasing ve smooth rendering
        this.game.renderer.antialias = true;
        
        // Yürüme animasyonu
        this.anims.create({
            key: 'walk',
            frames: this.anims.generateFrameNumbers('walkAnim', { start: 0, end: 7 }),
            frameRate: 12,
            repeat: -1
        });
        
        // Arka plan harita
        this.createBackground();
        
        // UI
        this.createUI();
        
        // Başlangıç üniteleri
        this.spawnInitialUnits();
        
        // Input
        this.setupInput();
        
        console.log('✅ HexGameScene create tamamlandı');
    }

    createBackground() {
        // Ana gökyüzü gradient
        const sky = this.add.graphics();
        sky.fillGradientStyle(0x4A1E1A, 0xFF6B35, 0x4682B4, 0x1E3A5F, 1);
        sky.fillRect(0, 0, 1200, 800);
        sky.setDepth(-100);
        
        // Volumetric bulutlar (çok daha fazla, daha gerçekçi)
        this.createVolumetricClouds(-80, 25, 'back');   // En uzak katman
        this.createVolumetricClouds(-60, 20, 'mid');    // Orta katman
        this.createVolumetricClouds(-40, 15, 'front');  // Ön katman
        
        // Işık ışınları (god rays)
        this.createLightRays();
        
        // Parıldayan partiküller
        this.createParticles();
        
        // Harita (hafif şeffaf)
        const map = this.add.image(600, 400, 'battleMap');
        map.setDisplaySize(1200, 800);
        map.setAlpha(0.85);
        map.setDepth(-10);
        map.setOrigin(0.5, 0.5);
        
        // Smooth texture
        map.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    
    createVolumetricClouds(depth, count, layer) {
        const colors = {
            back: { main: 0xFFE5CC, shadow: 0xFFB88C, alpha: 0.3 },
            mid: { main: 0xFFFFFF, shadow: 0xE8E8E8, alpha: 0.5 },
            front: { main: 0xF0F8FF, shadow: 0xCCE5FF, alpha: 0.7 }
        };
        
        const config = colors[layer];
        
        for (let i = 0; i < count; i++) {
            const x = Phaser.Math.Between(-100, 1300);
            const y = Phaser.Math.Between(0, 800);
            
            // Her bulut birden fazla ellipse'den oluşsun (volumetric)
            const cloudGroup = this.add.container(x, y);
            cloudGroup.setDepth(depth);
            
            const parts = Phaser.Math.Between(3, 6);
            for (let j = 0; j < parts; j++) {
                const offsetX = Phaser.Math.Between(-60, 60);
                const offsetY = Phaser.Math.Between(-30, 30);
                const width = Phaser.Math.Between(80, 180);
                const height = Phaser.Math.Between(40, 90);
                
                // Ana bulut
                const cloudPart = this.add.ellipse(offsetX, offsetY, width, height, config.main, config.alpha);
                cloudGroup.add(cloudPart);
                
                // Gölge efekti
                const shadow = this.add.ellipse(offsetX + 5, offsetY + 5, width * 0.9, height * 0.9, config.shadow, config.alpha * 0.5);
                cloudGroup.add(shadow);
            }
            
            // Bulut hareketi (çok yavaş, smooth)
            const speed = Phaser.Math.Between(20000, 40000);
            const drift = Phaser.Math.Between(100, 300);
            
            this.tweens.add({
                targets: cloudGroup,
                x: x + drift,
                y: y + Phaser.Math.Between(-20, 20),
                duration: speed,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
            
            // Alpha breathing
            this.tweens.add({
                targets: cloudGroup,
                alpha: { from: 0.6, to: 1 },
                duration: Phaser.Math.Between(4000, 8000),
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        }
    }
    
    createLightRays() {
        // Merkeze doğru ışık ışınları
        const rays = this.add.graphics();
        rays.setDepth(-70);
        
        const centerX = 600;
        const centerY = 250;
        
        for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 / 8) * i;
            const length = 400;
            const endX = centerX + Math.cos(angle) * length;
            const endY = centerY + Math.sin(angle) * length;
            
            rays.lineStyle(60, 0xFFD700, 0.1);
            rays.lineBetween(centerX, centerY, endX, endY);
        }
        
        // Işınlar dönsün
        this.tweens.add({
            targets: rays,
            angle: 360,
            duration: 30000,
            repeat: -1,
            ease: 'Linear'
        });
    }
    
    createParticles() {
        // Havada uçuşan partiküller
        for (let i = 0; i < 30; i++) {
            const particle = this.add.circle(
                Phaser.Math.Between(0, 1200),
                Phaser.Math.Between(0, 800),
                Phaser.Math.Between(1, 3),
                0xFFFFFF,
                Phaser.Math.FloatBetween(0.3, 0.8)
            );
            particle.setDepth(-20);
            
            // Rastgele hareket
            this.tweens.add({
                targets: particle,
                x: particle.x + Phaser.Math.Between(-200, 200),
                y: particle.y + Phaser.Math.Between(-300, 300),
                alpha: { from: particle.alpha, to: 0 },
                duration: Phaser.Math.Between(5000, 10000),
                repeat: -1,
                yoyo: true,
                ease: 'Sine.easeInOut'
            });
        }
    }

    createUI() {
        // Üst panel
        const panel = this.add.container(10, 10);
        panel.setScrollFactor(0);
        panel.setDepth(100);

        const bg = this.add.rectangle(0, 0, 300, 80, 0x000000, 0.7);
        bg.setOrigin(0, 0);
        panel.add(bg);

        const teamIcon = this.selectedTeam === 'fire' ? '🔥' : '❄️';
        const teamName = this.selectedTeam === 'fire' ? 'Ateş Ordusu' : 'Buz Ordusu';
        
        const text = this.add.text(15, 15, `${teamIcon} ${teamName}\n💳 ${this.walletAddress.slice(0, 10)}...`, {
            fontSize: '16px',
            color: '#FFFFFF'
        });
        panel.add(text);

        // Kontroller
        const controls = this.add.text(850, 20, '1. Karaktere tıkla\n2. Gitmek istediğin yere tıkla\nESC: İptal', {
            fontSize: '14px',
            color: '#FFFFFF',
            backgroundColor: '#000000',
            padding: { x: 10, y: 5 }
        });
        controls.setDepth(100);
    }

    spawnInitialUnits() {
        // Oyuncu üniteleri
        if (this.selectedTeam === 'fire') {
            // Ateş tarafında (üstte)
            const unit1 = this.createUnit(350, 120, 'fire', false);
            const unit2 = this.createUnit(550, 120, 'fire', false);
            this.units.push(unit1, unit2);
            
            // Düşman - Buz tarafında (altta)
            const enemy1 = this.createUnit(350, 680, 'ice', true);
            const enemy2 = this.createUnit(550, 680, 'ice', true);
            this.units.push(enemy1, enemy2);
        } else {
            // Oyuncu buz tarafında
            const unit1 = this.createUnit(350, 680, 'ice', false);
            const unit2 = this.createUnit(550, 680, 'ice', false);
            this.units.push(unit1, unit2);
            
            // Düşman ateş tarafında
            const enemy1 = this.createUnit(350, 120, 'fire', true);
            const enemy2 = this.createUnit(550, 120, 'fire', true);
            this.units.push(enemy1, enemy2);
        }
    }

    createUnit(x, y, team, isEnemy = false) {
        const unit = this.add.container(x, y);
        unit.setDepth(10);
        unit.setSize(60, 80);
        unit.setInteractive();
        
        // Statik sprite
        const charSprite = this.add.image(0, -20, 'playerChar');
        charSprite.setDisplaySize(50, 67);
        charSprite.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
        
        // Yürüme sprite
        const walkSprite = this.add.sprite(0, -20, 'walkAnim');
        walkSprite.setDisplaySize(50, 27);
        walkSprite.setVisible(false);
        walkSprite.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
        
        if (isEnemy) {
            charSprite.setTint(0x6666ff);
            walkSprite.setTint(0x6666ff);
        }
        
        unit.add(charSprite);
        unit.add(walkSprite);
        
        // Gölge
        const shadow = this.add.ellipse(0, 15, 30, 10, 0x000000, 0.5);
        unit.add(shadow);
        unit.sendToBack(shadow);
        
        unit.unitData = {
            team: team,
            isEnemy: isEnemy,
            health: 100,
            maxHealth: 100
        };
        
        unit.charSprite = charSprite;
        unit.walkSprite = walkSprite;
        
        // Ünite tıklama
        unit.on('pointerdown', (pointer) => {
            pointer.event.stopPropagation();
            if (!isEnemy) {
                this.selectUnit(unit);
            }
        });
        
        return unit;
    }

    selectUnit(unit) {
        // Önceki seçimi temizle
        if (this.selectedUnit) {
            this.selectedUnit.charSprite.clearTint();
            if (this.selectedUnit.unitData.team === 'ice') {
                this.selectedUnit.charSprite.setTint(0x6666ff);
            }
        }
        
        this.selectedUnit = unit;
        unit.charSprite.setTint(0xFFFF00); // Sarı highlight
        console.log('✅ Ünite seçildi:', unit.unitData.team);
    }

    setupInput() {
        // Haritaya tıklayınca seçili üniteyi oraya gönder
        this.input.on('pointerdown', (pointer) => {
            if (this.selectedUnit) {
                this.moveUnitTo(this.selectedUnit, pointer.worldX, pointer.worldY);
            }
        });
        
        // ESC ile seçimi iptal
        this.input.keyboard.on('keydown-ESC', () => {
            if (this.selectedUnit) {
                this.selectedUnit.charSprite.clearTint();
                if (this.selectedUnit.unitData.team === 'ice') {
                    this.selectedUnit.charSprite.setTint(0x6666ff);
                }
                this.selectedUnit = null;
                console.log('❌ Seçim iptal edildi');
            }
        });
    }

    moveUnitTo(unit, targetX, targetY) {
        console.log(`🚶 ${unit.unitData.team} hareket ediyor: (${unit.x}, ${unit.y}) -> (${targetX}, ${targetY})`);
        
        // Yürüme animasyonu başlat
        unit.charSprite.setVisible(false);
        unit.walkSprite.setVisible(true);
        unit.walkSprite.play('walk');
        
        // Yönü belirle
        if (targetX < unit.x) {
            unit.walkSprite.setFlipX(true);
        } else {
            unit.walkSprite.setFlipX(false);
        }
        
        // Hareket tween
        const distance = Phaser.Math.Distance.Between(unit.x, unit.y, targetX, targetY);
        const duration = (distance / 100) * 1000; // 100 piksel/saniye
        
        this.tweens.add({
            targets: unit,
            x: targetX,
            y: targetY,
            duration: duration,
            ease: 'Linear',
            onComplete: () => {
                // Animasyonu durdur
                unit.walkSprite.stop();
                unit.walkSprite.setVisible(false);
                unit.charSprite.setVisible(true);
                console.log('✅ Hareket tamamlandı');
            }
        });
    }

    update() {
        // Gerekirse update işlemleri
    }
}

// Export
window.HexGameScene = HexGameScene;
