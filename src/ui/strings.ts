import type { DayReport, SimTexts } from '../game/sim';
import type { PlanReason, RoomKind } from '../game/world';

/** All player-facing text. The game is in Dutch for now. */

export const GAME_TITLE = 'SimNext';

export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}€ ${Math.abs(Math.round(n)).toLocaleString('nl-NL')}`;
}

export const ROOM_NAMES: Record<RoomKind, string> = {
  office: 'Kantoor',
  apartment: 'Appartement',
};

export const TOOL_NAMES = {
  inspect: 'Bekijken',
  lobby: 'Lobby',
  floor: 'Verdieping',
  office: 'Kantoor',
  apartment: 'Appartement',
  elevator: 'Lift',
  demolish: 'Slopen',
} as const;

export const TOOL_HINTS = {
  inspect: 'Beweeg over de toren voor info. Sleep om rond te kijken.',
  lobby: 'Sleep over de begane grond om lobby te bouwen.',
  floor: 'Sleep over een verdieping om vloer te bouwen. Er moet iets onder zitten.',
  office: 'Klik om een kantoor te plaatsen. Kantoormensen werken overdag.',
  apartment: 'Klik om een appartement te plaatsen. Bewoners gaan overdag weg.',
  elevator: 'Sleep omhoog vanaf de lobby. Begin op een bestaande lift om hem te verlengen.',
  demolish: 'Klik op iets om het te slopen. Je krijgt geen geld terug.',
} as const;

export const REASONS: Record<PlanReason, string> = {
  outOfBounds: 'Buiten de bouwgrond',
  occupied: 'Hier staat al iets',
  noSupport: 'Er zit niets onder',
  groundIsLobby: 'De begane grond is voor de lobby',
  lobbyOnlyGround: 'Lobby kan alleen op de begane grond',
  tooShort: 'Een lift moet minstens twee verdiepingen hebben',
  nothingToBuild: 'Hier is al gebouwd',
  notEnoughMoney: 'Niet genoeg geld',
  somethingAbove: 'Eerst wat erboven staat slopen',
  nothingHere: 'Hier staat niets',
};

export function floorName(f: number): string {
  return f === 0 ? 'begane grond' : `verdieping ${f}`;
}

export function clock(hourOfDay: number): string {
  const h = Math.floor(hourOfDay);
  const m = Math.floor((hourOfDay - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const SIM_TEXTS: SimTexts = {
  movedIn: (kind, floor) => `Nieuwe huurder: ${ROOM_NAMES[kind].toLowerCase()} op ${floorName(floor)}`,
  movedOut: (kind, floor) =>
    `Huurder vertrokken uit ${ROOM_NAMES[kind].toLowerCase()} op ${floorName(floor)}: te lang wachten op de lift`,
  dayReport: (r: DayReport) => `Einde dag ${r.day}: huur ${money(r.rent)}, liftonderhoud ${money(-r.upkeep)}`,
};

export function moodLabel(mood: number): string {
  if (mood >= 75) return 'Tevreden';
  if (mood >= 50) return 'Gaat wel';
  if (mood >= 25) return 'Ontevreden';
  return 'Wil vertrekken';
}
