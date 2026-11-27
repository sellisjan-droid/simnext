import { Container, Graphics, Text } from 'pixi.js';
import { BALANCE } from '../config/balance';
import type { Look, Person, Simulation } from '../game/sim';
import type { Room } from '../game/world';
import { roomSpots } from './building';
import { CELL_W, FLOOR_H, SLAB, floorSurface, floorTop, seededRandom } from './geometry';

/** Visible part of the world, in world pixels. */
export interface View {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

type Pose = 'walk' | 'stand' | 'sit';

interface StreetCar {
  x: number;
  dir: 1 | -1;
  speed: number;
  color: number;
  long: boolean;
}

interface FloatText {
  text: Text;
  life: number;
}

const SIGN_STYLE = { fontFamily: 'system-ui, sans-serif', fontSize: 7, fontWeight: '700' as const, fill: 0xffffff, letterSpacing: 0.5 };
const MONEY_STYLE = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  fontWeight: '800' as const,
  fill: 0x7dff9a,
  stroke: { color: 0x0b2a14, width: 3 },
};

/** Draw one little person with their feet at (x, feet). */
export function drawPerson(g: Graphics, x: number, feet: number, look: Look, facing: number, pose: Pose, phase: number): void {
  const s = look.small ? 0.72 : 1;
  const legH = 5 * s;
  if (pose === 'sit') {
    g.rect(x - 1, feet - 6 * s, 5 * s * facing, 1.8 * s).fill(look.bottom);
    g.rect(x - 1 + 4 * s * facing, feet - 6 * s, 1.6 * s, 6 * s).fill(look.bottom);
    feet -= 4 * s;
  } else {
    const swing = pose === 'walk' ? Math.sin(phase) * 1.8 * s : 0;
    g.rect(x - 1.8 * s + swing, feet - legH, 1.6 * s, legH).fill(look.bottom);
    g.rect(x + 0.2 * s - swing, feet - legH, 1.6 * s, legH).fill(look.bottom);
  }
  // Body and arm.
  g.rect(x - 2.5 * s, feet - legH - 6 * s, 5 * s, 6.5 * s).fill(look.top);
  const armSwing = pose === 'walk' ? Math.sin(phase + Math.PI) * 1.2 : 0;
  g.rect(x - 0.7 * s + armSwing, feet - legH - 5.5 * s, 1.4 * s, 5 * s).fill({ color: 0x000000, alpha: 0.18 });
  // Head with hair.
  const hy = feet - legH - 8.6 * s;
  g.circle(x, hy, 2.6 * s).fill(look.hair);
  g.circle(x + facing * 0.5 * s, hy + 0.5 * s, 2.2 * s).fill(look.skin);
  g.rect(x - 2.6 * s, hy - 2.6 * s, 5.2 * s, 1.6 * s).fill(look.hair);
  if (pose === 'sit') return;
  // Things people carry.
  if (look.carry === 1) g.rect(x + facing * 2.6 - 1.5, feet - 5.5, 3.2, 2.6).fill(0x4a3424);
  else if (look.carry === 2) {
    g.rect(x - facing * 6 - 2, feet - 6, 4.5, 6).fill(0x7a5236);
    g.rect(x - facing * 6 - 0.5, feet - 7.5, 1.5, 1.5).fill(0x2b2b2b);
  } else if (look.carry === 3) g.rect(x + facing * 3 - 1.5, feet - 6.5, 3.4, 3.6).fill(0xf15bb5);
}

/**
 * Everything that changes every frame: room lights, people, elevator cars,
 * street traffic, signs and floating money.
 */
export class Actors {
  readonly g = new Graphics();
  readonly fx = new Container();
  private readonly sim: Simulation;
  private readonly signs = new Map<number, Text>();
  private readonly floats: FloatText[] = [];
  private readonly cars: StreetCar[] = [];
  private time = 0;

  constructor(sim: Simulation) {
    this.sim = sim;
    const r = seededRandom(42);
    const colors = [0xd9534f, 0x4f81bd, 0xf0ad4e, 0xeeeeee, 0x333a44, 0x5cb85c, 0x8e44ad];
    for (let i = 0; i < 14; i++) {
      this.cars.push({ x: r() * 6000 - 2000, dir: r() < 0.5 ? 1 : -1, speed: 60 + r() * 70, color: colors[Math.floor(r() * colors.length)], long: r() < 0.15 });
    }
  }

  draw(view: View, dark: number, lamps: number[], realSeconds: number): void {
    this.time += realSeconds;
    const g = this.g;
    g.clear();
    const sim = this.sim;
    const w = sim.world;
    const hour = sim.hourOfDay;
    const inView = (x: number, y: number, ww: number, hh: number) => x + ww >= view.x0 && x <= view.x1 && y + hh >= view.y0 && y <= view.y1;

    // Who is inside which room.
    const inside = new Map<number, Person[]>();
    for (const p of sim.people.values()) {
      if (p.state !== 'inside' || !p.atRoom) continue;
      let list = inside.get(p.atRoom);
      if (!list) inside.set(p.atRoom, (list = []));
      list.push(p);
    }

    // Night shade over unlit parts of the building.
    if (dark > 0.02) {
      for (let f = 0; f <= w.maxFloor; f++) {
        const y = floorTop(f);
        if (y + FLOOR_H < view.y0 || y > view.y1) continue;
        let x = 0;
        while (x < w.width) {
          const c = w.cells[f][x];
          if (c.base === 'none' || c.occupant) {
            x++;
            continue;
          }
          let end = x;
          while (end < w.width && w.cells[f][end].base !== 'none' && !w.cells[f][end].occupant) end++;
          if (c.base === 'floor') g.rect(x * CELL_W, y, (end - x) * CELL_W, FLOOR_H).fill({ color: 0x050816, alpha: dark * 0.72 });
          else g.rect(x * CELL_W, y, (end - x) * CELL_W, FLOOR_H - SLAB).fill({ color: 0xffd27a, alpha: dark * 0.08 });
          x = end;
        }
      }
      for (const s of w.shafts.values()) {
        g.rect(s.x * CELL_W, floorTop(s.top), s.width * CELL_W, (s.top - s.bottom + 1) * FLOOR_H).fill({ color: 0x050816, alpha: dark * 0.5 });
      }
      for (const s of w.stairs.values()) g.rect(s.x * CELL_W, floorTop(s.floor), s.width * CELL_W, FLOOR_H).fill({ color: 0x0a0f24, alpha: dark * 0.3 });
    }

    const sleeping = hour >= 23 || hour < 6.5;
    for (const room of w.rooms.values()) {
      const px = room.x * CELL_W;
      const y = floorTop(room.floor);
      const pw = room.width * CELL_W;
      if (!inView(px, y, pw, FLOOR_H)) {
        this.signFor(room, null);
        continue;
      }
      const people = inside.get(room.id) ?? [];
      const venue = room.kind === 'shop' || room.kind === 'restaurant';
      const open = venue && isOpen(room, hour);
      const lit = venue ? open : people.length > 0 && !(sleeping && room.kind !== 'office');
      if (dark > 0.02) {
        if (lit) {
          g.rect(px, y, pw, FLOOR_H - SLAB).fill({ color: 0xffc860, alpha: dark * 0.14 });
          for (let lx = px + 20; lx < px + pw - 10; lx += 40) g.circle(lx, y + 8, 14).fill({ color: 0xfff1b8, alpha: dark * 0.12 });
        } else {
          g.rect(px, y, pw, FLOOR_H - SLAB).fill({ color: 0x050816, alpha: dark * 0.78 });
        }
      }
      if (!lit && !venue && room.kind !== 'hotel' && !room.rented) {
        g.rect(px, y, pw, FLOOR_H - SLAB).fill({ color: 0x1a1f2b, alpha: 0.28 });
      }

      // People inside.
      if (!(sleeping && room.kind !== 'office')) this.drawInside(g, room, people);

      // Mood light (green, orange, red) for rooms with tenants or customers.
      if (room.rented || venue) {
        const color = room.mood >= 60 ? 0x4cd964 : room.mood >= 35 ? 0xf0ad4e : 0xff3b30;
        g.circle(px + pw - 7, y + 9, 2.6).fill(0x1b1f27).circle(px + pw - 7, y + 9, 2).fill(color);
      }

      // Signs.
      let sign: string | null = null;
      if ((room.kind === 'office' || room.kind === 'apartment') && !room.rented) sign = 'TE HUUR';
      else if (venue && !open) sign = 'GESLOTEN';
      else if (venue && room.visitors >= BALANCE.rooms[room.kind as 'shop' | 'restaurant'].capacity) sign = 'VOL';
      if (sign) {
        const sw = sign.length * 5 + 8;
        g.roundRect(px + pw / 2 - sw / 2, y + 12, sw, 11, 2).fill(sign === 'TE HUUR' ? 0xd23c3c : sign === 'VOL' ? 0xe08a1e : 0x4a505a);
      }
      this.signFor(room, sign);
    }

    // People out and about.
    for (const p of sim.people.values()) {
      if (p.state === 'walking' || p.state === 'waiting') {
        const x = p.x * CELL_W;
        const feet = floorSurface(p.floor);
        if (!inView(x - 10, feet - 20, 20, 20)) continue;
        const phase = p.x * 2.4;
        drawPerson(g, x, feet, p.look, p.facing, p.state === 'walking' ? 'walk' : 'stand', phase);
      } else if (p.state === 'climbing') {
        const leg = p.legs[0];
        if (leg?.type !== 'stairs') continue;
        const t = Math.min(1, p.climb);
        const fromFeet = floorSurface(p.climbFrom);
        const toFeet = floorSurface(leg.toFloor);
        const feet = fromFeet + (toFeet - fromFeet) * t;
        drawPerson(g, p.x * CELL_W, feet, p.look, p.facing, 'walk', p.climb * 30);
      }
    }

    // Elevator cars.
    for (const s of w.shafts.values()) {
      const car = s.car;
      const px = s.x * CELL_W + 5;
      const cw = s.width * CELL_W - 10;
      const ch = FLOOR_H - SLAB - 6;
      const top = -(car.floor + 1) * FLOOR_H + 6;
      if (!inView(px, top, cw, ch)) continue;
      const spec = BALANCE.transport[s.kind];
      g.rect(px, top, cw, ch).fill(s.kind === 'express' ? 0xc9a13a : 0x9aa1ab);
      g.rect(px + 2, top + 2, cw - 4, ch - 4).fill(0xfff1c9);
      // Riders standing inside.
      const n = car.riders.length;
      for (let i = 0; i < n; i++) {
        const rider = sim.people.get(car.riders[i]);
        if (!rider) continue;
        const col = i % Math.max(1, Math.floor((cw - 6) / 5));
        const row = Math.floor(i / Math.max(1, Math.floor((cw - 6) / 5)));
        const rx = px + 5 + col * 5;
        drawPerson(g, rx, top + ch - 2 - row * 3, rider.look, 1, 'stand', 0);
      }
      // Sliding doors.
      let open = 0;
      if (car.state === 'doors') {
        const t = car.timer / spec.doorMinutes;
        open = Math.max(0, Math.min(1, (1 - t) * 5, t * 5));
      }
      const half = (cw - 4) / 2;
      const panel = half * (1 - open);
      if (panel > 0.5) {
        g.rect(px + 2, top + 2, panel, ch - 4).fill(0xb8bec6);
        g.rect(px + 2 + (cw - 4) - panel, top + 2, panel, ch - 4).fill(0xb8bec6);
        g.rect(px + 2 + panel - 1, top + 2, 1, ch - 4).fill(0x8a919b);
      }
      g.rect(px, top - 2, cw, 2).fill(0x4a505a);
      if (car.dir !== 0) {
        const ax = px + cw / 2;
        const ay = top - 6;
        g.poly(car.dir > 0 ? [ax - 3, ay + 2, ax + 3, ay + 2, ax, ay - 2] : [ax - 3, ay - 2, ax + 3, ay - 2, ax, ay + 2]).fill(0x7fff9a);
      }
    }

    this.drawStreet(g, view, dark, lamps, realSeconds);
    this.drawFloats(realSeconds);
  }

  private drawInside(g: Graphics, room: Room, people: Person[]): void {
    if (!people.length) return;
    const spots = roomSpots(room);
    const px = room.x * CELL_W;
    const feet = floorSurface(room.floor);
    people.forEach((p, i) => {
      if (i >= spots.length * 2) return;
      const k = i % spots.length;
      const extra = i >= spots.length ? 7 : 0;
      const x = px + spots[k] + extra;
      let pose: Pose = 'stand';
      let facing = (p.id % 2 ? 1 : -1) as 1 | -1;
      if (room.kind === 'office') {
        pose = 'sit';
        facing = 1;
      } else if (room.kind === 'restaurant') {
        pose = 'sit';
        facing = k % 2 === 0 ? 1 : -1;
      } else if (room.kind === 'apartment' && (k === 1 || k === 2)) {
        pose = 'sit';
        facing = 1;
      }
      // Little idle bob so rooms feel alive.
      const bob = pose === 'stand' ? Math.max(0, Math.sin(this.time * 2 + p.id)) * 0.6 : 0;
      drawPerson(g, x, feet - (pose === 'sit' ? 2 : 0) - bob, p.look, facing, pose, 0);
    });
  }

  private signFor(room: Room, label: string | null): void {
    let t = this.signs.get(room.id);
    if (!label) {
      if (t) t.visible = false;
      return;
    }
    if (!t) {
      t = new Text({ text: label, style: SIGN_STYLE, resolution: 4 });
      t.anchor.set(0.5, 0.5);
      this.fx.addChild(t);
      this.signs.set(room.id, t);
    }
    if (t.text !== label) t.text = label;
    t.visible = true;
    t.position.set((room.x + room.width / 2) * CELL_W, floorTop(room.floor) + 17.5);
  }

  /** Remove signs for rooms that no longer exist. */
  pruneSigns(): void {
    for (const [id, t] of this.signs) {
      if (!this.sim.world.rooms.has(id)) {
        t.destroy();
        this.signs.delete(id);
      }
    }
  }

  private drawStreet(g: Graphics, view: View, dark: number, lamps: number[], dt: number): void {
    const plotW = this.sim.world.width * CELL_W;
    const minX = -2500;
    const maxX = plotW + 2500;
    for (const c of this.cars) {
      c.x += c.dir * c.speed * dt;
      if (c.x > maxX) c.x = minX;
      if (c.x < minX) c.x = maxX;
      const len = c.long ? 56 : 34;
      const laneY = c.dir > 0 ? 27 : 43;
      if (c.x + len < view.x0 || c.x - len > view.x1) continue;
      const x = c.x - len / 2;
      g.rect(x, laneY - 10, len, 8).fill(c.long ? 0xf2c14e : c.color);
      if (c.long) g.rect(x + 3, laneY - 15, len - 6, 6).fill(0xf2c14e);
      else g.roundRect(x + len * 0.25, laneY - 15, len * 0.5, 6, 2).fill(c.color);
      g.rect(x + len * 0.3, laneY - 14, len * 0.18, 4).fill(0xbfe3f7);
      g.rect(x + len * 0.52, laneY - 14, len * 0.18, 4).fill(0xbfe3f7);
      g.circle(x + 7, laneY - 2, 3).fill(0x1b1b1b);
      g.circle(x + len - 7, laneY - 2, 3).fill(0x1b1b1b);
      const front = c.dir > 0 ? x + len : x;
      if (dark > 0.2) {
        g.poly([front, laneY - 8, front + c.dir * 46, laneY - 14, front + c.dir * 46, laneY + 2]).fill({ color: 0xfff3b0, alpha: 0.18 * dark });
        g.rect(c.dir > 0 ? x : x + len - 2, laneY - 8, 2, 3).fill(0xff3b30);
      }
    }
    if (dark > 0.2) {
      for (const lx of lamps) {
        if (lx < view.x0 - 50 || lx > view.x1 + 50) continue;
        g.circle(lx, -42, 28).fill({ color: 0xffe08a, alpha: 0.12 * dark });
        g.circle(lx, -42, 4).fill({ color: 0xfff6d0, alpha: dark });
      }
    }
  }

  /** Show "+ €" pops for money the simulation reported. */
  private drawFloats(dt: number): void {
    const pops = this.sim.moneyPops.splice(0);
    for (const pop of pops) {
      if (this.floats.length > 40) break;
      const t = new Text({ text: `+€${pop.amount.toLocaleString('nl-NL')}`, style: MONEY_STYLE, resolution: 3 });
      t.anchor.set(0.5, 1);
      t.position.set(pop.x * CELL_W, floorTop(pop.floor) + 6);
      this.fx.addChild(t);
      this.floats.push({ text: t, life: 1 });
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt / 1.6;
      f.text.y -= 22 * dt;
      f.text.alpha = Math.min(1, f.life * 2);
      if (f.life <= 0) {
        f.text.destroy();
        this.floats.splice(i, 1);
      }
    }
  }
}

function isOpen(room: Room, hour: number): boolean {
  if (room.kind !== 'shop' && room.kind !== 'restaurant') return true;
  const [a, b] = BALANCE.rooms[room.kind].open;
  return hour >= a && hour < b;
}
