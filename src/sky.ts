const DEG = 180 / Math.PI;
const MOON_RADIUS_M = 1737400;
const SUN_RADIUS_KM = 696000;

export const SUN = 0;
export const EARTH = 1;

export interface Position {
  az: number;
  el: number;
  radius: number;
}

export function toXY(lon: number, lat: number): [number, number] {
  const rho = 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 + lat / DEG / 2);
  return [rho * Math.sin(lon / DEG), rho * Math.cos(lon / DEG)];
}

export function toLonLat(x: number, y: number): [number, number] {
  const lat = (2 * Math.atan(Math.hypot(x, y) / (2 * MOON_RADIUS_M)) - Math.PI / 2) * DEG;
  return [(Math.atan2(x, y) * DEG + 360) % 360, lat];
}

export class Observer {
  private readonly up: number[];
  private readonly east: number[];
  private readonly north: number[];
  private readonly at: number[];

  constructor(lon: number, lat: number, eyeM: number) {
    const lo = lon / DEG;
    const la = lat / DEG;
    this.up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    this.east = [-Math.sin(lo), Math.cos(lo), 0];
    this.north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
    this.at = this.up.map((u) => (u * (MOON_RADIUS_M + eyeM)) / 1000);
  }

  look(ephemeris: Float32Array, hour: number, body: number): Position {
    const i = hour * 6 + body * 3;
    const v = [0, 1, 2].map((k) => ephemeris[i + k] - this.at[k]);
    const distance = Math.hypot(v[0], v[1], v[2]);
    const dot = (w: number[]) => v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
    const az = (Math.atan2(dot(this.east), dot(this.north)) * DEG + 360) % 360;
    const radius = Math.asin((body === SUN ? SUN_RADIUS_KM : 6371) / distance) * DEG;
    return { az, el: Math.asin(dot(this.up) / distance) * DEG, radius };
  }
}

export function horizonAt(profile: Float32Array, az: number): number {
  const position = (az * profile.length) / 360;
  const i = Math.floor(position);
  const f = position - i;
  return profile[i % profile.length] * (1 - f) + profile[(i + 1) % profile.length] * f;
}

export function above(profile: Float32Array, p: Position): boolean {
  return p.el > horizonAt(profile, p.az);
}
