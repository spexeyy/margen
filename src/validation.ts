import "@fontsource-variable/geist";
import "./style.css";
import { LANDINGS } from "./mission";
import { onThemeChange } from "./theme";

interface Summary {
  meanDifference: number;
  bias: number;
  correlation: number;
}

interface Validation {
  ephemerisMaxError: number;
  athena: { time: string; sunAzimuth: number; sunElevation: number; horizonsSunElevation: number; terrainHorizon: number };
  avgvisib: { points: number[][]; sunlight: Summary; earth: Summary };
  sites20m: { points: number[][]; sunlight: Summary; earth: Summary; sites: string[]; terrain80m: { sunlight: Summary } };
}

const SIZE = 360;
const PAD = 44;
const TICKS = [0, 25, 50, 75, 100];

const result: Validation = await (await fetch("/data/validation.json")).json();
const byId = (id: string) => document.getElementById(id)!;

function scatter(pairs: [number, number][], kind: "sun" | "earth", name: string): string {
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
    .map(([nasa, ours]) => `<circle cx="${at(nasa)}" cy="${flip(ours)}" r="4" class="${kind}"><title>${name} · NASA ${nasa.toFixed(1)}% · MARGEN ${ours.toFixed(1)}%</title></circle>`)
    .join("");
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${name}: MARGEN against NASA for 160 spots">
    ${grid}
    <line x1="${at(0)}" y1="${flip(0)}" x2="${at(100)}" y2="${flip(100)}" class="diagonal"/>
    ${dots}
    <text x="${at(50)}" y="${SIZE - 4}" text-anchor="middle" class="axis">NASA map</text>
    <text x="12" y="${flip(50)}" text-anchor="middle" class="axis" transform="rotate(-90 12 ${flip(50)})">MARGEN</text>
  </svg>`;
}

interface Check {
  value: string;
  name: string;
  detail: string;
  missed: string | null;
}

function card({ value, name, detail, missed }: Check): string {
  const status = missed === null ? `<span class="status pass">✓ Pass</span>` : `<span class="status fail">✕ ${missed}</span>`;
  return `<article class="score">${status}<strong class="score-value">${value}</strong><span class="score-name">${name}</span><span class="score-detail">${detail}</span></article>`;
}

function missed(summary: Summary): string | null {
  return summary.meanDifference < 3 && summary.correlation > 0.95 ? null : "Missed the mark";
}

const { sunlight, earth, points } = result.avgvisib;
const athena = result.athena;
const athenaGap = Math.abs(athena.sunElevation - athena.horizonsSunElevation);
// Widest 95% interval of a chance estimated from this many landings, in points: at a true chance of 50%.
const simulationError = 196 * Math.sqrt(0.25 / LANDINGS);

const checks: Check[] = [
  { value: `${result.ephemerisMaxError}°`, name: "Sun and Earth positions", detail: "Worst of 48 against JPL Horizons. Mark: within 0.01°", missed: result.ephemerisMaxError < 0.01 ? null : "Missed the mark" },
  { value: `${sunlight.meanDifference} pts`, name: "Sunlight share", detail: `Against NASA's map, r ${sunlight.correlation}. Mark: under 3 points, r above 0.95`, missed: missed(sunlight) },
  { value: `${earth.meanDifference} pts`, name: "Earth-in-view share", detail: `Against NASA's map, r ${earth.correlation}. Mark: under 3 points, r above 0.95`, missed: missed(earth) },
  { value: `${athena.sunElevation}°`, name: "Sun height at Athena's landing", detail: `JPL Horizons: ${athena.horizonsSunElevation}°. Mark: within 0.05°`, missed: athenaGap < 0.05 ? null : "Missed the mark" },
  { value: `±${simulationError.toFixed(1)} pts`, name: `Precision of ${LANDINGS.toLocaleString("en-US")} landings`, detail: "95% interval, worst case. Mark: ±3 points", missed: simulationError <= 3 ? null : `Missed by ${(simulationError - 3).toFixed(1)}` },
];
byId("verdict").textContent = `${checks.filter((check) => check.missed === null).length} of ${checks.length} pass`;
byId("scorecard").innerHTML = checks.map(card).join("");

const sites = result.sites20m;
const spots = `${sites.points.length} spots at ${sites.sites.length} sites`;
const added: Check[] = [
  { value: `${sites.sunlight.meanDifference} pts`, name: "Sunlight", detail: `20 m terrain, ${spots}. r ${sites.sunlight.correlation}`, missed: missed(sites.sunlight) },
  { value: `${sites.earth.meanDifference} pts`, name: "Earth in view", detail: `20 m terrain, ${spots}. r ${sites.earth.correlation}`, missed: missed(sites.earth) },
];
byId("added-count").textContent = `${added.filter((check) => check.missed === null).length} of ${added.length} pass`;
byId("added").innerHTML =
  added.map(card).join("") +
  `<article class="score why"><span class="score-name">Why sunlight misses</span>` +
  `<span class="score-detail">MARGEN finds less sunlight than NASA at all ${sites.sites.length} sites, so its chances lean cautious. ` +
  `Crests and rims are hard to match: on NASA's 80 m terrain the same spots already differ by ${sites.terrain80m.sunlight.meanDifference} points, and 20 m terrain hides the low Sun a little more.</span></article>`;
byId("sites-method").textContent = `Landing-site check: ${sites.points.length / sites.sites.length} random spots in each 2 × 2 km site south of 85°S (${sites.sites.join(", ")}), with the navigator's 20 m terrain near the site.`;

byId("sunlight-chart").innerHTML = scatter(points.map((p) => [100 * p[3], 100 * p[2]]), "sun", "Sunlight");
byId("earth-chart").innerHTML = scatter(points.map((p) => [100 * p[5], 100 * p[4]]), "earth", "Earth in view");
byId("sunlight-stat").textContent = `Mean difference ${sunlight.meanDifference} points · r ${sunlight.correlation}`;
byId("earth-stat").textContent = `Mean difference ${earth.meanDifference} points · r ${earth.correlation}`;
const outliers = points.filter((p) => Math.abs(p[2] - p[3]) > 0.1 || Math.abs(p[4] - p[5]) > 0.1).length;
byId("outliers").textContent = `${outliers} of ${points.length} spots differ by more than 10 points in sunlight or Earth in view.`;

byId("athena-sun").textContent = `${athena.sunElevation.toFixed(2)}° high`;
byId("athena-sun-detail").textContent = `JPL Horizons: ${athena.horizonsSunElevation.toFixed(2)}°. Right.`;
byId("athena-hills").textContent = `Hills rise only ${athena.terrainHorizon.toFixed(1)}° toward the Sun on the 20 m map. Wrong.`;

onThemeChange();
