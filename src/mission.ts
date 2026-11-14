import type { SiteData } from "./data";

export const LANDINGS = 1000;
export const SCATTER_M = 100;
export const WINDOW_DAYS = 14;
export const NEEDS_SUNLIGHT = 0.5;
export const NEEDS_EARTH = 0.3;
export const GOOD_CHANCE = 0.9;
const EDGE_MARGIN_M = 250;

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

export const offsets = scatter(LANDINGS, SCATTER_M);

export interface Window {
  sunlight: Float32Array;
  earth: Float32Array;
}

export class Mission {
  readonly size: number;
  readonly pixel: number;
  readonly extent: number;
  readonly dates: number;
  private readonly data: SiteData;
  private readonly masks: Uint8Array[] = [];

  constructor(data: SiteData, days: number) {
    this.data = data;
    this.size = Math.sqrt(data.ground.length);
    this.pixel = data.site.pixel;
    this.extent = this.size * this.pixel;
    this.dates = days - WINDOW_DAYS + 1;
    for (let date = 0; date < this.dates; date++) {
      const { sunlight, earth } = this.window(date);
      this.masks.push(Uint8Array.from(sunlight, (s, p) => Number(s >= NEEDS_SUNLIGHT && earth[p] >= NEEDS_EARTH)));
    }
  }

  window(date: number): Window {
    const cells = this.size * this.size;
    const sunlight = new Float32Array(cells);
    const earth = new Float32Array(cells);
    for (let day = date; day < date + WINDOW_DAYS; day++) {
      for (let p = 0; p < cells; p++) {
        sunlight[p] += this.data.sunlight[day * cells + p];
        earth[p] += this.data.earth[day * cells + p];
      }
    }
    const scale = 1 / (255 * WINDOW_DAYS);
    return { sunlight: sunlight.map((v) => v * scale), earth: earth.map((v) => v * scale) };
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
    const mask = this.masks[date];
    const out = new Uint8Array(LANDINGS);
    for (let i = 0; i < LANDINGS; i++) out[i] = mask[this.cell(x + offsets[2 * i], y + offsets[2 * i + 1])];
    return out;
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
    for (let row = first; row < last; row++) {
      for (let col = first; col < last; col++) {
        chances[row * this.size + col] = this.chance(date, (col + 0.5) * this.pixel, (row + 0.5) * this.pixel);
      }
    }
    for (let row = first; row < last; row++) {
      for (let col = first; col < last; col++) {
        let neighbors = 0;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) neighbors += chances[(row + dr) * this.size + col + dc];
        }
        const score = chances[row * this.size + col] + neighbors / 2500;
        if (score > bestScore) {
          bestScore = score;
          best = [(col + 0.5) * this.pixel, (row + 0.5) * this.pixel];
        }
      }
    }
    return best;
  }

  nextGoodDate(date: number, x: number, y: number): number | null {
    for (let later = date + 1; later < this.dates; later++) {
      if (this.chance(later, x, y) >= GOOD_CHANCE) return later;
    }
    return null;
  }
}
