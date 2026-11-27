/**
 * All gameplay numbers live here, so balancing the game means editing only this file.
 * Money is in whole euros, time is in game minutes unless noted otherwise.
 */

export const BALANCE = {
  /** Money the player starts with. */
  startMoney: 250_000,

  /** Size of the building plot. */
  grid: {
    /** Number of cells from left to right. */
    width: 72,
    /** Highest floor number you can build on (ground floor is 0). */
    maxFloor: 30,
  },

  /** How fast the clock runs. */
  time: {
    /** Game minutes that pass per real second at speed 1x. */
    minutesPerSecond: 3,
    /** Speed multipliers offered in the top bar. */
    speeds: [1, 2, 4],
    /** Hour of day the game starts at. */
    startHour: 6,
  },

  /** Every new piece of floor (lobby or regular) costs this much per cell. */
  floorCostPerCell: 500,
  lobbyCostPerCell: 1_000,

  rooms: {
    office: {
      width: 9,
      cost: 40_000,
      /** Rent paid every day at midnight while rented. */
      rentPerDay: 2_500,
      /** People who work here. */
      people: 6,
    },
    apartment: {
      width: 12,
      cost: 55_000,
      rentPerDay: 2_000,
      people: 3,
    },
  },

  elevator: {
    /** Shaft width in cells. */
    width: 4,
    /** One-off cost to place a shaft. */
    baseCost: 30_000,
    /** Extra cost for every floor the shaft serves. */
    costPerFloor: 4_000,
    /** Running cost per day per shaft. */
    upkeepPerDay: 600,
    /** Max people in the car. */
    capacity: 10,
    /** Floors travelled per game minute. */
    speedFloorsPerMinute: 6,
    /** How long the doors stay open at a stop, in game minutes. */
    doorMinutes: 0.6,
  },

  people: {
    /** Walking speed in cells per game minute. */
    walkCellsPerMinute: 18,
  },

  /** When people arrive and leave, as [earliest, latest] hour of the day. */
  schedule: {
    officeArrive: [7.5, 9.5],
    officeLeave: [16.5, 18.5],
    apartmentLeave: [7, 9.5],
    apartmentReturn: [16.5, 21],
    /** Chance that a resident stays home all day. */
    apartmentStayHomeChance: 0.25,
  },

  /** Tenant happiness, 0-100. Unhappy tenants move out. */
  mood: {
    start: 70,
    /** Waiting at most this long for the elevator is fine. */
    okWaitMinutes: 4,
    /** Waiting longer than this is bad. */
    badWaitMinutes: 12,
    goodTripBonus: 1,
    badTripPenalty: 6,
    /** Penalty when someone cannot reach their room at all. */
    noRoutePenalty: 15,
    /** At midnight, a tenant whose mood is below this moves out. */
    moveOutBelow: 25,
  },

  /** Chance per game hour that a vacant, reachable room finds a tenant. */
  rentChancePerHour: 0.35,
} as const;

export type RoomKindWithStats = keyof typeof BALANCE.rooms;
