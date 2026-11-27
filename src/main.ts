import { Application } from 'pixi.js';
import { Simulation } from './game/sim';
import { World } from './game/world';
import { Renderer } from './render/renderer';
import { Controller } from './ui/controller';
import { Hud } from './ui/hud';
import { SIM_TEXTS } from './ui/strings';

async function start(): Promise<void> {
  const host = document.getElementById('game')!;
  const app = new Application();
  await app.init({ resizeTo: window, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
  host.appendChild(app.canvas);

  const world = new World();
  const sim = new Simulation(world, SIM_TEXTS);
  const renderer = new Renderer(app, sim);
  const hud = new Hud(sim);
  const controller = new Controller(app.canvas, renderer, sim, hud);

  app.ticker.add((ticker) => {
    const seconds = ticker.deltaMS / 1000;
    sim.update(seconds);
    controller.update(seconds);
    renderer.draw(controller.preview);
    hud.update();
  });

  // Handy for poking around in the browser console.
  Object.assign(window, { game: { world, sim, camera: renderer.camera } });
}

start();
