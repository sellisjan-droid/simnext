import { BALANCE } from '../config/balance';
import type { World } from './world';

/** One step of a trip. */
export type Leg =
  | { type: 'walk'; toX: number; queue?: boolean }
  | { type: 'ride'; shaftId: number; toFloor: number }
  | { type: 'stairs'; stairsId: number; toFloor: number };

export interface Spot {
  floor: number;
  x: number;
}

export interface Route {
  legs: Leg[];
  /** Estimated travel time in game minutes. */
  cost: number;
}

/** A place where people can board a transport: an elevator stop or the end of a staircase. */
interface Stop {
  /** Shaft or stairs id. */
  tid: number;
  stairs: boolean;
  floor: number;
  x: number;
}

/**
 * Finds the quickest way between two spots, using any mix of walking, elevators and stairs.
 * Builds a small graph of transport stops and runs Dijkstra on it.
 */
export class Router {
  private readonly world: World;
  private builtVersion = -1;
  private stops: Stop[] = [];
  private byFloor: number[][] = [];

  constructor(world: World) {
    this.world = world;
  }

  private rebuild(): void {
    const w = this.world;
    this.stops = [];
    this.byFloor = Array.from({ length: w.maxFloor + 1 }, () => []);
    const add = (s: Stop) => {
      this.byFloor[s.floor].push(this.stops.length);
      this.stops.push(s);
    };
    for (const s of w.shafts.values()) {
      for (let f = s.bottom; f <= s.top; f++) add({ tid: s.id, stairs: false, floor: f, x: w.shaftCenter(s) });
    }
    for (const s of w.stairs.values()) {
      add({ tid: s.id, stairs: true, floor: s.floor, x: w.stairsPoint(s, s.floor) });
      if (s.floor + 1 <= w.maxFloor) add({ tid: s.id, stairs: true, floor: s.floor + 1, x: w.stairsPoint(s, s.floor + 1) });
    }
    this.builtVersion = w.version;
  }

  private rideCost(a: Stop, b: Stop): number {
    if (a.stairs) return BALANCE.transport.stairs.climbMinutes * Math.abs(a.floor - b.floor);
    const shaft = this.world.shafts.get(a.tid)!;
    const spec = BALANCE.transport[shaft.kind];
    const queue = shaft.waiting.length / spec.capacity;
    return BALANCE.people.rideOverheadMinutes + queue * 4 + Math.abs(a.floor - b.floor) / spec.speed;
  }

  find(from: Spot, to: Spot): Route | null {
    const w = this.world;
    const walkSpeed = BALANCE.people.walkCellsPerMinute;
    if (from.floor === to.floor && w.canWalk(from.floor, from.x, to.x)) {
      return { legs: [{ type: 'walk', toX: to.x }], cost: Math.abs(from.x - to.x) / walkSpeed };
    }
    if (this.builtVersion !== w.version) this.rebuild();
    const stops = this.stops;
    const n = stops.length;
    const dist = new Array<number>(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);

    for (const i of this.byFloor[from.floor] ?? []) {
      if (w.canWalk(from.floor, from.x, stops[i].x)) dist[i] = Math.abs(from.x - stops[i].x) / walkSpeed;
    }

    let bestCost = Infinity;
    let bestEnd = -1;
    for (;;) {
      // Plain O(n^2) Dijkstra: the graph is small (a few hundred stops at most).
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] >= bestCost) break;
      done[u] = true;
      const su = stops[u];
      if (su.floor === to.floor && w.canWalk(to.floor, su.x, to.x)) {
        const c = dist[u] + Math.abs(su.x - to.x) / walkSpeed;
        if (c < bestCost) {
          bestCost = c;
          bestEnd = u;
        }
      }
      for (let v = 0; v < n; v++) {
        if (done[v] || v === u) continue;
        const sv = stops[v];
        let c: number;
        if (sv.tid === su.tid) {
          // Same transport: ride or climb.
          if (su.stairs && Math.abs(sv.floor - su.floor) !== 1) continue;
          c = this.rideCost(su, sv);
        } else if (sv.floor === su.floor && w.canWalk(su.floor, su.x, sv.x)) {
          c = Math.abs(su.x - sv.x) / walkSpeed + 0.2;
        } else continue;
        if (dist[u] + c < dist[v]) {
          dist[v] = dist[u] + c;
          prev[v] = u;
        }
      }
    }
    if (bestEnd < 0) return null;

    const path: number[] = [];
    for (let i = bestEnd; i >= 0; i = prev[i]) path.unshift(i);
    const legs: Leg[] = [];
    const first = stops[path[0]];
    legs.push({ type: 'walk', toX: first.x, queue: !first.stairs });
    for (let k = 1; k < path.length; k++) {
      const a = stops[path[k - 1]];
      const b = stops[path[k]];
      if (a.tid === b.tid) {
        legs.push(a.stairs ? { type: 'stairs', stairsId: a.tid, toFloor: b.floor } : { type: 'ride', shaftId: a.tid, toFloor: b.floor });
      } else {
        legs.push({ type: 'walk', toX: b.x, queue: !b.stairs });
      }
    }
    legs.push({ type: 'walk', toX: to.x });
    return { legs, cost: bestCost };
  }
}
