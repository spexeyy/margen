import { above, horizonAt } from "./sky";
import type { Position } from "./sky";
import { color } from "./theme";

export interface Sky {
  profile: Float32Array;
  sun: Position[];
  earth: Position[];
}

const COMPASS: [number, string][] = [[0, "N"], [90, "E"], [180, "S"], [270, "W"]];
const LEFT = 44;
const ROW = 14;

interface Frame {
  ctx: CanvasRenderingContext2D;
  sky: Sky;
  toX: (az: number) => number;
  toY: (el: number) => number;
  perDegree: number;
}

function relative(az: number, center: number): number {
  return ((az - center + 540) % 360) - 180;
}

function track(frame: Frame, path: Position[], fill: string, center: number) {
  const { ctx, toX, toY, perDegree } = frame;
  ctx.lineWidth = 2;
  ctx.strokeStyle = fill;
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < path.length; i++) {
    const wraps = i > 0 && Math.abs(relative(path[i - 1].az, center) - relative(path[i].az, center)) > 180;
    if (i === 0 || wraps) ctx.moveTo(toX(path[i].az), toY(path[i].el));
    else ctx.lineTo(toX(path[i].az), toY(path[i].el));
  }
  ctx.stroke();
  for (let h = 24; h < path.length; h += 24) {
    ctx.beginPath();
    ctx.arc(toX(path[h].az), toY(path[h].el), 2.5, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(toX(path[0].az), toY(path[0].el), Math.max(5, path[0].radius * perDegree), 0, 2 * Math.PI);
  ctx.fill();
}

function labels(frame: Frame, path: Position[], name: string) {
  const { ctx, sky, toX, toY } = frame;
  const [first, last] = [path[0], path[path.length - 1]];
  ctx.fillStyle = color("fg");
  ctx.fillText(above(sky.profile, first) ? `${name} at landing` : `${name} at landing, behind hills`, toX(first.az) + 12, toY(first.el) - 10);
  ctx.fillStyle = color("muted");
  ctx.fillText("Day 14", toX(last.az) + 6, toY(last.el) + 14);
}

function timeline(ctx: CanvasRenderingContext2D, sky: Sky, top: number, width: number) {
  const hours = sky.sun.length;
  const toX = (h: number) => LEFT + ((width - LEFT) * h) / hours;
  const rows: [string, Position[], string][] = [
    ["Sun", sky.sun, color("amber")],
    ["Earth", sky.earth, color("earth")],
  ];
  rows.forEach(([label, path, fill], i) => {
    const y = top + i * (ROW + 8);
    ctx.fillStyle = color("grid");
    ctx.fillRect(LEFT, y, width - LEFT, ROW);
    ctx.fillStyle = fill;
    path.forEach((p, h) => {
      if (above(sky.profile, p)) ctx.fillRect(toX(h), y, toX(h + 1) - toX(h) + 0.5, ROW);
    });
    ctx.fillStyle = color("muted");
    ctx.fillText(label, 0, y + ROW - 3);
  });
  const axis = top + 2 * (ROW + 8) + 10;
  ctx.fillText("Landing", LEFT, axis);
  for (const day of [7, 14]) {
    const text = `Day ${day}`;
    const textWidth = ctx.measureText(text).width;
    ctx.fillText(text, Math.min(width - textWidth, toX(day * 24) - textWidth / 2), axis);
  }
}

export function drawHorizon(canvas: HTMLCanvasElement, sky: Sky): void {
  const ctx = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px "Geist Variable", sans-serif';

  const center = sky.sun[Math.floor(sky.sun.length / 2)].az;
  const bodies = [...sky.sun, ...sky.earth].map((p) => p.el);
  const low = Math.floor(Math.min(...sky.profile, ...bodies)) - 1;
  const high = Math.max(low + 6, Math.ceil(Math.max(...bodies)) + 2);
  const step = high - low > 12 ? 2 : 1;
  const bottom = height - 2 * (ROW + 8) - 56;
  const perDegree = bottom / (high - low);
  const toX = (az: number) => LEFT + ((width - LEFT) * (relative(az, center) + 180)) / 360;
  const toY = (el: number) => bottom - (el - low) * perDegree;
  const frame = { ctx, sky, toX, toY, perDegree };

  ctx.lineWidth = 1;
  for (let el = low; el <= high; el += step) {
    ctx.strokeStyle = color(el === 0 ? "grid-zero" : "grid");
    ctx.beginPath();
    ctx.moveTo(LEFT, toY(el));
    ctx.lineTo(width, toY(el));
    ctx.stroke();
    ctx.fillStyle = color("muted");
    ctx.fillText(`${el}°`, 0, toY(el) + 4);
  }
  for (const [az, label] of COMPASS) ctx.fillText(label, toX(az) - 3, bottom + 16);

  ctx.save();
  ctx.beginPath();
  ctx.rect(LEFT, 0, width - LEFT, bottom);
  ctx.clip();
  track(frame, sky.earth, color("earth"), center);
  track(frame, sky.sun, color("amber"), center);
  ctx.fillStyle = color("terrain");
  ctx.strokeStyle = color("terrain-edge");
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(LEFT, bottom);
  for (let k = -180; k <= 180; k++) {
    const az = (center + k + 360) % 360;
    ctx.lineTo(LEFT + ((width - LEFT) * (k + 180)) / 360, toY(horizonAt(sky.profile, az)));
  }
  ctx.lineTo(width, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.restore();

  labels(frame, sky.earth, "Earth");
  labels(frame, sky.sun, "Sun");
  timeline(ctx, sky, bottom + 36, width);
}

export function hoursUntilChange(profile: Float32Array, path: Position[]): { up: boolean; hours: number | null } {
  const up = above(profile, path[0]);
  const hours = path.findIndex((p) => above(profile, p) !== up);
  return { up, hours: hours < 0 ? null : hours };
}
