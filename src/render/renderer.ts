import { Application, Container, Graphics } from 'pixi.js';
import type { Simulation } from '../game/sim';
import type { Room } from '../game/world';

/** Size of one grid cell in world pixels. */
export const CELL_W = 12;
export const FLOOR_H = 36;
const SLAB = 3;

/** A highlighted rectangle in grid cells, used while building. */
export interface Preview {
  x0: number;
  x1: number; // exclusive
  floor0: number;
  floor1: number; // inclusive
  ok: boolean;
}

const COLORS = {
  ground: 0x5b4636,
  groundDeep: 0x4a3a2e,
  grass: 0x5e8c3a,
  plot: 0xffffff,
  lobbyWall: 0xe2d3b5,
  lobbyTrim: 0xb08d57,
  floorWall: 0x9aa1a8,
  slab: 0x5d636b,
  officeWall: 0xcfd8e1,
  officeTrim: 0x5b6774,
  aptWall: 0xead6b8,
  aptTrim: 0x8a6440,
  shaft: 0x2f343b,
  shaftRail: 0x4b525b,
  car: 0xf2c14e,
  carEdge: 0x9c7a22,
  windowDay: 0x9fc4e0,
  windowNight: 0x3a4658,
  windowLit: 0xffe08a,
  vacant: 0x000000,
  forRent: 0xd9534f,
};

/** Sky colour through the day: [hour, colour]. */
const SKY: [number, number][] = [
  [0, 0x0b1530],
  [5, 0x0b1530],
  [6, 0x4a3f72],
  [6.8, 0xf0a868],
  [7.5, 0xbfd8e6],
  [8.5, 0x8ecdf2],
  [17, 0x8ecdf2],
  [18.2, 0xf3c07e],
  [19.2, 0xd2697a],
  [20.5, 0x14204a],
  [24, 0x0b1530],
];

function lerpColor(a: number, b: number, t: number): number {
  const ar = a >> 16, ag = (a >> 8) & 255, ab = a & 255;
  const br = b >> 16, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function skyColor(hour: number): number {
  for (let i = 0; i < SKY.length - 1; i++) {
    const [h0, c0] = SKY[i];
    const [h1, c1] = SKY[i + 1];
    if (hour >= h0 && hour <= h1) return lerpColor(c0, c1, (hour - h0) / (h1 - h0));
  }
  return SKY[0][1];
}

/** Shuffled but stable order in which windows light up, so lights don't fill left to right. */
function litOrder(i: number, n: number): number {
  return n % 7 === 0 ? i : (i * 7 + 3) % n;
}

/** Top y (in world pixels) of a floor. Floor 0 sits right on the ground at y = 0. */
export function floorTop(floor: number): number {
  return -(floor + 1) * FLOOR_H;
}

export class Renderer {
  readonly app: Application;
  readonly camera = new Container();
  private readonly sim: Simulation;
  private readonly staticG = new Graphics();
  private readonly dynamicG = new Graphics();
  private readonly previewG = new Graphics();
  private drawnVersion = -1;

  constructor(app: Application, sim: Simulation) {
    this.app = app;
    this.sim = sim;
    this.camera.addChild(this.staticG, this.dynamicG, this.previewG);
    app.stage.addChild(this.camera);
  }

  draw(preview: Preview | null): void {
    const night = this.isNight();
    this.app.renderer.background.color = skyColor(this.sim.hourOfDay);
    if (this.drawnVersion !== this.sim.world.version) {
      this.drawStatic();
      this.drawnVersion = this.sim.world.version;
    }
    this.drawDynamic(night);
    this.drawPreview(preview);
  }

  private isNight(): boolean {
    const h = this.sim.hourOfDay;
    return h < 6.5 || h >= 19.5;
  }

  /** Everything that only changes when the player builds or demolishes. */
  private drawStatic(): void {
    const g = this.staticG;
    const w = this.sim.world;
    g.clear();
    const plotW = w.width * CELL_W;

    // Ground and buildable area.
    g.rect(-4000, 0, plotW + 8000, 2000).fill(COLORS.groundDeep);
    g.rect(-4000, 0, plotW + 8000, 60).fill(COLORS.ground);
    g.rect(-4000, 0, plotW + 8000, 4).fill(COLORS.grass);
    g.rect(0, floorTop(w.maxFloor), plotW, (w.maxFloor + 1) * FLOOR_H).fill({ color: COLORS.plot, alpha: 0.06 });
    g.rect(0, 0, plotW, 4).fill(0x8a7a5a);

    // Bare floor and lobby, drawn as horizontal runs.
    for (let f = 0; f <= w.maxFloor; f++) {
      let x = 0;
      while (x < w.width) {
        const base = w.cells[f][x].base;
        if (base === 'none') {
          x++;
          continue;
        }
        let end = x;
        while (end < w.width && w.cells[f][end].base === base) end++;
        const y = floorTop(f);
        const px = x * CELL_W;
        const pw = (end - x) * CELL_W;
        if (base === 'lobby') {
          g.rect(px, y, pw, FLOOR_H).fill(COLORS.lobbyWall);
          g.rect(px, y, pw, 4).fill(COLORS.lobbyTrim);
          // Pillars every few cells.
          for (let c = x; c < end; c += 6) g.rect(c * CELL_W, y + 4, 3, FLOOR_H - 4).fill({ color: COLORS.lobbyTrim, alpha: 0.5 });
        } else {
          g.rect(px, y, pw, FLOOR_H).fill(COLORS.floorWall);
        }
        g.rect(px, y + FLOOR_H - SLAB, pw, SLAB).fill(COLORS.slab);
        x = end;
      }
    }

    for (const room of w.rooms.values()) this.drawRoomShell(g, room);

    for (const s of w.shafts.values()) {
      const px = s.x * CELL_W;
      const y = floorTop(s.top);
      const h = (s.top - s.bottom + 1) * FLOOR_H;
      g.rect(px, y, s.width * CELL_W, h).fill(COLORS.shaft);
      g.rect(px + 4, y, 2, h).fill(COLORS.shaftRail);
      g.rect(px + s.width * CELL_W - 6, y, 2, h).fill(COLORS.shaftRail);
      for (let f = s.bottom; f <= s.top; f++) {
        g.rect(px, floorTop(f) + FLOOR_H - SLAB, s.width * CELL_W, SLAB).fill(COLORS.slab);
      }
    }
  }

  private drawRoomShell(g: Graphics, room: Room): void {
    const px = room.x * CELL_W;
    const y = floorTop(room.floor);
    const pw = room.width * CELL_W;
    const isOffice = room.kind === 'office';
    g.rect(px, y, pw, FLOOR_H).fill(isOffice ? COLORS.officeWall : COLORS.aptWall);
    g.rect(px, y, pw, FLOOR_H).stroke({ width: 1, color: isOffice ? COLORS.officeTrim : COLORS.aptTrim, alignment: 1 });
    g.rect(px, y + FLOOR_H - SLAB, pw, SLAB).fill(COLORS.slab);
    if (!isOffice) {
      // Front door.
      g.rect(px + pw / 2 - 4, y + FLOOR_H - SLAB - 18, 8, 18).fill(COLORS.aptTrim);
    }
  }

  /** Window rectangles of a room, in world pixels. */
  private windows(room: Room): [number, number, number, number][] {
    const px = room.x * CELL_W;
    const y = floorTop(room.floor);
    const pw = room.width * CELL_W;
    const out: [number, number, number, number][] = [];
    if (room.kind === 'office') {
      const n = Math.floor(pw / 18);
      const gap = (pw - n * 12) / (n + 1);
      for (let i = 0; i < n; i++) {
        const wx = px + gap + i * (12 + gap);
        out.push([wx, y + 6, 12, 10], [wx, y + 19, 12, 10]);
      }
    } else {
      const doorL = px + pw / 2 - 4;
      out.push([px + 10, y + 9, 22, 14], [px + pw - 32, y + 9, 22, 14]);
      out.push([doorL - 26, y + 9, 14, 14], [doorL + 20, y + 9, 14, 14]);
    }
    return out;
  }

  /** Things that change every frame: lights, elevators and people. */
  private drawDynamic(night: boolean): void {
    const g = this.dynamicG;
    const sim = this.sim;
    const w = sim.world;
    g.clear();

    for (const room of w.rooms.values()) {
      let home = 0;
      for (const id of room.peopleIds) if (sim.people.get(id)?.state === 'inside') home++;
      // Light up a share of the windows that matches how many people are in.
      const showLights = room.kind === 'office' || night;
      const wins = this.windows(room);
      const litCount = showLights && room.peopleIds.length ? Math.ceil((wins.length * home) / room.peopleIds.length) : 0;
      const dark = night ? COLORS.windowNight : COLORS.windowDay;
      wins.forEach(([x, y, ww, hh], i) => g.rect(x, y, ww, hh).fill(litOrder(i, wins.length) < litCount ? COLORS.windowLit : dark));

      const px = room.x * CELL_W;
      const y = floorTop(room.floor);
      const pw = room.width * CELL_W;
      if (!room.rented) {
        g.rect(px, y, pw, FLOOR_H - SLAB).fill({ color: COLORS.vacant, alpha: 0.35 });
        // "For rent" sign.
        g.rect(px + pw / 2 - 10, y + 4, 20, 8).fill(COLORS.forRent);
        g.rect(px + pw / 2 - 7, y + 7, 14, 2).fill(0xffffff);
      } else {
        const moodColor = room.mood >= 60 ? 0x4caf50 : room.mood >= 35 ? 0xf0ad4e : 0xd9534f;
        g.circle(px + pw - 5, y + 5, 2.5).fill(moodColor);
      }
    }

    for (const s of w.shafts.values()) {
      const car = s.car;
      const px = s.x * CELL_W + 7;
      const cw = s.width * CELL_W - 14;
      const y = -(car.floor + 1) * FLOOR_H + 3;
      const ch = FLOOR_H - SLAB - 3;
      g.rect(px, y, cw, ch).fill(car.state === 'doors' ? 0xffe9a8 : COLORS.car).stroke({ width: 1, color: COLORS.carEdge });
      // One dot per passenger.
      car.riders.forEach((_, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        g.rect(px + 3 + col * 6, y + ch - 10 - row * 11, 3, 8).fill(0x333333);
      });
    }

    for (const p of sim.people.values()) {
      if (p.state !== 'walking' && p.state !== 'waiting') continue;
      const x = p.x * CELL_W;
      const yBase = floorTop(p.floor) + FLOOR_H - SLAB;
      g.rect(x - 1.5, yBase - 9, 3, 6).fill(p.color);
      g.circle(x, yBase - 10.5, 1.8).fill(0xf1c7a0);
      g.rect(x - 1.5, yBase - 3, 1, 3).fill(0x222222);
      g.rect(x + 0.5, yBase - 3, 1, 3).fill(0x222222);
    }
  }

  private drawPreview(preview: Preview | null): void {
    const g = this.previewG;
    g.clear();
    if (!preview) return;
    const x = preview.x0 * CELL_W;
    const y = floorTop(preview.floor1);
    const w = (preview.x1 - preview.x0) * CELL_W;
    const h = (preview.floor1 - preview.floor0 + 1) * FLOOR_H;
    const color = preview.ok ? 0x4caf50 : 0xd9534f;
    g.rect(x, y, w, h).fill({ color, alpha: 0.35 }).stroke({ width: 2, color, alignment: 1 });
  }
}
