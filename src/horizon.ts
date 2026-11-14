import { above, horizonAt } from "./sky";
import type { Position } from "./sky";
import { color } from "./theme";

export type Seen = Position & { visible: boolean };

export interface Sky {
  profile: Float32Array;
  sun: Seen[];
  earth: Seen[];
}

export interface TimelineRow {
  label: string;
  share: string;
  path: Seen[];
  fill: string;
}

const COMPASS: [number, string][] = [[0, "N"], [90, "E"], [180, "S"], [270, "W"]];
const LEFT = 40;
const BAR = 16;
const ROW = 46;

function prepare(canvas: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] {
  const ctx = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);
  ctx.font = '12px "Geist Variable", sans-serif';
  return [ctx, width, height];
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number) {
  const size = ctx.measureText(value).width;
  ctx.fillText(value, x + size + 4 > width ? x - size - 24 : x, y);
}

export function drawTimeline(canvas: HTMLCanvasElement, rows: TimelineRow[], hour: number, ticks: string[]): void {
  const [ctx, width] = prepare(canvas);
  const hours = rows[0].path.length;
  const toX = (h: number) => (width * h) / hours;
  rows.forEach((row, i) => {
    const top = i * ROW;
    ctx.fillStyle = color("fg");
    ctx.fillText(row.label, 0, top + 13);
    ctx.fillStyle = color("muted");
    ctx.fillText(row.share, ctx.measureText(row.label).width + 10, top + 13);
    ctx.fillStyle = color("grid");
    ctx.fillRect(0, top + 20, width, BAR);
    ctx.fillStyle = color(row.fill);
    row.path.forEach((p, h) => {
      if (p.visible) ctx.fillRect(toX(h), top + 20, toX(h + 1) - toX(h) + 0.5, BAR);
    });
  });
  const axis = rows.length * ROW + 8;
  ctx.fillStyle = color("muted");
  ticks.forEach((tick, i) => {
    const size = ctx.measureText(tick).width;
    const x = (width * i) / (ticks.length - 1);
    ctx.fillText(tick, Math.min(width - size, Math.max(0, x - size / 2)), axis);
  });
  ctx.strokeStyle = color("fg");
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(toX(hour), 16);
  ctx.lineTo(toX(hour), rows.length * ROW - 6);
  ctx.stroke();
}

function relative(az: number, center: number): number {
  return ((az - center + 540) % 360) - 180;
}

export function drawSky(canvas: HTMLCanvasElement, sky: Sky, hour: number): void {
  const [ctx, width, height] = prepare(canvas);
  const center = sky.sun[Math.floor(sky.sun.length / 2)].az;
  const bodies = [...sky.sun, ...sky.earth].map((p) => p.el);
  const low = 2 * Math.floor((Math.min(...sky.profile, ...bodies) - 1) / 2);
  const high = Math.max(low + 6, 2 * Math.ceil((Math.max(...bodies) + 1.5) / 2));
  const bottom = height - 24;
  const perDegree = (bottom - 8) / (high - low);
  const toX = (az: number) => LEFT + ((width - LEFT) * (relative(az, center) + 180)) / 360;
  const toY = (el: number) => bottom - (el - low) * perDegree;

  ctx.lineWidth = 1;
  for (let el = low; el <= high; el += 2) {
    ctx.strokeStyle = color(el === 0 ? "grid-zero" : "grid");
    ctx.beginPath();
    ctx.moveTo(LEFT, toY(el));
    ctx.lineTo(width, toY(el));
    ctx.stroke();
    ctx.fillStyle = color("muted");
    ctx.fillText(`${el}°`, 0, toY(el) + 4);
  }
  for (const [az, label] of COMPASS) ctx.fillText(label, toX(az) - 4, height - 6);

  ctx.save();
  ctx.beginPath();
  ctx.rect(LEFT, 0, width - LEFT, bottom);
  ctx.clip();
  for (const [path, fill] of [[sky.earth, "earth"], [sky.sun, "amber"]] as const) {
    ctx.strokeStyle = ctx.fillStyle = color(fill);
    ctx.lineWidth = 2;
    ctx.beginPath();
    path.forEach((p, i) => {
      const wraps = i > 0 && Math.abs(relative(path[i - 1].az, center) - relative(p.az, center)) > 180;
      if (i === 0 || wraps) ctx.moveTo(toX(p.az), toY(p.el));
      else ctx.lineTo(toX(p.az), toY(p.el));
    });
    ctx.stroke();
    for (let h = 0; h < path.length; h += 24) {
      ctx.beginPath();
      ctx.arc(toX(path[h].az), toY(path[h].el), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    const now = path[hour];
    ctx.beginPath();
    ctx.arc(toX(now.az), toY(now.el), Math.max(6, now.radius * perDegree), 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.fillStyle = color("terrain");
  ctx.strokeStyle = color("terrain-edge");
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(LEFT, bottom);
  for (let k = -180; k <= 180; k++) {
    ctx.lineTo(LEFT + ((width - LEFT) * (k + 180)) / 360, toY(horizonAt(sky.profile, (center + k + 360) % 360)));
  }
  ctx.lineTo(width, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = color("muted");
  ctx.fillText("Sky", LEFT + 8, 16);
  ctx.fillText("Hills", LEFT + 8, bottom - 8);
  for (const [path, name] of [[sky.earth, "Earth"], [sky.sun, "Sun"]] as const) {
    const [first, last, now] = [path[0], path[path.length - 1], path[hour]];
    ctx.fillStyle = color("muted");
    text(ctx, "Landing", toX(first.az) + 8, toY(first.el) + 16, width);
    text(ctx, "Day 14", toX(last.az) + 8, toY(last.el) + 16, width);
    ctx.fillStyle = color("fg");
    text(ctx, now.visible ? name : `${name}, behind the hills`, toX(now.az) + 12, toY(now.el) - 10, width);
  }
}

export function withVisibility(profile: Float32Array, path: Position[]): Seen[] {
  return path.map((p) => ({ ...p, visible: above(profile, p) }));
}

export function hoursUntilChange(path: Seen[]): { up: boolean; hours: number | null } {
  const up = path[0].visible;
  const hours = path.findIndex((p) => p.visible !== up);
  return { up, hours: hours < 0 ? null : hours };
}
