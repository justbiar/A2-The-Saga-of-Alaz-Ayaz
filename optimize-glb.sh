#!/bin/bash
# GLB Model Optimizer — texture resize + webp + mesh quantize + weld + simplify
# Kullanım: bash optimize-glb.sh

set -e

ASSETS="/Users/biar/Desktop/Avx/assets"
BACKUP="/Users/biar/Desktop/Avx/assets-backup-$(date +%Y%m%d_%H%M%S)"

echo "=== GLB Optimizer ==="
echo ""

# Backup
echo "[1/5] Yedek alınıyor → $BACKUP"
mkdir -p "$BACKUP"
cp -r "$ASSETS/character animation" "$BACKUP/"
cp -r "$ASSETS/base" "$BACKUP/"
if [ -f "$ASSETS/images/gameplay/korhan.glb" ]; then
  mkdir -p "$BACKUP/images/gameplay"
  cp "$ASSETS/images/gameplay/korhan.glb" "$BACKUP/images/gameplay/"
fi
echo "  ✓ Yedek alındı"
echo ""

# Toplam boyut (önce)
BEFORE=$(find "$ASSETS" -name "*.glb" -exec stat -f%z {} + 2>/dev/null | awk '{s+=$1} END {print s}')
echo "[2/5] Optimizasyon öncesi toplam: $(echo "scale=1; $BEFORE/1048576" | bc) MB"
echo ""

optimize_glb() {
  local input="$1"
  local tex_size="${2:-1024}"  # default 1024
  local simplify_ratio="${3:-0.75}"  # default %75 vertex koru
  local tmp="${input}.tmp.glb"
  local filename=$(basename "$input")
  local size_before=$(stat -f%z "$input" 2>/dev/null || stat -c%s "$input" 2>/dev/null)

  echo -n "  $filename ($(echo "scale=1; $size_before/1048576" | bc)MB) → "

  # Step 1: Texture resize + WebP
  npx gltf-transform resize "$input" "$tmp" --width "$tex_size" --height "$tex_size" 2>&1 | tail -1
  npx gltf-transform webp "$tmp" "$tmp" --quality 75 2>&1 | tail -1

  # Step 2: Mesh optimize — dedup + weld + quantize
  npx gltf-transform dedup "$tmp" "$tmp" 2>/dev/null
  npx gltf-transform weld "$tmp" "$tmp" 2>/dev/null
  npx gltf-transform quantize "$tmp" "$tmp" 2>/dev/null

  # Step 3: Simplify (polygon azalt)
  npx gltf-transform simplify "$tmp" "$tmp" --ratio "$simplify_ratio" --error 0.01 2>/dev/null || true

  mv "$tmp" "$input"
  local size_after=$(stat -f%z "$input" 2>/dev/null || stat -c%s "$input" 2>/dev/null)
  local savings=$(echo "scale=0; 100 - ($size_after * 100 / $size_before)" | bc)
  echo "$(echo "scale=1; $size_after/1048576" | bc)MB (-%${savings})"
}

# Karakter animasyonları
echo "[3/5] Karakter GLB'leri optimize ediliyor..."
for f in "$ASSETS/character animation"/*.glb; do
  [ -f "$f" ] && optimize_glb "$f" 1024 0.65
done
echo ""

# Boru modelleri
echo "[4/5] Boru GLB'leri optimize ediliyor..."
for f in "$ASSETS/character animation/Meshy_AI_biped"/*.glb; do
  [ -f "$f" ] && optimize_glb "$f" 1024 0.65
done
echo ""

# Base modelleri
echo "[5/5] Base GLB'leri optimize ediliyor..."
for f in "$ASSETS/base"/*.glb; do
  [ -f "$f" ] && optimize_glb "$f" 1024 0.70
done
# Gameplay korhan
if [ -f "$ASSETS/images/gameplay/korhan.glb" ]; then
  optimize_glb "$ASSETS/images/gameplay/korhan.glb" 1024 0.65
fi
echo ""

# Toplam boyut (sonra)
AFTER=$(find "$ASSETS" -name "*.glb" -exec stat -f%z {} + 2>/dev/null | awk '{s+=$1} END {print s}')
echo "=== SONUÇ ==="
echo "Önce:  $(echo "scale=1; $BEFORE/1048576" | bc) MB"
echo "Sonra: $(echo "scale=1; $AFTER/1048576" | bc) MB"
echo "Kazanç: $(echo "scale=1; ($BEFORE-$AFTER)/1048576" | bc) MB (-%$(echo "scale=0; 100 - ($AFTER * 100 / $BEFORE)" | bc))"
echo ""
echo "Yedek: $BACKUP"
echo "Sorun olursa: rm -rf '$ASSETS/base' '$ASSETS/character animation' && cp -r '$BACKUP'/* '$ASSETS/'"
