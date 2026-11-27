import { describe, expect, it } from 'vitest';
import { BALANCE } from '../config/balance';
import { Simulation } from './sim';
import { World } from './world';

const texts = { movedIn: () => 'in', movedOut: () => 'out', dayReport: () => 'day' };

/** Deterministic random numbers so tests are repeatable. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function smallTower(money = 1_000_000) {
  const w = new World(40, 10, money);
  w.buildStrip('lobby', 0, 0, 39);
  for (let f = 1; f <= 3; f++) w.buildStrip('floor', f, 10, 35);
  const shaft = w.buildShaft(0, 20, 3);
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

  it('keeps lobby on the ground floor', () => {
    const w = new World(20, 5, 1_000_000);
    expect(w.planStrip('lobby', 1, 0, 3).reason).toBe('lobbyOnlyGround');
    expect(w.planStrip('floor', 0, 0, 3).reason).toBe('groundIsLobby');
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
    expect(w.buildShaft(0, 5, 3).ok).toBe(true);
    const s = w.shaftAt(2, 5)!;
    expect([s.bottom, s.top]).toEqual([0, 3]);
    expect(w.buildShaft(3, 5, 6).ok).toBe(true);
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
});

describe('Simulation', () => {
  it('rents a reachable office and workers ride the elevator to it', () => {
    const { w, office } = smallTower();
    const sim = new Simulation(w, texts, seeded(3));
    sim.moveIn(office);
    // Run one full day in small steps.
    let sawRiding = false;
    let sawInside = false;
    for (let i = 0; i < (24 * 60) / 0.2; i++) {
      sim.step(0.2);
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
    while (sim.day === 1) sim.step(0.2);
    const expected = BALANCE.rooms.office.rentPerDay - BALANCE.elevator.upkeepPerDay;
    expect(w.money - before).toBe(expected);
  });

  it('never gets people stuck waiting forever', () => {
    const w = new World(40, 12, 10_000_000);
    w.buildStrip('lobby', 0, 0, 39);
    w.buildShaft(0, 20, 10);
    for (let f = 1; f <= 10; f++) {
      w.buildStrip('floor', f, 0, 39);
      w.buildRoom(f % 2 ? 'office' : 'apartment', f, 4);
      w.buildRoom('office', f, 24);
    }
    const sim = new Simulation(w, texts, seeded(9));
    for (const r of w.rooms.values()) sim.moveIn(r);
    for (let i = 0; i < (2 * 24 * 60) / 0.2; i++) sim.step(0.2);
    // At 6 in the morning of day 3 nobody should still be waiting or riding.
    while (sim.hourOfDay < 6 || sim.day < 3) sim.step(0.2);
    const busy = [...sim.people.values()].filter((p) => p.state === 'waiting' || p.state === 'riding');
    expect(busy).toEqual([]);
  });
});
