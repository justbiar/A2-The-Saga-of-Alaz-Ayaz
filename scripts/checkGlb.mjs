import { readFileSync } from 'fs';

const dir = 'assets/character animation/';
const files = ['tepegozwalk.glb', 'tepegozattack.glb', 'tepegozdie.glb', 'korhanwalk.glb'];

for (const f of files) {
  try {
    const buf = readFileSync(dir + f);
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
    console.log(`\n=== ${f} (${buf.length} bytes) ===`);
    console.log(`  meshes: ${json.meshes?.length ?? 0}`);
    console.log(`  nodes: ${json.nodes?.length ?? 0}`);
    console.log(`  animations: ${json.animations?.length ?? 0}`);
    console.log(`  skins: ${json.skins?.length ?? 0}`);
    console.log(`  materials: ${json.materials?.length ?? 0}`);
    if (json.nodes) {
      json.nodes.forEach((n, i) => {
        if (n.mesh !== undefined) {
          console.log(`    node[${i}]: "${n.name}" mesh=${n.mesh} skin=${n.skin ?? 'none'}`);
        }
      });
    }
    if (json.meshes) {
      json.meshes.forEach((m, i) => {
        const totalVerts = m.primitives?.reduce((s, p) => {
          const acc = json.accessors?.[p.attributes?.POSITION];
          return s + (acc?.count ?? 0);
        }, 0) ?? 0;
        console.log(`    mesh[${i}]: "${m.name}" primitives=${m.primitives?.length} verts=${totalVerts}`);
      });
    }
  } catch (e) {
    console.log(`\n=== ${f}: ERROR ===`, e.message);
  }
}
