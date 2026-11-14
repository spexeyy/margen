import { LANDINGS, NEEDS_EARTH, NEEDS_SUNLIGHT, SCATTER_M, offsets } from "./mission";
import type { Window } from "./mission";

const DETAIL = 6;
const AMBER = [255, 178, 36];
const LIGHT_ELEVATION = 0.6;
const LIGHT = [-Math.SQRT1_2 * Math.cos(LIGHT_ELEVATION), -Math.SQRT1_2 * Math.cos(LIGHT_ELEVATION), Math.sin(LIGHT_ELEVATION)];

export interface MapView {
  shade: HTMLCanvasElement;
  zone: HTMLCanvasElement;
  extent: number;
  aim: [number, number];
  outcomes: Uint8Array;
  marker: { x: number; y: number; label: string } | null;
}

function canvasOf(size: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  return [canvas, ctx, ctx.createImageData(size, size)];
}

export function shade(ground: Int16Array, size: number, pixel: number): HTMLCanvasElement {
  const [canvas, ctx, image] = canvasOf(size);
  const at = (r: number, c: number) => ground[Math.min(size - 1, Math.max(0, r)) * size + Math.min(size - 1, Math.max(0, c))];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const dx = (at(r, c + 1) - at(r, c - 1)) / (2 * pixel);
      const dy = (at(r + 1, c) - at(r - 1, c)) / (2 * pixel);
      const norm = Math.hypot(dx, dy, 1);
      const lit = Math.max(0, (-dx * LIGHT[0] - dy * LIGHT[1] + LIGHT[2]) / norm);
      const gray = 10 + 115 * lit;
      image.data.set([gray, gray, gray, 255], (r * size + c) * 4);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function zone(window: Window, size: number): HTMLCanvasElement {
  const margin = window.sunlight.map((s, p) => Math.min(s / NEEDS_SUNLIGHT, window.earth[p] / NEEDS_EARTH) - 1);
  const fine = size * DETAIL;
  const field = new Float32Array(fine * fine);
  for (let y = 0; y < fine; y++) {
    const v = Math.min(size - 1, Math.max(0, (y + 0.5) / DETAIL - 0.5));
    const r = Math.min(size - 2, Math.floor(v));
    for (let x = 0; x < fine; x++) {
      const u = Math.min(size - 1, Math.max(0, (x + 0.5) / DETAIL - 0.5));
      const c = Math.min(size - 2, Math.floor(u));
      const fu = u - c;
      const fv = v - r;
      const top = margin[r * size + c] * (1 - fu) + margin[r * size + c + 1] * fu;
      const bottom = margin[(r + 1) * size + c] * (1 - fu) + margin[(r + 1) * size + c + 1] * fu;
      field[y * fine + x] = top * (1 - fv) + bottom * fv;
    }
  }
  const [canvas, ctx, image] = canvasOf(fine);
  for (let p = 0; p < field.length; p++) {
    if (field[p] < 0) continue;
    const x = p % fine;
    const edge = x === 0 || x === fine - 1 || field[p - 1] < 0 || field[p + 1] < 0 || field[p - fine] < 0 || field[p + fine] < 0;
    image.data.set([...AMBER, edge ? 255 : 56], p * 4);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function drawMap(canvas: HTMLCanvasElement, view: MapView): void {
  const ctx = canvas.getContext("2d")!;
  const width = canvas.width;
  const scale = width / view.extent;
  const unit = width / 600;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(view.shade, 0, 0, width, width);
  ctx.drawImage(view.zone, 0, 0, width, width);

  const [ax, ay] = view.aim;
  for (let i = 0; i < LANDINGS; i++) {
    ctx.fillStyle = view.outcomes[i] ? "#ffffff" : "#ff5b4f";
    const x = (ax + offsets[2 * i]) * scale;
    const y = (ay + offsets[2 * i + 1]) * scale;
    ctx.fillRect(x - unit, y - unit, 2 * unit, 2 * unit);
  }

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5 * unit;
  ctx.beginPath();
  ctx.arc(ax * scale, ay * scale, SCATTER_M * scale, 0, 2 * Math.PI);
  ctx.moveTo(ax * scale - 10 * unit, ay * scale);
  ctx.lineTo(ax * scale + 10 * unit, ay * scale);
  ctx.moveTo(ax * scale, ay * scale - 10 * unit);
  ctx.lineTo(ax * scale, ay * scale + 10 * unit);
  ctx.stroke();

  ctx.font = `${12 * unit}px "Geist Variable", sans-serif`;
  if (view.marker) {
    const mx = view.marker.x * scale;
    const my = view.marker.y * scale;
    ctx.strokeStyle = "#3ea8ff";
    ctx.strokeRect(mx - 5 * unit, my - 5 * unit, 10 * unit, 10 * unit);
    ctx.fillStyle = "#3ea8ff";
    ctx.fillText(view.marker.label, mx + 10 * unit, my + 4 * unit);
  }

  const bar = 500 * scale;
  ctx.fillStyle = "#ededed";
  ctx.fillRect(16 * unit, width - 20 * unit, bar, 2 * unit);
  ctx.fillText("500 m", 16 * unit, width - 28 * unit);
}

export function onAim(canvas: HTMLCanvasElement, move: (fx: number, fy: number) => void): void {
  const aimAt = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    move((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  };
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    aimAt(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (canvas.hasPointerCapture(event.pointerId)) aimAt(event);
  });
}
