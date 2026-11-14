import { above } from "./sky";
import type { Position } from "./sky";

export interface Sky {
  profile: Float32Array;
  sun: Position[];
  earth: Position[];
}

const SUN_COLOR = "#ffb224";
const EARTH_COLOR = "#3ea8ff";
const LABELS: [number, string][] = [[0, "N"], [90, "E"], [180, "S"], [270, "W"], [360, "N"]];

function track(ctx: CanvasRenderingContext2D, sky: Sky, path: Position[], color: string, toX: (az: number) => number, toY: (el: number) => number) {
  ctx.lineWidth = 2;
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    if (Math.abs(a.az - b.az) > 180) continue;
    const visible = above(sky.profile, a) && above(sky.profile, b);
    ctx.strokeStyle = color;
    ctx.globalAlpha = visible ? 1 : 0.25;
    ctx.setLineDash(visible ? [] : [3, 4]);
    ctx.beginPath();
    ctx.moveTo(toX(a.az), toY(a.el));
    ctx.lineTo(toX(b.az), toY(b.el));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

function disc(ctx: CanvasRenderingContext2D, sky: Sky, p: Position, color: string, label: string, toX: (az: number) => number, toY: (el: number) => number, perDegree: number) {
  const x = toX(p.az);
  const y = toY(p.el);
  const visible = above(sky.profile, p);
  ctx.globalAlpha = visible ? 1 : 0.35;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(5, p.radius * perDegree), 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillText(visible ? label : `${label} (behind terrain)`, x + 12, y - 10);
  ctx.globalAlpha = 1;
}

export function drawHorizon(canvas: HTMLCanvasElement, sky: Sky): void {
  const ctx = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const bodies = [...sky.sun, ...sky.earth].map((p) => p.el);
  const low = Math.floor(Math.min(...sky.profile, ...bodies)) - 1;
  const high = Math.max(low + 6, Math.ceil(Math.max(...bodies)) + 2);
  const step = high - low > 12 ? 2 : 1;
  const left = 36;
  const bottom = height - 24;
  const perDegree = bottom / (high - low);
  const toX = (az: number) => left + ((width - left) * az) / 360;
  const toY = (el: number) => bottom - (el - low) * perDegree;

  ctx.font = '11px "Geist Variable", sans-serif';
  ctx.lineWidth = 1;
  for (let el = low; el <= high; el += step) {
    ctx.strokeStyle = el === 0 ? "#3a3a3a" : "#161616";
    ctx.beginPath();
    ctx.moveTo(left, toY(el));
    ctx.lineTo(width, toY(el));
    ctx.stroke();
    ctx.fillStyle = "#6f6f6f";
    ctx.fillText(`${el}°`, 0, toY(el) + 4);
  }
  for (const [az, label] of LABELS) ctx.fillText(label, Math.min(width - 10, toX(az) - 3), height - 6);

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, 0, width - left, bottom);
  ctx.clip();
  ctx.fillStyle = "#111111";
  ctx.strokeStyle = "#8f8f8f";
  ctx.beginPath();
  ctx.moveTo(toX(0), bottom);
  for (let az = 0; az <= 360; az++) ctx.lineTo(toX(az), toY(sky.profile[az % 360]));
  ctx.lineTo(toX(360), bottom);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  track(ctx, sky, sky.earth, EARTH_COLOR, toX, toY);
  track(ctx, sky, sky.sun, SUN_COLOR, toX, toY);
  disc(ctx, sky, sky.earth[0], EARTH_COLOR, "Earth", toX, toY, perDegree);
  disc(ctx, sky, sky.sun[0], SUN_COLOR, "Sun", toX, toY, perDegree);
}

export function hoursUntilChange(profile: Float32Array, path: Position[]): { up: boolean; hours: number | null } {
  const up = above(profile, path[0]);
  const hours = path.findIndex((p) => above(profile, p) !== up);
  return { up, hours: hours < 0 ? null : hours };
}
