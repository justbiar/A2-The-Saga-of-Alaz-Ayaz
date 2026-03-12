import fs from 'fs';

const html = fs.readFileSync('index.html', 'utf8');
const ts = fs.readFileSync('src/main.ts', 'utf8');

// main.ts'teki getElementById('xxx')! çağrılarını bul (non-null assertion)
const idRegex = /getElementById\(['"]([^'"]+)['"]\)\s*!/g;
let match;
const requiredIds = new Set();
while ((match = idRegex.exec(ts))) requiredIds.add(match[1]);

// main.ts'teki getElementById('xxx') as çağrılarını da bul
const asRegex = /getElementById\(['"]([^'"]+)['"]\)\s*as\s/g;
while ((match = asRegex.exec(ts))) requiredIds.add(match[1]);

// HTML'de bu id'lerin olup olmadığını kontrol et
const missing = [];
for (const id of requiredIds) {
  const pattern = `id="${id}"`;
  if (!html.includes(pattern)) missing.push(id);
}

console.log(`Checked ${requiredIds.size} element IDs from main.ts`);
if (missing.length === 0) {
  console.log('✅ All required IDs found in HTML');
} else {
  console.log(`\n❌ MISSING ${missing.length} IDs in index.html:`);
  missing.forEach(id => console.log(`  ❌ ${id}`));
}
