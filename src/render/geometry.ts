/** Size of one grid cell in world pixels. */
export const CELL_W = 16;
export const FLOOR_H = 48;
/** Thickness of the concrete slab at the bottom of each floor. */
export const SLAB = 4;

/** Top y (in world pixels) of a floor. Floor 0 sits right on the ground at y = 0. */
export function floorTop(floor: number): number {
  return -(floor + 1) * FLOOR_H;
}

/** The y where people's feet touch the floor. */
export function floorSurface(floor: number): number {
  return floorTop(floor) + FLOOR_H - SLAB;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpColor(a: number, b: number, t: number): number {
  const ar = a >> 16, ag = (a >> 8) & 255, ab = a & 255;
  const br = b >> 16, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
}

/** Pick a value from [hour, value] keyframes, blending between them. */
export function keyframe(frames: readonly (readonly [number, number])[], hour: number): number {
  for (let i = 0; i < frames.length - 1; i++) {
    const [h0, c0] = frames[i];
    const [h1, c1] = frames[i + 1];
    if (hour >= h0 && hour <= h1) return lerpColor(c0, c1, (hour - h0) / (h1 - h0));
  }
  return frames[0][1];
}

/** How dark it is: 0 at midday, 1 at night, smooth at dawn and dusk. */
export function darkness(hour: number): number {
  if (hour >= 8 && hour <= 17.5) return 0;
  if (hour <= 5.5 || hour >= 20.5) return 1;
  if (hour < 8) return 1 - (hour - 5.5) / 2.5;
  return (hour - 17.5) / 3;
}

/** Small deterministic random generator, so procedural art stays the same every frame. */
export function seededRandom(seed: number): () => number {
  let s = (seed * 9301 + 49297) % 233280 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
