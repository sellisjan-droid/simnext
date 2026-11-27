import { BALANCE } from '../config/balance';
import { audio } from '../audio/audio';
import type { GameMessage, Simulation } from '../game/sim';
import { EVENT_CHIPS, STAR_TITLES, STAR_UNLOCKS, TOOL_HINTS, TOOL_ICONS, TOOL_NAMES, WEEKDAYS, clock, money } from './strings';

export type Tool = keyof typeof TOOL_NAMES;

/** Tool bar layout; null draws a separator. */
const LAYOUT: (Tool | null)[] = [
  'inspect',
  null,
  'lobby',
  'floor',
  'stairs',
  'elevator',
  'express',
  null,
  'office',
  'apartment',
  'shop',
  'restaurant',
  'hotel',
  'metro',
  null,
  'demolish',
];

export const TOOL_KEYS: Partial<Record<string, Tool>> = {
  '1': 'inspect',
  '2': 'lobby',
  '3': 'floor',
  '4': 'stairs',
  '5': 'elevator',
  '6': 'office',
  '7': 'apartment',
  '8': 'shop',
  '9': 'restaurant',
  '0': 'hotel',
  e: 'express',
  m: 'metro',
  x: 'demolish',
  Delete: 'demolish',
};

/** Stars needed before a tool can be used. */
export function toolStars(tool: Tool): number {
  if (tool in BALANCE.rooms) return BALANCE.rooms[tool as keyof typeof BALANCE.rooms].stars;
  if (tool in BALANCE.transport) return BALANCE.transport[tool as keyof typeof BALANCE.transport].stars;
  return 1;
}

const textCache = new Map<string, string>();

/** Set text only when it changed, to keep per-frame DOM work low. */
function setText(id: string, text: string, html = false): void {
  if (textCache.get(id) === text) return;
  textCache.set(id, text);
  const el = $(id);
  if (html) el.innerHTML = text;
  else el.textContent = text;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function toolCost(tool: Tool): string {
  const t = BALANCE.transport;
  switch (tool) {
    case 'lobby':
      return `${money(BALANCE.lobbyCostPerCell)}/vak`;
    case 'floor':
      return `${money(BALANCE.floorCostPerCell)}/vak`;
    case 'stairs':
      return money(t.stairs.cost);
    case 'elevator':
    case 'express':
      return `${money(t[tool].baseCost)}+`;
    case 'office':
    case 'apartment':
    case 'shop':
    case 'restaurant':
    case 'hotel':
    case 'metro':
      return money(BALANCE.rooms[tool].cost);
    default:
      return '';
  }
}

function keyFor(tool: Tool): string {
  const k = Object.entries(TOOL_KEYS).find(([, t]) => t === tool)?.[0];
  return k === 'Delete' ? 'X' : (k ?? '').toUpperCase();
}

/** The HTML overlay: top bar, tool buttons, messages, tooltip, banners and dialogs. */
export class Hud {
  private readonly sim: Simulation;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly speedButtons: { speed: number; el: HTMLButtonElement }[] = [];
  private readonly tooltip = $('tooltip');
  private shownMessages: number;
  private shownStars: number;
  private lastSpeed = 1;
  private bannerTimer = 0;
  private lastMoney: number;
  onToolChange: (tool: Tool) => void = () => {};
  onSave: () => void = () => {};
  onNewGame: () => void = () => {};

  constructor(sim: Simulation) {
    this.sim = sim;
    this.shownMessages = sim.messageCount;
    this.shownStars = sim.stars;
    this.lastMoney = sim.world.money;

    const tools = $('tools');
    for (const tool of LAYOUT) {
      if (!tool) {
        const sep = document.createElement('div');
        sep.className = 'sep';
        tools.appendChild(sep);
        continue;
      }
      const b = document.createElement('button');
      b.innerHTML = `<span class="key">${keyFor(tool)}</span><span class="icon">${TOOL_ICONS[tool]}</span><span class="name">${TOOL_NAMES[tool]}</span><span class="cost">${toolCost(tool)}</span>`;
      b.addEventListener('click', () => this.onToolChange(tool));
      tools.appendChild(b);
      this.toolButtons.set(tool, b);
    }

    const speed = $('speed');
    for (const s of [0, ...BALANCE.time.speeds]) {
      const b = document.createElement('button');
      b.textContent = s === 0 ? '❚❚' : `${'▶'.repeat(BALANCE.time.speeds.indexOf(s as never) + 1)}`;
      b.title = s === 0 ? 'Pauze (spatiebalk)' : `Snelheid ${s}×`;
      b.addEventListener('click', () => this.setSpeed(s));
      speed.appendChild(b);
      this.speedButtons.push({ speed: s, el: b });
    }

    // Menu.
    const menu = $('menu');
    $('menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    window.addEventListener('click', () => (menu.hidden = true));
    menu.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest('button')?.dataset.action;
      if (action === 'help') this.openHelp();
      if (action === 'save') this.onSave();
      if (action === 'music') {
        e.stopPropagation();
        audio.setMusic(!audio.musicOn);
        this.refreshAudioButtons();
      }
      if (action === 'sound') {
        e.stopPropagation();
        audio.setSound(!audio.soundOn);
        this.refreshAudioButtons();
      }
      if (action === 'new') this.openDialog($('confirm'));
    });
    $('confirm-no').addEventListener('click', () => this.closeDialog($('confirm')));
    $('confirm-yes').addEventListener('click', () => this.onNewGame());

    // Help screen; shown the first time.
    $('help-close').addEventListener('click', () => this.closeDialog($('help')));
    let seen = false;
    try {
      seen = !!localStorage.getItem('simnext.helpSeen');
      localStorage.setItem('simnext.helpSeen', '1');
    } catch {
      // Storage can be blocked; just show the help.
    }
    if (!seen) this.openHelp();
    this.refreshLocks();
    this.refreshAudioButtons();
  }

  private refreshAudioButtons(): void {
    $('music-btn').textContent = `🎵 Muziek: ${audio.musicOn ? 'aan' : 'uit'}`;
    $('sound-btn').textContent = `${audio.soundOn ? '🔊' : '🔇'} Geluid: ${audio.soundOn ? 'aan' : 'uit'}`;
  }

  private speedBeforeDialog = 1;
  private dialogsOpen = 0;

  /** Open an overlay and pause the game while it's open. */
  private openDialog(el: HTMLElement): void {
    if (!el.hidden) return;
    if (this.dialogsOpen++ === 0) {
      this.speedBeforeDialog = this.sim.speed;
      this.sim.speed = 0;
    }
    el.hidden = false;
  }

  private closeDialog(el: HTMLElement): void {
    if (el.hidden) return;
    el.hidden = true;
    if (--this.dialogsOpen === 0) this.setSpeed(this.speedBeforeDialog);
  }

  openHelp(): void {
    this.openDialog($('help'));
  }

  get dialogOpen(): boolean {
    return this.dialogsOpen > 0;
  }

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

  isLocked(tool: Tool): boolean {
    return !this.sim.isUnlocked(toolStars(tool));
  }

  private refreshLocks(): void {
    for (const [tool, b] of this.toolButtons) {
      const need = toolStars(tool);
      const locked = !this.sim.isUnlocked(need);
      b.classList.toggle('locked', locked);
      b.title = locked ? `Vrij bij ${'★'.repeat(need)}` : TOOL_HINTS[tool];
      const cost = b.querySelector('.cost')!;
      cost.textContent = locked ? `🔒 ${'★'.repeat(need)}` : toolCost(tool);
    }
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
    const h = this.tooltip.offsetHeight;
    const left = x + pad + w > window.innerWidth ? x - pad - w : x + pad;
    const top = y + pad + h > window.innerHeight - 110 ? y - pad - h : y + pad;
    this.tooltip.style.left = `${Math.max(4, left)}px`;
    this.tooltip.style.top = `${Math.max(4, top)}px`;
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

  flashSaved(): void {
    const el = $('saved');
    el.hidden = false;
    el.style.opacity = '1';
    setTimeout(() => (el.style.opacity = '0'), 1200);
    setTimeout(() => (el.hidden = true), 1800);
  }

  private showStarBanner(stars: number): void {
    $('banner-stars').textContent = '★'.repeat(stars);
    $('banner-title').textContent = STAR_TITLES[stars];
    $('banner-text').textContent = STAR_UNLOCKS[stars] ?? '';
    const banner = $('banner');
    banner.hidden = true;
    void banner.offsetWidth; // restart the animation
    banner.hidden = false;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (banner.hidden = true), 5000);
    for (const [tool, b] of this.toolButtons) {
      if (toolStars(tool) === stars) b.classList.add('new-unlock');
    }
  }

  update(): void {
    const sim = this.sim;
    const m = $('money');
    setText('money', money(sim.world.money));
    m.classList.toggle('negative', sim.world.money < 0);
    m.classList.toggle('flash-up', sim.world.money > this.lastMoney && sim.world.money >= 0);
    this.lastMoney = sim.world.money;
    const daily = sim.dailyBalance;
    setText('daily', `${daily >= 0 ? '+' : ''}${money(daily)}/dag`);
    $('daily').classList.toggle('negative', daily < 0);

    setText('date', `Dag ${sim.day}, ${WEEKDAYS[(sim.day - 1) % 7]}`);
    const h = sim.hourOfDay;
    setText('clock', `${h >= 6.5 && h < 20 ? '☀️' : '🌙'} ${clock(h)}`);
    const pop = sim.population;
    setText('population', pop.toLocaleString('nl-NL'));

    // Star rating and progress to the next star.
    setText('stars', [1, 2, 3, 4, 5].map((i) => (i <= sim.stars ? '★' : '<span class="off">★</span>')).join(''), true);
    setText('star-title', STAR_TITLES[sim.stars]);
    const next = sim.nextStarAt;
    const prev = BALANCE.stars.find((s) => s.stars === sim.stars)?.population ?? 0;
    setText('star-next', next ? `${pop} / ${next} mensen voor ${'★'.repeat(sim.stars + 1)}` : 'Hoogste waardering!');
    ($('star-bar') as HTMLElement).style.width = next ? `${Math.max(0, Math.min(100, ((pop - prev) / (next - prev)) * 100))}%` : '100%';
    if (sim.stars !== this.shownStars) {
      if (sim.stars > this.shownStars) this.showStarBanner(sim.stars);
      this.shownStars = sim.stars;
      this.refreshLocks();
    }

    for (const { speed, el } of this.speedButtons) el.classList.toggle('active', speed === sim.speed);

    // Running events as little chips in the top bar.
    const chips = sim.activeEvents
      .map((e) => {
        const until = e.until && e.kind !== 'vip' ? ` tot ${clock((e.until % 1440) / 60)}` : e.kind === 'vip' && e.until ? ` om ${clock((e.until % 1440) / 60)}` : '';
        return `<span class="chip ${e.kind}">${EVENT_CHIPS[e.kind]}${until}</span>`;
      })
      .join('');
    setText('events', chips, true);

    // New simulation messages become toasts.
    const fresh = Math.min(sim.messageCount - this.shownMessages, sim.messages.length);
    for (const msg of sim.messages.slice(sim.messages.length - fresh)) this.toast(msg.text, msg.kind);
    this.shownMessages = sim.messageCount;
  }
}
