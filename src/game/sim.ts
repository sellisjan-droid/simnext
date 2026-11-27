import { BALANCE, type RoomKind } from '../config/balance';
import { Router, type Leg, type Spot } from './routing';
import type { Room, Shaft, Stairs } from './world';
import { World } from './world';

const DAY = 24 * 60;

export type PersonKind = 'worker' | 'resident' | 'guest' | 'visitor';
export type PersonState = 'away' | 'walking' | 'waiting' | 'riding' | 'climbing' | 'inside';
export type Errand = 'home' | 'out' | 'eat' | 'shop';

export interface Look {
  skin: number;
  hair: number;
  top: number;
  bottom: number;
  /** 0 none, 1 briefcase, 2 suitcase, 3 shopping bag. */
  carry: number;
  /** Children are smaller. */
  small: boolean;
}

export interface Person {
  id: number;
  kind: PersonKind;
  /** Office, apartment or hotel room this person belongs to, 0 for visitors. */
  homeId: number;
  state: PersonState;
  floor: number;
  /** Horizontal position in cells. */
  x: number;
  /** Direction faced: -1 left, 1 right. */
  facing: -1 | 1;
  legs: Leg[];
  /** Room the person is in right now, 0 when not in a room. */
  atRoom: number;
  /** Where the current trip goes: a room id, or 0 for the street. */
  tripTo: number;
  /** Room whose mood this trip affects. */
  moodRoom: number;
  /** Where to go after a visit to a shop or restaurant. */
  returnTo: 'home' | 'out';
  /** When a visit ends (absolute minutes), 0 when not visiting. */
  stayUntil: number;
  waitStart: number;
  /** Progress while on the stairs, 0..1. */
  climb: number;
  climbFrom: number;
  /** Small random offset so people don't stand exactly on top of each other. */
  jitter: number;
  /** Planned errands, sorted by time. */
  todo: { at: number; go: Errand }[];
  /** Visitors and hotel guests disappear once they leave. */
  transient: boolean;
  look: Look;
}

export interface GameMessage {
  text: string;
  time: number;
  kind: 'info' | 'good' | 'bad' | 'star';
}

export interface DayReport {
  day: number;
  rent: number;
  upkeep: number;
  sales: number;
}

/** Text callbacks so the simulation stays independent of the UI language. */
export interface SimTexts {
  movedIn(kind: RoomKind, floor: number): string;
  movedOut(kind: RoomKind, floor: number): string;
  dayReport(r: DayReport): string;
  newStar(stars: number): string;
}

/** Money popping up somewhere in the tower, for the floating "+ €" effect. */
export interface MoneyPop {
  amount: number;
  floor: number;
  x: number;
}

export interface SimData {
  minutes: number;
  stars: number;
  nextPersonId: number;
  visitorDebt: number;
  salesToday: number;
  people: Person[];
}

const SKIN = [0xf1c7a0, 0xe0ac7e, 0xc68c5c, 0x9a6640, 0x6e4628];
const HAIR = [0x2b1d14, 0x5a3a22, 0x8a5a2b, 0xd6b25e, 0x1b1b1b, 0xa0a0a0, 0xb4472d];
const TOPS: Record<PersonKind, number[]> = {
  worker: [0x2e3b55, 0x3a3f47, 0x4b5d73, 0x24303f, 0x5b4a3f],
  resident: [0xd9534f, 0x4f81bd, 0x6aa84f, 0xf0a030, 0x8064a2, 0x2aa198],
  guest: [0xffffff, 0xc9b28a, 0x7aa6c2, 0xe6a1a8],
  visitor: [0xe8505b, 0xf9d56e, 0x14b1ab, 0x9b5de5, 0xf15bb5, 0x00bbf9, 0x7bd389],
};
const BOTTOMS = [0x2c2f3a, 0x3d4a5c, 0x5a4632, 0x22262e, 0x6b7a8f];

const pick = <T>(arr: readonly T[], r: number): T => arr[Math.floor(r * arr.length) % arr.length];

/**
 * The running game: clock, people, elevators, stars and money flow on top of a World.
 * Time is measured in game minutes since the start.
 */
export class Simulation {
  readonly world: World;
  readonly router: Router;
  readonly people = new Map<number, Person>();
  readonly messages: GameMessage[] = [];
  /** Total messages ever sent, so the UI can tell which ones are new. */
  messageCount = 0;
  /** Money effects since the renderer last looked; it empties this list. */
  readonly moneyPops: MoneyPop[] = [];
  minutes: number;
  /** Speed multiplier, 0 means paused. */
  speed = 1;
  stars = 1;
  private nextPersonId = 1;
  private lastHour: number;
  private visitorDebt = 0;
  private salesToday = 0;
  private rng: () => number;
  private texts: SimTexts;

  constructor(world: World, texts: SimTexts, rng: () => number = Math.random, data?: SimData) {
    this.world = world;
    this.router = new Router(world);
    this.texts = texts;
    this.rng = rng;
    this.minutes = BALANCE.time.startHour * 60;
    if (data) {
      this.minutes = data.minutes;
      this.stars = data.stars;
      this.nextPersonId = data.nextPersonId;
      this.visitorDebt = data.visitorDebt;
      this.salesToday = data.salesToday;
      for (const p of data.people) this.people.set(p.id, p);
    }
    this.lastHour = Math.floor(this.minutes / 60);
  }

  toData(): SimData {
    return {
      minutes: this.minutes,
      stars: this.stars,
      nextPersonId: this.nextPersonId,
      visitorDebt: this.visitorDebt,
      salesToday: this.salesToday,
      people: [...this.people.values()],
    };
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

  /** Tenants plus hotel guests: what counts for the star rating. */
  get population(): number {
    let n = 0;
    for (const r of this.world.rooms.values()) if (r.kind === 'office' || r.kind === 'apartment') n += r.peopleIds.length;
    for (const p of this.people.values()) if (p.kind === 'guest' && p.state !== 'away') n++;
    return n;
  }

  /** Population needed for the next star, or null at the top. */
  get nextStarAt(): number | null {
    const next = BALANCE.stars.find((s) => s.stars === this.stars + 1);
    return next ? next.population : null;
  }

  isUnlocked(stars: number): boolean {
    return this.stars >= stars;
  }

  /** Advance the game by a real-time delta in seconds. */
  update(realSeconds: number): void {
    if (this.speed <= 0) return;
    let total = Math.min(realSeconds, 0.25) * BALANCE.time.minutesPerSecond * this.speed;
    // Small fixed steps keep elevators and walking stable at high speed.
    while (total > 0) {
      const dt = Math.min(total, 0.25);
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
    this.spawnVisitors(dt);
    for (const p of [...this.people.values()]) this.stepPerson(p, dt);
    for (const s of this.world.shafts.values()) this.stepCar(s, dt);
  }

  private say(text: string, kind: GameMessage['kind'] = 'info'): void {
    this.messages.push({ text, time: this.minutes, kind });
    this.messageCount++;
    if (this.messages.length > 50) this.messages.shift();
  }

  private rand(a: number, b: number): number {
    return a + (b - a) * this.rng();
  }

  private earn(amount: number, room: Room): void {
    this.world.money += amount;
    this.salesToday += amount;
    room.earnedToday += amount;
    this.moneyPops.push({ amount, floor: room.floor, x: this.world.roomCenter(room) });
    if (this.moneyPops.length > 60) this.moneyPops.shift();
  }

  // ---- Calendar ---------------------------------------------------------

  private onHour(): void {
    const hour = Math.floor(this.hourOfDay);
    for (const room of this.world.rooms.values()) {
      if (room.rented) continue;
      if (room.kind === 'office' || room.kind === 'apartment') {
        if (this.rng() < BALANCE.rentChancePerHour && this.reachableFromStreet(room)) this.moveIn(room);
      } else if (room.kind === 'hotel' && hour === 16) {
        const chance = BALANCE.rooms.hotel.bookingChance * (room.mood / 100) * Math.min(1, BALANCE.visitorBoost[this.stars]);
        if (this.rng() < chance && this.reachableFromStreet(room)) this.bookHotel(room);
      }
    }
    this.checkStars();
  }

  private checkStars(): void {
    const next = this.nextStarAt;
    if (next !== null && this.population >= next) {
      this.stars++;
      this.say(this.texts.newStar(this.stars), 'star');
    }
  }

  private onMidnight(): void {
    let rent = 0;
    let upkeep = 0;
    for (const room of this.world.rooms.values()) {
      const spec = BALANCE.rooms[room.kind];
      if ('rentPerDay' in spec && room.rented) rent += spec.rentPerDay;
      if ('upkeepPerDay' in spec) upkeep += spec.upkeepPerDay;
      room.earnedToday = 0;
    }
    for (const s of this.world.shafts.values()) upkeep += BALANCE.transport[s.kind].upkeepPerDay;
    this.world.money += rent - upkeep;
    this.say(this.texts.dayReport({ day: this.day - 1, rent, upkeep, sales: this.salesToday }), rent + this.salesToday >= upkeep ? 'info' : 'bad');
    this.salesToday = 0;

    for (const room of [...this.world.rooms.values()]) {
      if ((room.kind === 'office' || room.kind === 'apartment') && room.rented && room.mood < BALANCE.mood.moveOutBelow) this.moveOut(room);
    }
    const dayStart = Math.floor(this.minutes / DAY) * DAY;
    for (const p of this.people.values()) if (!p.transient) this.planDay(p, dayStart);
  }

  // ---- Tenants, guests and visitors -------------------------------------

  private newPerson(kind: PersonKind, homeId: number, transient: boolean): Person {
    const r = () => this.rng();
    const p: Person = {
      id: this.nextPersonId++,
      kind,
      homeId,
      state: 'away',
      floor: 0,
      x: 0,
      facing: 1,
      legs: [],
      atRoom: 0,
      tripTo: 0,
      moodRoom: homeId,
      returnTo: 'out',
      stayUntil: 0,
      waitStart: 0,
      climb: 0,
      climbFrom: 0,
      jitter: this.rand(-1.2, 1.2),
      todo: [],
      transient,
      look: {
        skin: pick(SKIN, r()),
        hair: pick(HAIR, r()),
        top: pick(TOPS[kind], r()),
        bottom: pick(BOTTOMS, r()),
        carry: kind === 'worker' ? (r() < 0.6 ? 1 : 0) : kind === 'guest' ? 2 : kind === 'visitor' && r() < 0.4 ? 3 : 0,
        small: (kind === 'resident' || kind === 'visitor') && r() < 0.15,
      },
    };
    this.people.set(p.id, p);
    return p;
  }

  moveIn(room: Room): void {
    room.rented = true;
    room.mood = BALANCE.mood.start;
    const spec = BALANCE.rooms[room.kind];
    const count = 'people' in spec ? spec.people : 0;
    const hour = this.hourOfDay;
    const s = BALANCE.schedule;
    for (let i = 0; i < count; i++) {
      const p = this.newPerson(room.kind === 'office' ? 'worker' : 'resident', room.id, false);
      room.peopleIds.push(p.id);
      this.planDay(p, Math.floor(this.minutes / DAY) * DAY);
      // New tenants show up soon, as long as it fits their day.
      const arriveNow = room.kind === 'apartment' || (hour >= s.officeArrive[0] && hour < s.officeLeave[0] - 1);
      if (arriveNow) this.addTodo(p, this.minutes + this.rand(5, 60), 'home');
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

  private bookHotel(room: Room): void {
    const s = BALANCE.schedule;
    const dayStart = Math.floor(this.minutes / DAY) * DAY;
    const guests = this.rng() < 0.4 ? 2 : 1;
    room.rented = true;
    for (let i = 0; i < guests; i++) {
      const p = this.newPerson('guest', room.id, true);
      room.peopleIds.push(p.id);
      const checkIn = dayStart + this.rand(s.hotelCheckIn[0], s.hotelCheckIn[1]) * 60;
      this.addTodo(p, Math.max(this.minutes + 1, checkIn), 'home');
      if (this.rng() < s.hotelDinnerChance) this.addTodo(p, Math.max(checkIn + 30, dayStart + this.rand(s.hotelDinner[0], s.hotelDinner[1]) * 60), 'eat');
      this.addTodo(p, dayStart + DAY + this.rand(s.hotelCheckOut[0], s.hotelCheckOut[1]) * 60, 'out');
    }
  }

  private spawnVisitors(dt: number): void {
    const hour = this.hourOfDay;
    let perHour = 0;
    for (const room of this.world.rooms.values()) {
      if (room.kind !== 'shop' && room.kind !== 'restaurant') continue;
      const spec = BALANCE.rooms[room.kind];
      if (hour < spec.open[0] || hour >= spec.open[1] - 0.5) continue;
      // Restaurants are busiest at lunch and dinner.
      const rush = room.kind === 'restaurant' ? (hour >= 12 && hour < 14) || (hour >= 18 && hour < 21) ? 1.5 : 0.4 : 1;
      perHour += spec.visitorsPerHour * rush * (0.3 + room.mood / 100);
    }
    perHour *= BALANCE.visitorBoost[this.stars];
    this.visitorDebt += (perHour * dt) / 60;
    while (this.visitorDebt >= 1) {
      this.visitorDebt -= 1;
      const p = this.newPerson('visitor', 0, true);
      // Pick an errand in proportion to what is open.
      p.todo.push({ at: this.minutes, go: this.rng() < this.shareOf('shop', hour) ? 'shop' : 'eat' });
    }
  }

  /** Share of open shops among open shops and restaurants. */
  private shareOf(kind: 'shop' | 'restaurant', hour: number): number {
    let mine = 0;
    let all = 0;
    for (const r of this.world.rooms.values()) {
      if (r.kind !== 'shop' && r.kind !== 'restaurant') continue;
      const spec = BALANCE.rooms[r.kind];
      if (hour < spec.open[0] || hour >= spec.open[1]) continue;
      all++;
      if (r.kind === kind) mine++;
    }
    return all ? mine / all : 0;
  }

  private removePerson(id: number): void {
    const p = this.people.get(id);
    if (!p) return;
    this.people.delete(id);
    const at = this.world.rooms.get(p.atRoom);
    if (at && p.stayUntil && at.visitors > 0) at.visitors--;
    const home = this.world.rooms.get(p.homeId);
    if (home && p.transient) {
      home.peopleIds = home.peopleIds.filter((x) => x !== id);
      if (home.kind === 'hotel' && home.peopleIds.length === 0) home.rented = false;
    }
    for (const s of this.world.shafts.values()) {
      s.waiting = s.waiting.filter((w) => w !== id);
      s.car.riders = s.car.riders.filter((r) => r !== id);
    }
  }

  private addTodo(p: Person, at: number, go: Errand): void {
    p.todo.push({ at, go });
    p.todo.sort((a, b) => a.at - b.at);
  }

  /** Fill a tenant's errands for the day starting at dayStart. */
  private planDay(p: Person, dayStart: number): void {
    const s = BALANCE.schedule;
    const at = (range: readonly [number, number]) => dayStart + this.rand(range[0], range[1]) * 60;
    p.todo = [];
    if (p.kind === 'worker') {
      p.todo.push({ at: at(s.officeArrive), go: 'home' });
      if (this.rng() < s.officeLunchChance) p.todo.push({ at: at(s.officeLunch), go: 'eat' });
      p.todo.push({ at: at(s.officeLeave), go: 'out' });
    } else if (p.kind === 'resident') {
      if (this.rng() >= s.apartmentStayHomeChance) {
        p.todo.push({ at: at(s.apartmentLeave), go: 'out' }, { at: at(s.apartmentReturn), go: 'home' });
      }
      if (this.rng() < s.apartmentEveningOutChance) p.todo.push({ at: at(s.apartmentEvening), go: this.rng() < 0.5 ? 'eat' : 'shop' });
    }
    p.todo = p.todo.filter((t) => t.at > this.minutes).sort((a, b) => a.at - b.at);
  }

  private adjustMood(roomId: number, delta: number): void {
    const room = this.world.rooms.get(roomId);
    if (room) room.mood = Math.max(0, Math.min(100, room.mood + delta));
  }

  // ---- Getting around ---------------------------------------------------

  /** Where a person stands right now. */
  private spotOf(p: Person): Spot {
    return { floor: p.floor, x: p.x };
  }

  /** Is there any way from the street to this room? */
  private reachableFromStreet(room: Room): boolean {
    const target = { floor: room.floor, x: this.world.roomCenter(room) };
    return this.world.entrances().some((x) => this.router.find({ floor: 0, x }, target) !== null);
  }

  private isOpen(room: Room): boolean {
    if (room.kind !== 'shop' && room.kind !== 'restaurant') return true;
    const [a, b] = BALANCE.rooms[room.kind].open;
    const h = this.hourOfDay;
    return h >= a && h < b;
  }

  /** Pick a shop or restaurant for someone, preferring nearby, happy and not-full ones. */
  private chooseVenue(p: Person, kind: 'shop' | 'restaurant'): Room | undefined {
    const options: { room: Room; score: number }[] = [];
    for (const r of this.world.rooms.values()) {
      if (r.kind !== kind || !this.isOpen(r)) continue;
      const cap = BALANCE.rooms[kind].capacity;
      if (r.visitors >= cap) continue;
      const dist = Math.abs(r.floor - p.floor) * 2 + Math.abs(this.world.roomCenter(r) - p.x) / 10;
      options.push({ room: r, score: r.mood / 20 - dist + this.rng() * 4 });
    }
    options.sort((a, b) => b.score - a.score);
    return options[0]?.room;
  }

  private stepPerson(p: Person, dt: number): void {
    const travelling = p.state === 'walking' || p.state === 'waiting' || p.state === 'riding' || p.state === 'climbing';
    if (!travelling) {
      if (p.state === 'inside' && p.stayUntil && this.minutes >= p.stayUntil) {
        this.endVisit(p);
      } else if (p.todo.length && p.todo[0].at <= this.minutes) {
        this.doErrand(p, p.todo.shift()!.go);
      }
    }
    if (p.state === 'walking') this.walk(p, dt);
    else if (p.state === 'climbing') this.climbStairs(p, dt);
  }

  private doErrand(p: Person, go: Errand): void {
    const w = this.world;
    switch (go) {
      case 'home': {
        if (p.atRoom === p.homeId) return;
        const home = w.rooms.get(p.homeId);
        if (!home) return;
        this.startTrip(p, home, home.id);
        if (home.kind === 'hotel' && p.state !== 'away') {
          // Guests pay when they check in; one payment per room.
          if (home.peopleIds[0] === p.id) this.earn(BALANCE.rooms.hotel.incomePerNight, home);
        }
        return;
      }
      case 'out':
        if (p.state === 'away') {
          if (p.transient) this.removePerson(p.id);
          return;
        }
        this.startTrip(p, null, p.homeId || p.moodRoom);
        return;
      case 'eat':
      case 'shop': {
        const venue = this.chooseVenue(p, go === 'eat' ? 'restaurant' : 'shop');
        if (!venue) {
          if (p.transient && p.state === 'away' && p.kind === 'visitor') this.removePerson(p.id);
          return;
        }
        p.returnTo = p.state === 'away' ? 'out' : p.atRoom === p.homeId && p.homeId ? 'home' : 'out';
        this.startTrip(p, venue, venue.id);
        return;
      }
    }
  }

  /** Start walking to a room, or to the street when room is null. */
  private startTrip(p: Person, room: Room | null, moodRoom: number): void {
    const w = this.world;
    const entrances = w.entrances();
    const target: Spot | null = room ? { floor: room.floor, x: room.x + 1 + this.rng() * (room.width - 2) } : null;
    let best: { legs: Leg[]; cost: number; start: Spot } | null = null;
    const starts: Spot[] = p.state === 'away' ? entrances.map((x) => ({ floor: 0, x })) : [this.spotOf(p)];
    const ends: Spot[] = target ? [target] : entrances.map((x) => ({ floor: 0, x }));
    for (const start of starts) {
      for (const end of ends) {
        const r = this.router.find(start, end);
        // A little randomness spreads people over both doors.
        const cost = r ? r.cost + this.rng() * 2 : Infinity;
        if (r && (!best || cost < best.cost)) best = { legs: r.legs, cost, start };
      }
    }
    if (!best) {
      this.adjustMood(moodRoom, -BALANCE.mood.noRoutePenalty);
      if (p.transient && p.state === 'away') this.removePerson(p.id);
      return;
    }
    this.leaveRoom(p);
    p.floor = best.start.floor;
    p.x = best.start.x;
    p.tripTo = room ? room.id : 0;
    p.moodRoom = moodRoom;
    p.legs = best.legs;
    this.beginLeg(p);
  }

  private leaveRoom(p: Person): void {
    if (p.stayUntil) {
      const at = this.world.rooms.get(p.atRoom);
      if (at && at.visitors > 0) at.visitors--;
      p.stayUntil = 0;
    }
    p.atRoom = 0;
  }

  private endVisit(p: Person): void {
    const home = this.world.rooms.get(p.homeId);
    if (p.returnTo === 'home' && home) this.startTrip(p, home, home.id);
    else this.startTrip(p, null, p.moodRoom);
    // If no way out was found, try again a bit later instead of every step.
    if (p.state === 'inside') p.stayUntil = this.minutes + 10;
  }

  private walk(p: Person, dt: number): void {
    const leg = p.legs[0];
    if (leg?.type !== 'walk') return this.nextLeg(p);
    const toX = leg.toX + (leg.queue ? p.jitter : 0);
    const step = BALANCE.people.walkCellsPerMinute * dt;
    const d = toX - p.x;
    if (d !== 0) p.facing = d > 0 ? 1 : -1;
    if (Math.abs(d) <= step) {
      p.x = toX;
      this.nextLeg(p);
    } else {
      p.x += Math.sign(d) * step;
    }
  }

  private climbStairs(p: Person, dt: number): void {
    const leg = p.legs[0];
    const stairs = leg?.type === 'stairs' ? this.world.stairs.get(leg.stairsId) : undefined;
    if (!leg || leg.type !== 'stairs' || !stairs) return this.abortTrip(p);
    p.climb += dt / BALANCE.transport.stairs.climbMinutes;
    const up = leg.toFloor > p.climbFrom;
    p.facing = up ? 1 : -1;
    const a = this.world.stairsPoint(stairs, p.climbFrom);
    const b = this.world.stairsPoint(stairs, leg.toFloor);
    p.x = a + (b - a) * Math.min(1, p.climb);
    if (p.climb >= 1) {
      p.floor = leg.toFloor;
      p.x = b;
      this.nextLeg(p);
    }
  }

  private nextLeg(p: Person): void {
    p.legs.shift();
    this.beginLeg(p);
  }

  private beginLeg(p: Person): void {
    const leg = p.legs[0];
    if (!leg) return this.arrive(p);
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
      case 'stairs':
        if (!this.world.stairs.has(leg.stairsId)) return this.abortTrip(p);
        p.state = 'climbing';
        p.climb = 0;
        p.climbFrom = p.floor;
        break;
    }
  }

  /** End of a trip. */
  private arrive(p: Person): void {
    p.legs = [];
    if (!p.tripTo) {
      p.state = 'away';
      p.atRoom = 0;
      if (p.transient) this.removePerson(p.id);
      return;
    }
    const room = this.world.rooms.get(p.tripTo);
    if (!room) return this.abortTrip(p);
    p.state = 'inside';
    p.atRoom = room.id;
    if (room.kind === 'shop' || room.kind === 'restaurant') {
      const spec = BALANCE.rooms[room.kind];
      if (room.visitors >= spec.capacity || !this.isOpen(room)) {
        // Full or closed: turn around.
        this.adjustMood(room.id, -BALANCE.mood.fullPenalty);
        p.stayUntil = this.minutes + 0.5;
        room.visitors++;
        return;
      }
      room.visitors++;
      p.stayUntil = this.minutes + this.rand(spec.visitMinutes[0], spec.visitMinutes[1]);
      this.earn(spec.incomePerVisit, room);
    }
  }

  /** Called when a trip can't be finished (e.g. a transport was demolished). Puts the person where they wanted to be. */
  private abortTrip(p: Person): void {
    this.adjustMood(p.moodRoom, -BALANCE.mood.noRoutePenalty);
    for (const s of this.world.shafts.values()) {
      s.waiting = s.waiting.filter((w) => w !== p.id);
      s.car.riders = s.car.riders.filter((r) => r !== p.id);
    }
    p.legs = [];
    const room = this.world.rooms.get(p.tripTo);
    if (room) {
      p.floor = room.floor;
      p.x = this.world.roomCenter(room);
      p.state = 'inside';
      p.atRoom = room.id;
      if (room.kind === 'shop' || room.kind === 'restaurant') {
        room.visitors++;
        p.stayUntil = this.minutes + 5;
      }
    } else {
      p.state = 'away';
      p.atRoom = 0;
      if (p.transient) this.removePerson(p.id);
    }
  }

  /** Clean up after the player demolished something. */
  onRoomRemoved(room: Room): void {
    for (const id of room.peopleIds) this.removePerson(id);
    for (const p of [...this.people.values()]) {
      if (p.atRoom === room.id) {
        p.atRoom = 0;
        p.stayUntil = 0;
        p.state = 'away';
        if (p.transient) this.removePerson(p.id);
      } else if (p.tripTo === room.id) {
        p.tripTo = 0;
      }
    }
  }

  onShaftRemoved(shaft: Shaft): void {
    for (const id of [...shaft.waiting, ...shaft.car.riders]) {
      const p = this.people.get(id);
      if (p) this.abortTrip(p);
    }
  }

  onStairsRemoved(stairs: Stairs): void {
    for (const p of [...this.people.values()]) {
      const leg = p.legs[0];
      if (p.state === 'climbing' && leg?.type === 'stairs' && leg.stairsId === stairs.id) this.abortTrip(p);
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
    const hasRoom = car.riders.length < BALANCE.transport[shaft.kind].capacity;
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
    let budget = BALANCE.transport[shaft.kind].speed * dt;
    while (budget > 0 && car.state === 'moving') {
      const dir = car.dir as -1 | 1;
      const next = dir > 0 ? Math.floor(car.floor + 1e-6) + 1 : Math.ceil(car.floor - 1e-6) - 1;
      const dist = Math.abs(next - car.floor);
      if (budget < dist) {
        car.floor += dir * budget;
        break;
      }
      car.floor = next;
      budget -= dist;
      const stop = this.scan(shaft, next, dir);
      if (stop === null) {
        car.state = 'idle';
        car.dir = 0;
      } else if (stop === next) {
        this.arriveCar(shaft);
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
      this.arriveCar(shaft);
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
  private arriveCar(shaft: Shaft): void {
    const car = shaft.car;
    const floor = Math.round(car.floor);
    car.floor = floor;
    const spec = BALANCE.transport[shaft.kind];

    for (const id of [...car.riders]) {
      if (this.destOf(id) !== floor) continue;
      car.riders = car.riders.filter((r) => r !== id);
      const p = this.people.get(id);
      if (!p) continue;
      p.floor = floor;
      p.x = this.world.shaftCenter(shaft) + p.jitter * 0.5;
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
      if (car.riders.length >= spec.capacity) break;
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
      if (waited <= m.okWaitMinutes) this.adjustMood(p.moodRoom, m.goodTripBonus);
      else if (waited >= m.badWaitMinutes) this.adjustMood(p.moodRoom, -m.badTripPenalty);
    }

    car.dir = dir;
    car.state = 'doors';
    car.timer = spec.doorMinutes;
  }
}
