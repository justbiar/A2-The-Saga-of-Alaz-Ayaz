#!/bin/bash
# deploy.sh — VM'e projeyi deploy et
# Kullanım: bash deploy.sh <user@vm-ip>
# Örnek:    bash deploy.sh a2saga@34.56.130.155

set -e

VM="${1:?Kullanım: bash deploy.sh user@vm-ip}"
REMOTE_DIR="~/avx"

echo "=== A2: The Saga of Alaz & Ayaz — VM Deploy ==="
echo "Hedef: $VM:$REMOTE_DIR"

# 1. VM'de Node.js kur
echo ""
echo "[1/4] VM hazırlanıyor..."
ssh "$VM" "bash -s" <<'SETUP'
if ! command -v node &>/dev/null; then
    echo "Node.js kuruluyor..."
    sudo apt-get install -y nodejs 2>/dev/null || {
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -n bash -
        sudo apt-get install -y nodejs
    }
fi
echo "Node: $(node -v) | npm: $(npm -v)"
mkdir -p ~/avx
SETUP

# 2. Dosyaları rsync ile gönder
echo ""
echo "[2/4] Dosyalar gönderiliyor (rsync)..."
rsync -avz --progress \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='dist' \
    --exclude='.vite' \
    --exclude='.DS_Store' \
    ./ "$VM:$REMOTE_DIR/"

# 3. VM'de npm install
echo ""
echo "[3/4] Bağımlılıklar kuruluyor..."
ssh "$VM" "bash -s" <<'BUILD'
cd ~/avx
npm install
echo "Bağımlılıklar kuruldu."
BUILD

# 4. VM'de dev server başlat
echo ""
echo "[4/4] Dev server başlatılıyor..."
ssh "$VM" "bash -s" <<'START'
cd ~/avx
pkill -f "vite" 2>/dev/null || true
sleep 1
nohup npx vite --host 0.0.0.0 --port 5173 > /tmp/vite.log 2>&1 &
sleep 3
echo ""
echo "=== HAZIR ==="
VM_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo "Tarayıcıdan aç: http://$VM_IP:5173"
START
