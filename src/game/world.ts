import { BALANCE, type RoomKind, type ShaftKind } from '../config/balance';

export type { RoomKind, ShaftKind };

/** What a single grid cell is built of. */
export type BaseKind = 'none' | 'lobby' | 'floor';

export interface Cell {
  base: BaseKind;
  /** Id of the room, shaft or stairs standing on this cell, 0 when free. */
  occupant: number;
}

export interface Room {
  id: number;
  kind: RoomKind;
  floor: number;
  x: number;
  width: number;
  /** Offices and apartments: has a tenant. Hotel rooms: has a booking tonight. */
  rented: boolean;
  /** Happiness of the people using this room, 0-100. */
  mood: number;
  /** Tenants (offices, apartments) or guests (hotel). */
  peopleIds: number[];
  /** Customers inside right now (shops, restaurants). */
  visitors: number;
  /** Money earned today by this room, for the info tooltip. */
  earnedToday: number;
  /** Minutes this room has been on fire, 0 when not burning. */
  fire: number;
}

export interface Car {
  /** Current position in floors; fractional while moving. */
  floor: number;
  dir: -1 | 0 | 1;
  state: 'idle' | 'moving' | 'doors';
  /** Time left with doors open, in game minutes. */
  timer: number;
  riders: number[];
}

export interface Shaft {
  id: number;
  kind: ShaftKind;
  x: number;
  width: number;
  bottom: number;
  top: number;
  car: Car;
  /** People waiting for this elevator. */
  waiting: number[];
}

/** Stairs on `floor` lead up to `floor + 1`. People enter at the left foot and leave at the right top. */
export interface Stairs {
  id: number;
  floor: number;
  x: number;
  width: number;
}

/** Result of checking whether something can be built. */
export interface Plan {
  ok: boolean;
  cost: number;
  /** Explanation key when not ok. */
  reason?: PlanReason;
}

export type PlanReason =
  | 'outOfBounds'
  | 'occupied'
  | 'noSupport'
  | 'groundIsLobby'
  | 'lobbyOnlyGround'
  | 'tooShort'
  | 'nothingToBuild'
  | 'notEnoughMoney'
  | 'somethingAbove'
  | 'nothingHere'
  | 'topFloor'
  | 'basementOnly'
  | 'notInBasement'
  | 'somethingBelow';

export interface ShaftPlan extends Plan {
  x: number;
  bottom: number;
  top: number;
  /** Set when the plan extends an existing shaft. */
  extendId?: number;
}

export type DemolishTarget = 'room' | 'shaft' | 'stairs' | 'base';

/** Everything needed to rebuild a World, as plain JSON. */
export interface WorldData {
  width: number;
  maxFloor: number;
  /** Floor of the first row in `bases`; missing in older saves (then 0). */
  minFloor?: number;
  money: number;
  nextId: number;
  bases: string[];
  rooms: Room[];
  shafts: Shaft[];
  stairs: Stairs[];
}

const BASE_CODE: Record<BaseKind, string> = { none: '.', lobby: 'L', floor: 'F' };
const CODE_BASE: Record<string, BaseKind> = { '.': 'none', L: 'lobby', F: 'floor' };

/**
 * The building itself: the grid of cells plus rooms, elevator shafts and stairs.
 * Contains placement rules but no time-based simulation.
 */
export class World {
  readonly width: number;
  readonly maxFloor: number;
  readonly minFloor: number;
  /** Rows of cells by floor number; basements use negative keys. */
  readonly cells: Record<number, Cell[]>;
  readonly rooms = new Map<number, Room>();
  readonly shafts = new Map<number, Shaft>();
  readonly stairs = new Map<number, Stairs>();
  money: number;
  /** Bumped on every structural change, so the renderer and route finder know when to refresh. */
  version = 0;
  private nextId = 1;

  constructor(
    width: number = BALANCE.grid.width,
    maxFloor: number = BALANCE.grid.maxFloor,
    money: number = BALANCE.startMoney,
    minFloor: number = BALANCE.grid.minFloor,
  ) {
    this.width = width;
    this.maxFloor = maxFloor;
    this.minFloor = minFloor;
    this.money = money;
    this.cells = {};
    for (let f = minFloor; f <= maxFloor; f++) {
      const row: Cell[] = [];
      for (let x = 0; x < width; x++) row.push({ base: 'none', occupant: 0 });
      this.cells[f] = row;
    }
  }

  /** All floor numbers from the deepest basement to the top. */
  floors(): number[] {
    const out: number[] = [];
    for (let f = this.minFloor; f <= this.maxFloor; f++) out.push(f);
    return out;
  }

  // ---- Save / load ------------------------------------------------------

  toData(): WorldData {
    return {
      width: this.width,
      maxFloor: this.maxFloor,
      money: this.money,
      nextId: this.nextId,
      minFloor: this.minFloor,
      bases: this.floors().map((f) => this.cells[f].map((c) => BASE_CODE[c.base]).join('')),
      rooms: [...this.rooms.values()],
      shafts: [...this.shafts.values()],
      stairs: [...this.stairs.values()],
    };
  }

  static fromData(d: WorldData): World {
    const w = new World(d.width, d.maxFloor, d.money);
    w.nextId = d.nextId;
    const first = d.minFloor ?? 0;
    d.bases.forEach((row, i) => {
      const f = first + i;
      if (!w.cells[f]) return;
      for (let x = 0; x < row.length && x < w.width; x++) w.cells[f][x].base = CODE_BASE[row[x]] ?? 'none';
    });
    for (const r of d.rooms) {
      r.fire ??= 0;
      w.rooms.set(r.id, r);
      for (let x = r.x; x < r.x + r.width; x++) w.cells[r.floor][x].occupant = r.id;
    }
    for (const s of d.shafts) {
      w.shafts.set(s.id, s);
      for (let f = s.bottom; f <= s.top; f++) for (let x = s.x; x < s.x + s.width; x++) w.cells[f][x].occupant = s.id;
    }
    for (const s of d.stairs) {
      w.stairs.set(s.id, s);
      for (let x = s.x; x < s.x + s.width; x++) w.cells[s.floor][x].occupant = s.id;
    }
    return w;
  }

  // ---- Basics -----------------------------------------------------------

  inBounds(floor: number, x: number): boolean {
    return floor >= this.minFloor && floor <= this.maxFloor && x >= 0 && x < this.width;
  }

  cell(floor: number, x: number): Cell | undefined {
    return this.inBounds(floor, x) ? this.cells[floor][x] : undefined;
  }

  hasBase(floor: number, x: number): boolean {
    const c = this.cell(floor, x);
    return !!c && c.base !== 'none';
  }

  /**
   * A cell can get a new base if it is on the ground, rests on something right below it,
   * or (for basements) hangs under something right above it.
   */
  isSupported(floor: number, x: number): boolean {
    if (floor === 0) return true;
    return floor > 0 ? this.hasBase(floor - 1, x) : this.hasBase(floor + 1, x);
  }

  /** Deepest floor with anything built on it, or 0. */
  bottomFloor(): number {
    for (let f = this.minFloor; f < 0; f++) if (this.cells[f].some((c) => c.base !== 'none')) return f;
    return 0;
  }

  /** Highest floor with anything built on it, or -1. */
  topFloor(): number {
    for (let f = this.maxFloor; f >= 0; f--) if (this.cells[f].some((c) => c.base !== 'none')) return f;
    return -1;
  }

  private baseCost(floor: number): number {
    if (floor === 0) return BALANCE.lobbyCostPerCell;
    return floor < 0 ? BALANCE.basementCostPerCell : BALANCE.floorCostPerCell;
  }

  /** Cost of adding base under [x0, x0+width) on a floor, or a reason why it can't be done. */
  private planBase(floor: number, x0: number, width: number): Plan {
    let cost = 0;
    for (let x = x0; x < x0 + width; x++) {
      if (!this.inBounds(floor, x)) return { ok: false, cost: 0, reason: 'outOfBounds' };
      if (this.hasBase(floor, x)) continue;
      if (!this.isSupported(floor, x)) return { ok: false, cost: 0, reason: 'noSupport' };
      cost += this.baseCost(floor);
    }
    return { ok: true, cost };
  }

  private addBase(floor: number, x0: number, width: number): void {
    for (let x = x0; x < x0 + width; x++) {
      const c = this.cells[floor][x];
      if (c.base === 'none') c.base = floor === 0 ? 'lobby' : 'floor';
    }
  }

  private withMoneyCheck<T extends Plan>(plan: T): T {
    if (plan.ok && plan.cost > this.money) return { ...plan, ok: false, reason: 'notEnoughMoney' };
    return plan;
  }

  private freeCells(floor: number, x0: number, width: number): PlanReason | null {
    for (let x = x0; x < x0 + width; x++) {
      const c = this.cell(floor, x);
      if (!c) return 'outOfBounds';
      if (c.occupant) return 'occupied';
    }
    return null;
  }

  // ---- Lobby and floors -------------------------------------------------

  /** Plan a horizontal strip of lobby (ground floor) or floor (upper floors). */
  planStrip(kind: 'lobby' | 'floor', floor: number, xa: number, xb: number): Plan {
    if (kind === 'lobby' && floor !== 0) return { ok: false, cost: 0, reason: 'lobbyOnlyGround' };
    if (kind === 'floor' && floor === 0) return { ok: false, cost: 0, reason: 'groundIsLobby' };
    if (floor < this.minFloor || floor > this.maxFloor) return { ok: false, cost: 0, reason: 'outOfBounds' };
    const x0 = Math.max(0, Math.min(xa, xb));
    const x1 = Math.min(this.width - 1, Math.max(xa, xb));
    const plan = this.planBase(floor, x0, x1 - x0 + 1);
    if (plan.ok && plan.cost === 0) return { ok: false, cost: 0, reason: 'nothingToBuild' };
    return this.withMoneyCheck(plan);
  }

  buildStrip(kind: 'lobby' | 'floor', floor: number, xa: number, xb: number): Plan {
    const plan = this.planStrip(kind, floor, xa, xb);
    if (!plan.ok) return plan;
    const x0 = Math.max(0, Math.min(xa, xb));
    const x1 = Math.min(this.width - 1, Math.max(xa, xb));
    this.addBase(floor, x0, x1 - x0 + 1);
    this.money -= plan.cost;
    this.version++;
    return plan;
  }

  // ---- Rooms ------------------------------------------------------------

  /** Left edge of something `width` wide centred on the given cell. */
  leftFor(width: number, centerX: number): number {
    return centerX - Math.floor(width / 2);
  }

  roomLeft(kind: RoomKind, centerX: number): number {
    return this.leftFor(BALANCE.rooms[kind].width, centerX);
  }

  planRoom(kind: RoomKind, floor: number, x0: number): Plan {
    const spec = BALANCE.rooms[kind];
    if (floor === 0 && !spec.ground) return { ok: false, cost: 0, reason: 'groundIsLobby' };
    if (floor >= 0 && spec.basementOnly) return { ok: false, cost: 0, reason: 'basementOnly' };
    if (floor < 0 && !spec.basement) return { ok: false, cost: 0, reason: 'notInBasement' };
    const blocked = this.freeCells(floor, x0, spec.width);
    if (blocked) return { ok: false, cost: 0, reason: blocked };
    const base = this.planBase(floor, x0, spec.width);
    if (!base.ok) return base;
    return this.withMoneyCheck({ ok: true, cost: base.cost + spec.cost });
  }

  buildRoom(kind: RoomKind, floor: number, x0: number): Room | null {
    const plan = this.planRoom(kind, floor, x0);
    if (!plan.ok) return null;
    const width = BALANCE.rooms[kind].width;
    this.addBase(floor, x0, width);
    const room: Room = {
      id: this.nextId++,
      kind,
      floor,
      x: x0,
      width,
      rented: false,
      mood: BALANCE.mood.start,
      peopleIds: [],
      visitors: 0,
      earnedToday: 0,
      fire: 0,
    };
    for (let x = x0; x < x0 + width; x++) this.cells[floor][x].occupant = room.id;
    this.rooms.set(room.id, room);
    this.money -= plan.cost;
    this.version++;
    return room;
  }

  // ---- Stairs -----------------------------------------------------------

  planStairs(floor: number, x0: number): Plan {
    const w = BALANCE.transport.stairs.width;
    if (floor >= this.maxFloor) return { ok: false, cost: 0, reason: 'topFloor' };
    const blocked = this.freeCells(floor, x0, w);
    if (blocked) return { ok: false, cost: 0, reason: blocked };
    const base = this.planBase(floor, x0, w);
    if (!base.ok) return base;
    return this.withMoneyCheck({ ok: true, cost: base.cost + BALANCE.transport.stairs.cost });
  }

  buildStairs(floor: number, x0: number): Stairs | null {
    const plan = this.planStairs(floor, x0);
    if (!plan.ok) return null;
    const w = BALANCE.transport.stairs.width;
    this.addBase(floor, x0, w);
    const s: Stairs = { id: this.nextId++, floor, x: x0, width: w };
    for (let x = x0; x < x0 + w; x++) this.cells[floor][x].occupant = s.id;
    this.stairs.set(s.id, s);
    this.money -= plan.cost;
    this.version++;
    return s;
  }

  // ---- Elevators --------------------------------------------------------

  shaftAt(floor: number, x: number): Shaft | undefined {
    const id = this.cell(floor, x)?.occupant;
    return id ? this.shafts.get(id) : undefined;
  }

  /**
   * Plan an elevator dragged from (anchorFloor, anchorX) to toFloor.
   * Starting the drag on an existing shaft of the same kind extends that shaft.
   */
  planShaft(kind: ShaftKind, anchorFloor: number, anchorX: number, toFloor: number): ShaftPlan {
    const spec = BALANCE.transport[kind];
    const w = spec.width;
    const found = this.shaftAt(anchorFloor, anchorX);
    const existing = found && found.kind === kind ? found : undefined;
    const x = existing ? existing.x : this.leftFor(w, anchorX);
    let bottom = Math.min(anchorFloor, toFloor);
    let top = Math.max(anchorFloor, toFloor);
    if (existing) {
      bottom = Math.min(bottom, existing.bottom);
      top = Math.max(top, existing.top);
    }
    const fail = (reason: PlanReason): ShaftPlan => ({ ok: false, cost: 0, reason, x, bottom, top });
    if (bottom < this.minFloor || top > this.maxFloor || x < 0 || x + w > this.width) return fail('outOfBounds');
    if (top - bottom < 1) return fail('tooShort');
    // A shaft needs support at the end nearest the ground, unless it passes through the ground floor.
    const anchorRow = bottom > 0 ? bottom : top < 0 ? top : null;

    let cost = 0;
    for (let f = bottom; f <= top; f++) {
      if (existing && f >= existing.bottom && f <= existing.top) continue;
      for (let cx = x; cx < x + w; cx++) {
        const c = this.cells[f][cx];
        if (c.occupant) return fail('occupied');
        if (c.base === 'none') {
          if (f === anchorRow && !this.isSupported(f, cx)) return fail('noSupport');
          cost += this.baseCost(f);
        }
      }
    }
    const newFloors = existing ? top - bottom - (existing.top - existing.bottom) : top - bottom + 1;
    if (newFloors <= 0) return fail('nothingToBuild');
    cost += (existing ? 0 : spec.baseCost) + spec.costPerFloor * newFloors;
    return this.withMoneyCheck({ ok: true, cost, x, bottom, top, extendId: existing?.id });
  }

  buildShaft(kind: ShaftKind, anchorFloor: number, anchorX: number, toFloor: number): ShaftPlan {
    const plan = this.planShaft(kind, anchorFloor, anchorX, toFloor);
    if (!plan.ok) return plan;
    const w = BALANCE.transport[kind].width;
    let shaft: Shaft;
    if (plan.extendId) {
      shaft = this.shafts.get(plan.extendId)!;
      shaft.bottom = plan.bottom;
      shaft.top = plan.top;
    } else {
      shaft = {
        id: this.nextId++,
        kind,
        x: plan.x,
        width: w,
        bottom: plan.bottom,
        top: plan.top,
        car: { floor: plan.bottom, dir: 0, state: 'idle', timer: 0, riders: [] },
        waiting: [],
      };
      this.shafts.set(shaft.id, shaft);
    }
    for (let f = plan.bottom; f <= plan.top; f++) {
      this.addBase(f, plan.x, w);
      for (let cx = plan.x; cx < plan.x + w; cx++) this.cells[f][cx].occupant = shaft.id;
    }
    this.money -= plan.cost;
    this.version++;
    return plan;
  }

  // ---- Demolish ---------------------------------------------------------

  /** What a demolish click at this cell would remove. */
  planDemolish(floor: number, x: number): Plan & { target?: DemolishTarget; id?: number } {
    const c = this.cell(floor, x);
    if (!c || c.base === 'none') return { ok: false, cost: 0, reason: 'nothingHere' };
    if (c.occupant) {
      const target: DemolishTarget = this.rooms.has(c.occupant) ? 'room' : this.shafts.has(c.occupant) ? 'shaft' : 'stairs';
      return { ok: true, cost: 0, target, id: c.occupant };
    }
    if (floor >= 0 && this.hasBase(floor + 1, x)) return { ok: false, cost: 0, reason: 'somethingAbove' };
    if (floor <= 0 && this.hasBase(floor - 1, x)) return { ok: false, cost: 0, reason: 'somethingBelow' };
    return { ok: true, cost: 0, target: 'base' };
  }

  /**
   * Remove whatever is at the cell. Rooms, shafts and stairs leave their floor behind;
   * a bare floor cell is removed only if nothing rests on it.
   * Returns what was removed so the simulation can clean up its people.
   */
  demolish(floor: number, x: number): { ok: boolean; room?: Room; shaft?: Shaft; stairs?: Stairs; reason?: PlanReason } {
    const plan = this.planDemolish(floor, x);
    if (!plan.ok) return { ok: false, reason: plan.reason };
    const clear = (f: number, x0: number, w: number) => {
      for (let cx = x0; cx < x0 + w; cx++) this.cells[f][cx].occupant = 0;
    };
    this.version++;
    switch (plan.target) {
      case 'room': {
        const room = this.rooms.get(plan.id!)!;
        clear(room.floor, room.x, room.width);
        this.rooms.delete(room.id);
        return { ok: true, room };
      }
      case 'shaft': {
        const shaft = this.shafts.get(plan.id!)!;
        for (let f = shaft.bottom; f <= shaft.top; f++) clear(f, shaft.x, shaft.width);
        this.shafts.delete(shaft.id);
        return { ok: true, shaft };
      }
      case 'stairs': {
        const s = this.stairs.get(plan.id!)!;
        clear(s.floor, s.x, s.width);
        this.stairs.delete(s.id);
        return { ok: true, stairs: s };
      }
      default:
        this.cells[floor][x].base = 'none';
        return { ok: true };
    }
  }

  // ---- Geometry helpers -------------------------------------------------

  /** True if one can walk along a floor between two x positions (in cells, may be fractional). */
  canWalk(floor: number, xa: number, xb: number): boolean {
    const a = Math.floor(Math.min(xa, xb));
    const b = Math.floor(Math.max(xa, xb) - 1e-6);
    for (let x = a; x <= b; x++) if (!this.hasBase(floor, x)) return false;
    return true;
  }

  shaftCenter(shaft: Shaft): number {
    return shaft.x + shaft.width / 2;
  }

  roomCenter(room: Room): number {
    return room.x + room.width / 2;
  }

  /** Where people get on or off the stairs on a floor (foot on the lower floor, top on the upper floor). */
  stairsPoint(s: Stairs, floor: number): number {
    return floor === s.floor ? s.x + 0.5 : s.x + s.width - 0.5;
  }

  /** Left and right end (exclusive right) of the connected strip of floor around x. */
  stripAround(floor: number, x: number): [number, number] {
    let l = Math.floor(x);
    let r = Math.floor(x);
    while (this.hasBase(floor, l - 1)) l--;
    while (this.hasBase(floor, r + 1)) r++;
    return [l, r + 1];
  }

  /** Ways into the building: both ends of every lobby strip, and every metro platform. */
  entrances(): { floor: number; x: number }[] {
    const out: { floor: number; x: number }[] = [];
    let x = 0;
    while (x < this.width) {
      if (!this.hasBase(0, x)) {
        x++;
        continue;
      }
      const [l, r] = this.stripAround(0, x);
      out.push({ floor: 0, x: l + 0.5 }, { floor: 0, x: r - 0.5 });
      x = r;
    }
    for (const room of this.rooms.values()) if (room.kind === 'metro') out.push({ floor: room.floor, x: this.roomCenter(room) });
    return out;
  }
}
