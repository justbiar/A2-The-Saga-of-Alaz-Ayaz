/**
 * exportMapHeadless.mjs — Node.js ile headless GLB export v2
 * 
 * Düzeltmeler:
 *  - Köşe boşlukları kapatıldı (sol/sağ köşelerde ek dolgu mesh'leri)
 *  - Diamond ground iki üçgen — vertex pozisyonları birebir aynı
 *  - Tüm geometri createAvaxMap.ts ile aynı
 * 
 * Kullanım: node scripts/exportMapHeadless.mjs
 * Çıktı:    assets/newmap.glb
 */
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '..', 'assets', 'newmap.glb');

import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import '@babylonjs/core/Meshes/Builders/discBuilder.js';
import '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { GLTF2Export } from '@babylonjs/serializers/glTF/2.0/index.js';

const DW = 32, DH = 48, SURF = 0.0;
const Y_FEATURE = SURF + 0.06;
const Y_LANE    = SURF + 0.14;
const Y_PAD     = SURF + 0.12;
const LANE_W    = 4.5;

const LEFT_PTS  = [[0,-40],[-7,-33],[-14,-22],[-19,-15],[-26,-5],[-29,0],[-26,5],[-19,15],[-14,22],[-7,33],[0,40]];
const MID_PTS   = [[0,-40],[0,-28],[0,-20],[0,-15],[0,0],[0,5],[0,15],[0,28],[0,40]];
const RIGHT_PTS = [[0,-40],[7,-33],[14,-22],[19,-15],[26,-5],[29,0],[26,5],[19,15],[14,22],[7,33],[0,40]];

function cMat(nm, d, e, a, sc) {
    const m = new StandardMaterial(nm, sc);
    m.diffuseColor = d; m.emissiveColor = e;
    m.specularColor = Color3.Black(); m.alpha = a; m.backFaceCulling = false;
    return m;
}

function buildDiamond(scene) {
    // Fire üçgen — vertex'ler: sol(-DW,0), sağ(DW,0), üst(0,-DH)
    const fireMesh = new Mesh('fireGround', scene);
    const fvd = new VertexData();
    fvd.positions = [-DW,SURF,0, DW,SURF,0, 0,SURF,-DH];
    fvd.indices = [0, 2, 1];
    fvd.normals = [0,1,0, 0,1,0, 0,1,0];
    fvd.uvs = [0,0.5, 1,0.5, 0.5,0];
    fvd.applyToMesh(fireMesh);
    fireMesh.material = cMat('fireGroundMat', new Color3(.45,.15,.02), new Color3(.35,.12,.02), 1, scene);

    // Ice üçgen — vertex'ler: sol(-DW,0), sağ(DW,0), alt(0,DH)  — AYNI sol/sağ noktalar!
    const iceMesh = new Mesh('iceGround', scene);
    const ivd = new VertexData();
    ivd.positions = [-DW,SURF,0, DW,SURF,0, 0,SURF,DH];
    ivd.indices = [0, 1, 2];
    ivd.normals = [0,1,0, 0,1,0, 0,1,0];
    ivd.uvs = [0,0.5, 1,0.5, 0.5,1];
    ivd.applyToMesh(iceMesh);
    iceMesh.material = cMat('iceGroundMat', new Color3(.1,.2,.45), new Color3(.04,.07,.18), 1, scene);

    // Sol ve sağ köşe dolgu — equator kenarında olası açıklıkları kapat
    for (const side of [-1, 1]) {
        const x = DW * side;
        const patch = MeshBuilder.CreateGround(`cornerPatch_${side>0?'R':'L'}`, { width: 6, height: 8 }, scene);
        patch.position.set(x * 0.88, SURF + 0.01, 0);
        patch.material = cMat(`cornerPatchMat_${side>0?'R':'L'}`, new Color3(.3,.2,.15), new Color3(.15,.1,.06), 1, scene);
    }

    // Equator
    const eq = MeshBuilder.CreateGround('equator', { width: DW*2, height: 1.2 }, scene);
    eq.position.set(0, SURF+0.08, 0);
    eq.material = cMat('eqMat', new Color3(.7,.6,.2), new Color3(.35,.28,.08), .75, scene);

    const eqGlow = MeshBuilder.CreateGround('equatorGlow', { width: DW*2, height: 3 }, scene);
    eqGlow.position.set(0, SURF+0.05, 0);
    eqGlow.material = cMat('eqGlowMat', new Color3(.5,.4,.15), new Color3(.2,.15,.04), .25, scene);
}

function buildTriangleEdges(scene) {
    const edges = [
        { from:[-DW,0], to:[0,-DH], fire:true, name:'TL' },
        { from:[DW,0],  to:[0,-DH], fire:true, name:'TR' },
        { from:[-DW,0], to:[0,DH],  fire:false, name:'BL' },
        { from:[DW,0],  to:[0,DH],  fire:false, name:'BR' },
    ];
    edges.forEach(e => {
        const dx = e.to[0]-e.from[0], dz = e.to[1]-e.from[1];
        const len = Math.sqrt(dx*dx+dz*dz);
        const cx = (e.from[0]+e.to[0])/2, cz = (e.from[1]+e.to[1])/2;
        const angle = Math.atan2(dx, dz);
        const col = e.fire ? new Color3(1,.45,.08) : new Color3(.15,.55,1);
        const emCol = e.fire ? new Color3(.7,.3,.04) : new Color3(.1,.35,.8);

        const edge = MeshBuilder.CreateBox(`triEdge_${e.name}`, {width:.5,height:.3,depth:len}, scene);
        edge.position.set(cx,SURF+0.18,cz); edge.rotation.y = angle;
        edge.material = cMat(`triEdgeMat_${e.name}`, col, emCol, 0.95, scene);

        const glow = MeshBuilder.CreateBox(`triGlow_${e.name}`, {width:1.5,height:.08,depth:len}, scene);
        glow.position.set(cx,SURF+0.14,cz); glow.rotation.y = angle;
        glow.material = cMat(`triGlowMat_${e.name}`, col, emCol.scale(1.5), 0.3, scene);

        const amb = MeshBuilder.CreateBox(`triAmb_${e.name}`, {width:3,height:.04,depth:len}, scene);
        amb.position.set(cx,SURF+0.1,cz); amb.rotation.y = angle;
        amb.material = cMat(`triAmbMat_${e.name}`, col, emCol.scale(.7), 0.12, scene);
    });
}

function buildEnergyNodes(scene) {
    [{z:-DH,fire:true},{z:DH,fire:false}].forEach(n => {
        const col = n.fire ? new Color3(1,.5,.1) : new Color3(.2,.55,1);
        const emCol = n.fire ? new Color3(.8,.35,.06) : new Color3(.12,.4,.85);
        const torus = MeshBuilder.CreateTorus(`energyTorus_${n.fire?'f':'i'}`, {diameter:8,thickness:.6,tessellation:32}, scene);
        torus.position.set(0,SURF+0.5,n.z); torus.rotation.x = Math.PI/2;
        torus.material = cMat(`energyTorusMat_${n.fire?'f':'i'}`, col, emCol, 0.75, scene);
        const disc = MeshBuilder.CreateDisc(`energyDisc_${n.fire?'f':'i'}`, {radius:3.5,tessellation:24}, scene);
        disc.position.set(0,SURF+0.2,n.z); disc.rotation.x = Math.PI/2;
        disc.material = cMat(`energyDiscMat_${n.fire?'f':'i'}`, col.scale(.4), emCol.scale(.6), 0.35, scene);
        const outer = MeshBuilder.CreateTorus(`energyOuter_${n.fire?'f':'i'}`, {diameter:12,thickness:.3,tessellation:32}, scene);
        outer.position.set(0,SURF+0.3,n.z); outer.rotation.x = Math.PI/2;
        outer.material = cMat(`energyOuterMat_${n.fire?'f':'i'}`, col, emCol.scale(.4), 0.25, scene);
    });
}

function buildLanePaths(scene) {
    function buildLane(pts, name) {
        const isSide = name==='L'||name==='R';
        const lastIdx = pts.length-2;
        for (let i=0;i<pts.length-1;i++) {
            const [x1,z1]=pts[i],[x2,z2]=pts[i+1];
            const dx=x2-x1,dz=z2-z1;
            const len=Math.sqrt(dx*dx+dz*dz);
            const cx=(x1+x2)/2,cz=(z1+z2)/2;
            const angle=Math.atan2(dx,dz);
            const isFire=cz<0;
            const emCol=isFire?new Color3(.35,.12,.02):new Color3(.05,.18,.45);
            const borCol=isFire?new Color3(.9,.4,.05):new Color3(.2,.55,1);
            const borEm=isFire?new Color3(.6,.22,.02):new Color3(.08,.32,.75);
            const difCol=isFire?new Color3(.4,.12,.02):new Color3(.08,.18,.4);

            const seg=MeshBuilder.CreateBox(`lane_${name}_${i}`, {width:LANE_W,height:.18,depth:len}, scene);
            seg.position.set(cx,Y_LANE,cz); seg.rotation.y=angle;
            seg.material=cMat(`laneMat_${name}_${i}`, difCol, emCol, 1, scene);

            const isTipSeg=isSide&&(i===0||i===lastIdx);
            if(!isTipSeg) {
                for(const side of [-1,1]) {
                    const bar=MeshBuilder.CreateBox(`laneBorder_${name}_${i}_${side}`, {width:.25,height:.35,depth:len}, scene);
                    const offX=side*(LANE_W/2+0.125);
                    const wx=cx+offX*Math.cos(angle);
                    const wz=cz-offX*Math.sin(angle);
                    bar.position.set(wx,Y_LANE+0.09,wz); bar.rotation.y=angle;
                    bar.material=cMat(`laneBorderMat_${name}_${i}_${side}`, borCol, borEm, 0.9, scene);
                }
            }
        }
    }
    buildLane(LEFT_PTS,'L'); buildLane(MID_PTS,'M'); buildLane(RIGHT_PTS,'R');

    const TIP_PTS=new Set(['0_-40','0_40']);
    const NEAR_TIP=new Set(['-7_-33','7_-33','-7_33','7_33']);
    const ALL_PTS=[...LEFT_PTS,...MID_PTS,...RIGHT_PTS];
    const seen=new Set();
    ALL_PTS.forEach(([x,z])=>{
        const key=`${x}_${z}`;
        if(seen.has(key))return; seen.add(key);
        const isFire=z<=0;
        const emCol=isFire?new Color3(.35,.12,.02):new Color3(.05,.18,.45);
        const difCol=isFire?new Color3(.4,.12,.02):new Color3(.08,.18,.4);
        const padSize=TIP_PTS.has(key)?LANE_W*3:NEAR_TIP.has(key)?LANE_W*1.8:LANE_W+0.5;
        const pad=MeshBuilder.CreateBox(`jpad_${key}`, {width:padSize,height:.18,depth:padSize}, scene);
        pad.position.set(x,Y_PAD,z);
        pad.material=cMat(`jpadMat_${key}`, difCol, emCol, 1, scene);
    });

    for(const fire of [true,false]) {
        const zTip=fire?-40:40, zNear=fire?-33:33;
        const emCol=fire?new Color3(.35,.12,.02):new Color3(.05,.18,.45);
        const difCol=fire?new Color3(.4,.12,.02):new Color3(.08,.18,.4);
        const midZ=(zTip+zNear)/2, depth=Math.abs(zNear-zTip)+LANE_W;
        const fill=MeshBuilder.CreateBox(`tipFill_${fire?'f':'i'}`, {width:14+LANE_W,height:.18,depth}, scene);
        fill.position.set(0,Y_PAD,midZ);
        fill.material=cMat(`tipFillMat_${fire?'f':'i'}`, difCol, emCol, 1, scene);
    }
}

function buildLavaFeatures(scene) {
    const sideX=(z)=>DW*(1-Math.abs(z)/DH)-3;
    const bands=[{z1:-36,z2:-28},{z1:-28,z2:-19},{z1:-19,z2:-10},{z1:-10,z2:-1}];
    for(const side of [-1,1]) {
        bands.forEach((b,i)=>{
            const zc=(b.z1+b.z2)/2, len=b.z2-b.z1;
            const sx=sideX(zc)*side, mx=3*side;
            const cx=(mx+sx)/2, w=Math.abs(sx-mx);
            if(w<1)return;
            const tag=side<0?'L':'R';
            const r=MeshBuilder.CreateGround(`lavaRiv_${tag}_${i}`, {width:w,height:len+1,subdivisions:4}, scene);
            r.position.set(cx,Y_FEATURE,zc);
            r.material=cMat(`lavaRivM_${tag}_${i}`, new Color3(.6,.2,.02), new Color3(.35,.12,.01), 1, scene);
            const g=MeshBuilder.CreateGround(`lavaGlow_${tag}_${i}`, {width:w+4,height:len+3,subdivisions:1}, scene);
            g.position.set(cx,Y_FEATURE-0.02,zc);
            g.material=cMat(`lavaGlowM_${tag}_${i}`, new Color3(.8,.3,.04), new Color3(.35,.12,.01), 0.18, scene);
        });
    }
    [{x:-10,z:-14,r:3},{x:10,z:-14,r:3},{x:-5,z:-26,r:2},{x:5,z:-26,r:2},{x:-18,z:-8,r:3.5},{x:18,z:-8,r:3.5}].forEach((lp,i)=>{
        const p=MeshBuilder.CreateDisc(`lavaP_${i}`, {radius:lp.r,tessellation:20}, scene);
        p.position.set(lp.x,Y_FEATURE,lp.z); p.rotation.x=Math.PI/2;
        p.material=cMat(`lavaPMat_${i}`, new Color3(.7,.25,.02), new Color3(.4,.15,.01), 1, scene);
    });
    [{x:0,z:-40,s:.7},{x:-3,z:-36,s:.6},{x:3,z:-36,s:.6},{x:-6,z:-28,s:.5},{x:6,z:-28,s:.5}].forEach((v,i)=>{
        const c=MeshBuilder.CreateCylinder(`vol_${i}`, {diameterTop:1.2*v.s,diameterBottom:5*v.s,height:4*v.s,tessellation:7}, scene);
        c.position.set(v.x,SURF+2*v.s,v.z);
        c.material=cMat(`volMat_${i}`, new Color3(.2,.12,.06), new Color3(.04,.02,.0), 1, scene);
        const cr=MeshBuilder.CreateCylinder(`crat_${i}`, {diameter:1.3*v.s,height:.4*v.s,tessellation:7}, scene);
        cr.position.set(v.x,SURF+4.2*v.s,v.z);
        cr.material=cMat(`cratMat_${i}`, new Color3(.8,.3,.05), new Color3(.45,.18,.0), 1, scene);
    });
    [{x:-4,z:-22,s:.75},{x:4,z:-22,s:.75},{x:-8,z:-16,s:.65},{x:8,z:-16,s:.65},{x:-15,z:-10,s:.8},{x:15,z:-10,s:.8},{x:-2,z:-32,s:.55},{x:2,z:-32,s:.55}].forEach((r,i)=>{
        const rk=MeshBuilder.CreateBox(`fRk_${i}`, {width:1.8*r.s,height:1.4*r.s,depth:1.6*r.s}, scene);
        rk.position.set(r.x,SURF+.7*r.s,r.z); rk.rotation.y=i*1.3; rk.rotation.x=.12;
        rk.material=cMat(`fRkM_${i}`, new Color3(.2,.12,.06), new Color3(.04,.02,.0), 1, scene);
    });
}

function buildIceFeatures(scene) {
    const sideX=(z)=>DW*(1-Math.abs(z)/DH)-3;
    const bands=[{z1:1,z2:10},{z1:10,z2:19},{z1:19,z2:28},{z1:28,z2:36}];
    for(const side of [-1,1]) {
        bands.forEach((b,i)=>{
            const zc=(b.z1+b.z2)/2, len=b.z2-b.z1;
            const sx=sideX(zc)*side, mx=3*side;
            const cx=(mx+sx)/2, w=Math.abs(sx-mx);
            if(w<1)return;
            const tag=side<0?'L':'R';
            const r=MeshBuilder.CreateGround(`iceRiv_${tag}_${i}`, {width:w,height:len+1,subdivisions:4}, scene);
            r.position.set(cx,SURF+0.06,zc);
            r.material=cMat(`iceRivM_${tag}_${i}`, new Color3(.12,.25,.55), new Color3(.03,.06,.15), 1, scene);
            const g=MeshBuilder.CreateGround(`iceGlow_${tag}_${i}`, {width:w+4,height:len+3,subdivisions:1}, scene);
            g.position.set(cx,SURF+0.03,zc);
            g.material=cMat(`iceGlowM_${tag}_${i}`, new Color3(.15,.4,.85), new Color3(.06,.18,.5), 0.18, scene);
        });
    }
    [{x:-10,z:14,r:3},{x:10,z:14,r:3},{x:-5,z:26,r:2},{x:5,z:26,r:2},{x:-18,z:8,r:3.5},{x:18,z:8,r:3.5}].forEach((ip,i)=>{
        const p=MeshBuilder.CreateDisc(`icePool_${i}`, {radius:ip.r,tessellation:20}, scene);
        p.position.set(ip.x,SURF+.05,ip.z); p.rotation.x=Math.PI/2;
        p.material=cMat(`icePoolM_${i}`, new Color3(.15,.3,.65), new Color3(.06,.12,.25), .75, scene);
    });
    [{x:-5,z:20,h:3.5,d:1.8},{x:5,z:20,h:3.8,d:2},{x:-3,z:34,h:3.2,d:1.4},{x:3,z:34,h:3,d:1.3},{x:-1,z:40,h:2.2,d:1},{x:1,z:40,h:2.5,d:1.1},{x:-4,z:28,h:4,d:2},{x:4,z:28,h:3.8,d:1.8},{x:0,z:32,h:3,d:1.5}].forEach((c,i)=>{
        const cr=MeshBuilder.CreateCylinder(`cry_${i}`, {diameterTop:.1,diameterBottom:c.d,height:c.h,tessellation:5}, scene);
        cr.position.set(c.x,SURF+c.h/2,c.z); cr.rotation.y=i*.7; cr.rotation.z=(i%3-1)*.1;
        cr.material=cMat(`cryM_${i}`, new Color3(.2,.35,.7), new Color3(.03,.05,.12), .78, scene);
    });
    [{x:-8,z:12,s:1.6},{x:8,z:12,s:1.6},{x:-12,z:16,s:1.3},{x:12,z:16,s:1.3},{x:-4,z:24,s:1.1},{x:4,z:24,s:1.1}].forEach((ib,i)=>{
        const b=MeshBuilder.CreateBox(`iceB_${i}`, {width:ib.s*1.3,height:ib.s*.5,depth:ib.s*1.3}, scene);
        b.position.set(ib.x,SURF+ib.s*.25,ib.z); b.rotation.y=i*.5;
        b.material=cMat(`iceBM_${i}`, new Color3(.25,.4,.65), new Color3(.05,.1,.2), .5, scene);
    });
}

function buildBases(scene) {
    bBase(scene,-40,'fire',new Color3(.7,.3,0),new Color3(.2,.08,.0));
    bBase(scene,40,'ice',new Color3(.2,.4,.7),new Color3(.04,.1,.25));
}
function bBase(sc,z,side,col,em) {
    const base=MeshBuilder.CreateCylinder(`${side}Base`, {diameter:10,height:.8,tessellation:24}, sc);
    base.position.set(0,SURF+.4,z);
    base.material=cMat(`${side}BaseMat`, col.scale(.5), em.scale(.5), 1, sc);
    const ring=MeshBuilder.CreateTorus(`${side}Ring`, {diameter:9.5,thickness:.45,tessellation:36}, sc);
    ring.position.set(0,SURF+.85,z); ring.rotation.x=Math.PI/2;
    ring.material=cMat(`${side}RingMat`, col, em.scale(.7), .65, sc);
    const tower=MeshBuilder.CreateCylinder(`${side}Nexus`, {diameter:3.5,height:5,tessellation:16}, sc);
    tower.position.set(0,SURF+3.2,z);
    tower.material=cMat(`${side}NexusMat`, col.scale(.6), em.scale(1.2), 1, sc);
    const cap=MeshBuilder.CreateCylinder(`${side}Cap`, {diameterTop:0,diameterBottom:4,height:2,tessellation:16}, sc);
    cap.position.set(0,SURF+6.5,z);
    cap.material=cMat(`${side}CapMat`, col, em.scale(.9), 1, sc);
    const portal=MeshBuilder.CreateGround(`${side}Portal`, {width:8,height:8}, sc);
    portal.position.set(0,SURF+.82,z);
    portal.material=cMat(`${side}PortalMat`, col.scale(.3), em.scale(.4), .45, sc);
    [-7,0,7].forEach((x,i)=>{
        const dz=side==='fire'?3:-3;
        const pad=MeshBuilder.CreateGround(`${side}Pad_${i}`, {width:4.5,height:5}, sc);
        pad.position.set(x,SURF+.03,z+dz);
        pad.material=cMat(`${side}PadMat_${i}`, col.scale(.3), em.scale(.25), 1, sc);
    });
    [Math.PI/5,-Math.PI/5,Math.PI*4/5,-Math.PI*4/5].forEach((angle,i)=>{
        const tx=Math.cos(angle)*4, tz=Math.sin(angle)*4;
        const bt=MeshBuilder.CreateBox(`${side}BT_${i}`, {width:1.4,height:3.8,depth:1.4}, sc);
        bt.position.set(tx,SURF+2.6,z+tz);
        bt.material=cMat(`${side}BTMat_${i}`, col.scale(.5), em.scale(.6), 1, sc);
    });
    if(side==='fire') {
        [{dx:-2.5,dz:3.5,r:1},{dx:2.5,dz:3.5,r:1}].forEach((lp,li)=>{
            const p=MeshBuilder.CreateDisc(`fBLv_${li}`, {radius:lp.r,tessellation:16}, sc);
            p.position.set(lp.dx,SURF+.05,z+lp.dz); p.rotation.x=Math.PI/2;
            p.material=cMat(`fBLvM_${li}`, new Color3(.6,.2,.02), new Color3(.3,.1,.0), .7, sc);
        });
    } else {
        [{dx:-2.5,dz:-3.5,h:2},{dx:2.5,dz:-3.5,h:2.3}].forEach((bc,ci)=>{
            const cr=MeshBuilder.CreateCylinder(`iBCr_${ci}`, {diameterTop:.05,diameterBottom:.9,height:bc.h,tessellation:5}, sc);
            cr.position.set(bc.dx,SURF+bc.h/2,z+bc.dz); cr.rotation.y=ci*.9;
            cr.material=cMat(`iBCrM_${ci}`, new Color3(.2,.35,.7), new Color3(.05,.1,.2), .75, sc);
        });
    }
}

function buildMap(scene) {
    console.log('[Export] Building map geometry...');
    buildDiamond(scene);
    buildTriangleEdges(scene);
    buildEnergyNodes(scene);
    buildLanePaths(scene);
    buildLavaFeatures(scene);
    buildIceFeatures(scene);
    buildBases(scene);
    console.log(`[Export] Total meshes: ${scene.meshes.length}`);
}

async function main() {
    console.log('[Export] Starting headless GLB export v2...');
    const engine = new NullEngine();
    const scene = new Scene(engine);
    buildMap(scene);
    console.log('[Export] Exporting to GLB...');
    const glb = await GLTF2Export.GLBAsync(scene, 'newmap');
    const files = glb.glTFFiles;
    const glbKey = Object.keys(files).find(k => k.endsWith('.glb'));
    if (!glbKey) { console.error('[Export] No .glb found!'); process.exit(1); }
    const data = files[glbKey];
    let buffer;
    if (data instanceof ArrayBuffer) buffer = Buffer.from(data);
    else if (data instanceof Blob) buffer = Buffer.from(await data.arrayBuffer());
    else buffer = Buffer.from(data);
    writeFileSync(OUT_PATH, buffer);
    console.log(`[Export] ✅ GLB written to: ${OUT_PATH}`);
    console.log(`[Export] Size: ${(buffer.length/1024).toFixed(1)} KB`);
    engine.dispose();
    process.exit(0);
}

main().catch(err => { console.error('[Export] ❌ Failed:', err); process.exit(1); });
