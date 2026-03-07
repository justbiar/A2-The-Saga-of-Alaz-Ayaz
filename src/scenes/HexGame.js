// HexGame.js - Hexagon Kart Strateji Oyunu
class HexGameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'HexGameScene' });
        this.hexGrid = [];
        this.cards = [];
        this.selectedCard = null;
        this.playerMana = 6;
        this.enemyMana = 6;
        this.isPlayerTurn = true;
    }

    init(data) {
        this.selectedTeam = data.team || 'fire';
        this.walletAddress = data.walletAddress || '';
    }

    preload() {
        // Görseller
        this.load.image('battleMap', 'assets/images/MAP/5.png');
        this.load.image('korhan', 'assets/images/gameplay/korhan.png');
        this.load.svg('tuplar', 'assets/images/characters/tuplar.svg', { width: 200, height: 200 });
    }

    create() {
        // Arka plan - koyu
        this.add.rectangle(600, 400, 1200, 800, 0x1a1a2e);
        
        // Harita görseli - geniş
        const map = this.add.image(600, 400, 'battleMap');
        map.setDisplaySize(600, 700);
        map.setDepth(0);
        
        // Hexagon harita (ortada - AVAX şekli, şeffaf)
        this.createHexBoard();
        
        // Sol üst - Oyuncu 1 profili
        this.createPlayerProfile(20, 20, 'P1', this.enemyMana, true);
        
        // Sol alt - Oyuncu 2 profili (sen)
        this.createPlayerProfile(20, 620, 'P2', this.playerMana, false);
        
        // Sağ panel - Kart detayı
        this.createCardDetailPanel();
        
        // Alt - Kart eli
        this.createCardHand();
        
        // Sağ alt - End Turn butonu
        this.createEndTurnButton();
        
        // Başlangıç üniteleri
        this.placeStartingUnits();
    }

    createHexBoard() {
        const centerX = 600;
        const centerY = 400;
        const hexSize = 40;
        const spacingX = 70; // Yatay mesafe
        const spacingY = 60; // Dikey mesafe
        
        // ÜST ÜÇGEN (Ateş) - haritanın üst yarısına otur
        const fireHexes = [
            // Satır 1 - 2 hex (en üst)
            { y: -145, cols: [-0.5, 0.5] },
            // Satır 2 - 3 hex  
            { y: -85, cols: [-1, 0, 1] },
            // Satır 3 - 4 hex (en geniş)
            { y: -25, cols: [-1.5, -0.5, 0.5, 1.5] },
        ];
        
        // ALT ÜÇGEN (Buz) - haritanın alt yarısına otur
        const iceHexes = [
            // Satır 1 - 4 hex (en geniş)
            { y: 35, cols: [-1.5, -0.5, 0.5, 1.5] },
            // Satır 2 - 3 hex
            { y: 95, cols: [-1, 0, 1] },
            // Satır 3 - 2 hex (en alt)
            { y: 155, cols: [-0.5, 0.5] },
        ];
        
        // Ateş hexagonları
        fireHexes.forEach((rowData, rowIndex) => {
            rowData.cols.forEach(col => {
                const x = centerX + col * spacingX;
                const y = centerY + rowData.y;
                const hex = this.createHexTile(x, y, hexSize, 'fire', rowIndex, col);
                this.hexGrid.push(hex);
            });
        });
        
        // Buz hexagonları
        iceHexes.forEach((rowData, rowIndex) => {
            rowData.cols.forEach(col => {
                const x = centerX + col * spacingX;
                const y = centerY + rowData.y;
                const hex = this.createHexTile(x, y, hexSize, 'ice', rowIndex + 3, col);
                this.hexGrid.push(hex);
            });
        });
    }

    createHexTile(x, y, size, type, row, col) {
        const graphics = this.add.graphics();
        graphics.setDepth(1);
        
        // Renk - sadece kenar çizgisi için
        const colors = {
            fire: { 
                stroke: 0xFF4500,    // Turuncu kenar
                glow: 0xFF6600       // Lav parlaması
            },
            ice: { 
                stroke: 0x00BFFF,    // Açık mavi kenar
                glow: 0x4FC3F7       // Buz parlaması
            }
        };
        
        const color = colors[type];
        
        // Hexagon noktaları
        const points = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            points.push({
                x: x + size * Math.cos(angle),
                y: y + size * Math.sin(angle)
            });
        }
        
        // Şeffaf dolgu (çok hafif)
        graphics.fillStyle(0x000000, 0.15);
        graphics.beginPath();
        graphics.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < 6; i++) {
            graphics.lineTo(points[i].x, points[i].y);
        }
        graphics.closePath();
        graphics.fillPath();
        
        // Kenar çizgisi (parlak)
        graphics.lineStyle(2, color.stroke, 0.8);
        graphics.beginPath();
        graphics.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < 6; i++) {
            graphics.lineTo(points[i].x, points[i].y);
        }
        graphics.closePath();
        graphics.strokePath();
        
        // Interactive
        const hitArea = new Phaser.Geom.Polygon(points);
        graphics.setInteractive(hitArea, Phaser.Geom.Polygon.Contains);
        
        graphics.on('pointerover', () => {
            graphics.lineStyle(3, 0xFFD700, 1);
            graphics.strokePath();
        });
        
        graphics.on('pointerout', () => {
            graphics.lineStyle(2, color.stroke, 1);
            graphics.strokePath();
        });
        
        graphics.on('pointerdown', () => {
            this.onHexClick(hex);
        });
        
        const hex = {
            graphics, x, y, row, col, type,
            unit: null, points, color
        };
        
        return hex;
    }

    createPlayerProfile(x, y, name, mana, isTop) {
        const container = this.add.container(x, y);
        
        // Çerçeve
        const frame = this.add.graphics();
        frame.fillStyle(0x1a1a2e, 0.9);
        frame.lineStyle(3, 0x4a90a4, 1);
        frame.fillRoundedRect(0, 0, 150, 100, 10);
        frame.strokeRoundedRect(0, 0, 150, 100, 10);
        container.add(frame);
        
        // Mana kristali
        const manaCircle = this.add.graphics();
        manaCircle.fillStyle(0x3498db, 1);
        manaCircle.fillCircle(30, 50, 25);
        manaCircle.lineStyle(2, 0x5dade2, 1);
        manaCircle.strokeCircle(30, 50, 25);
        container.add(manaCircle);
        
        // Mana sayısı
        const manaText = this.add.text(30, 50, mana.toString(), {
            fontSize: '24px',
            fontFamily: 'Arial',
            color: '#ffffff',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        container.add(manaText);
        
        // İsim
        const nameText = this.add.text(75, 20, name, {
            fontSize: '14px',
            color: '#ffffff'
        });
        container.add(nameText);
        
        // Cüzdan adresi
        const addr = isTop ? '0xac6...46De' : this.walletAddress.slice(0, 10) || '0x...';
        const addrText = this.add.text(75, 40, addr, {
            fontSize: '10px',
            color: '#888888'
        });
        container.add(addrText);
        
        if (isTop) {
            this.enemyManaText = manaText;
        } else {
            this.playerManaText = manaText;
        }
        
        return container;
    }

    createCardDetailPanel() {
        const x = 980;
        const y = 150;
        
        // Panel arka planı
        const panel = this.add.graphics();
        panel.fillStyle(0x1a1a2e, 0.95);
        panel.lineStyle(3, 0x8b7355, 1);
        panel.fillRoundedRect(x, y, 200, 350, 15);
        panel.strokeRoundedRect(x, y, 200, 350, 15);
        
        // Kart görseli placeholder
        this.cardDetailImage = this.add.rectangle(x + 100, y + 100, 150, 150, 0x333333);
        
        // Kart ismi
        this.cardDetailName = this.add.text(x + 100, y + 200, 'Kart Seç', {
            fontSize: '18px',
            fontFamily: 'Arial',
            color: '#d4af37',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        
        // Kart açıklaması
        this.cardDetailDesc = this.add.text(x + 20, y + 230, 'Bir kart seçerek\ndetayları gör', {
            fontSize: '12px',
            color: '#cccccc',
            wordWrap: { width: 160 }
        });
        
        // Saldırı/Can
        this.cardDetailStats = this.add.text(x + 100, y + 320, '⚔️ 0   ❤️ 0', {
            fontSize: '18px',
            color: '#ffffff'
        }).setOrigin(0.5);
    }

    createCardHand() {
        const cards = [
            { name: 'Korhan', cost: 3, attack: 4, health: 4, texture: 'korhan', desc: 'Ateş savaşçısı.\nSaldırı: Yakındaki\ndüşmanlara hasar.' },
            { name: 'Tuplar', cost: 2, attack: 3, health: 3, texture: 'tuplar', desc: 'Buz okçusu.\nMenzilli saldırı.' },
            { name: 'Korhan', cost: 3, attack: 4, health: 4, texture: 'korhan', desc: 'Ateş savaşçısı.' },
            { name: 'Tuplar', cost: 5, attack: 6, health: 6, texture: 'tuplar', desc: 'Güçlü buz lordu.' },
            { name: 'Korhan', cost: 2, attack: 2, health: 5, texture: 'korhan', desc: 'Savunmacı.' }
        ];
        
        const startX = 300;
        const y = 720;
        
        cards.forEach((cardData, i) => {
            const card = this.createCard(startX + i * 120, y, cardData, i);
            this.cards.push(card);
        });
    }

    createCard(x, y, data, index) {
        const container = this.add.container(x, y);
        container.setDepth(100);
        
        // Kart arka planı
        const bg = this.add.graphics();
        bg.fillStyle(0x2a2a3e, 1);
        bg.lineStyle(2, 0x8b7355, 1);
        bg.fillRoundedRect(-50, -70, 100, 140, 8);
        bg.strokeRoundedRect(-50, -70, 100, 140, 8);
        container.add(bg);
        
        // Kart görseli
        const image = this.add.image(0, -20, data.texture);
        image.setDisplaySize(80, 60);
        container.add(image);
        
        // Maliyet (sol üst)
        const costBg = this.add.circle(-40, -60, 15, 0x3498db);
        container.add(costBg);
        const costText = this.add.text(-40, -60, data.cost.toString(), {
            fontSize: '16px',
            fontStyle: 'bold',
            color: '#ffffff'
        }).setOrigin(0.5);
        container.add(costText);
        
        // İsim
        const nameText = this.add.text(0, 25, data.name, {
            fontSize: '11px',
            color: '#ffffff'
        }).setOrigin(0.5);
        container.add(nameText);
        
        // Saldırı (sol alt)
        const atkBg = this.add.circle(-35, 55, 12, 0xe74c3c);
        container.add(atkBg);
        const atkText = this.add.text(-35, 55, data.attack.toString(), {
            fontSize: '14px',
            color: '#ffffff'
        }).setOrigin(0.5);
        container.add(atkText);
        
        // Can (sağ alt)
        const hpBg = this.add.circle(35, 55, 12, 0x27ae60);
        container.add(hpBg);
        const hpText = this.add.text(35, 55, data.health.toString(), {
            fontSize: '14px',
            color: '#ffffff'
        }).setOrigin(0.5);
        container.add(hpText);
        
        // Interactive
        container.setSize(100, 140);
        container.setInteractive();
        
        container.on('pointerover', () => {
            container.setScale(1.1);
            container.y = y - 20;
            this.showCardDetail(data);
        });
        
        container.on('pointerout', () => {
            if (this.selectedCard !== container) {
                container.setScale(1);
                container.y = y;
            }
        });
        
        container.on('pointerdown', () => {
            this.selectCard(container, data);
        });
        
        container.cardData = data;
        return container;
    }

    showCardDetail(data) {
        this.cardDetailName.setText(data.name);
        this.cardDetailDesc.setText(data.desc);
        this.cardDetailStats.setText(`⚔️ ${data.attack}   ❤️ ${data.health}`);
    }

    selectCard(container, data) {
        // Önceki seçimi kaldır
        if (this.selectedCard) {
            this.selectedCard.setScale(1);
            this.selectedCard.y += 20;
        }
        
        this.selectedCard = container;
        container.setScale(1.15);
        console.log('Kart seçildi:', data.name);
    }

    createEndTurnButton() {
        const x = 1080;
        const y = 650;
        
        const btn = this.add.container(x, y);
        
        // Buton arka planı
        const bg = this.add.graphics();
        bg.fillStyle(0xe74c3c, 1);
        bg.lineStyle(3, 0xc0392b, 1);
        bg.fillRoundedRect(-50, -30, 100, 60, 10);
        bg.strokeRoundedRect(-50, -30, 100, 60, 10);
        btn.add(bg);
        
        // Text
        const text = this.add.text(0, 0, 'END\nTURN', {
            fontSize: '14px',
            fontStyle: 'bold',
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);
        btn.add(text);
        
        btn.setSize(100, 60);
        btn.setInteractive();
        
        btn.on('pointerover', () => btn.setScale(1.1));
        btn.on('pointerout', () => btn.setScale(1));
        btn.on('pointerdown', () => this.endTurn());
        
        return btn;
    }

    placeStartingUnits() {
        // Oyuncu 1 başlangıç ünitesi (ateş - üst)
        const topHex = this.hexGrid[0]; // İlk hex
        if (topHex) {
            this.placeUnit(topHex, 'korhan', true);
        }
        
        // Oyuncu 2 başlangıç ünitesi (buz - alt)
        const botHex = this.hexGrid[this.hexGrid.length - 1]; // Son hex
        if (botHex) {
            this.placeUnit(botHex, 'tuplar', false);
        }
    }

    placeUnit(hex, texture, isEnemy) {
        const unit = this.add.image(hex.x, hex.y, texture);
        unit.setDisplaySize(50, 50);
        unit.setDepth(10);
        
        if (isEnemy) {
            unit.setTint(0xff6666);
        }
        
        // Saldırı/Can göstergesi
        const stats = this.add.text(hex.x, hex.y + 30, '4 | 4', {
            fontSize: '12px',
            color: '#ffffff',
            backgroundColor: '#000000',
            padding: { x: 4, y: 2 }
        }).setOrigin(0.5).setDepth(11);
        
        hex.unit = { sprite: unit, stats, isEnemy };
    }

    onHexClick(hex) {
        console.log('Hex tıklandı:', hex.q, hex.r);
        
        // Seçili kart varsa ve hex boşsa, kartı oyna
        if (this.selectedCard && !hex.unit) {
            const data = this.selectedCard.cardData;
            
            if (this.playerMana >= data.cost) {
                // Mana harca
                this.playerMana -= data.cost;
                this.playerManaText.setText(this.playerMana.toString());
                
                // Üniteyi yerleştir
                this.placeUnit(hex, data.texture, false);
                
                // Kartı kaldır
                this.selectedCard.destroy();
                this.selectedCard = null;
            } else {
                console.log('Yetersiz mana!');
            }
        }
    }

    endTurn() {
        console.log('Tur bitti!');
        this.isPlayerTurn = !this.isPlayerTurn;
        
        // Mana yenile
        if (this.isPlayerTurn) {
            this.playerMana = Math.min(10, this.playerMana + 1);
            this.playerManaText.setText(this.playerMana.toString());
        } else {
            this.enemyMana = Math.min(10, this.enemyMana + 1);
            this.enemyManaText.setText(this.enemyMana.toString());
        }
    }

    update() {}
}

window.HexGameScene = HexGameScene;
