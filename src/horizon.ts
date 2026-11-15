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
  path: Seen[];
  fill: string;
}

const COMPASS: [number, string][] = [[0, "N"], [90, "E"], [180, "S"], [270, "W"]];
const LEFT = 40;
const BAR = 6;
const ROW = 40;

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
  const x = Math.min(width - 6, Math.max(6, toX(hour)));
  rows.forEach((row, i) => {
    const top = 18 + i * ROW;
    ctx.font = '13px "Geist Variable", sans-serif';
    ctx.fillStyle = color("fg");
    ctx.fillText(row.label, 0, top);
    const middle = top + 13;
    ctx.fillStyle = color("line-strong");
    ctx.fillRect(0, middle - 0.5, width, 1);
    ctx.fillStyle = color(row.fill);
    let start = -1;
    for (let h = 0; h <= hours; h++) {
      const visible = h < hours && row.path[h].visible;
      if (visible && start < 0) start = h;
      if (!visible && start >= 0) {
        ctx.beginPath();
        ctx.roundRect(toX(start), middle - BAR / 2, toX(h) - toX(start), BAR, BAR / 2);
        ctx.fill();
        start = -1;
      }
    }
    const now = row.path[Math.floor(hour)].visible;
    ctx.beginPath();
    ctx.arc(x, middle, 5, 0, 2 * Math.PI);
    ctx.fillStyle = now ? color(row.fill) : color("bg");
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = now ? color("bg") : color("muted");
    ctx.stroke();
  });

  const axis = 18 + rows.length * ROW;
  ctx.fillStyle = color("line-strong");
  ctx.fillRect(0, axis, width, 1);
  for (let day = 0; day <= hours / 24; day++) ctx.fillRect(Math.min(width - 1, toX(day * 24)), axis, 1, 5);
  ctx.fillStyle = color("fg");
  ctx.beginPath();
  ctx.moveTo(x, axis - 1);
  ctx.lineTo(x - 5, axis + 7);
  ctx.lineTo(x + 5, axis + 7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color("muted");
  ctx.font = '11px "Geist Variable", sans-serif';
  ticks.forEach((tick, i) => {
    const size = ctx.measureText(tick).width;
    const tx = (width * i) / (ticks.length - 1);
    ctx.fillText(tick, Math.min(width - size, Math.max(0, tx - size / 2)), axis + 22);
  });
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
  ctx.fillStyle = color("fg");
  for (const [path, name] of [[sky.earth, "Earth"], [sky.sun, "Sun"]] as const) {
    const now = path[hour];
    text(ctx, name, toX(now.az) + 12, toY(now.el) - 10, width);
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
