import { Application, Container, Graphics } from 'pixi.js';
import type { Simulation } from '../game/sim';
import { Actors, type View } from './actors';
import { Backdrop } from './backdrop';
import { drawBuilding, lampPositions } from './building';
import { CELL_W, FLOOR_H, darkness, floorTop } from './geometry';

export { CELL_W, FLOOR_H, floorTop };

/** A highlighted rectangle in grid cells, used while building. */
export interface Preview {
  x0: number;
  x1: number; // exclusive
  floor0: number;
  floor1: number; // inclusive
  ok: boolean;
}

/** Puts the whole scene together: backdrop, building, actors and build preview. */
export class Renderer {
  readonly app: Application;
  readonly camera = new Container();
  private readonly sim: Simulation;
  private readonly backdrop = new Backdrop();
  private readonly building = new Graphics();
  private readonly actors: Actors;
  private readonly previewG = new Graphics();
  private drawnVersion = -1;
  private lamps: number[] = [];

  constructor(app: Application, sim: Simulation) {
    this.app = app;
    this.sim = sim;
    this.actors = new Actors(sim);
    this.camera.addChild(this.building, this.actors.g, this.actors.fx, this.previewG);
    app.stage.addChild(this.backdrop.container, this.camera);
  }

  draw(preview: Preview | null, buildMode: boolean, realSeconds: number): void {
    const sim = this.sim;
    const hour = sim.hourOfDay;
    const dark = darkness(hour);
    const screen = this.app.screen;
    const cam = this.camera;
    const zoom = cam.scale.x;

    this.backdrop.update(hour, screen.width, screen.height, cam.x, cam.y, zoom, realSeconds);

    if (this.drawnVersion !== sim.world.version) {
      drawBuilding(this.building, sim.world);
      this.lamps = lampPositions(sim.world);
      this.actors.pruneSigns();
      this.drawnVersion = sim.world.version;
    }

    const view: View = {
      x0: -cam.x / zoom,
      x1: (screen.width - cam.x) / zoom,
      y0: -cam.y / zoom,
      y1: (screen.height - cam.y) / zoom,
    };
    // Real time for animations, scaled a bit with game speed so traffic feels busier when fast.
    this.actors.draw(view, dark, this.lamps, realSeconds * (sim.speed === 0 ? 0 : Math.min(3, sim.speed)));
    this.drawPreview(preview, buildMode);
  }

  private drawPreview(preview: Preview | null, buildMode: boolean): void {
    const g = this.previewG;
    g.clear();
    const w = this.sim.world;
    if (buildMode) {
      // Show the edges of the building plot while building.
      const top = floorTop(w.maxFloor);
      const plotW = w.width * CELL_W;
      const bottom = floorTop(w.minFloor - 1);
      for (let y = top; y < bottom; y += 12) {
        g.rect(-1, y, 2, 6).fill({ color: 0xffffff, alpha: 0.35 });
        g.rect(plotW - 1, y, 2, 6).fill({ color: 0xffffff, alpha: 0.35 });
      }
    }
    if (!preview) return;
    const x = preview.x0 * CELL_W;
    const y = floorTop(preview.floor1);
    const pw = (preview.x1 - preview.x0) * CELL_W;
    const h = (preview.floor1 - preview.floor0 + 1) * FLOOR_H;
    const color = preview.ok ? 0x4cd964 : 0xff3b30;
    g.rect(x, y, pw, h).fill({ color, alpha: 0.3 }).stroke({ width: 2, color, alignment: 1 });
  }
}
