import { audio } from '../audio/audio';
import { BALANCE, EVENTS, type RoomKind } from '../config/balance';
import type { Simulation } from '../game/sim';
import type { Plan } from '../game/world';
import { CELL_W, FLOOR_H, type Preview, type Renderer } from '../render/renderer';
import { TOOL_KEYS, toolStars, type Hud, type Tool } from './hud';
import { floorName, money, moodLabel, REASONS, ROOM_NAMES } from './strings';

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;
const KEY_PAN_SPEED = 800; // screen pixels per second
const ROOM_TOOLS: Tool[] = ['office', 'apartment', 'shop', 'restaurant', 'hotel', 'metro'];

/** Turns mouse and keyboard input into camera moves and build actions. */
export class Controller {
  tool: Tool = 'inspect';
  preview: Preview | null = null;
  private readonly sim: Simulation;
  private readonly renderer: Renderer;
  private readonly hud: Hud;
  private drag: { floor: number; x: number } | null = null;
  private pan: { sx: number; sy: number; cx: number; cy: number } | null = null;
  private mouse: { x: number; y: number } | null = null;
  private readonly keys = new Set<string>();

  constructor(canvas: HTMLCanvasElement, renderer: Renderer, sim: Simulation, hud: Hud) {
    this.renderer = renderer;
    this.sim = sim;
    this.hud = hud;
    hud.onToolChange = (t) => this.setTool(t);
    this.setTool('inspect');
    this.resetCamera();

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => {
      if (!this.drag && !this.pan) {
        this.mouse = null;
        this.refreshHover();
      }
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get buildMode(): boolean {
    return this.tool !== 'inspect';
  }

  setTool(tool: Tool): void {
    if (this.hud.isLocked(tool)) {
      this.hud.toast(`${'★'.repeat(toolStars(tool))} nodig om dit te bouwen`, 'bad');
      audio.play('error');
      return;
    }
    if (tool !== this.tool) audio.play('click');
    this.tool = tool;
    this.drag = null;
    this.hud.setTool(tool);
    this.refreshHover();
  }

  /** Frame the tower (or the empty plot) with the ground near the bottom. */
  resetCamera(): void {
    const cam = this.renderer.camera;
    const w = this.sim.world;
    const plotW = w.width * CELL_W;
    const top = Math.max(4, w.topFloor() + 2);
    const depth = -w.bottomFloor();
    const usableH = window.innerHeight - 260;
    const zoom = Math.max(0.5, Math.min(2, (window.innerWidth * 0.95) / plotW, usableH / ((top + depth) * FLOOR_H)));
    cam.scale.set(zoom);
    cam.x = (window.innerWidth - plotW * zoom) / 2;
    cam.y = window.innerHeight - 150 - depth * FLOOR_H * zoom;
  }

  /** Called every frame for smooth keyboard panning. */
  update(realSeconds: number): void {
    const cam = this.renderer.camera;
    const d = KEY_PAN_SPEED * realSeconds;
    let moved = false;
    if (this.keys.has('ArrowLeft') || this.keys.has('a')) (cam.x += d), (moved = true);
    if (this.keys.has('ArrowRight') || this.keys.has('d')) (cam.x -= d), (moved = true);
    if (this.keys.has('ArrowUp') || this.keys.has('w')) (cam.y += d), (moved = true);
    if (this.keys.has('ArrowDown') || this.keys.has('s')) (cam.y -= d), (moved = true);
    if (moved) this.clampCamera();
    // Room info changes over time, so keep the hover fresh.
    if (moved || (this.mouse && this.tool === 'inspect')) this.refreshHover();
  }

  private clampCamera(): void {
    const cam = this.renderer.camera;
    const z = cam.scale.x;
    const plotW = this.sim.world.width * CELL_W * z;
    const plotH = (this.sim.world.maxFloor + 1) * FLOOR_H * z;
    const depth = -this.sim.world.minFloor * FLOOR_H * z;
    const w = window.innerWidth;
    const h = window.innerHeight;
    cam.x = Math.min(w * 0.8, Math.max(w * 0.2 - plotW, cam.x));
    cam.y = Math.min(h * 0.2 + plotH, Math.max(h * 0.45 - depth, cam.y));
  }

  private zoomAt(sx: number, sy: number, factor: number): void {
    const cam = this.renderer.camera;
    const old = cam.scale.x;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, old * factor));
    cam.x = sx - ((sx - cam.x) * z) / old;
    cam.y = sy - ((sy - cam.y) * z) / old;
    cam.scale.set(z);
    this.clampCamera();
  }

  /** Screen position to grid cell. */
  private cellAt(sx: number, sy: number): { floor: number; x: number } {
    const cam = this.renderer.camera;
    const wx = (sx - cam.x) / cam.scale.x;
    const wy = (sy - cam.y) / cam.scale.y;
    return { floor: Math.floor(-wy / FLOOR_H), x: Math.floor(wx / CELL_W) };
  }

  private onDown(e: PointerEvent): void {
    this.mouse = { x: e.clientX, y: e.clientY };
    // A left click on a fire always calls the fire brigade.
    if (e.button === 0) {
      const at = this.cellAt(e.clientX, e.clientY);
      const burning = this.burningAt(at.floor, at.x);
      if (burning) {
        this.sim.extinguish(burning);
        this.refreshHover();
        return;
      }
    }
    const panButton = e.button === 1 || e.button === 2 || (e.button === 0 && this.tool === 'inspect');
    if (panButton) {
      const cam = this.renderer.camera;
      this.pan = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
      return;
    }
    if (e.button !== 0) return;
    const c = this.cellAt(e.clientX, e.clientY);
    const w = this.sim.world;
    switch (this.tool) {
      case 'lobby':
      case 'floor':
      case 'elevator':
      case 'express':
        this.drag = c;
        break;
      case 'office':
      case 'apartment':
      case 'shop':
      case 'restaurant':
      case 'hotel':
      case 'metro': {
        const kind: RoomKind = this.tool;
        const x0 = w.roomLeft(kind, c.x);
        const plan = w.planRoom(kind, c.floor, x0);
        if (plan.ok && w.buildRoom(kind, c.floor, x0)) this.spent(plan.cost);
        else this.refuse(plan);
        break;
      }
      case 'stairs': {
        const x0 = w.leftFor(BALANCE.transport.stairs.width, c.x);
        const plan = w.planStairs(c.floor, x0);
        if (plan.ok && w.buildStairs(c.floor, x0)) this.spent(plan.cost);
        else this.refuse(plan);
        break;
      }
      case 'demolish': {
        const res = w.demolish(c.floor, c.x);
        if (res.room) this.sim.onRoomRemoved(res.room);
        if (res.shaft) this.sim.onShaftRemoved(res.shaft);
        if (res.stairs) this.sim.onStairsRemoved(res.stairs);
        if (res.ok) audio.play('demolish');
        else if (res.reason) this.refuse({ ok: false, cost: 0, reason: res.reason });
        break;
      }
    }
    this.refreshHover();
  }

  private onMove(e: PointerEvent): void {
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.pan) {
      const cam = this.renderer.camera;
      cam.x = this.pan.cx + e.clientX - this.pan.sx;
      cam.y = this.pan.cy + e.clientY - this.pan.sy;
      this.clampCamera();
    }
    this.refreshHover();
  }

  private onUp(e: PointerEvent): void {
    if (this.pan) {
      this.pan = null;
      return;
    }
    if (!this.drag || e.button !== 0) return;
    const a = this.drag;
    const c = this.cellAt(e.clientX, e.clientY);
    this.drag = null;
    const w = this.sim.world;
    if (this.tool === 'lobby' || this.tool === 'floor') {
      const res = w.buildStrip(this.tool, a.floor, a.x, c.x);
      if (res.ok) this.spent(res.cost);
      else if (res.reason !== 'nothingToBuild') this.refuse(res);
    } else if (this.tool === 'elevator' || this.tool === 'express') {
      const res = w.buildShaft(this.tool, a.floor, a.x, c.floor);
      if (res.ok) this.spent(res.cost);
      else this.refuse(res);
    }
    this.refreshHover();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.002));
    } else {
      const cam = this.renderer.camera;
      if (e.shiftKey) cam.x -= e.deltaY;
      else {
        cam.x -= e.deltaX;
        cam.y -= e.deltaY;
      }
      this.clampCamera();
    }
    this.refreshHover();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!down) {
      this.keys.delete(key);
      return;
    }
    if (this.hud.dialogOpen) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's'].includes(key)) {
      this.keys.add(key);
      e.preventDefault();
      return;
    }
    const tool = TOOL_KEYS[key];
    if (tool) this.setTool(tool);
    else if (key === ' ') {
      this.hud.togglePause();
      e.preventDefault();
    } else if (key === 'Escape') this.setTool('inspect');
    else if (key === '+' || key === '=') this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.2);
    else if (key === '-') this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.2);
    else if (key === 'Home') this.resetCamera();
  }

  private spent(cost: number): void {
    if (cost > 0) this.hud.toast(`Gebouwd voor ${money(cost)}`);
    audio.play('build');
  }

  private refuse(plan: Plan): void {
    if (plan.reason) this.hud.toast(REASONS[plan.reason], 'bad');
    audio.play('error');
  }

  private burningAt(floor: number, x: number) {
    const id = this.sim.world.cell(floor, x)?.occupant;
    const room = id ? this.sim.world.rooms.get(id) : undefined;
    return room && room.fire > 0 ? room : undefined;
  }

  /** Update the build preview and tooltip for the current mouse position. */
  private refreshHover(): void {
    if (!this.mouse || this.pan) {
      this.preview = null;
      this.hud.showTooltip(null);
      return;
    }
    const { x: sx, y: sy } = this.mouse;
    const c = this.cellAt(sx, sy);
    const w = this.sim.world;
    const burning = this.burningAt(c.floor, c.x);
    if (burning) {
      this.preview = { x0: burning.x, x1: burning.x + burning.width, floor0: burning.floor, floor1: burning.floor, ok: true };
      this.hud.showTooltip(`🔥 Brand! Klik om de brandweer te bellen (${money(EVENTS.fire.extinguishCost)})`, sx, sy, true);
      return;
    }
    const show = (preview: Preview | null, plan: Plan | null, info?: string) => {
      this.preview = preview;
      if (plan) {
        const text = plan.ok ? (plan.cost > 0 ? money(plan.cost) : '') : plan.reason ? REASONS[plan.reason] : '';
        this.hud.showTooltip(text || null, sx, sy, !plan.ok);
      } else this.hud.showTooltip(info ?? null, sx, sy);
    };

    if (ROOM_TOOLS.includes(this.tool)) {
      const kind = this.tool as RoomKind;
      const x0 = w.roomLeft(kind, c.x);
      const plan = w.planRoom(kind, c.floor, x0);
      const width = BALANCE.rooms[kind].width;
      return show({ x0, x1: x0 + width, floor0: c.floor, floor1: c.floor, ok: plan.ok }, plan);
    }
    switch (this.tool) {
      case 'inspect':
        return show(null, null, this.describe(c.floor, c.x));
      case 'lobby':
      case 'floor': {
        const a = this.drag ?? c;
        const plan = w.planStrip(this.tool, a.floor, a.x, c.x);
        const x0 = Math.max(0, Math.min(a.x, c.x));
        const x1 = Math.min(w.width, Math.max(a.x, c.x) + 1);
        return show({ x0, x1, floor0: a.floor, floor1: a.floor, ok: plan.ok }, plan);
      }
      case 'stairs': {
        const sw = BALANCE.transport.stairs.width;
        const x0 = w.leftFor(sw, c.x);
        const plan = w.planStairs(c.floor, x0);
        return show({ x0, x1: x0 + sw, floor0: c.floor, floor1: c.floor, ok: plan.ok }, plan);
      }
      case 'elevator':
      case 'express': {
        const a = this.drag ?? c;
        const to = this.drag ? c.floor : c.floor + 1;
        const plan = w.planShaft(this.tool, a.floor, a.x, to);
        const width = BALANCE.transport[this.tool].width;
        const preview = { x0: plan.x, x1: plan.x + width, floor0: plan.bottom, floor1: plan.top, ok: plan.ok };
        return show(preview, this.drag ? plan : null, this.drag ? undefined : 'Sleep omhoog of omlaag');
      }
      case 'demolish': {
        const plan = w.planDemolish(c.floor, c.x);
        if (!plan.ok) return show(null, null);
        if (plan.target === 'room') {
          const r = w.rooms.get(plan.id!)!;
          return show({ x0: r.x, x1: r.x + r.width, floor0: r.floor, floor1: r.floor, ok: false }, null, `${ROOM_NAMES[r.kind]} slopen`);
        }
        if (plan.target === 'shaft') {
          const s = w.shafts.get(plan.id!)!;
          return show({ x0: s.x, x1: s.x + s.width, floor0: s.bottom, floor1: s.top, ok: false }, null, 'Lift slopen');
        }
        if (plan.target === 'stairs') {
          const s = w.stairs.get(plan.id!)!;
          return show({ x0: s.x, x1: s.x + s.width, floor0: s.floor, floor1: s.floor, ok: false }, null, 'Trap slopen');
        }
        return show({ x0: c.x, x1: c.x + 1, floor0: c.floor, floor1: c.floor, ok: false }, null, 'Vloer slopen');
      }
    }
  }

  /** Tooltip text for the inspect tool. */
  private describe(floor: number, x: number): string | undefined {
    const sim = this.sim;
    const w = sim.world;
    const cell = w.cell(floor, x);
    if (!cell || cell.base === 'none') return undefined;
    const room = cell.occupant ? w.rooms.get(cell.occupant) : undefined;
    if (room) {
      const name = `${ROOM_NAMES[room.kind]} · ${floorName(room.floor)}`;
      const mood = `${moodLabel(room.mood)} (${Math.round(room.mood)})`;
      let inside = 0;
      for (const p of sim.people.values()) if (p.state === 'inside' && p.atRoom === room.id) inside++;
      switch (room.kind) {
        case 'office':
        case 'apartment': {
          const rent = `Huur ${money(sim.rentOf(room))} per dag`;
          if (!room.rented) return `${name}\nTe huur. Wacht op een huurder als hij bereikbaar is.\n${rent}`;
          return `${name}\nVerhuurd · ${mood}\n${inside} van ${room.peopleIds.length} mensen binnen\n${rent}`;
        }
        case 'shop':
        case 'restaurant': {
          const spec = BALANCE.rooms[room.kind];
          return `${name}\nOpen ${spec.open[0]}:00 tot ${spec.open[1]}:00 · ${mood}\n${room.visitors} van ${spec.capacity} klanten binnen\nVandaag verdiend: ${money(room.earnedToday)}\nKosten ${money(spec.upkeepPerDay)} per dag`;
        }
        case 'metro': {
          const spec = BALANCE.rooms.metro;
          return `${name}\nTreinen van ${Math.floor(spec.open[0])}:30 tot 24:00\nVandaag verdiend: ${money(room.earnedToday)}\nKosten ${money(spec.upkeepPerDay)} per dag`;
        }
        case 'hotel':
          return `${name}\n${room.rented ? `Geboekt (${room.peopleIds.length} gast${room.peopleIds.length > 1 ? 'en' : ''})` : 'Vrij vannacht'} · ${mood}\n${money(BALANCE.rooms.hotel.incomePerNight)} per nacht`;
      }
    }
    const shaft = cell.occupant ? w.shafts.get(cell.occupant) : undefined;
    if (shaft) {
      const name = shaft.kind === 'express' ? 'Expreslift' : 'Lift';
      return `${name} · ${floorName(shaft.bottom)} t/m ${floorName(shaft.top)}\n${shaft.waiting.length} wachtend · ${shaft.car.riders.length} van ${BALANCE.transport[shaft.kind].capacity} in de lift`;
    }
    const stairs = cell.occupant ? w.stairs.get(cell.occupant) : undefined;
    if (stairs) return `Trap · van ${floorName(stairs.floor)} naar ${floorName(stairs.floor + 1)}`;
    return cell.base === 'lobby' ? 'Lobby' : `Lege vloer · ${floorName(floor)}`;
  }
}
