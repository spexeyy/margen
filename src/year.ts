import { GOOD_CHANCE } from "./mission";
import { color } from "./theme";

const DAY_MS = 86400000;
const TOP = 22;

export interface YearView {
  chances: number[];
  date: number;
  slip: number;
  hover: number | null;
  firstDay: number;
}

export function drawYear(canvas: HTMLCanvasElement, view: YearView): void {
  const ctx = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px "Geist Variable", sans-serif';
  const bar = width / view.chances.length;
  const tall = height - TOP - 2;

  view.chances.forEach((chance, date) => {
    ctx.fillStyle = color("grid");
    ctx.fillRect(date * bar, TOP, bar + 0.6, tall);
    if (chance <= 0) return;
    ctx.fillStyle = color(chance >= GOOD_CHANCE ? "amber" : "muted");
    ctx.fillRect(date * bar, TOP + tall * (1 - chance), bar + 0.6, tall * chance);
  });

  const first = new Date(view.firstDay);
  for (let month = 0; month < 12; month++) {
    const start = new Date(Date.UTC(first.getUTCFullYear(), month, 1));
    const date = (start.getTime() - view.firstDay) / DAY_MS;
    if (date >= view.chances.length) break;
    ctx.fillStyle = color("muted");
    ctx.fillText(start.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), date * bar + 3, 11);
    ctx.fillStyle = color("line-strong");
    ctx.fillRect(date * bar, 2, 1, TOP - 6);
  }

  if (view.slip >= 0) {
    ctx.fillStyle = color("amber");
    ctx.fillRect(view.date * bar, TOP - 5, (view.slip + 1) * bar, 2.5);
  }
  if (view.hover !== null) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = color("fg");
    ctx.fillRect(view.hover * bar, TOP, Math.max(1, bar), tall);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = color("fg");
  ctx.lineWidth = 2;
  ctx.strokeRect(view.date * bar - 1.5, TOP - 1, bar + 3, tall + 2);
}
