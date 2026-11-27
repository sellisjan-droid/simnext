import { Application } from 'pixi.js';
import { deleteSave, loadGame, saveGame } from './game/save';
import { Simulation } from './game/sim';
import { World } from './game/world';
import { Renderer } from './render/renderer';
import { Controller } from './ui/controller';
import { Hud } from './ui/hud';
import { SIM_TEXTS } from './ui/strings';

const AUTOSAVE_SECONDS = 30;

async function start(): Promise<void> {
  const host = document.getElementById('game')!;
  const app = new Application();
  await app.init({ resizeTo: window, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
  host.appendChild(app.canvas);

  const sim = loadGame(SIM_TEXTS) ?? new Simulation(new World(), SIM_TEXTS);
  const renderer = new Renderer(app, sim);
  const hud = new Hud(sim);
  const controller = new Controller(app.canvas, renderer, sim, hud);

  let resetting = false;
  const save = (manual: boolean) => {
    if (resetting) return;
    const ok = saveGame(sim);
    if (manual) {
      if (ok) hud.flashSaved();
      else hud.toast('Opslaan lukte niet in deze browser', 'bad');
    }
  };
  hud.onSave = () => save(true);
  hud.onNewGame = () => {
    resetting = true;
    deleteSave();
    location.reload();
  };
  window.addEventListener('beforeunload', () => save(false));
  document.addEventListener('visibilitychange', () => document.hidden && save(false));
  setInterval(() => save(false), AUTOSAVE_SECONDS * 1000);

  app.ticker.add((ticker) => {
    const seconds = Math.min(0.1, ticker.deltaMS / 1000);
    sim.update(seconds);
    controller.update(seconds);
    renderer.draw(controller.preview, controller.buildMode, seconds);
    hud.update();
  });

  // Handy for poking around in the browser console.
  Object.assign(window, { game: { world: sim.world, sim, camera: renderer.camera, renderer, app } });
}

start();
