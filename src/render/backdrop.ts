import { Container, Graphics } from 'pixi.js';
import { darkness, keyframe, lerpColor, seededRandom } from './geometry';

/** Sky colours through the day: top of the screen and horizon. */
const SKY_TOP: [number, number][] = [
  [0, 0x050a1f],
  [5, 0x070d26],
  [6.2, 0x2c2a5a],
  [7, 0x4a78b8],
  [9, 0x3d8fd9],
  [16.5, 0x3d8fd9],
  [18.5, 0x3a4f8f],
  [19.6, 0x2a2556],
  [21, 0x070d26],
  [24, 0x050a1f],
];
const SKY_BOTTOM: [number, number][] = [
  [0, 0x101a3a],
  [5, 0x16204a],
  [6.2, 0xf08a5d],
  [7, 0xf6c58f],
  [9, 0xbfe3f7],
  [16.5, 0xbfe3f7],
  [18.5, 0xf6a96b],
  [19.6, 0xd2587a],
  [21, 0x1a2350],
  [24, 0x101a3a],
];

const SKY_BANDS = 32;
const CITY_TILE = 2400;

interface Cloud {
  x: number;
  y: number;
  scale: number;
  speed: number;
  puffs: [number, number, number][];
}

/**
 * Everything behind the tower: sky gradient, sun, moon, stars, clouds and two layers of city skyline.
 * Drawn in screen space; the skyline moves a little with the camera for a sense of depth.
 */
export class Backdrop {
  readonly container = new Container();
  private readonly sky = new Graphics();
  private readonly stars = new Graphics();
  private readonly sunMoon = new Graphics();
  private readonly clouds = new Graphics();
  private readonly cityFar = new Container();
  private readonly cityNear = new Container();
  private readonly farShapes = new Graphics();
  private readonly farLights = new Graphics();
  private readonly nearShapes = new Graphics();
  private readonly nearLights = new Graphics();
  private readonly starList: [number, number, number][] = [];
  private readonly cloudList: Cloud[] = [];
  private time = 0;

  constructor() {
    this.cityFar.addChild(this.farShapes, this.farLights);
    this.cityNear.addChild(this.nearShapes, this.nearLights);
    this.container.addChild(this.sky, this.stars, this.sunMoon, this.clouds, this.cityFar, this.cityNear);

    const r = seededRandom(7);
    for (let i = 0; i < 160; i++) this.starList.push([r(), r() * 0.75, 0.4 + r() * 1.2]);
    for (let i = 0; i < 9; i++) {
      const puffs: [number, number, number][] = [];
      const n = 4 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) puffs.push([k * 18 - n * 9 + r() * 8, -r() * 14, 14 + r() * 14]);
      this.cloudList.push({ x: r() * 3000, y: 0.08 + r() * 0.4, scale: 0.6 + r() * 0.9, speed: 4 + r() * 10, puffs });
    }
    this.drawCity(this.farShapes, this.farLights, 11, 40, 260, 0.85);
    this.drawCity(this.nearShapes, this.nearLights, 23, 60, 380, 1);
  }

  /** Draws one repeating strip of city blocks, in white so it can be tinted by the time of day. */
  private drawCity(shapes: Graphics, lights: Graphics, seed: number, minH: number, maxH: number, shade: number): void {
    for (let tile = 0; tile < 2; tile++) {
      const r2 = seededRandom(seed);
      let x = tile * CITY_TILE;
      const end = (tile + 1) * CITY_TILE;
      while (x < end) {
        const w = 50 + r2() * 90;
        const h = minH + r2() * r2() * (maxH - minH);
        const grey = Math.round(255 * shade * (0.8 + r2() * 0.2));
        const col = (grey << 16) | (grey << 8) | grey;
        shapes.rect(x, -h, w, h).fill(col);
        // Roof details.
        if (r2() < 0.35) shapes.rect(x + w * 0.3, -h - 12, w * 0.15, 12).fill(col);
        if (r2() < 0.25) shapes.rect(x + w * 0.6, -h - 30, 2, 30).fill(col);
        // Windows that light up at night.
        for (let wy = -h + 10; wy < -12; wy += 14) {
          for (let wx = x + 6; wx < x + w - 8; wx += 11) {
            if (r2() < 0.33) lights.rect(wx, wy, 5, 7).fill(r2() < 0.8 ? 0xffd88a : 0xbfe0ff);
          }
        }
        x += w + 4 + r2() * 20;
      }
    }
  }

  /** Update for the current hour and camera. groundY is the screen y of the ground line. */
  update(hour: number, width: number, height: number, cameraX: number, groundY: number, zoom: number, realSeconds: number): void {
    this.time += realSeconds;
    const dark = darkness(hour);

    // Sky gradient as horizontal bands.
    const top = keyframe(SKY_TOP, hour);
    const bottom = keyframe(SKY_BOTTOM, hour);
    const sky = this.sky;
    sky.clear();
    const bandH = Math.ceil(height / SKY_BANDS) + 1;
    for (let i = 0; i < SKY_BANDS; i++) {
      sky.rect(0, i * bandH, width, bandH + 1).fill(lerpColor(top, bottom, Math.pow(i / (SKY_BANDS - 1), 1.3)));
    }

    // Stars fade in at night and twinkle.
    const st = this.stars;
    st.clear();
    if (dark > 0.05) {
      this.starList.forEach(([sx, sy, size], i) => {
        const tw = 0.6 + 0.4 * Math.sin(this.time * 2 + i * 1.7);
        st.circle(sx * width, sy * height, size).fill({ color: 0xffffff, alpha: dark * tw * 0.9 });
      });
    }

    // Sun by day, moon by night, moving in an arc.
    const sm = this.sunMoon;
    sm.clear();
    const arc = (t: number) => ({ x: width * (0.08 + 0.84 * t), y: height * 0.75 - Math.sin(Math.PI * t) * height * 0.6 });
    if (hour >= 5.5 && hour <= 20.5) {
      const p = arc((hour - 5.5) / 15);
      const warm = lerpColor(0xfff6d5, 0xffb070, Math.min(1, dark * 1.5));
      sm.circle(p.x, p.y, 60).fill({ color: warm, alpha: 0.12 });
      sm.circle(p.x, p.y, 38).fill({ color: warm, alpha: 0.2 });
      sm.circle(p.x, p.y, 22).fill(warm);
    }
    if (hour >= 19 || hour <= 7) {
      const t = hour >= 19 ? (hour - 19) / 12 : (hour + 5) / 12;
      const p = arc(t);
      const a = Math.min(1, dark * 1.3);
      sm.circle(p.x, p.y, 34).fill({ color: 0xdfe8ff, alpha: 0.08 * a });
      sm.circle(p.x, p.y, 16).fill({ color: 0xf4f1e6, alpha: a });
      sm.circle(p.x + 6, p.y - 4, 13).fill({ color: lerpColor(top, bottom, 0.3), alpha: a });
    }

    // Drifting clouds, lit by the sky colour.
    const cl = this.clouds;
    cl.clear();
    const cloudColor = lerpColor(0xffffff, lerpColor(bottom, 0x30365a, 0.6), dark);
    for (const c of this.cloudList) {
      const span = width + 600;
      const cx = (((c.x + this.time * c.speed - cameraX * 0.05) % span) + span) % span - 300;
      const cy = c.y * height;
      for (const [px, py, pr] of c.puffs) {
        cl.circle(cx + px * c.scale, cy + py * c.scale, pr * c.scale).fill({ color: cloudColor, alpha: 0.75 - dark * 0.55 });
      }
    }

    // City skyline, tinted by time of day. Far layer is lighter (more haze).
    const farTint = lerpColor(lerpColor(bottom, 0x6b7f99, 0.5), 0x0d1430, dark);
    const nearTint = lerpColor(lerpColor(bottom, 0x41526b, 0.7), 0x080c1e, dark);
    this.placeCity(this.cityFar, this.farShapes, this.farLights, farTint, cameraX * 0.25, groundY, zoom * 0.7, dark);
    this.placeCity(this.cityNear, this.nearShapes, this.nearLights, nearTint, cameraX * 0.5, groundY, zoom * 0.85, dark);
  }

  private placeCity(layer: Container, shapes: Graphics, lights: Graphics, tint: number, offset: number, groundY: number, scale: number, dark: number): void {
    shapes.tint = tint;
    lights.alpha = Math.max(0, dark - 0.15);
    layer.scale.set(Math.max(0.5, scale));
    const tileW = CITY_TILE * layer.scale.x;
    let x = offset % tileW;
    if (x > 0) x -= tileW;
    layer.x = x;
    layer.y = groundY;
  }
}
