import type { RoomKind } from '../config/balance';
import type { DayReport, EventMessage, SimTexts } from '../game/sim';
import type { PlanReason } from '../game/world';

/** All player-facing text. The game is in Dutch for now. */

export const GAME_TITLE = 'SimNext';

export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}€ ${Math.abs(Math.round(n)).toLocaleString('nl-NL')}`;
}

export const ROOM_NAMES: Record<RoomKind, string> = {
  office: 'Kantoor',
  apartment: 'Appartement',
  shop: 'Winkel',
  restaurant: 'Restaurant',
  hotel: 'Hotelkamer',
  metro: 'Metrostation',
};

export const TOOL_NAMES = {
  inspect: 'Bekijken',
  lobby: 'Lobby',
  floor: 'Verdieping',
  stairs: 'Trap',
  elevator: 'Lift',
  express: 'Expreslift',
  office: 'Kantoor',
  apartment: 'Appartement',
  shop: 'Winkel',
  restaurant: 'Restaurant',
  hotel: 'Hotelkamer',
  metro: 'Metro',
  demolish: 'Slopen',
} as const;

export const TOOL_ICONS: Record<keyof typeof TOOL_NAMES, string> = {
  inspect: '🔍',
  lobby: '🚪',
  floor: '🧱',
  stairs: '🪜',
  elevator: '🛗',
  express: '⚡',
  office: '💼',
  apartment: '🏠',
  shop: '🛍️',
  restaurant: '🍽️',
  hotel: '🛏️',
  metro: '🚇',
  demolish: '🧨',
};

export const TOOL_HINTS = {
  inspect: 'Beweeg over de toren voor info. Sleep om rond te kijken.',
  lobby: 'Sleep over de begane grond om lobby te bouwen. Hier komt iedereen binnen.',
  floor: 'Sleep om vloer te bouwen. Boven de grond moet er iets onder zitten, in de kelder iets boven.',
  stairs: 'Klik om een trap naar de verdieping erboven te zetten. Handig voor korte stukjes.',
  elevator: 'Sleep omhoog vanaf de lobby. Begin op een bestaande lift om hem te verlengen.',
  express: 'Snelle, grote lift voor hoge torens. Sleep omhoog vanaf de lobby.',
  office: 'Klik om een kantoor te plaatsen. Kantoormensen werken overdag en lunchen graag.',
  apartment: 'Klik om een appartement te plaatsen. Bewoners gaan overdag weg.',
  shop: 'Klik om een winkel te plaatsen, ook in de lobby. Trekt bezoekers van buiten.',
  restaurant: 'Klik om een restaurant te plaatsen, ook in de lobby. Druk bij lunch en diner.',
  hotel: 'Klik om een hotelkamer te plaatsen. Gasten komen \'s avonds en betalen bij inchecken.',
  metro: 'Klik in een kelder om een metrostation te bouwen. Brengt veel bezoekers en is ook een ingang.',
  demolish: 'Klik op iets om het te slopen. Je krijgt geen geld terug.',
} as const;

export const REASONS: Record<PlanReason, string> = {
  outOfBounds: 'Buiten de bouwgrond',
  occupied: 'Hier staat al iets',
  noSupport: 'Er zit niets onder',
  groundIsLobby: 'De begane grond is voor lobby, winkels en restaurants',
  lobbyOnlyGround: 'Lobby kan alleen op de begane grond',
  tooShort: 'Een lift moet minstens twee verdiepingen hebben',
  nothingToBuild: 'Hier is al gebouwd',
  notEnoughMoney: 'Niet genoeg geld',
  somethingAbove: 'Eerst wat erboven staat slopen',
  nothingHere: 'Hier staat niets',
  topFloor: 'Hoger kan niet',
  basementOnly: 'Dit kan alleen in de kelder',
  notInBasement: 'Dit kan niet in de kelder',
  somethingBelow: 'Eerst de kelder eronder slopen',
};

export const STAR_TITLES = ['', 'Nieuwbouw', 'Buurtgebouw', 'Stadsicoon', 'Wolkenkrabber', 'Wereldtoren'];

/** What each star rating unlocks, shown when you earn it. */
export const STAR_UNLOCKS: Record<number, string> = {
  2: 'Winkels en restaurants zijn vrijgespeeld!',
  3: 'Hotelkamers en het metrostation zijn vrijgespeeld!',
  4: 'De expreslift is vrijgespeeld!',
  5: 'Je toren is wereldberoemd. Gefeliciteerd!',
};

export function floorName(f: number): string {
  if (f === 0) return 'begane grond';
  return f < 0 ? `kelder ${-f}` : `verdieping ${f}`;
}

export function clock(hourOfDay: number): string {
  const h = Math.floor(hourOfDay);
  const m = Math.floor((hourOfDay - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const WEEKDAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

export const SIM_TEXTS: SimTexts = {
  movedIn: (kind, floor) => `Nieuwe huurder: ${ROOM_NAMES[kind].toLowerCase()} op ${floorName(floor)}`,
  movedOut: (kind, floor) =>
    `Huurder vertrokken uit ${ROOM_NAMES[kind].toLowerCase()} op ${floorName(floor)}: te lang wachten`,
  dayReport: (r: DayReport) =>
    `Einde dag ${r.day}: huur ${money(r.rent)}, verkoop ${money(r.sales)}, kosten ${money(-r.upkeep)}`,
  newStar: (stars) => `${'★'.repeat(stars)} ${STAR_TITLES[stars]}! ${STAR_UNLOCKS[stars] ?? ''}`,
  event: eventText,
};

function eventText(m: EventMessage): string {
  switch (m.type) {
    case 'vipComing':
      return `⭐ Vandaag om ${m.hour}:00 komt een VIP op bezoek! Zorg dat de lift naar boven snel is.`;
    case 'vipHappy':
      return `⭐ De VIP was onder de indruk! Je krijgt ${money(m.reward)} en iedereen is blijer.`;
    case 'vipUnhappy':
      return m.minutes ? `⭐ De VIP was ${m.minutes} minuten onderweg en vond het maar niks.` : '⭐ De VIP kon nergens heen en is boos vertrokken.';
    case 'fireStart':
      return `🔥 Brand in ${ROOM_NAMES[m.kind].toLowerCase()} op ${floorName(m.floor)}! Klik op het vuur om te blussen.`;
    case 'fireOut':
      return `🚒 De brandweer heeft de brand op ${floorName(m.floor)} geblust (${money(m.cost)}).`;
    case 'fireLost':
      return `🔥 ${ROOM_NAMES[m.kind]} op ${floorName(m.floor)} is afgebrand.`;
    case 'conventionStart':
      return '🎪 Zakenbeurs in de stad! Vandaag komen er veel meer bezoekers.';
    case 'conventionEnd':
      return '🎪 De zakenbeurs is afgelopen.';
    case 'blackoutStart':
      return '⚡ Stroomstoring! De liften staan stil.';
    case 'blackoutEnd':
      return '⚡ De stroom is terug.';
    case 'broke':
      return '💸 Je staat rood. Zorg voor meer huur of verkoop.';
  }
}

export const EVENT_CHIPS = {
  vip: '⭐ VIP-bezoek',
  fire: '🔥 Brand!',
  convention: '🎪 Zakenbeurs',
  blackout: '⚡ Stroomstoring',
} as const;

export function moodLabel(mood: number): string {
  if (mood >= 75) return 'Tevreden';
  if (mood >= 50) return 'Gaat wel';
  if (mood >= 25) return 'Ontevreden';
  return 'Wil vertrekken';
}
