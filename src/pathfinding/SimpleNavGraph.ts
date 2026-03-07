/**
 * SimpleNavGraph.ts — 3-lane waypoint graph
 *
 * AVAX logo silüeti: diamond |x|/DW + |z|/DH ≤ 1  (DW=32, DH=48)
 * Side lane'ler diamond kenarına YAPISIK:
 *   lane_x = DW*(1 - |z|/DH) - 3   (offset=3 ≈ roadHalfW + margin)
 *   - z=±33: x=±7    (dar, üçgen ucu)
 *   - z=±22: x=±14   (açılıyor)
 *   - z=±15: x=±19   (köprü)
 *   - z=±5:  x=±26   (geniş)
 *   - z=0:   x=±29   (equator, en geniş)
 *
 * Layout:
 *   Fire base:  node 0  (0, 0, -38)
 *   Ice  base:  node 24 (0, 0, +38)
 *   Left lane:  X curves from -7 → -29 → -7
 *   Mid  lane:  X = 0
 *   Right lane: X curves from +7 → +29 → +7
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export class SimpleNavGraph {
    public readonly nodes: Vector3[];
    public readonly adj: number[][];

    constructor() {
        this.nodes = [
            //  0 — fire base
            new Vector3(  0, 0, -38),

            //  1, 2 — lane starts near fire base (edge-following)
            new Vector3( -7, 0, -33),   //  1 left  lane fire
            new Vector3(  7, 0, -33),   //  2 right lane fire

            //  3, 4, 5 — before fire river
            new Vector3(-14, 0, -22),   //  3 left,  pre-river
            new Vector3(  0, 0, -20),   //  4 mid,   pre-river
            new Vector3( 14, 0, -22),   //  5 right, pre-river

            //  6, 7, 8 — fire river bridges
            new Vector3(-19, 0, -15),   //  6 left  bridge
            new Vector3(  0, 0, -15),   //  7 mid   bridge
            new Vector3( 19, 0, -15),   //  8 right bridge

            //  9, 10, 11 — past fire river (spreading to max width)
            new Vector3(-26, 0,  -5),   //  9 left
            new Vector3(  0, 0,   0),   // 10 mid center
            new Vector3( 26, 0,  -5),   // 11 right

            // 12, 13 — center line (Z=0, max spread — edge-flush)
            new Vector3(-29, 0,   0),   // 12 left  center
            new Vector3( 29, 0,   0),   // 13 right center

            // 14, 15, 16 — before ice river
            new Vector3(-26, 0,   5),   // 14 left
            new Vector3(  0, 0,   5),   // 15 mid
            new Vector3( 26, 0,   5),   // 16 right

            // 17, 18, 19 — ice river bridges
            new Vector3(-19, 0,  15),   // 17 left  bridge
            new Vector3(  0, 0,  15),   // 18 mid   bridge
            new Vector3( 19, 0,  15),   // 19 right bridge

            // 20, 21 — past ice river
            new Vector3(-14, 0,  22),   // 20 left
            new Vector3( 14, 0,  22),   // 21 right

            // 22, 23 — near ice base (converging)
            new Vector3( -7, 0,  33),   // 22 left  lane ice
            new Vector3(  7, 0,  33),   // 23 right lane ice

            // 24 — ice base
            new Vector3(  0, 0,  38),

            // 25, 26 — mid lane extensions
            new Vector3(  0, 0, -28),   // 25 mid lane fire (base → pre-river)
            new Vector3(  0, 0,  28),   // 26 mid lane ice  (post-bridge → base)
        ];

        this.adj = [
            [1, 2, 25],     //  0  fire base     → left, right, mid
            [0, 3],         //  1  left  fire     → base, pre-river
            [0, 5],         //  2  right fire     → base, pre-river
            [1, 6, 4],      //  3  left  pre-river
            [3, 7, 5, 25],  //  4  mid   pre-river
            [2, 8, 4],      //  5  right pre-river
            [3, 9],         //  6  left  bridge
            [4, 10],        //  7  mid   bridge
            [5, 11],        //  8  right bridge
            [6, 12],        //  9  left  post-bridge
            [7, 15],        // 10  mid   center
            [8, 13],        // 11  right post-bridge
            [9, 14],        // 12  left  center-line
            [11, 16],       // 13  right center-line
            [12, 17],       // 14  left  pre-ice-river
            [10, 18],       // 15  mid   pre-ice-river
            [13, 19],       // 16  right pre-ice-river
            [14, 20],       // 17  left  ice bridge
            [15, 10, 26],   // 18  mid   ice bridge  → forward via node 26
            [16, 21],       // 19  right ice bridge
            [17, 22],       // 20  left  post-ice-bridge
            [19, 23],       // 21  right post-ice-bridge
            [20, 24],       // 22  left  near ice base
            [21, 24],       // 23  right near ice base
            [22, 23, 26],   // 24  ice base
            [0, 4],         // 25  mid fire extension
            [18, 24],       // 26  mid ice  extension
        ];
    }

    closestNode(pos: Vector3): number {
        let best = 0, bestD = Infinity;
        const flat = new Vector3(pos.x, 0, pos.z);
        for (let i = 0; i < this.nodes.length; i++) {
            const d = Vector3.DistanceSquared(flat, this.nodes[i]);
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    }

    findPath(fromIdx: number, toIdx: number): Vector3[] {
        if (fromIdx === toIdx) return [this.nodes[fromIdx]];
        const visited = new Set<number>([fromIdx]);
        const queue: number[][] = [[fromIdx]];
        while (queue.length) {
            const path = queue.shift()!;
            const tip = path[path.length - 1];
            for (const nb of this.adj[tip]) {
                if (nb === toIdx) return [...path, nb].map(i => this.nodes[i]);
                if (!visited.has(nb)) { visited.add(nb); queue.push([...path, nb]); }
            }
        }
        return [this.nodes[fromIdx], this.nodes[toIdx]];
    }
}
