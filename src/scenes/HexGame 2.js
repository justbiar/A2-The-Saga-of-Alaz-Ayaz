// HexGame.js - Hexagon tabanlı strateji oyunu
// Ateş (üst) vs Buz (alt) adaları

class HexGameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'HexGameScene' });
        this.selectedTeam = null;
        this.units = [];
        this.selectedUnit = null;
        this.hexGrid = [];
        this.hexSize = 40;
        this.selectedHex = null;
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
        // Harita görselini ekle
        const map = this.add.image(600, 400, 'battleMap');
        map.setDisplaySize(1200, 800);
        map.setDepth(-10);
    }

    createHexMap() {
        const centerX = 600;
        const centerY = 400;
        const rows = 7;
        const cols = 9;
        
        // Hexagon boyutları
        const hexWidth = this.hexSize * 2;
        const hexHeight = this.hexSize * Math.sqrt(3);
        
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // Hexagon pozisyonu
                const xOffset = (row % 2) * (hexWidth * 0.75) / 2;
                const x = centerX - (cols * hexWidth * 0.75) / 2 + col * hexWidth * 0.75 + xOffset;
                const y = centerY - (rows * hexHeight) / 2 + row * hexHeight;
                
                // Hexagon türünü belirle (üst: ateş, alt: buz, orta: nötr)
                let hexType = 'neutral';
                if (y < centerY - 100) {
                    hexType = 'fire';
                } else if (y > centerY + 100) {
                    hexType = 'ice';
                }
                
                const hex = this.createHexagon(x, y, hexType, row, col);
                this.hexGrid.push(hex);
            }
        }
    }

    createHexagon(x, y, type, row, col) {
        const hex = this.add.container(x, y);
        
        // Hexagon çiz
        const graphics = this.add.graphics();
        
        // Renk
        let fillColor, strokeColor;
        if (type === 'fire') {
            fillColor = 0xFF6B35;
            strokeColor = 0xFF4500;
        } else if (type === 'ice') {
            fillColor = 0x89CFF0;
            strokeColor = 0x2196F3;
        } else {
            fillColor = 0x4CAF50;
            strokeColor = 0x2E7D32;
        }
        
        graphics.fillStyle(fillColor, 0.2); // Çok şeffaf
        graphics.lineStyle(2, strokeColor, 0.8);
        
        // Hexagon şekli
        const points = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            points.push({
                x: this.hexSize * Math.cos(angle),
                y: this.hexSize * Math.sin(angle)
            });
        }
        
        graphics.beginPath();
        graphics.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            graphics.lineTo(points[i].x, points[i].y);
        }
        graphics.closePath();
        graphics.fillPath();
        graphics.strokePath();
        
        hex.add(graphics);
        
        // Interactive zone
        const hitArea = new Phaser.Geom.Polygon(points);
        graphics.setInteractive(hitArea, Phaser.Geom.Polygon.Contains);
        
        graphics.on('pointerover', () => {
            graphics.clear();
            graphics.fillStyle(fillColor, 0.5); // Hover'da biraz daha belirgin
            graphics.lineStyle(3, 0xFFD700, 1);
            graphics.beginPath();
            graphics.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                graphics.lineTo(points[i].x, points[i].y);
            }
            graphics.closePath();
            graphics.fillPath();
            graphics.strokePath();
        });
        
        graphics.on('pointerout', () => {
            if (this.selectedHex !== hex) {
                graphics.clear();
                graphics.fillStyle(fillColor, 0.2);
                graphics.lineStyle(2, strokeColor, 0.8);
                graphics.beginPath();
                graphics.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    graphics.lineTo(points[i].x, points[i].y);
                }
                graphics.closePath();
                graphics.fillPath();
                graphics.strokePath();
            }
        });
        
        graphics.on('pointerdown', () => {
            this.onHexClick(hex);
        });
        
        // Hexagon verisi
        hex.hexData = {
            type: type,
            row: row,
            col: col,
            x: x,
            y: y,
            unit: null,
            graphics: graphics,
            points: points,
            fillColor: fillColor,
            strokeColor: strokeColor
        };
        
        hex.setDepth(1);
        return hex;
    }

    onHexClick(hex) {
        console.log('Hexagon tıklandı:', hex.hexData.row, hex.hexData.col);
        
        // Seçili ünite varsa, o hexagon'a hareket ettir
        if (this.selectedUnit && !hex.hexData.unit) {
            this.moveUnitToHex(this.selectedUnit, hex);
        }
        
        // O hexagon'da ünite varsa, seç
        if (hex.hexData.unit && !hex.hexData.unit.unitData.isEnemy) {
            this.selectUnit(hex.hexData.unit);
        }
        
        // Seçili hexagon'u işaretle
        this.selectedHex = hex;
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
        const controls = this.add.text(1000, 20, '🖱️ Hexagon tıkla: Seç/Hareket\nESC: İptal', {
            fontSize: '14px',
            color: '#FFFFFF',
            backgroundColor: '#000000',
            padding: { x: 10, y: 5 }
        });
        controls.setDepth(100);
    }

    spawnInitialUnits() {
        // Oyuncu üniteleri - Ateş tarafında (üstte)
        if (this.selectedTeam === 'fire') {
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
        unit.setInteractive(new Phaser.Geom.Circle(0, -20, 30), Phaser.Geom.Circle.Contains);
        
        // Statik sprite
        const charSprite = this.add.image(0, -20, 'playerChar');
        charSprite.setDisplaySize(50, 67);
        
        // Yürüme sprite
        const walkSprite = this.add.sprite(0, -20, 'walkAnim');
        walkSprite.setDisplaySize(50, 27);
        walkSprite.setVisible(false);
        
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
        unit.on('pointerdown', () => {
            if (!isEnemy) {
                this.selectUnit(unit);
            }
        });
        
        return unit;
    }

    selectUnit(unit) {
        if (this.selectedUnit) {
            this.selectedUnit.charSprite.clearTint();
            if (this.selectedUnit.unitData.isEnemy) {
                this.selectedUnit.charSprite.setTint(0x6666ff);
            }
        }
        
        this.selectedUnit = unit;
        unit.charSprite.setTint(0xFFFF00);
        console.log('Ünite seçildi:', unit.unitData.team);
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
                if (this.selectedUnit.unitData.isEnemy) {
                    this.selectedUnit.charSprite.setTint(0x6666ff);
                }
                this.selectedUnit = null;
            }
        });
    }

    moveUnitTo(unit, targetX, targetY) {
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
        const duration = (distance / 100) * 1000;
        
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
            }
        });
    }

    update() {
        // Gerekirse update işlemleri
    }
}

// Export
window.HexGameScene = HexGameScene;
