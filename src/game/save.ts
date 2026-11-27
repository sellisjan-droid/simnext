import type { SimData, SimTexts } from './sim';
import { Simulation } from './sim';
import type { WorldData } from './world';
import { World } from './world';

const KEY = 'simnext.save.v2';
const VERSION = 2;

interface SaveFile {
  version: number;
  savedAt: number;
  world: WorldData;
  sim: SimData;
}

/** Write the game to browser storage. Returns false when storage is unavailable or full. */
export function saveGame(sim: Simulation): boolean {
  const file: SaveFile = { version: VERSION, savedAt: Date.now(), world: sim.world.toData(), sim: sim.toData() };
  try {
    localStorage.setItem(KEY, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

/** Read the saved game, or null if there is none or it can't be read. */
export function loadGame(texts: SimTexts): Simulation | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const file = JSON.parse(raw) as SaveFile;
    if (file.version !== VERSION) return null;
    const world = World.fromData(file.world);
    return new Simulation(world, texts, Math.random, file.sim);
  } catch {
    return null;
  }
}

export function deleteSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do when storage is blocked.
  }
}
