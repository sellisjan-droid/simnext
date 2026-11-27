import { BALANCE } from '../config/balance';
import type { Room, RoomKind, Shaft } from './world';
import { World } from './world';

const DAY = 24 * 60;

/** One step of a trip. */
type Leg =
  | { type: 'walk'; toX: number }
  | { type: 'ride'; shaftId: number; toFloor: number }
  | { type: 'enter' }
  | { type: 'exit' };

export type PersonState = 'away' | 'walking' | 'waiting' | 'riding' | 'inside';

export interface Person {
  id: number;
  roomId: number;
  kind: RoomKind;
  state: PersonState;
  floor: number;
  /** Horizontal position in cells. */
  x: number;
  legs: Leg[];
  /** Whether the current trip goes into the building (true) or out (false). */
  goingIn: boolean;
  waitStart: number;
  /** Small random offset so people don't stand exactly on top of each other. */
  jitter: number;
  /** Planned moves for today, sorted by time. */
  todo: { at: number; goIn: boolean }[];
  color: number;
}

export interface GameMessage {
  text: string;
  time: number;
  kind: 'info' | 'good' | 'bad';
}

export interface DayReport {
  day: number;
  rent: number;
  upkeep: number;
}

/** Text callbacks so the simulation stays independent of the UI language. */
export interface SimTexts {
  movedIn(kind: RoomKind, floor: number): string;
  movedOut(kind: RoomKind, floor: number): string;
  dayReport(r: DayReport): string;
}

const PERSON_COLORS: Record<RoomKind, number[]> = {
  office: [0x2b3a55, 0x3d4f6e, 0x55433a, 0x1f2a36],
  apartment: [0xc0504d, 0x4f81bd, 0x9bbb59, 0xf79646, 0x8064a2],
};

/**
 * The running game: clock, people, elevators and money flow on top of a World.
 * Time is measured in game minutes since the start.
 */
export class Simulation {
  readonly world: World;
  readonly people = new Map<number, Person>();
  readonly messages: GameMessage[] = [];
  minutes: number;
  /** Speed multiplier, 0 means paused. */
  speed = 1;
  private nextPersonId = 1;
  private lastHour: number;
  private rng: () => number;
  private texts: SimTexts;

  constructor(world: World, texts: SimTexts, rng: () => number = Math.random) {
    this.world = world;
    this.texts = texts;
    this.rng = rng;
    this.minutes = BALANCE.time.startHour * 60;
    this.lastHour = Math.floor(this.minutes / 60);
  }

  get day(): number {
    return Math.floor(this.minutes / DAY) + 1;
  }

  get minuteOfDay(): number {
    return this.minutes % DAY;
  }

  get hourOfDay(): number {
    return this.minuteOfDay / 60;
  }

  get population(): number {
    let n = 0;
    for (const r of this.world.rooms.values()) if (r.rented) n += r.peopleIds.length;
    return n;
  }

  /** Advance the game by a real-time delta in seconds. */
  update(realSeconds: number): void {
    if (this.speed <= 0) return;
    let total = Math.min(realSeconds, 0.25) * BALANCE.time.minutesPerSecond * this.speed;
    // Small fixed steps keep elevators and walking stable at high speed.
    while (total > 0) {
      const dt = Math.min(total, 0.2);
      this.step(dt);
      total -= dt;
    }
  }

  step(dt: number): void {
    const before = this.minutes;
    this.minutes += dt;
    if (Math.floor(before / DAY) !== Math.floor(this.minutes / DAY)) this.onMidnight();
    const hour = Math.floor(this.minutes / 60);
    if (hour !== this.lastHour) {
      this.lastHour = hour;
      this.onHour();
    }
    for (const p of this.people.values()) this.stepPerson(p, dt);
    for (const s of this.world.shafts.values()) this.stepCar(s, dt);
  }

  private say(text: string, kind: GameMessage['kind'] = 'info'): void {
    this.messages.push({ text, time: this.minutes, kind });
    if (this.messages.length > 50) this.messages.shift();
  }

  private rand(a: number, b: number): number {
    return a + (b - a) * this.rng();
  }

  // ---- Tenants ----------------------------------------------------------

  private onHour(): void {
    for (const room of this.world.rooms.values()) {
      if (room.rented) continue;
      if (!this.world.shaftForRoom(room)) continue;
      if (this.rng() < BALANCE.rentChancePerHour) this.moveIn(room);
    }
  }

  moveIn(room: Room): void {
    room.rented = true;
    room.mood = BALANCE.mood.start;
    const count = BALANCE.rooms[room.kind].people;
    const colors = PERSON_COLORS[room.kind];
    const hour = this.hourOfDay;
    const s = BALANCE.schedule;
    for (let i = 0; i < count; i++) {
      const p: Person = {
        id: this.nextPersonId++,
        roomId: room.id,
        kind: room.kind,
        state: 'away',
        floor: 0,
        x: 0,
        legs: [],
        goingIn: true,
        waitStart: 0,
        jitter: this.rand(-1, 1),
        todo: [],
        color: colors[Math.floor(this.rng() * colors.length)],
      };
      this.people.set(p.id, p);
      room.peopleIds.push(p.id);
      this.planDay(p, Math.floor(this.minutes / DAY) * DAY);
      // New tenants show up soon, as long as it fits their day.
      const arriveNow = room.kind === 'apartment' || (hour >= s.officeArrive[0] && hour < s.officeLeave[0] - 1);
      if (arriveNow) p.todo.unshift({ at: this.minutes + this.rand(5, 60), goIn: true });
    }
    this.say(this.texts.movedIn(room.kind, room.floor), 'good');
  }

  private moveOut(room: Room): void {
    for (const id of room.peopleIds) this.removePerson(id);
    room.peopleIds = [];
    room.rented = false;
    room.mood = BALANCE.mood.start;
    this.say(this.texts.movedOut(room.kind, room.floor), 'bad');
  }

  private removePerson(id: number): void {
    this.people.delete(id);
    for (const s of this.world.shafts.values()) {
      s.waiting = s.waiting.filter((w) => w !== id);
      s.car.riders = s.car.riders.filter((r) => r !== id);
    }
  }

  /** Fill a person's to-do list for the day starting at dayStart. */
  private planDay(p: Person, dayStart: number): void {
    const s = BALANCE.schedule;
    const at = (range: readonly [number, number]) => dayStart + this.rand(range[0], range[1]) * 60;
    p.todo = [];
    if (p.kind === 'office') {
      p.todo.push({ at: at(s.officeArrive), goIn: true }, { at: at(s.officeLeave), goIn: false });
    } else if (this.rng() >= s.apartmentStayHomeChance) {
      p.todo.push({ at: at(s.apartmentLeave), goIn: false }, { at: at(s.apartmentReturn), goIn: true });
    }
    p.todo = p.todo.filter((t) => t.at > this.minutes);
  }

  private onMidnight(): void {
    let rent = 0;
    for (const room of this.world.rooms.values()) {
      if (room.rented) rent += BALANCE.rooms[room.kind].rentPerDay;
    }
    const upkeep = this.world.shafts.size * BALANCE.elevator.upkeepPerDay;
    this.world.money += rent - upkeep;
    this.say(this.texts.dayReport({ day: this.day - 1, rent, upkeep }), rent >= upkeep ? 'info' : 'bad');

    for (const room of [...this.world.rooms.values()]) {
      if (room.rented && room.mood < BALANCE.mood.moveOutBelow) this.moveOut(room);
    }
    const dayStart = Math.floor(this.minutes / DAY) * DAY;
    for (const p of this.people.values()) this.planDay(p, dayStart);
  }

  private adjustMood(p: Person, delta: number): void {
    const room = this.world.rooms.get(p.roomId);
    if (room) room.mood = Math.max(0, Math.min(100, room.mood + delta));
  }

  // ---- People -----------------------------------------------------------

  private stepPerson(p: Person, dt: number): void {
    if (p.todo.length && p.todo[0].at <= this.minutes) {
      const t = p.todo.shift()!;
      if (t.goIn && p.state === 'away') this.startTrip(p, true);
      else if (!t.goIn && p.state === 'inside') this.startTrip(p, false);
    }
    if (p.state === 'walking') {
      const leg = p.legs[0];
      if (leg?.type !== 'walk') return this.nextLeg(p);
      const step = BALANCE.people.walkCellsPerMinute * dt;
      const d = leg.toX - p.x;
      if (Math.abs(d) <= step) {
        p.x = leg.toX;
        this.nextLeg(p);
      } else {
        p.x += Math.sign(d) * step;
      }
    }
  }

  private startTrip(p: Person, goingIn: boolean): void {
    const room = this.world.rooms.get(p.roomId);
    if (!room) return;
    const shaft = this.world.shaftForRoom(room);
    if (!shaft) {
      this.adjustMood(p, -BALANCE.mood.noRoutePenalty);
      return;
    }
    const sx = this.world.shaftCenter(shaft);
    const [l, r] = this.world.stripAround(0, sx);
    const door = this.rng() < 0.5 ? l + 0.5 : r - 0.5;
    const spot = room.x + 1 + this.rng() * (room.width - 2);
    p.goingIn = goingIn;
    if (goingIn) {
      p.floor = 0;
      p.x = door;
      p.legs = [
        { type: 'walk', toX: sx + p.jitter },
        { type: 'ride', shaftId: shaft.id, toFloor: room.floor },
        { type: 'walk', toX: spot },
        { type: 'enter' },
      ];
    } else {
      p.legs = [
        { type: 'walk', toX: sx + p.jitter },
        { type: 'ride', shaftId: shaft.id, toFloor: 0 },
        { type: 'walk', toX: door },
        { type: 'exit' },
      ];
    }
    this.beginLeg(p);
  }

  private nextLeg(p: Person): void {
    p.legs.shift();
    this.beginLeg(p);
  }

  private beginLeg(p: Person): void {
    const leg = p.legs[0];
    if (!leg) {
      p.state = p.goingIn ? 'inside' : 'away';
      return;
    }
    switch (leg.type) {
      case 'walk':
        p.state = 'walking';
        break;
      case 'ride': {
        const shaft = this.world.shafts.get(leg.shaftId);
        if (!shaft) return this.abortTrip(p);
        p.state = 'waiting';
        p.waitStart = this.minutes;
        shaft.waiting.push(p.id);
        break;
      }
      case 'enter':
        p.state = 'inside';
        p.legs = [];
        break;
      case 'exit':
        p.state = 'away';
        p.legs = [];
        break;
    }
  }

  /** Called when a trip can't be finished (e.g. the elevator was demolished). */
  private abortTrip(p: Person): void {
    this.adjustMood(p, -BALANCE.mood.noRoutePenalty);
    p.legs = [];
    p.state = p.goingIn ? 'inside' : 'away';
    const room = this.world.rooms.get(p.roomId);
    if (room && p.goingIn) {
      p.floor = room.floor;
      p.x = this.world.roomCenter(room);
    }
  }

  /** Clean up after the player demolished something. */
  onRoomRemoved(room: Room): void {
    for (const id of room.peopleIds) this.removePerson(id);
  }

  onShaftRemoved(shaft: Shaft): void {
    for (const id of [...shaft.waiting, ...shaft.car.riders]) {
      const p = this.people.get(id);
      if (p) this.abortTrip(p);
    }
  }

  // ---- Elevators --------------------------------------------------------

  private destOf(id: number): number {
    const leg = this.people.get(id)?.legs[0];
    return leg?.type === 'ride' ? leg.toFloor : 0;
  }

  /** Directions people waiting on a floor want to go. */
  private callsAt(shaft: Shaft, floor: number): { up: boolean; down: boolean } {
    let up = false;
    let down = false;
    for (const id of shaft.waiting) {
      const p = this.people.get(id);
      if (!p || p.floor !== floor) continue;
      if (this.destOf(id) > floor) up = true;
      else down = true;
    }
    return { up, down };
  }

  private hasRequestBeyond(shaft: Shaft, floor: number, dir: number): boolean {
    for (const id of shaft.car.riders) if ((this.destOf(id) - floor) * dir > 0) return true;
    for (const id of shaft.waiting) {
      const p = this.people.get(id);
      if (p && (p.floor - floor) * dir > 0) return true;
    }
    return false;
  }

  /** First floor from `start` (inclusive) in direction `dir` where the car should stop. */
  private scan(shaft: Shaft, start: number, dir: -1 | 1): number | null {
    const car = shaft.car;
    const hasRoom = car.riders.length < BALANCE.elevator.capacity;
    for (let f = start; f >= shaft.bottom && f <= shaft.top; f += dir) {
      if (car.riders.some((id) => this.destOf(id) === f)) return f;
      const calls = this.callsAt(shaft, f);
      if (hasRoom && (dir > 0 ? calls.up : calls.down)) return f;
      if (hasRoom && (calls.up || calls.down) && !this.hasRequestBeyond(shaft, f, dir)) return f;
    }
    return null;
  }

  private stepCar(shaft: Shaft, dt: number): void {
    const car = shaft.car;
    if (car.state === 'doors') {
      car.timer -= dt;
      if (car.timer > 0) return;
      car.state = 'idle';
    }
    if (car.state === 'idle') {
      this.decide(shaft);
      if ((car.state as string) !== 'moving') return;
    }
    // Moving: travel, checking every floor we pass.
    let budget = BALANCE.elevator.speedFloorsPerMinute * dt;
    while (budget > 0 && car.state === 'moving') {
      const dir = car.dir as -1 | 1;
      const next = dir > 0 ? Math.floor(car.floor + 1e-6) + 1 : Math.ceil(car.floor - 1e-6) - 1;
      const dist = Math.abs(next - car.floor);
      if (budget < dist) {
        car.floor += dir * budget;
        budget = 0;
        break;
      }
      car.floor = next;
      budget -= dist;
      const stop = this.scan(shaft, next, dir);
      if (stop === null) {
        car.state = 'idle';
        car.dir = 0;
      } else if (stop === next) {
        this.arrive(shaft);
      }
    }
  }

  /** Pick what a standing car does next. */
  private decide(shaft: Shaft): void {
    const car = shaft.car;
    const cur = Math.round(car.floor);
    car.floor = cur;
    if (car.riders.length === 0 && shaft.waiting.length === 0) {
      car.dir = 0;
      return;
    }
    const here = this.callsAt(shaft, cur);
    const hereSameWay = car.dir > 0 ? here.up : car.dir < 0 ? here.down : here.up || here.down;
    const turnHere = (here.up || here.down) && (car.dir === 0 || !this.hasRequestBeyond(shaft, cur, car.dir));
    if (car.riders.length === 0 && (hereSameWay || turnHere)) {
      this.arrive(shaft);
      return;
    }
    let dir: -1 | 1 = car.dir !== 0 ? (car.dir as -1 | 1) : this.hasRequestBeyond(shaft, cur, 1) ? 1 : -1;
    let target = this.scan(shaft, cur + dir, dir);
    if (target === null) {
      dir = -dir as -1 | 1;
      target = this.scan(shaft, cur + dir, dir);
    }
    if (target === null) {
      car.dir = 0;
      return;
    }
    car.dir = dir;
    car.state = 'moving';
  }

  /** Car has stopped at a floor: let people out and in. */
  private arrive(shaft: Shaft): void {
    const car = shaft.car;
    const floor = Math.round(car.floor);
    car.floor = floor;

    for (const id of [...car.riders]) {
      if (this.destOf(id) !== floor) continue;
      car.riders = car.riders.filter((r) => r !== id);
      const p = this.people.get(id);
      if (!p) continue;
      p.floor = floor;
      p.x = this.world.shaftCenter(shaft) + p.jitter;
      this.nextLeg(p);
    }

    // Which way are we going from here?
    let dir = car.dir;
    if (car.riders.length === 0 && (dir === 0 || !this.hasRequestBeyond(shaft, floor, dir))) {
      const calls = this.callsAt(shaft, floor);
      if (dir !== 0 && (dir > 0 ? calls.up : calls.down)) {
        // keep direction
      } else if (calls.up || calls.down) {
        dir = calls.up && (dir >= 0 || !calls.down) ? 1 : -1;
      } else {
        dir = 0;
      }
    }

    for (const id of [...shaft.waiting]) {
      if (car.riders.length >= BALANCE.elevator.capacity) break;
      const p = this.people.get(id);
      if (!p || p.floor !== floor) continue;
      const want = this.destOf(id) > floor ? 1 : -1;
      if (dir !== 0 && want !== dir) continue;
      dir = want;
      shaft.waiting = shaft.waiting.filter((w) => w !== id);
      car.riders.push(id);
      p.state = 'riding';
      const waited = this.minutes - p.waitStart;
      const m = BALANCE.mood;
      if (waited <= m.okWaitMinutes) this.adjustMood(p, m.goodTripBonus);
      else if (waited >= m.badWaitMinutes) this.adjustMood(p, -m.badTripPenalty);
    }

    car.dir = dir;
    car.state = 'doors';
    car.timer = BALANCE.elevator.doorMinutes;
  }
}
