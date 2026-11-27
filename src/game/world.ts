import { BALANCE } from '../config/balance';

/** What a single grid cell is built of. */
export type BaseKind = 'none' | 'lobby' | 'floor';
export type RoomKind = 'office' | 'apartment';

export interface Cell {
  base: BaseKind;
  /** Id of the room or shaft standing on this cell, 0 when free. */
  occupant: number;
}

export interface Room {
  id: number;
  kind: RoomKind;
  floor: number;
  x: number;
  width: number;
  rented: boolean;
  /** Tenant happiness, 0-100. */
  mood: number;
  peopleIds: number[];
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
  x: number;
  width: number;
  bottom: number;
  top: number;
  car: Car;
  /** People waiting for this elevator. */
  waiting: number[];
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
  | 'nothingHere';

export interface ShaftPlan extends Plan {
  x: number;
  bottom: number;
  top: number;
  /** Set when the plan extends an existing shaft. */
  extendId?: number;
}

/**
 * The building itself: the grid of cells plus rooms and elevator shafts.
 * Contains placement rules but no time-based simulation.
 */
export class World {
  readonly width: number;
  readonly maxFloor: number;
  readonly cells: Cell[][];
  readonly rooms = new Map<number, Room>();
  readonly shafts = new Map<number, Shaft>();
  money: number;
  /** Bumped on every structural change, so the renderer knows when to redraw. */
  version = 0;
  private nextId = 1;

  constructor(width: number = BALANCE.grid.width, maxFloor: number = BALANCE.grid.maxFloor, money: number = BALANCE.startMoney) {
    this.width = width;
    this.maxFloor = maxFloor;
    this.money = money;
    this.cells = [];
    for (let f = 0; f <= maxFloor; f++) {
      const row: Cell[] = [];
      for (let x = 0; x < width; x++) row.push({ base: 'none', occupant: 0 });
      this.cells.push(row);
    }
  }

  inBounds(floor: number, x: number): boolean {
    return floor >= 0 && floor <= this.maxFloor && x >= 0 && x < this.width;
  }

  cell(floor: number, x: number): Cell | undefined {
    return this.inBounds(floor, x) ? this.cells[floor][x] : undefined;
  }

  hasBase(floor: number, x: number): boolean {
    const c = this.cell(floor, x);
    return !!c && c.base !== 'none';
  }

  /** A cell can get a new base if it is on the ground or there is something built right below it. */
  isSupported(floor: number, x: number): boolean {
    return floor === 0 || this.hasBase(floor - 1, x);
  }

  private baseCost(floor: number): number {
    return floor === 0 ? BALANCE.lobbyCostPerCell : BALANCE.floorCostPerCell;
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

  // ---- Lobby and floors -------------------------------------------------

  /** Plan a horizontal strip of lobby (ground floor) or floor (upper floors). */
  planStrip(kind: 'lobby' | 'floor', floor: number, xa: number, xb: number): Plan {
    if (kind === 'lobby' && floor !== 0) return { ok: false, cost: 0, reason: 'lobbyOnlyGround' };
    if (kind === 'floor' && floor === 0) return { ok: false, cost: 0, reason: 'groundIsLobby' };
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

  /** Left edge of a room centred on the given cell. */
  roomLeft(kind: RoomKind, centerX: number): number {
    return centerX - Math.floor(BALANCE.rooms[kind].width / 2);
  }

  planRoom(kind: RoomKind, floor: number, x0: number): Plan {
    const width = BALANCE.rooms[kind].width;
    if (floor === 0) return { ok: false, cost: 0, reason: 'groundIsLobby' };
    for (let x = x0; x < x0 + width; x++) {
      const c = this.cell(floor, x);
      if (!c) return { ok: false, cost: 0, reason: 'outOfBounds' };
      if (c.occupant) return { ok: false, cost: 0, reason: 'occupied' };
    }
    const base = this.planBase(floor, x0, width);
    if (!base.ok) return base;
    return this.withMoneyCheck({ ok: true, cost: base.cost + BALANCE.rooms[kind].cost });
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
    };
    for (let x = x0; x < x0 + width; x++) this.cells[floor][x].occupant = room.id;
    this.rooms.set(room.id, room);
    this.money -= plan.cost;
    this.version++;
    return room;
  }

  // ---- Elevators --------------------------------------------------------

  shaftAt(floor: number, x: number): Shaft | undefined {
    const id = this.cell(floor, x)?.occupant;
    return id ? this.shafts.get(id) : undefined;
  }

  shaftCost(floors: number): number {
    return BALANCE.elevator.baseCost + BALANCE.elevator.costPerFloor * floors;
  }

  /**
   * Plan an elevator dragged from (anchorFloor, anchorX) to toFloor.
   * Starting the drag on an existing shaft extends that shaft.
   */
  planShaft(anchorFloor: number, anchorX: number, toFloor: number): ShaftPlan {
    const w = BALANCE.elevator.width;
    const existing = this.shaftAt(anchorFloor, anchorX);
    const x = existing ? existing.x : anchorX - Math.floor(w / 2);
    let bottom = Math.min(anchorFloor, toFloor);
    let top = Math.max(anchorFloor, toFloor);
    if (existing) {
      bottom = Math.min(bottom, existing.bottom);
      top = Math.max(top, existing.top);
    }
    const fail = (reason: PlanReason): ShaftPlan => ({ ok: false, cost: 0, reason, x, bottom, top });
    if (bottom < 0 || top > this.maxFloor || x < 0 || x + w > this.width) return fail('outOfBounds');
    if (top - bottom < 1) return fail('tooShort');

    let cost = 0;
    for (let f = bottom; f <= top; f++) {
      const isOld = !!existing && f >= existing.bottom && f <= existing.top;
      if (isOld) continue;
      for (let cx = x; cx < x + w; cx++) {
        const c = this.cells[f][cx];
        if (c.occupant) return fail('occupied');
        // Only the lowest floor needs support; the shaft carries itself above that.
        if (c.base === 'none') {
          if (f === bottom && !this.isSupported(f, cx)) return fail('noSupport');
          cost += this.baseCost(f);
        }
      }
    }
    const newFloors = existing ? top - bottom - (existing.top - existing.bottom) : top - bottom + 1;
    if (newFloors <= 0) return fail('nothingToBuild');
    cost += existing ? BALANCE.elevator.costPerFloor * newFloors : this.shaftCost(newFloors);
    return this.withMoneyCheck({ ok: true, cost, x, bottom, top, extendId: existing?.id });
  }

  buildShaft(anchorFloor: number, anchorX: number, toFloor: number): ShaftPlan {
    const plan = this.planShaft(anchorFloor, anchorX, toFloor);
    if (!plan.ok) return plan;
    const w = BALANCE.elevator.width;
    let shaft: Shaft;
    if (plan.extendId) {
      shaft = this.shafts.get(plan.extendId)!;
      shaft.bottom = plan.bottom;
      shaft.top = plan.top;
    } else {
      shaft = {
        id: this.nextId++,
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
  planDemolish(floor: number, x: number): Plan & { target?: 'room' | 'shaft' | 'base'; id?: number } {
    const c = this.cell(floor, x);
    if (!c || c.base === 'none') return { ok: false, cost: 0, reason: 'nothingHere' };
    if (c.occupant) {
      const target = this.rooms.has(c.occupant) ? 'room' : 'shaft';
      return { ok: true, cost: 0, target, id: c.occupant };
    }
    if (this.hasBase(floor + 1, x)) return { ok: false, cost: 0, reason: 'somethingAbove' };
    return { ok: true, cost: 0, target: 'base' };
  }

  /**
   * Remove whatever is at the cell. Rooms and shafts leave their floor behind;
   * a bare floor cell is removed only if nothing rests on it.
   * Returns the removed room or shaft so the simulation can clean up its people.
   */
  demolish(floor: number, x: number): { ok: boolean; room?: Room; shaft?: Shaft; reason?: PlanReason } {
    const plan = this.planDemolish(floor, x);
    if (!plan.ok) return { ok: false, reason: plan.reason };
    if (plan.target === 'room') {
      const room = this.rooms.get(plan.id!)!;
      for (let cx = room.x; cx < room.x + room.width; cx++) this.cells[room.floor][cx].occupant = 0;
      this.rooms.delete(room.id);
      this.version++;
      return { ok: true, room };
    }
    if (plan.target === 'shaft') {
      const shaft = this.shafts.get(plan.id!)!;
      for (let f = shaft.bottom; f <= shaft.top; f++) {
        for (let cx = shaft.x; cx < shaft.x + shaft.width; cx++) this.cells[f][cx].occupant = 0;
      }
      this.shafts.delete(shaft.id);
      this.version++;
      return { ok: true, shaft };
    }
    this.cells[floor][x].base = 'none';
    this.version++;
    return { ok: true };
  }

  // ---- Routing helpers --------------------------------------------------

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

  /** The best elevator to get from one spot to another, or undefined if there is no way. */
  findShaft(fromFloor: number, fromX: number, toFloor: number, toX: number): Shaft | undefined {
    let best: Shaft | undefined;
    let bestDist = Infinity;
    for (const s of this.shafts.values()) {
      if (fromFloor < s.bottom || fromFloor > s.top || toFloor < s.bottom || toFloor > s.top) continue;
      const cx = this.shaftCenter(s);
      if (!this.canWalk(fromFloor, fromX, cx) || !this.canWalk(toFloor, cx, toX)) continue;
      const dist = Math.abs(fromX - cx) + Math.abs(toX - cx);
      if (dist < bestDist) {
        best = s;
        bestDist = dist;
      }
    }
    return best;
  }

  /** The elevator people use to go between the lobby and a room, if any. */
  shaftForRoom(room: Room): Shaft | undefined {
    const cx = this.roomCenter(room);
    let best: Shaft | undefined;
    let bestDist = Infinity;
    for (const s of this.shafts.values()) {
      if (s.bottom > 0 || s.top < room.floor) continue;
      const sx = this.shaftCenter(s);
      if (!this.canWalk(room.floor, sx, cx)) continue;
      const d = Math.abs(sx - cx);
      if (d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best;
  }

  /** Left and right end (exclusive right) of the connected strip of floor around x. */
  stripAround(floor: number, x: number): [number, number] {
    let l = Math.floor(x);
    let r = Math.floor(x);
    while (this.hasBase(floor, l - 1)) l--;
    while (this.hasBase(floor, r + 1)) r++;
    return [l, r + 1];
  }
}
