import type { Graphics } from 'pixi.js';
import type { Room, Shaft, Stairs, World } from '../game/world';
import { CELL_W, FLOOR_H, SLAB, floorSurface, floorTop, seededRandom } from './geometry';

/**
 * Static art: ground, street, lobby, floors, room interiors, shafts and stairs.
 * Only redrawn when the building changes.
 */

const C = {
  soilTop: 0x5e4a3a,
  soil: 0x3f3128,
  sidewalk: 0xa7a59f,
  sidewalkLine: 0x8f8d87,
  curb: 0x6d6b66,
  road: 0x34363b,
  roadLine: 0xe8d36a,
  facade: 0x2b2f36,
  parapet: 0x4a505a,
  parapetCap: 0x7a828e,
  slab: 0x4b5058,
  emptyWall: 0x9aa1a9,
  emptyColumn: 0x858c95,
  emptyCeiling: 0x7b828b,
  lobbyWall: 0xf2e7d0,
  lobbyWainscot: 0xc49a5e,
  lobbyColumn: 0xe3d3b0,
  marbleA: 0xece6da,
  marbleB: 0xd5cdbd,
  glass: 0x9fd0ea,
  frame: 0x3a3f47,
  wood: 0x8a5a2b,
  woodDark: 0x5a3a22,
  plant: 0x4f9a4a,
  plantDark: 0x3a7a38,
  pot: 0xb5653a,
  shaftBack: 0x22262c,
  rail: 0x3c424b,
  cable: 0x5a606a,
  express: 0xd4a73a,
};

export function drawBuilding(g: Graphics, w: World): void {
  g.clear();
  drawGround(g, w);
  for (let f = 0; f <= w.maxFloor; f++) drawFloorRuns(g, w, f);
  for (const room of w.rooms.values()) drawRoom(g, room);
  for (const s of w.stairs.values()) drawStairs(g, s);
  for (const s of w.shafts.values()) drawShaft(g, s);
  drawFacade(g, w);
}

// ---- Ground and street ----------------------------------------------------

function drawGround(g: Graphics, w: World): void {
  const plotW = w.width * CELL_W;
  const L = -4000;
  const W = plotW + 8000;
  g.rect(L, 0, W, 2000).fill(C.soil);
  g.rect(L, 0, W, 120).fill(C.soilTop);
  for (let i = 0; i < 6; i++) g.rect(L, 120 + i * 30, W, 30).fill({ color: 0x000000, alpha: 0.05 * i });
  // Sidewalk, curb and road (seen in cross-section).
  g.rect(L, 0, W, 10).fill(C.sidewalk);
  for (let x = Math.floor(L / 40) * 40; x < L + W; x += 40) g.rect(x, 0, 1, 10).fill(C.sidewalkLine);
  g.rect(L, 10, W, 3).fill(C.curb);
  g.rect(L, 13, W, 34).fill(C.road);
  for (let x = Math.floor(L / 60) * 60; x < L + W; x += 60) g.rect(x, 29, 30, 2).fill(C.roadLine);
  g.rect(L, 47, W, 3).fill(C.curb);

  // Trees and lamp posts along the street, but not inside the building.
  const r = seededRandom(3);
  for (let x = -1800; x < plotW + 1800; x += 70 + Math.floor(r() * 60)) {
    const cell = Math.floor(x / CELL_W);
    if (w.hasBase(0, cell) || w.hasBase(0, cell - 1) || w.hasBase(0, cell + 1)) continue;
    if (r() < 0.6) drawTree(g, x, r);
    else drawLamp(g, x);
  }
}

function drawTree(g: Graphics, x: number, r: () => number): void {
  const h = 30 + r() * 26;
  g.rect(x - 2, -h * 0.55, 4, h * 0.55).fill(0x5a3e2b);
  const green = r() < 0.5 ? C.plant : 0x5aa64a;
  g.circle(x, -h * 0.65, h * 0.32).fill(C.plantDark);
  g.circle(x - h * 0.18, -h * 0.55, h * 0.24).fill(green);
  g.circle(x + h * 0.16, -h * 0.75, h * 0.26).fill(green);
  g.circle(x + h * 0.05, -h * 0.9, h * 0.2).fill(0x6dbb5a);
}

function drawLamp(g: Graphics, x: number): void {
  g.rect(x - 1, -46, 2, 46).fill(0x3a3f47);
  g.rect(x - 1, -46, 10, 2).fill(0x3a3f47);
  g.rect(x + 6, -45, 6, 3).fill(0xe8e2c8);
}

/** x positions of the street lamps, so the renderer can make them glow at night. */
export function lampPositions(w: World): number[] {
  const plotW = w.width * CELL_W;
  const out: number[] = [];
  const r = seededRandom(3);
  for (let x = -1800; x < plotW + 1800; x += 70 + Math.floor(r() * 60)) {
    const cell = Math.floor(x / CELL_W);
    if (w.hasBase(0, cell) || w.hasBase(0, cell - 1) || w.hasBase(0, cell + 1)) continue;
    if (r() < 0.6) {
      // Same random draws as drawTree, to stay in sync.
      r();
      r();
    } else out.push(x + 9);
  }
  return out;
}

// ---- Bare floor and lobby -------------------------------------------------

function drawFloorRuns(g: Graphics, w: World, f: number): void {
  let x = 0;
  while (x < w.width) {
    const base = w.cells[f][x].base;
    if (base === 'none') {
      x++;
      continue;
    }
    let end = x;
    while (end < w.width && w.cells[f][end].base === base) end++;
    if (base === 'lobby') drawLobby(g, w, x, end);
    else drawEmptyFloor(g, f, x, end);
    x = end;
  }
}

function drawEmptyFloor(g: Graphics, f: number, x0: number, x1: number): void {
  const y = floorTop(f);
  const px = x0 * CELL_W;
  const pw = (x1 - x0) * CELL_W;
  g.rect(px, y, pw, FLOOR_H).fill(C.emptyWall);
  g.rect(px, y, pw, 4).fill(C.emptyCeiling);
  for (let c = Math.ceil(x0 / 4) * 4; c < x1; c += 4) g.rect(c * CELL_W - 3, y + 4, 6, FLOOR_H - 4).fill(C.emptyColumn);
  g.rect(px, y + FLOOR_H - SLAB, pw, SLAB).fill(C.slab);
}

function drawLobby(g: Graphics, w: World, x0: number, x1: number): void {
  const y = floorTop(0);
  const surf = floorSurface(0);
  const px = x0 * CELL_W;
  const pw = (x1 - x0) * CELL_W;
  g.rect(px, y, pw, FLOOR_H).fill(C.lobbyWall);
  g.rect(px, y, pw, 4).fill(0xd8c8a8);
  g.rect(px, surf - 14, pw, 14).fill(C.lobbyWainscot);
  g.rect(px, surf - 15, pw, 1).fill(0xe6c890);
  // Marble floor.
  for (let c = x0; c < x1; c++) g.rect(c * CELL_W, surf, CELL_W, SLAB).fill(c % 2 ? C.marbleA : C.marbleB);
  // Columns and ceiling lights.
  for (let c = x0 + 4; c < x1 - 2; c += 8) {
    if (w.cells[0][c].occupant) continue;
    g.rect(c * CELL_W - 4, y + 4, 8, FLOOR_H - SLAB - 4).fill(C.lobbyColumn);
    g.rect(c * CELL_W - 6, y + 4, 12, 3).fill(0xcdb88f);
    g.rect(c * CELL_W - 6, surf - 3, 12, 3).fill(0xcdb88f);
  }
  for (let c = x0 + 2; c < x1; c += 6) g.rect(c * CELL_W - 6, y + 4, 12, 2).fill(0xfff8e0);
  // Plants.
  for (let c = x0 + 8; c < x1 - 4; c += 12) if (!w.cells[0][c].occupant) drawPlant(g, c * CELL_W + 4, surf, 1.2);
  // Reception desk near the left entrance on long lobbies.
  if (x1 - x0 >= 14 && !w.cells[0][x0 + 3].occupant && !w.cells[0][x0 + 4].occupant) {
    const dx = (x0 + 2) * CELL_W + 4;
    g.rect(dx, surf - 15, 34, 15).fill(C.wood);
    g.rect(dx - 2, surf - 17, 38, 3).fill(C.woodDark);
    g.rect(dx + 6, surf - 23, 8, 6).fill(0x2b3440);
  }
  // Glass entrance doors at both ends.
  for (const ex of [px + 2, px + pw - 16]) {
    g.rect(ex, surf - 34, 14, 34).fill(C.frame);
    g.rect(ex + 2, surf - 32, 4.5, 32).fill({ color: C.glass, alpha: 0.85 });
    g.rect(ex + 7.5, surf - 32, 4.5, 32).fill({ color: C.glass, alpha: 0.85 });
  }
}

function drawPlant(g: Graphics, x: number, surf: number, s = 1): void {
  g.rect(x - 4 * s, surf - 7 * s, 8 * s, 7 * s).fill(C.pot);
  g.circle(x, surf - 12 * s, 5 * s).fill(C.plantDark);
  g.circle(x - 3 * s, surf - 10 * s, 4 * s).fill(C.plant);
  g.circle(x + 3 * s, surf - 14 * s, 4 * s).fill(C.plant);
}

// ---- Rooms ----------------------------------------------------------------

function drawRoom(g: Graphics, room: Room): void {
  const px = room.x * CELL_W;
  const y = floorTop(room.floor);
  const pw = room.width * CELL_W;
  const surf = floorSurface(room.floor);
  const r = seededRandom(room.id * 31 + 7);
  switch (room.kind) {
    case 'office':
      drawOffice(g, px, y, pw, surf, r);
      break;
    case 'apartment':
      drawApartment(g, px, y, pw, surf, r);
      break;
    case 'shop':
      drawShop(g, px, y, pw, surf, r);
      break;
    case 'restaurant':
      drawRestaurant(g, px, y, pw, surf);
      break;
    case 'hotel':
      drawHotel(g, px, y, pw, surf, r);
      break;
  }
  g.rect(px, y + FLOOR_H - SLAB, pw, SLAB).fill(C.slab);
  // Thin dividing walls.
  g.rect(px, y, 2, FLOOR_H - SLAB).fill(0x5d6570);
  g.rect(px + pw - 2, y, 2, FLOOR_H - SLAB).fill(0x5d6570);
}

/** Where people sit or stand inside a room, as x offsets from the left wall. */
export function roomSpots(room: Room): number[] {
  const pw = room.width * CELL_W;
  switch (room.kind) {
    case 'office': {
      const n = Math.floor((pw - 20) / 34);
      return Array.from({ length: n }, (_, i) => 22 + i * 34);
    }
    case 'apartment':
      return [30, 84, 100, 150];
    case 'shop':
      return [20, 34, 56, 70, 90, 104];
    case 'restaurant': {
      const out: number[] = [];
      for (let tx = 70; tx < pw - 12; tx += 40) out.push(tx - 10, tx + 10);
      return out;
    }
    case 'hotel':
      return [60, 76];
  }
}

function drawOffice(g: Graphics, px: number, y: number, pw: number, surf: number, r: () => number): void {
  g.rect(px, y, pw, FLOOR_H).fill(0xe6ecf2);
  g.rect(px, surf - 16, pw, 16).fill(0xcfd8e2);
  g.rect(px, y, pw, 4).fill(0xb9c3cd);
  for (let lx = px + 12; lx < px + pw - 16; lx += 36) g.rect(lx, y + 4, 18, 2).fill(0xfafcff);
  // Wall clock and a whiteboard.
  g.circle(px + pw / 2 + 8, y + 13, 4).fill(0xffffff).stroke({ width: 1, color: 0x55606c });
  g.rect(px + 10, y + 9, 26, 12).fill(0xffffff).stroke({ width: 1, color: 0x9aa5b1 });
  g.rect(px + 13, y + 13, 14, 1).fill(0x4f81bd);
  g.rect(px + 13, y + 16, 9, 1).fill(0xd9534f);
  g.rect(px, surf - 2, pw, 2).fill(0x6d7b8c);
  // Desks with monitors and chairs.
  for (const sx of officeDesks(pw)) {
    const dx = px + sx;
    g.rect(dx - 13, surf - 13, 26, 3).fill(0xb08a5e);
    g.rect(dx - 12, surf - 10, 2, 10).fill(0x7b6148);
    g.rect(dx + 10, surf - 10, 2, 10).fill(0x7b6148);
    g.rect(dx - 4, surf - 21, 10, 7).fill(0x2b3440);
    g.rect(dx - 3, surf - 20, 8, 5).fill(r() < 0.5 ? 0x6fa8dc : 0x8fd19e);
    g.rect(dx, surf - 14, 2, 1).fill(0x2b3440);
    // Chair behind the desk (towards the left).
    g.rect(dx - 9, surf - 7, 7, 2).fill(0x39424e);
    g.rect(dx - 10, surf - 15, 2, 10).fill(0x39424e);
  }
  drawPlant(g, px + pw - 8, surf, 0.9);
}

function officeDesks(pw: number): number[] {
  const n = Math.floor((pw - 20) / 34);
  return Array.from({ length: n }, (_, i) => 26 + i * 34);
}

function drawApartment(g: Graphics, px: number, y: number, pw: number, surf: number, r: () => number): void {
  const wall = [0xf3e3c8, 0xe6efe0, 0xf1dcd5, 0xe0e8f2][Math.floor(r() * 4)];
  g.rect(px, y, pw, FLOOR_H).fill(wall);
  for (let sx = px + 4; sx < px + pw; sx += 8) g.rect(sx, y + 4, 1, FLOOR_H - 8).fill({ color: 0x000000, alpha: 0.04 });
  g.rect(px, y, pw, 4).fill(0xd6c4a6);
  g.rect(px, surf - 2, pw, 2).fill(0xa66f3d);
  // Kitchen on the left.
  g.rect(px + 4, surf - 14, 40, 14).fill(0xf7f7f7);
  g.rect(px + 4, surf - 15, 40, 2).fill(0x8a8f98);
  g.rect(px + 8, surf - 11, 1, 8).fill(0xb0b4ba);
  g.rect(px + 24, surf - 11, 1, 8).fill(0xb0b4ba);
  g.rect(px + 4, y + 9, 40, 9).fill(0xd8c3a5);
  g.rect(px + 28, surf - 18, 6, 3).fill(0x444444);
  g.rect(px + 46, surf - 30, 14, 30).fill(0xe8edf2);
  g.rect(px + 46, surf - 20, 14, 1).fill(0xb7bec7);
  g.rect(px + 57, surf - 27, 1, 5).fill(0x9aa1a9);
  // Living room: TV, sofa, lamp, rug.
  g.ellipse(px + 96, surf - 1, 26, 2).fill(0xc7604a);
  g.rect(px + 80, y + 12, 30, 15).fill(0x1f242b);
  g.rect(px + 82, y + 14, 26, 11).fill(0x34404f);
  const sofa = [0x4f81bd, 0x6aa84f, 0x8064a2, 0xc0504d][Math.floor(r() * 4)];
  g.rect(px + 76, surf - 9, 40, 9).fill(sofa);
  g.rect(px + 76, surf - 16, 40, 7).fill(sofa);
  g.rect(px + 73, surf - 12, 5, 12).fill(sofa);
  g.rect(px + 114, surf - 12, 5, 12).fill(sofa);
  g.rect(px + 124, surf - 30, 2, 30).fill(0x555555);
  g.rect(px + 120, surf - 34, 10, 6).fill(0xf3d37a);
  // Bed on the right.
  const blanket = [0x5b9bd5, 0xed7d31, 0x70ad47, 0xffc000, 0xa5a5a5][Math.floor(r() * 5)];
  g.rect(px + pw - 6, surf - 22, 4, 22).fill(C.woodDark);
  g.rect(px + pw - 58, surf - 10, 52, 10).fill(0xf5f5f5);
  g.rect(px + pw - 58, surf - 12, 40, 6).fill(blanket);
  g.rect(px + pw - 18, surf - 14, 11, 5).fill(0xffffff);
  g.rect(px + pw - 72, surf - 10, 10, 10).fill(C.wood);
}

function drawShop(g: Graphics, px: number, y: number, pw: number, surf: number, r: () => number): void {
  g.rect(px, y, pw, FLOOR_H).fill(0xfff7ea);
  for (let c = 0; c < pw; c += 8) g.rect(px + c, surf - 2, 8, 2).fill((c / 8) % 2 ? 0xe2d8c6 : 0xcfc4b0);
  // Striped awning along the ceiling.
  const stripe = [0xd9534f, 0x2a9d8f, 0xf4a261, 0x6d5acf][Math.floor(r() * 4)];
  for (let c = 0; c < pw; c += 8) {
    g.rect(px + c, y + 2, 8, 6).fill((c / 8) % 2 ? 0xffffff : stripe);
    g.circle(px + c + 4, y + 8, 4).fill((c / 8) % 2 ? 0xffffff : stripe);
  }
  // Shelves full of products.
  for (const sx of [8, 44]) {
    const x = px + sx;
    g.rect(x, surf - 30, 32, 30).fill(0x9a6b45);
    for (let k = 0; k < 3; k++) {
      const shelfY = surf - 28 + k * 9;
      g.rect(x + 2, shelfY + 7, 28, 1.5).fill(0x6b4a2f);
      for (let p = 0; p < 6; p++) {
        const h = 3 + r() * 4;
        g.rect(x + 3 + p * 4.5, shelfY + 7 - h, 3.5, h).fill([0xe63946, 0xf4a261, 0x2a9d8f, 0x457b9d, 0xe9c46a, 0x8ac926, 0xff70a6][Math.floor(r() * 7)]);
      }
    }
  }
  // Counter with register.
  g.rect(px + pw - 36, surf - 14, 30, 14).fill(0x6b4f35);
  g.rect(px + pw - 37, surf - 15, 32, 2).fill(0x4a3423);
  g.rect(px + pw - 26, surf - 21, 10, 6).fill(0x2b2f36);
  g.rect(px + pw - 24, surf - 20, 6, 2).fill(0x8fd19e);
}

function drawRestaurant(g: Graphics, px: number, y: number, pw: number, surf: number): void {
  g.rect(px, y, pw, FLOOR_H).fill(0xf6dcb4);
  g.rect(px, surf - 15, pw, 15).fill(0x7a3f26);
  g.rect(px, surf - 16, pw, 1).fill(0xa35a36);
  g.rect(px, y, pw, 4).fill(0x5a2e1b);
  g.rect(px, surf - 2, pw, 2).fill(0x4a2f1c);
  // Open kitchen on the left.
  g.rect(px + 4, surf - 15, 44, 15).fill(0xc0c6cc);
  g.rect(px + 4, surf - 16, 44, 2).fill(0x8f979f);
  g.rect(px + 10, surf - 19, 12, 3).fill(0x2b2b2b);
  g.rect(px + 28, surf - 22, 8, 6).fill(0x9aa1a9);
  g.rect(px + 8, y + 6, 36, 8).fill(0xa7aeb5);
  g.rect(px + 50, y + 4, 2, FLOOR_H - SLAB - 4).fill(0x5a2e1b);
  // Tables with chairs and pendant lamps.
  for (let tx = 70; tx < pw - 12; tx += 40) {
    const x = px + tx;
    g.rect(x, y + 4, 1, 10).fill(0x2f2f2f);
    g.poly([x - 6, y + 18, x + 7, y + 18, x + 3, y + 13, x - 2, y + 13]).fill(0x2f2f2f);
    g.rect(x - 9, surf - 12, 19, 3).fill(0xffffff);
    g.rect(x - 9, surf - 10, 19, 2).fill(0xd9534f);
    g.rect(x, surf - 9, 2, 9).fill(0x3a2a20);
    g.rect(x - 15, surf - 7, 6, 2).fill(0x5a3a22);
    g.rect(x - 16, surf - 15, 2, 15).fill(0x5a3a22);
    g.rect(x + 11, surf - 7, 6, 2).fill(0x5a3a22);
    g.rect(x + 16, surf - 15, 2, 15).fill(0x5a3a22);
  }
}

function drawHotel(g: Graphics, px: number, y: number, pw: number, surf: number, r: () => number): void {
  g.rect(px, y, pw, FLOOR_H).fill(0xe9e0f3);
  g.rect(px, y, pw, 4).fill(0xc9bcd9);
  g.rect(px, surf - 2, pw, 2).fill(0x6e4b7e);
  // Wardrobe.
  g.rect(px + 6, surf - 34, 24, 34).fill(C.wood);
  g.rect(px + 17.5, surf - 32, 1, 30).fill(C.woodDark);
  g.rect(px + 14, surf - 18, 2, 3).fill(0xe0c080);
  g.rect(px + 20, surf - 18, 2, 3).fill(0xe0c080);
  // Painting.
  g.rect(px + 50, y + 10, 26, 14).fill(0xffffff).stroke({ width: 2, color: 0xb08a3e });
  g.rect(px + 52, y + 17, 22, 5).fill(0x7bbf6a);
  g.circle(px + 68, y + 15, 2).fill(0xf4c542);
  // Bed and nightstand.
  const blanket = [0x8e44ad, 0x2e86c1, 0xc0392b, 0x16a085][Math.floor(r() * 4)];
  g.rect(px + pw - 14, surf - 24, 4, 24).fill(C.woodDark);
  g.rect(px + 40, surf - 11, 62, 11).fill(0xfafafa);
  g.rect(px + 40, surf - 13, 46, 7).fill(blanket);
  g.rect(px + 88, surf - 15, 12, 5).fill(0xffffff);
  g.rect(px + pw - 10, surf - 10, 9, 10).fill(C.wood);
  g.rect(px + pw - 8, surf - 16, 5, 6).fill(0xf6e3a1);
}

// ---- Stairs and elevators -------------------------------------------------

function drawStairs(g: Graphics, s: Stairs): void {
  const px = s.x * CELL_W;
  const y = floorTop(s.floor);
  const pw = s.width * CELL_W;
  const surf = floorSurface(s.floor);
  g.rect(px, y, pw, FLOOR_H).fill(0xd8d3c8);
  g.rect(px, y, pw, 4).fill(0xb9b2a4);
  const steps = 10;
  const rise = FLOOR_H / steps;
  const run = pw / steps;
  for (let i = 0; i < steps; i++) {
    const h = (i + 1) * rise;
    g.rect(px + i * run, surf - h, run + 0.5, h).fill(0x8a8f98);
    g.rect(px + i * run, surf - h, run + 0.5, 1.5).fill(0x5c6169);
  }
  // Hand rail.
  g.moveTo(px + 2, surf - 14).lineTo(px + pw - 2, surf - FLOOR_H - 14 + 4).stroke({ width: 2, color: 0x40454d });
  g.rect(px, y + FLOOR_H - SLAB, pw, SLAB).fill(C.slab);
}

function drawShaft(g: Graphics, s: Shaft): void {
  const px = s.x * CELL_W;
  const pw = s.width * CELL_W;
  const y = floorTop(s.top);
  const h = (s.top - s.bottom + 1) * FLOOR_H;
  g.rect(px, y, pw, h).fill(C.shaftBack);
  g.rect(px + 3, y, 2, h).fill(C.rail);
  g.rect(px + pw - 5, y, 2, h).fill(C.rail);
  g.rect(px + pw / 2 - 0.5, y, 1, h).fill(C.cable);
  if (s.kind === 'express') {
    g.rect(px, y, 2, h).fill(C.express);
    g.rect(px + pw - 2, y, 2, h).fill(C.express);
  }
  for (let f = s.bottom; f <= s.top; f++) {
    const surf = floorSurface(f);
    // Landing frame and floor number light.
    g.rect(px + 6, surf - 34, pw - 12, 2).fill(0x8d949e);
    g.rect(px, surf, pw, SLAB).fill(C.slab);
    g.rect(px + pw / 2 - 3, surf - 40, 6, 3).fill(s.kind === 'express' ? 0xf2c14e : 0x7fd1ff);
  }
  // Machine room on top.
  g.rect(px - 2, y - 10, pw + 4, 10).fill(0x3a3f47);
  g.rect(px + 4, y - 7, pw - 8, 4).fill(0x555c66);
}

/** Outer walls and roof edges, so the tower reads as one building. */
function drawFacade(g: Graphics, w: World): void {
  for (let f = 0; f <= w.maxFloor; f++) {
    const y = floorTop(f);
    for (let x = 0; x < w.width; x++) {
      if (!w.hasBase(f, x)) continue;
      const px = x * CELL_W;
      if (!w.hasBase(f, x - 1)) g.rect(px - 3, y, 3, FLOOR_H).fill(C.facade);
      if (!w.hasBase(f, x + 1)) g.rect(px + CELL_W, y, 3, FLOOR_H).fill(C.facade);
      if (!w.hasBase(f + 1, x) && !w.shaftAt(f, x)) {
        const l = !w.hasBase(f, x - 1) ? 3 : 0;
        const r = !w.hasBase(f, x + 1) ? 3 : 0;
        g.rect(px - l, y - 5, CELL_W + l + r, 5).fill(C.parapet);
        g.rect(px - l, y - 5, CELL_W + l + r, 1).fill(C.parapetCap);
      }
    }
  }
}
