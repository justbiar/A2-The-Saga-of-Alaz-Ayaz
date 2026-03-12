#!/bin/bash
# nginx-fix.sh — VM'de nginx config'i duzelt
# Kullanim: gcloud compute ssh a2saga --zone=us-central1-c sonra bu scripti calistir
# veya: ssh selfbiar@34.56.130.155 < nginx-fix.sh

set -e

echo "=== nginx config guncelleniyor ==="

# nginx config dosyasini bul
CONF=$(ls /etc/nginx/sites-enabled/a2saga* 2>/dev/null | head -1)
if [ -z "$CONF" ]; then
    CONF=$(ls /etc/nginx/sites-enabled/default 2>/dev/null | head -1)
fi
if [ -z "$CONF" ]; then
    echo "nginx config bulunamadi!"
    exit 1
fi
echo "Config: $CONF"

# Yedekle
sudo cp "$CONF" "${CONF}.bak.$(date +%s)"

# character animation klasoru icin boşluklu path duzeltmesi + cache headers + MIME
sudo tee /tmp/nginx-a2-extra.conf > /dev/null <<'NGINX'

    # GLB dosyalari icin MIME type
    types {
        model/gltf-binary glb;
        model/gltf+json gltf;
    }

    # Assets icin cache-control (JS/CSS hash'li oldugundan uzun cache OK)
    location ~* \.(?:js|css)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # GLB, resim, ses icin kisa cache (guncelleme olunca yenilensin)
    location ~* \.(?:glb|gltf|png|jpg|mp3|mp4|wav|ogg|avif)$ {
        expires 1h;
        add_header Cache-Control "public, must-revalidate";
    }

    # character animation klasoru (bossluklu path)
    location /assets/character%20animation/ {
        alias /var/www/html/assets/character animation/;
        expires 1h;
        add_header Cache-Control "public, must-revalidate";
    }
NGINX

echo ""
echo "Asagidaki blogu $CONF icindeki server {} bloguna ekle:"
echo "---"
cat /tmp/nginx-a2-extra.conf
echo "---"
echo ""
echo "Veya elle eklemek istemiyorsan:"
echo "sudo nano $CONF"
echo "sonra: sudo nginx -t && sudo systemctl reload nginx"
