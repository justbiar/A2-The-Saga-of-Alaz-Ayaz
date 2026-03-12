#!/bin/bash
# deploy.sh — Lokal build + GCP VM'e HIZLI production deploy (nginx)
# Sadece degisen dosyalari gonderir (JS/CSS/HTML ~3MB), asset'leri atlar.
# Tam deploy (asset'ler dahil): bash deploy.sh --full
# Kullanim: bash deploy.sh
# Not: gcloud compute ssh/scp kullanir (SSH key otomatik)

set -e

INSTANCE="a2saga"
ZONE="us-central1-c"
FULL_DEPLOY=false

if [ "$1" = "--full" ]; then
  FULL_DEPLOY=true
fi

echo "=== A2: The Saga of Alaz & Ayaz — Production Deploy ==="

# 1. Lokal production build
echo ""
echo "[1/4] Lokal build yapiliyor..."
npx vite build
echo "Build tamamlandi: dist/"

# 2. Sadece degisen dosyalari gonder
echo ""
if [ "$FULL_DEPLOY" = true ]; then
  echo "[2/4] TAM deploy — tum dosyalar gonderiliyor..."
  tar czf /tmp/a2-dist.tar.gz -C dist .
  echo "Paket: $(du -h /tmp/a2-dist.tar.gz | cut -f1)"
  gcloud compute scp /tmp/a2-dist.tar.gz "$INSTANCE":/tmp/a2-dist.tar.gz --zone="$ZONE"

  echo ""
  echo "[3/4] VM'de deploy ediliyor..."
  gcloud compute ssh "$INSTANCE" --zone="$ZONE" -- "
    mkdir -p /tmp/a2-dist
    tar xzf /tmp/a2-dist.tar.gz -C /tmp/a2-dist
    sudo rm -rf /var/www/html/*
    sudo cp -r /tmp/a2-dist/* /var/www/html/
    sudo chmod -R 755 /var/www/html/
    sudo chown -R www-data:www-data /var/www/html/
    rm -rf /tmp/a2-dist /tmp/a2-dist.tar.gz
    echo 'Tam deploy tamamlandi.'
  "
else
  echo "[2/4] HIZLI deploy — sadece JS/CSS/HTML gonderiliyor..."
  # Sadece index.html + JS/CSS chunk'larini paketle (GLB/video/resim haric)
  cd dist
  tar czf /tmp/a2-code.tar.gz \
    index.html \
    $(find assets -maxdepth 1 \( -name '*.js' -o -name '*.css' \) -type f)
  cd ..
  CODE_SIZE=$(du -h /tmp/a2-code.tar.gz | cut -f1)
  echo "Paket: $CODE_SIZE (sadece kod)"
  gcloud compute scp /tmp/a2-code.tar.gz "$INSTANCE":/tmp/a2-code.tar.gz --zone="$ZONE"

  echo ""
  echo "[3/4] VM'de deploy ediliyor..."
  gcloud compute ssh "$INSTANCE" --zone="$ZONE" -- "
    mkdir -p /tmp/a2-code
    tar xzf /tmp/a2-code.tar.gz -C /tmp/a2-code

    # Eski JS/CSS chunk'larini sil
    sudo find /var/www/html/assets/ -maxdepth 1 -name '*.js' -delete 2>/dev/null
    sudo find /var/www/html/assets/ -maxdepth 1 -name '*.css' -delete 2>/dev/null

    # Yeni kod dosyalarini kopyala
    sudo cp /tmp/a2-code/index.html /var/www/html/
    sudo cp /tmp/a2-code/assets/*.js /var/www/html/assets/ 2>/dev/null
    sudo cp /tmp/a2-code/assets/*.css /var/www/html/assets/ 2>/dev/null

    sudo chmod -R 755 /var/www/html/
    sudo chown -R www-data:www-data /var/www/html/
    rm -rf /tmp/a2-code /tmp/a2-code.tar.gz
    echo 'Hizli deploy tamamlandi.'
  "
fi

# 4. API server kontrol
echo ""
echo "[4/4] API server kontrol ediliyor..."
gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="
  if curl -s http://127.0.0.1:3001/api/health | grep -q '\"ok\":true'; then
    echo 'API server calisiyor'
  else
    echo 'API server calismiyior, baslatiliyor...'
    cd ~/a2-api 2>/dev/null || cd ~/avx/server
    pkill -f 'node.*index.js' 2>/dev/null || true
    sleep 1
    nohup node index.js > /tmp/a2-api.log 2>&1 &
    sleep 2
    if curl -s http://127.0.0.1:3001/api/health | grep -q '\"ok\":true'; then
      echo 'API server baslatildi'
    else
      echo 'API server basarilamadi — log: /tmp/a2-api.log'
    fi
  fi
"

echo ""
echo "=== HAZIR ==="
echo "Site: https://a2saga.me"
