import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./style.css";

interface Summary {
  meanDifference: number;
  bias: number;
  correlation: number;
}

interface Validation {
  ephemerisMaxError: number;
  athena: { time: string; sunAzimuth: number; sunElevation: number; horizonsSunElevation: number; terrainHorizon: number };
  avgvisib: { points: number[][]; sunlight: Summary; earth: Summary };
}

const SIZE = 360;
const PAD = 44;
const TICKS = [0, 25, 50, 75, 100];

const result: Validation = await (await fetch("/data/validation.json")).json();
const byId = (id: string) => document.getElementById(id)!;

function scatter(pairs: [number, number][], color: string, name: string): string {
  const at = (v: number) => PAD + ((SIZE - PAD - 12) * v) / 100;
  const flip = (v: number) => SIZE - at(v);
  const grid = TICKS.map(
    (t) =>
      `<line x1="${at(0)}" x2="${at(100)}" y1="${flip(t)}" y2="${flip(t)}" class="grid"/>` +
      `<line x1="${at(t)}" x2="${at(t)}" y1="${flip(0)}" y2="${flip(100)}" class="grid"/>` +
      `<text x="${at(t)}" y="${SIZE - PAD + 18}" text-anchor="middle">${t}%</text>` +
      `<text x="${PAD - 8}" y="${flip(t) + 4}" text-anchor="end">${t}%</text>`,
  ).join("");
  const dots = pairs
    .map(([nasa, ours]) => `<circle cx="${at(nasa)}" cy="${flip(ours)}" r="4" fill="${color}"><title>${name} · NASA ${nasa.toFixed(1)}% · MARGEN ${ours.toFixed(1)}%</title></circle>`)
    .join("");
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${name}: MARGEN against NASA for 160 spots">
    ${grid}
    <line x1="${at(0)}" y1="${flip(0)}" x2="${at(100)}" y2="${flip(100)}" class="diagonal"/>
    ${dots}
    <text x="${at(50)}" y="${SIZE - 4}" text-anchor="middle" class="axis">NASA map</text>
    <text x="12" y="${flip(50)}" text-anchor="middle" class="axis" transform="rotate(-90 12 ${flip(50)})">MARGEN</text>
  </svg>`;
}

function row(check: string, mark: string, value: string, pass: boolean): string {
  const status = pass ? `<span class="pass">✓ Pass</span>` : `<span class="fail">✕ Fail</span>`;
  return `<tr><td>${check}</td><td>${mark}</td><td class="mono">${value}</td><td>${status}</td></tr>`;
}

function passes(summary: Summary): boolean {
  return summary.meanDifference < 3 && summary.correlation > 0.95;
}

const { sunlight, earth, points } = result.avgvisib;
const athena = result.athena;
const athenaGap = Math.abs(athena.sunElevation - athena.horizonsSunElevation);

byId("checks").innerHTML = [
  row("Sun and Earth positions vs JPL Horizons", "Within 0.01°", `${result.ephemerisMaxError}° worst`, result.ephemerisMaxError < 0.01),
  row("Sunlight vs NASA long-term map", "Mean difference under 3 points, correlation above 0.95", `${sunlight.meanDifference} points, ${sunlight.correlation}`, passes(sunlight)),
  row("Earth in view vs NASA long-term map", "Mean difference under 3 points, correlation above 0.95", `${earth.meanDifference} points, ${earth.correlation}`, passes(earth)),
  row("Sun height at Athena's landing vs JPL Horizons", "Within 0.05°", `${athena.sunElevation}° vs ${athena.horizonsSunElevation}°`, athenaGap < 0.05),
].join("");

byId("sunlight-chart").innerHTML = scatter(points.map((p) => [100 * p[3], 100 * p[2]]), "#ffb224", "Sunlight");
byId("earth-chart").innerHTML = scatter(points.map((p) => [100 * p[5], 100 * p[4]]), "#3ea8ff", "Earth in view");
byId("sunlight-stat").textContent = `Mean difference ${sunlight.meanDifference} points · correlation ${sunlight.correlation}`;
byId("earth-stat").textContent = `Mean difference ${earth.meanDifference} points · correlation ${earth.correlation}`;

byId("athena").textContent =
  `On March 6, 2025 at 17:28 UTC, the Athena lander touched down on Mons Mouton a few hundred meters from its aim ` +
  `and ended up on its side in a small crater. MARGEN puts the Sun ${athena.sunElevation.toFixed(2)}° above a level ` +
  `horizon at that moment; JPL Horizons gives ${athena.horizonsSunElevation.toFixed(2)}°. In the Sun's direction, ` +
  `the hills on the 20 m terrain map rise only ${athena.terrainHorizon.toFixed(1)}°, so the map shows the spot in ` +
  `sunlight. The crater Athena landed in is about 20 m across, too small for the map to see. That is a limit of ` +
  `this kind of data, and it is listed below.`;
