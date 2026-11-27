/**
 * All gameplay numbers live here, so balancing the game means editing only this file.
 * Money is in whole euros, time is in game minutes unless noted otherwise.
 */

export const BALANCE = {
  /** Money the player starts with. */
  startMoney: 600_000,

  /** Size of the building plot. */
  grid: {
    /** Number of cells from left to right. */
    width: 80,
    /** Highest floor number you can build on (ground floor is 0). */
    maxFloor: 40,
  },

  /** How fast the clock runs. */
  time: {
    /** Game minutes that pass per real second at speed 1x. */
    minutesPerSecond: 3,
    /** Speed multipliers offered in the top bar. */
    speeds: [1, 3, 8],
    /** Hour of day the game starts at. */
    startHour: 6,
  },

  /** Every new piece of floor costs this much per cell. */
  floorCostPerCell: 200,
  lobbyCostPerCell: 500,

  /**
   * Room types. `stars` is the tower rating needed to unlock the room.
   * `ground` rooms may also be placed in the lobby on the ground floor.
   */
  rooms: {
    office: {
      width: 9,
      cost: 40_000,
      stars: 1,
      ground: false,
      /** Rent paid every day at midnight while rented. */
      rentPerDay: 2_500,
      /** People who work here. */
      people: 6,
    },
    apartment: {
      width: 12,
      cost: 55_000,
      stars: 1,
      ground: false,
      rentPerDay: 2_000,
      people: 3,
    },
    shop: {
      width: 8,
      cost: 70_000,
      stars: 2,
      ground: true,
      /** Paid every day at midnight for staff and stock. */
      upkeepPerDay: 1_200,
      /** Earned for every customer. */
      incomePerVisit: 90,
      /** Max customers inside at once. */
      capacity: 6,
      /** How long a visit takes, [min, max] minutes. */
      visitMinutes: [12, 30],
      /** Opening hours [from, to]. */
      open: [9, 21],
      /** Outside visitors per hour for one shop, at one star. */
      visitorsPerHour: 6,
    },
    restaurant: {
      width: 14,
      cost: 110_000,
      stars: 2,
      ground: true,
      upkeepPerDay: 2_500,
      incomePerVisit: 140,
      capacity: 14,
      visitMinutes: [30, 60],
      open: [11, 23],
      visitorsPerHour: 6,
    },
    hotel: {
      width: 7,
      cost: 30_000,
      stars: 3,
      ground: false,
      upkeepPerDay: 200,
      /** Paid when a guest checks in. */
      incomePerNight: 1_100,
      /** Chance per evening that a free, reachable room gets a booking (at full mood). */
      bookingChance: 0.8,
    },
  },

  /** Elevators and stairs. */
  transport: {
    elevator: {
      stars: 1,
      width: 4,
      baseCost: 30_000,
      costPerFloor: 4_000,
      upkeepPerDay: 600,
      capacity: 10,
      /** Floors travelled per game minute. */
      speed: 6,
      /** How long the doors stay open at a stop, in game minutes. */
      doorMinutes: 0.6,
    },
    express: {
      stars: 4,
      width: 6,
      baseCost: 120_000,
      costPerFloor: 10_000,
      upkeepPerDay: 2_000,
      capacity: 24,
      speed: 16,
      doorMinutes: 0.8,
    },
    stairs: {
      stars: 1,
      width: 4,
      cost: 6_000,
      /** Minutes to climb one floor. */
      climbMinutes: 1.2,
    },
  },

  people: {
    /** Walking speed in cells per game minute. */
    walkCellsPerMinute: 18,
    /** Extra minutes the route finder adds for every elevator ride, so people don't hop around. */
    rideOverheadMinutes: 3,
  },

  /** When people arrive and leave, as [earliest, latest] hour of the day. */
  schedule: {
    officeArrive: [7.5, 9.5],
    officeLunch: [11.5, 13.5],
    officeLunchChance: 0.6,
    officeLeave: [16.5, 18.5],
    apartmentLeave: [7, 9.5],
    apartmentReturn: [16.5, 20],
    apartmentStayHomeChance: 0.25,
    /** Chance that a resident goes out for dinner or shopping in the evening. */
    apartmentEveningOutChance: 0.35,
    apartmentEvening: [18.5, 21],
    hotelCheckIn: [17, 22],
    hotelCheckOut: [7, 10.5],
    hotelDinnerChance: 0.5,
    hotelDinner: [19, 21.5],
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
    /** Penalty when someone cannot reach their goal at all. */
    noRoutePenalty: 12,
    /** Penalty when a shop or restaurant is full, bonus for a good visit. */
    fullPenalty: 2,
    goodVisitBonus: 1,
    /** At midnight, a tenant whose mood is below this moves out. */
    moveOutBelow: 25,
  },

  /** Chance per game hour that a vacant, reachable office or apartment finds a tenant. */
  rentChancePerHour: 0.35,

  /**
   * Tower rating. Each entry is the population needed for that many stars.
   * More stars unlock rooms and bring more visitors.
   */
  stars: [
    { stars: 2, population: 60 },
    { stars: 3, population: 200 },
    { stars: 4, population: 450 },
    { stars: 5, population: 900 },
  ],
  /** Visitor multiplier per star rating (index = stars). */
  visitorBoost: [0, 1, 1, 1.5, 2, 2.6],
} as const;

export type RoomKind = keyof typeof BALANCE.rooms;
export type ShaftKind = 'elevator' | 'express';
export const ROOM_KINDS = Object.keys(BALANCE.rooms) as RoomKind[];
