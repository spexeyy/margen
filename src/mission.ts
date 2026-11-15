import type { SiteData } from "./data";

export const LANDINGS = 1000;
export const SCATTER_M = 100;
export const WINDOW_DAYS = 14;
export const NEEDS_SUNLIGHT = 0.5;
export const NEEDS_EARTH = 0.3;
export const MAX_SLOPE_DEG = 10;
export const GOOD_CHANCE = 0.9;
export const WORKS = 0;
export const TOO_STEEP = 1;
export const TOO_DARK = 2;
export const EARTH_HIDDEN = 3;
const EDGE_MARGIN_M = 250;
const NEARBY_M = 200;

function scatter(count: number, sigma: number): Float32Array {
  let seed = 2026;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(count * 2);
  for (let i = 0; i < out.length; i += 2) {
    const r = sigma * Math.sqrt(-2 * Math.log(1 - random()));
    const angle = 2 * Math.PI * random();
    out[i] = r * Math.cos(angle);
    out[i + 1] = r * Math.sin(angle);
  }
  return out;
}

// Half of the landings fall inside the typical miss: the median radius of a 2D Gaussian is sigma * sqrt(2 ln 2).
export const offsets = scatter(LANDINGS, SCATTER_M / Math.sqrt(2 * Math.LN2));

export interface Window {
  sunlight: Float32Array;
  earth: Float32Array;
  landingSun: Float32Array;
  landingEarth: Float32Array;
  // How far each spot is from failing its tightest requirement: 0 or more works.
  margin: Float32Array;
  // Which requirement is tightest where a landing fails: TOO_STEEP, TOO_DARK or EARTH_HIDDEN; WORKS otherwise.
  cause: Uint8Array;
}

// Whole percent, never 0% or 100% unless it is exactly that.
export function percent(value: number): string {
  const rounded = Math.round(100 * value);
  return `${value > 0 && value < 1 ? Math.min(99, Math.max(1, rounded)) : rounded}%`;
}

export function gradient(ground: Int16Array, size: number, pixel: number, row: number, col: number): [number, number] {
  const clamp = (i: number) => Math.min(size - 1, Math.max(0, i));
  const rise = (r0: number, c0: number, r1: number, c1: number) =>
    (ground[clamp(r1) * size + clamp(c1)] - ground[clamp(r0) * size + clamp(c0)]) /
    (pixel * (clamp(r1) - clamp(r0) + clamp(c1) - clamp(c0)));
  return [rise(row, col - 1, row, col + 1), rise(row - 1, col, row + 1, col)];
}

// For an aim at the center of a cell: where the landings fall, as [rows away, columns away, landings] triples.
function spread(pixel: number): Int32Array {
  const counts = new Map<number, number>();
  for (let i = 0; i < LANDINGS; i++) {
    const key = Math.floor(0.5 + offsets[2 * i + 1] / pixel) * 1024 + Math.floor(0.5 + offsets[2 * i] / pixel);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Int32Array.from([...counts].flatMap(([key, count]) => [Math.round(key / 1024), key - 1024 * Math.round(key / 1024), count]));
}

// Sum of the cells within `radius` cells of each cell. Only valid at least `radius` cells from the edge of the map.
function boxSum(values: Float32Array, size: number, radius: number): Float32Array {
  const along = new Float32Array(values.length);
  const out = new Float32Array(values.length);
  for (let p = radius; p < values.length - radius; p++) {
    for (let d = -radius; d <= radius; d++) along[p] += values[p + d];
  }
  for (let p = radius * size; p < values.length - radius * size; p++) {
    for (let d = -radius; d <= radius; d++) out[p] += along[p + d * size];
  }
  return out;
}

export class Mission {
  readonly size: number;
  readonly pixel: number;
  readonly extent: number;
  readonly dates: number;
  readonly slope: Float32Array;
  private readonly data: SiteData;
  private readonly masks: Uint8Array[] = [];
  private readonly spread: Int32Array;

  constructor(data: SiteData, days: number) {
    this.data = data;
    this.size = Math.sqrt(data.ground.length);
    this.pixel = data.site.pixel;
    this.extent = this.size * this.pixel;
    this.dates = days - WINDOW_DAYS + 1;
    this.spread = spread(this.pixel);
    this.slope = Float32Array.from(data.ground, (_, p) => {
      const [dx, dy] = gradient(data.ground, this.size, this.pixel, Math.floor(p / this.size), p % this.size);
      return (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
    });
  }

  private mask(date: number): Uint8Array {
    if (!this.masks[date]) {
      const margin = this.window(date).margin;
      const mask = new Uint8Array(margin.length);
      for (let p = 0; p < mask.length; p++) mask[p] = Number(margin[p] >= 0);
      this.masks[date] = mask;
    }
    return this.masks[date];
  }

  // Plain loops: this runs for every site and landing date.
  window(date: number): Window {
    const cells = this.size * this.size;
    const { sunlight: sun, earth: home } = this.data;
    const sunlight = new Float32Array(cells);
    const earth = new Float32Array(cells);
    const landingSun = new Float32Array(cells);
    const landingEarth = new Float32Array(cells);
    const margin = new Float32Array(cells);
    const cause = new Uint8Array(cells);
    for (let day = date; day < date + WINDOW_DAYS; day++) {
      for (let p = 0; p < cells; p++) {
        sunlight[p] += sun[day * cells + p];
        earth[p] += home[day * cells + p];
      }
    }
    const scale = 1 / (255 * WINDOW_DAYS);
    for (let p = 0; p < cells; p++) {
      sunlight[p] *= scale;
      earth[p] *= scale;
      landingSun[p] = sun[date * cells + p] / 255;
      landingEarth[p] = home[date * cells + p] / 255;
      const flatRoom = MAX_SLOPE_DEG / this.slope[p];
      const sunRoom = Math.min(sunlight[p], landingSun[p]) / NEEDS_SUNLIGHT;
      const earthRoom = Math.min(earth[p], landingEarth[p]) / NEEDS_EARTH;
      const tightest = Math.min(flatRoom, sunRoom, earthRoom);
      margin[p] = tightest - 1;
      cause[p] = tightest >= 1 ? WORKS : tightest === flatRoom ? TOO_STEEP : tightest === sunRoom ? TOO_DARK : EARTH_HIDDEN;
    }
    return { sunlight, earth, landingSun, landingEarth, margin, cause };
  }

  clampAim(x: number, y: number): [number, number] {
    const clamp = (v: number) => Math.min(this.extent - EDGE_MARGIN_M, Math.max(EDGE_MARGIN_M, v));
    return [clamp(x), clamp(y)];
  }

  cell(x: number, y: number): number {
    const last = this.size - 1;
    const col = Math.min(last, Math.max(0, Math.floor(x / this.pixel)));
    const row = Math.min(last, Math.max(0, Math.floor(y / this.pixel)));
    return row * this.size + col;
  }

  outcomes(date: number, x: number, y: number): Uint8Array {
    const mask = this.mask(date);
    const out = new Uint8Array(LANDINGS);
    for (let i = 0; i < LANDINGS; i++) out[i] = mask[this.cell(x + offsets[2 * i], y + offsets[2 * i + 1])];
    return out;
  }

  causes(window: Window, x: number, y: number): number[] {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < LANDINGS; i++) counts[window.cause[this.cell(x + offsets[2 * i], y + offsets[2 * i + 1])]]++;
    return counts;
  }

  chance(date: number, x: number, y: number): number {
    return this.outcomes(date, x, y).reduce((sum, v) => sum + v, 0) / LANDINGS;
  }

  bestAim(date: number): [number, number] {
    let best: [number, number] = [this.extent / 2, this.extent / 2];
    let bestScore = 0;
    const first = Math.ceil(EDGE_MARGIN_M / this.pixel);
    const last = this.size - first;
    const chances = new Float32Array(this.size * this.size);
    const mask = this.mask(date);
    if (!mask.includes(1)) return best;
    const clamp = (i: number) => Math.min(this.size - 1, Math.max(0, i));
    for (let row = first; row < last; row++) {
      for (let col = first; col < last; col++) {
        let works = 0;
        for (let i = 0; i < this.spread.length; i += 3) {
          works += this.spread[i + 2] * mask[clamp(row + this.spread[i]) * this.size + clamp(col + this.spread[i + 1])];
        }
        chances[row * this.size + col] = works / LANDINGS;
      }
    }
    const radius = Math.round(NEARBY_M / this.pixel);
    const nearby = boxSum(chances, this.size, radius);
    const room = boxSum(this.window(date).margin, this.size, radius);
    for (let row = first; row < last; row++) {
      for (let col = first; col < last; col++) {
        const p = row * this.size + col;
        // Ties go to the aim whose surroundings work best, then to the one with the most room to spare in its requirements.
        const score = chances[p] + nearby[p] / 1e7 + room[p] / 1e14;
        if (score > bestScore) {
          bestScore = score;
          best = [(col + 0.5) * this.pixel, (row + 0.5) * this.pixel];
        }
      }
    }
    return best;
  }

  slipDays(date: number, x: number, y: number): number {
    let late = 0;
    while (date + late + 1 < this.dates && this.chance(date + late + 1, x, y) >= GOOD_CHANCE) late++;
    return late;
  }

  nextGoodDate(date: number, x: number, y: number): number | null {
    for (let later = date + 1; later < this.dates; later++) {
      if (this.chance(later, x, y) >= GOOD_CHANCE) return later;
    }
    return null;
  }
}
