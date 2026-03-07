// HexGame.js - Temiz ve basit oyun
class HexGameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'HexGameScene' });
        this.units = [];
        this.selectedUnit = null;
    }

    init(data) {
        this.selectedTeam = data.team || 'fire';
        this.walletAddress = data.walletAddress || '';
    }

    preload() {
        this.load.image('battleMap', 'assets/images/MAP/5.png');
        this.load.image('playerChar', 'assets/images/gameplay/korhan.png');
        this.load.svg('tuplar', 'assets/images/characters/tuplar.svg', { width: 200, height: 200 });
        this.load.spritesheet('walkAnim', 'assets/images/gameplay/walk_spritesheet.png', {
            frameWidth: 96,
            frameHeight: 53
        });
    }

    create() {
        // Yürüme animasyonu
        this.anims.create({
            key: 'walk',
            frames: this.anims.generateFrameNumbers('walkAnim', { start: 0, end: 7 }),
            frameRate: 12,
            repeat: -1
        });
        
        // Sadece harita - tam ekran
        const map = this.add.image(600, 400, 'battleMap');
        map.setDisplaySize(1200, 800);
        
        // Üniteler
        this.spawnUnits();
        
        // Input
        this.input.on('pointerdown', (pointer) => {
            if (this.selectedUnit) {
                this.moveUnit(this.selectedUnit, pointer.x, pointer.y);
            }
        });
        
        this.input.keyboard.on('keydown-ESC', () => {
            if (this.selectedUnit) {
                this.selectedUnit.clearTint();
                this.selectedUnit = null;
            }
        });
    }

    spawnUnits() {
        // Ateş takımı - Korhan (üst)
        const fire1 = this.createUnit(400, 150, 'playerChar', false);
        const fire2 = this.createUnit(600, 150, 'playerChar', false);
        
        // Buz takımı - Tuplar (alt)  
        const ice1 = this.createUnit(400, 650, 'tuplar', true);
        const ice2 = this.createUnit(600, 650, 'tuplar', true);
        
        this.units.push(fire1, fire2, ice1, ice2);
    }

    createUnit(x, y, texture, isEnemy) {
        const unit = this.add.image(x, y, texture);
        unit.setScale(0.15);
        unit.setInteractive();
        unit.isEnemy = isEnemy;
        
        if (isEnemy) {
            unit.setTint(0x99ccff); // Hafif mavi ton
        }
        
        unit.on('pointerdown', (pointer) => {
            pointer.event.stopPropagation();
            if (!isEnemy) {
                if (this.selectedUnit) this.selectedUnit.clearTint();
                this.selectedUnit = unit;
                unit.setTint(0xffff00);
            }
        });
        
        return unit;
    }

    moveUnit(unit, x, y) {
        // Yön
        if (x < unit.x) {
            unit.setFlipX(true);
        } else {
            unit.setFlipX(false);
        }
        
        // Hareket
        this.tweens.add({
            targets: unit,
            x: x,
            y: y,
            duration: 1000,
            ease: 'Power2'
        });
    }
}

window.HexGameScene = HexGameScene;
