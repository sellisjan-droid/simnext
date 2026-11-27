import { BALANCE } from '../config/balance';
import type { GameMessage, Simulation } from '../game/sim';
import { clock, money, TOOL_HINTS, TOOL_NAMES } from './strings';

export type Tool = keyof typeof TOOL_NAMES;
export const TOOLS: Tool[] = ['inspect', 'lobby', 'floor', 'office', 'apartment', 'elevator', 'demolish'];

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function toolCost(tool: Tool): string {
  switch (tool) {
    case 'lobby':
      return `${money(BALANCE.lobbyCostPerCell)} per vak`;
    case 'floor':
      return `${money(BALANCE.floorCostPerCell)} per vak`;
    case 'office':
      return money(BALANCE.rooms.office.cost);
    case 'apartment':
      return money(BALANCE.rooms.apartment.cost);
    case 'elevator':
      return `${money(BALANCE.elevator.baseCost)} + ${money(BALANCE.elevator.costPerFloor)}/verd.`;
    default:
      return '';
  }
}

/** The HTML overlay: top bar, tool buttons, messages, tooltip and help screen. */
export class Hud {
  private readonly sim: Simulation;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly speedButtons: { speed: number; el: HTMLButtonElement }[] = [];
  private readonly tooltip = $('tooltip');
  private shownMessages = 0;
  onToolChange: (tool: Tool) => void = () => {};

  constructor(sim: Simulation) {
    this.sim = sim;

    const tools = $('tools');
    TOOLS.forEach((tool, i) => {
      const b = document.createElement('button');
      b.innerHTML = `<span class="key">${i + 1}</span><span>${TOOL_NAMES[tool]}</span><span class="cost">${toolCost(tool)}</span>`;
      b.addEventListener('click', () => this.onToolChange(tool));
      tools.appendChild(b);
      this.toolButtons.set(tool, b);
    });

    const speed = $('speed');
    for (const s of [0, ...BALANCE.time.speeds]) {
      const b = document.createElement('button');
      b.textContent = s === 0 ? '❚❚' : `${s}×`;
      b.title = s === 0 ? 'Pauze (spatiebalk)' : `Snelheid ${s}×`;
      b.addEventListener('click', () => this.setSpeed(s));
      speed.appendChild(b);
      this.speedButtons.push({ speed: s, el: b });
    }

    // The game pauses while the help screen is open.
    const help = $('help');
    let speedBeforeHelp = 1;
    const openHelp = () => {
      if (!help.hidden) return;
      speedBeforeHelp = this.sim.speed;
      this.sim.speed = 0;
      help.hidden = false;
    };
    const closeHelp = () => {
      help.hidden = true;
      this.setSpeed(speedBeforeHelp);
    };
    $('help-btn').addEventListener('click', openHelp);
    $('help-close').addEventListener('click', closeHelp);
    let seen = false;
    try {
      seen = !!localStorage.getItem('simnext.helpSeen');
      localStorage.setItem('simnext.helpSeen', '1');
    } catch {
      // Storage can be blocked; just show the help.
    }
    if (!seen) openHelp();
  }

  private lastSpeed = 1;

  setSpeed(s: number): void {
    if (s > 0) this.lastSpeed = s;
    this.sim.speed = s;
  }

  togglePause(): void {
    this.setSpeed(this.sim.speed === 0 ? this.lastSpeed : 0);
  }

  setTool(tool: Tool): void {
    for (const [t, b] of this.toolButtons) b.classList.toggle('active', t === tool);
    $('hint').textContent = TOOL_HINTS[tool];
  }

  showTooltip(text: string | null, x = 0, y = 0, bad = false): void {
    if (!text) {
      this.tooltip.hidden = true;
      return;
    }
    this.tooltip.hidden = false;
    this.tooltip.textContent = text;
    this.tooltip.classList.toggle('bad', bad);
    const pad = 16;
    const w = this.tooltip.offsetWidth;
    const left = x + pad + w > window.innerWidth ? x - pad - w : x + pad;
    this.tooltip.style.left = `${Math.max(4, left)}px`;
    this.tooltip.style.top = `${y + pad}px`;
  }

  /** Show a short message in the message column. */
  toast(text: string, kind: GameMessage['kind'] = 'info'): void {
    const box = $('messages');
    const el = document.createElement('div');
    el.className = `msg ${kind}`;
    el.textContent = text;
    box.prepend(el);
    while (box.children.length > 5) box.lastElementChild?.remove();
    setTimeout(() => (el.style.opacity = '0'), 6000);
    setTimeout(() => el.remove(), 6700);
  }

  update(): void {
    const sim = this.sim;
    const m = $('money');
    m.textContent = money(sim.world.money);
    m.classList.toggle('negative', sim.world.money < 0);
    $('clock').textContent = `Dag ${sim.day}, ${clock(sim.hourOfDay)}`;
    $('population').textContent = String(sim.population);

    let rent = 0;
    for (const r of sim.world.rooms.values()) if (r.rented) rent += BALANCE.rooms[r.kind].rentPerDay;
    $('income').textContent = money(rent - sim.world.shafts.size * BALANCE.elevator.upkeepPerDay);

    for (const { speed, el } of this.speedButtons) el.classList.toggle('active', speed === sim.speed);

    // New simulation messages become toasts.
    const fresh = Math.min(sim.messageCount - this.shownMessages, sim.messages.length);
    for (const msg of sim.messages.slice(sim.messages.length - fresh)) this.toast(msg.text, msg.kind);
    this.shownMessages = sim.messageCount;
  }
}
