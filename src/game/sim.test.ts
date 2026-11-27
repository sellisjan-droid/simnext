import { describe, expect, it } from 'vitest';
import { BALANCE } from '../config/balance';
import { Simulation, type SimTexts } from './sim';
import { World } from './world';

const texts: SimTexts = { movedIn: () => 'in', movedOut: () => 'out', dayReport: () => 'day', newStar: (s) => `star ${s}` };

/** Deterministic random numbers so tests are repeatable. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function run(sim: Simulation, minutes: number): void {
  for (let i = 0; i < minutes / 0.25; i++) sim.step(0.25);
}

function smallTower(money = 1_000_000) {
  const w = new World(40, 10, money);
  w.buildStrip('lobby', 0, 0, 39);
  for (let f = 1; f <= 3; f++) w.buildStrip('floor', f, 10, 35);
  const shaft = w.buildShaft('elevator', 0, 20, 3);
  expect(shaft.ok).toBe(true);
  const office = w.buildRoom('office', 3, 22)!;
  expect(office).not.toBeNull();
  return { w, office };
}

describe('World placement', () => {
  it('needs support below', () => {
    const w = new World(20, 5, 1_000_000);
    expect(w.planRoom('office', 1, 0).reason).toBe('noSupport');
    w.buildStrip('lobby', 0, 0, 19);
    expect(w.planRoom('office', 1, 0).ok).toBe(true);
    expect(w.planRoom('office', 2, 0).reason).toBe('noSupport');
  });

  it('keeps the ground floor for the lobby, shops and restaurants', () => {
    const w = new World(30, 5, 1_000_000);
    expect(w.planStrip('lobby', 1, 0, 3).reason).toBe('lobbyOnlyGround');
    expect(w.planStrip('floor', 0, 0, 3).reason).toBe('groundIsLobby');
    expect(w.planRoom('office', 0, 0).reason).toBe('groundIsLobby');
    expect(w.planRoom('shop', 0, 0).ok).toBe(true);
  });

  it('charges money and refuses when broke', () => {
    const w = new World(20, 5, 10_000);
    w.buildStrip('lobby', 0, 0, 8);
    expect(w.money).toBe(10_000 - 9 * BALANCE.lobbyCostPerCell);
    expect(w.planRoom('office', 1, 0).reason).toBe('notEnoughMoney');
  });

  it('builds and extends elevator shafts', () => {
    const w = new World(20, 8, 1_000_000);
    w.buildStrip('lobby', 0, 0, 19);
    expect(w.buildShaft('elevator', 0, 5, 3).ok).toBe(true);
    const s = w.shaftAt(2, 5)!;
    expect([s.bottom, s.top]).toEqual([0, 3]);
    expect(w.buildShaft('elevator', 3, 5, 6).ok).toBe(true);
    expect(s.top).toBe(6);
    expect(w.shafts.size).toBe(1);
  });

  it('does not remove floor that carries something', () => {
    const w = new World(20, 5, 1_000_000);
    w.buildStrip('lobby', 0, 0, 19);
    w.buildRoom('office', 1, 0);
    expect(w.demolish(0, 2).reason).toBe('somethingAbove');
    expect(w.demolish(1, 2).room).toBeDefined();
    expect(w.demolish(1, 2).ok).toBe(true); // bare floor left behind
    expect(w.demolish(0, 2).ok).toBe(true);
  });

  it('saves and loads', () => {
    const { w } = smallTower();
    w.buildStairs(1, 12);
    const copy = World.fromData(JSON.parse(JSON.stringify(w.toData())));
    expect(copy.rooms.size).toBe(1);
    expect(copy.shafts.size).toBe(1);
    expect(copy.stairs.size).toBe(1);
    expect(copy.money).toBe(w.money);
    expect(copy.cell(3, 22)!.occupant).toBe(w.cell(3, 22)!.occupant);
  });
});

describe('Routing', () => {
  it('uses stairs and changes between transports', () => {
    const w = new World(40, 10, 10_000_000);
    w.buildStrip('lobby', 0, 0, 39);
    for (let f = 1; f <= 6; f++) w.buildStrip('floor', f, 0, 39);
    w.buildShaft('elevator', 0, 5, 3); // lift A: floors 0-3 on the left
    w.buildShaft('elevator', 3, 30, 6); // lift B: floors 3-6 on the right
    w.buildStairs(6, 15); // stairs from 6 to 7... but floor 7 has no floor yet
    const sim = new Simulation(w, texts, seeded(2));
    const route = sim.router.find({ floor: 0, x: 1 }, { floor: 6, x: 20 })!;
    expect(route).not.toBeNull();
    const rides = route.legs.filter((l) => l.type === 'ride');
    expect(rides.length).toBe(2);

    w.buildStairs(1, 15);
    const short = sim.router.find({ floor: 1, x: 14 }, { floor: 2, x: 20 })!;
    expect(short.legs.some((l) => l.type === 'stairs')).toBe(true);
  });

  it('returns null when there is no way', () => {
    const w = new World(40, 10, 10_000_000);
    w.buildStrip('lobby', 0, 0, 39);
    w.buildStrip('floor', 1, 0, 39);
    const sim = new Simulation(w, texts, seeded(2));
    expect(sim.router.find({ floor: 0, x: 1 }, { floor: 1, x: 5 })).toBeNull();
  });
});

describe('Simulation', () => {
  it('rents a reachable office and workers ride the elevator to it', () => {
    const { w, office } = smallTower();
    const sim = new Simulation(w, texts, seeded(3));
    sim.moveIn(office);
    let sawRiding = false;
    let sawInside = false;
    for (let i = 0; i < (24 * 60) / 0.25; i++) {
      sim.step(0.25);
      for (const p of sim.people.values()) {
        if (p.state === 'riding') sawRiding = true;
        if (p.state === 'inside' && p.floor === 3) sawInside = true;
      }
    }
    expect(sawRiding).toBe(true);
    expect(sawInside).toBe(true);
    expect(sim.people.size).toBe(BALANCE.rooms.office.people);
  });

  it('collects rent at midnight', () => {
    const { w, office } = smallTower();
    const sim = new Simulation(w, texts, seeded(5));
    sim.moveIn(office);
    const before = w.money;
    while (sim.day === 1) sim.step(0.25);
    const expected = BALANCE.rooms.office.rentPerDay - BALANCE.transport.elevator.upkeepPerDay;
    expect(w.money - before).toBe(expected);
  });

  it('brings customers to shops and restaurants', () => {
    const w = new World(60, 10, 10_000_000);
    w.buildStrip('lobby', 0, 0, 59);
    w.buildRoom('shop', 0, 5);
    w.buildRoom('restaurant', 0, 30);
    const sim = new Simulation(w, texts, seeded(7));
    const before = w.money;
    run(sim, 12 * 60); // 6:00 to 18:00
    const shop = [...w.rooms.values()].find((r) => r.kind === 'shop')!;
    const rest = [...w.rooms.values()].find((r) => r.kind === 'restaurant')!;
    expect(shop.earnedToday).toBeGreaterThan(0);
    expect(rest.earnedToday).toBeGreaterThan(0);
    expect(w.money).toBeGreaterThan(before);
  });

  it('fills hotel rooms in the evening and empties them in the morning', () => {
    const w = new World(40, 10, 10_000_000);
    w.buildStrip('lobby', 0, 0, 39);
    w.buildStrip('floor', 1, 0, 39);
    w.buildStairs(0, 2);
    const room = w.buildRoom('hotel', 1, 10)!;
    const sim = new Simulation(w, texts, seeded(11));
    sim.stars = 3;
    run(sim, 17 * 60); // to 23:00
    expect(room.rented).toBe(true);
    expect(sim.people.size).toBeGreaterThan(0);
    run(sim, 12 * 60); // to 11:00 next day
    const guests = [...sim.people.values()].filter((p) => p.kind === 'guest' && p.homeId === room.id && p.state !== 'away');
    expect(guests.length).toBe(0);
  });

  it('awards stars when the population grows', () => {
    const w = new World(80, 20, 100_000_000);
    w.buildStrip('lobby', 0, 0, 79);
    w.buildShaft('elevator', 0, 40, 12);
    for (let f = 1; f <= 12; f++) {
      w.buildStrip('floor', f, 0, 79);
      w.buildRoom('office', f, 25);
      w.buildRoom('office', f, 50);
    }
    const sim = new Simulation(w, texts, seeded(4));
    for (const r of w.rooms.values()) sim.moveIn(r);
    run(sim, 61);
    expect(sim.stars).toBeGreaterThanOrEqual(2);
    expect(sim.messages.some((m) => m.kind === 'star')).toBe(true);
  });

  it('never gets people stuck waiting forever', () => {
    const w = new World(40, 12, 10_000_000);
    w.buildStrip('lobby', 0, 0, 39);
    w.buildShaft('elevator', 0, 20, 10);
    for (let f = 1; f <= 10; f++) {
      w.buildStrip('floor', f, 0, 39);
      w.buildRoom(f % 2 ? 'office' : 'apartment', f, 4);
      w.buildRoom(f % 3 ? 'office' : 'restaurant', f, 24);
    }
    w.buildRoom('shop', 0, 2);
    const sim = new Simulation(w, texts, seeded(9));
    sim.stars = 3;
    for (const r of w.rooms.values()) if (r.kind === 'office' || r.kind === 'apartment') sim.moveIn(r);
    run(sim, 2 * 24 * 60);
    // At 4 in the morning of day 3 nobody should still be waiting, riding or out in the building.
    while (sim.hourOfDay < 4 || sim.day < 3) sim.step(0.25);
    const busy = [...sim.people.values()].filter((p) => p.state !== 'away' && p.state !== 'inside');
    expect(busy.map((p) => `${p.kind}:${p.state}`)).toEqual([]);
    // Shop and restaurant visitors are all gone at night.
    expect([...w.rooms.values()].every((r) => r.visitors === 0)).toBe(true);
  });

  it('saves and restores a running game', () => {
    const { w, office } = smallTower();
    const sim = new Simulation(w, texts, seeded(3));
    sim.moveIn(office);
    run(sim, 3 * 60);
    const json = JSON.parse(JSON.stringify({ w: w.toData(), s: sim.toData() }));
    const w2 = World.fromData(json.w);
    const sim2 = new Simulation(w2, texts, seeded(3), json.s);
    expect(sim2.people.size).toBe(sim.people.size);
    expect(sim2.minutes).toBe(sim.minutes);
    run(sim2, 24 * 60);
    expect(w2.money).toBeGreaterThan(0);
  });
});
