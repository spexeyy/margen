import "@fontsource-variable/geist";
import "./style.css";
import { loadEphemeris, loadHorizons, loadIndex, loadSite } from "./data";
import type { Site, SiteData } from "./data";
import { datePicker } from "./datePicker";
import { siteMenu } from "./siteMenu";
import { drawSky, drawTimeline, hoursUntilChange, withVisibility } from "./horizon";
import type { Seen, Sky } from "./horizon";
import { drawMap, onDrag, shade, zone } from "./map";
import { GOOD_CHANCE, LANDINGS, MAX_SLOPE_DEG, Mission, NEEDS_EARTH, NEEDS_SUNLIGHT, WINDOW_DAYS, percent } from "./mission";
import type { Window } from "./mission";
import { EARTH, Observer, SUN, toLonLat, toXY } from "./sky";
import { isLight, onThemeChange } from "./theme";
import { drawYear } from "./year";

const DAY_MS = 86400000;
const DEFAULT_SITE = "mouton";
const HOURS_PER_MS = 0.028;
const CAUSES = [
  { label: "Land and work", hint: "all five met", color: "muted" },
  { label: "Too steep", hint: "slope over 10°", color: "fail" },
  { label: "Too little sunlight", hint: "first day or 14 days", color: "amber" },
  { label: "Earth out of view", hint: "first day or 14 days", color: "earth" },
];
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const index = await loadIndex();
const sites = new Map<string, SiteData>();
const missions = new Map<string, Mission>();
const loading = new Map<string, Promise<void>>();

function ensure(id: string): Promise<void> {
  if (!loading.has(id)) {
    const site = index.sites.find((s) => s.id === id)!;
    loading.set(
      id,
      loadSite(site).then((data) => {
        sites.set(id, data);
        missions.set(id, new Mission(data, index.days));
      }),
    );
  }
  return loading.get(id)!;
}

const requested = new URLSearchParams(location.search).get("site");
const state = {
  site: index.sites.some((site) => site.id === requested) ? requested! : DEFAULT_SITE,
  date: 14,
  aim: [0, 0] as [number, number],
};
const dates = index.days - WINDOW_DAYS + 1;
const [ephemeris] = await Promise.all([loadEphemeris(), ensure(state.site)]);
const shades = new Map<string, HTMLCanvasElement>();
const horizons = new Map<string, Uint8Array>();
const windows = new Map<string, Window>();
const zones = new Map<string, HTMLCanvasElement>();
const bestAims = new Map<string, [number, number]>();
const goodCounts = new Map<string, number>();

const firstDay = Date.parse(`${index.firstDay}T00:00:00Z`);
const isoDate = (date: number) => new Date(firstDay + date * DAY_MS).toISOString().slice(0, 10);
const label = (date: number, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(firstDay + date * DAY_MS).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const mapCanvas = byId<HTMLCanvasElement>("map");
const yearCanvas = byId<HTMLCanvasElement>("year");
const timelineCanvas = byId<HTMLCanvasElement>("timeline");
const skyCanvas = byId<HTMLCanvasElement>("sky");
const playButton = byId<HTMLButtonElement>("play");
let skyView: Sky | null = null;
let chances: number[] = [];
let slip = -1;
let yearHover: number | null = null;
let hour = 0;
let playing = false;
let onScreen = false;
let lastFrame = 0;

function bestAim(site: string, date: number): [number, number] {
  const key = `${site}:${date}`;
  if (!bestAims.has(key)) bestAims.set(key, missions.get(site)!.bestAim(date));
  return bestAims.get(key)!;
}

function goodDates(site: string, date: number): number {
  const key = `${site}:${date}`;
  if (!goodCounts.has(key)) {
    const mission = missions.get(site)!;
    const aim = bestAim(site, date);
    let count = 0;
    for (let d = 0; d < dates; d++) count += Number(mission.chance(d, ...aim) >= GOOD_CHANCE);
    goodCounts.set(key, count);
  }
  return goodCounts.get(key)!;
}

function windowOf(site: string, date: number): Window {
  const key = `${site}:${date}`;
  if (!windows.has(key)) windows.set(key, missions.get(site)!.window(date));
  return windows.get(key)!;
}

function zoneOf(site: string, date: number): HTMLCanvasElement {
  const key = `${site}:${date}:${isLight()}`;
  if (!zones.has(key)) zones.set(key, zone(windowOf(site, date), index.size));
  return zones.get(key)!;
}

function shadeOf(site: string): HTMLCanvasElement {
  const key = `${site}:${isLight()}`;
  const data = sites.get(site)!;
  if (!shades.has(key)) shades.set(key, shade(data.ground, index.size, data.site.pixel));
  return shades.get(key)!;
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  const date = params.get("date");
  if (date) state.date = Math.min(dates - 1, Math.max(0, Math.round((Date.parse(`${date}T00:00:00Z`) - firstDay) / DAY_MS) || 0));
  const aim = params.get("aim")?.split(",").map(Number);
  state.aim = aim?.length === 2 && aim.every(Number.isFinite) ? missions.get(state.site)!.clampAim(aim[0], aim[1]) : bestAim(state.site, state.date);
}

function writeUrl() {
  const aim = state.aim.map(Math.round).join(",");
  history.replaceState(null, "", `?site=${state.site}&date=${isoDate(state.date)}&aim=${aim}`);
}

function fitCanvas(canvas: HTMLCanvasElement) {
  const width = Math.round(canvas.clientWidth * devicePixelRatio);
  const height = Math.round(canvas.clientHeight * devicePixelRatio);
  if (canvas.width !== width || canvas.height !== height) [canvas.width, canvas.height] = [width, height];
}

function flash(button: HTMLElement, text: string) {
  const original = button.textContent;
  button.textContent = text;
  setTimeout(() => (button.textContent = original), 1500);
}

function slipText(late: number) {
  return late === 0 ? "Works only on this date" : `Still works up to ${days(late)} late`;
}

function northOf(site: Site, extent: number): [number, number] {
  // Near the south pole, local north points straight away from the pole; canvas y grows downward.
  const x = site.x0 + extent / 2;
  const y = site.y0 - extent / 2;
  const length = Math.hypot(x, y);
  return [x / length, -y / length];
}

function compass(north: [number, number], dx: number, dy: number): string {
  const [nx, ny] = north;
  const bearing = (Math.atan2(-dx * ny + dy * nx, dx * nx + dy * ny) * 180) / Math.PI;
  return COMPASS[Math.round(((bearing + 360) % 360) / 45) % 8];
}

function distance(meters: number): string {
  return meters < 1000 ? `${Math.max(20, Math.round(meters / 10) * 10)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function duration(hours: number) {
  return hours < 72 ? `${hours} h` : `${(hours / 24).toFixed(1)} days`;
}

function event(name: string, up: boolean, hours: number | null) {
  const what = up ? `${name}set` : `${name}rise`;
  return hours === null ? `No ${what.toLowerCase()} before ${label(index.days)}` : `${what} in ${duration(hours)}`;
}

async function renderHorizon() {
  const data = sites.get(state.site)!;
  if (!horizons.has(state.site)) horizons.set(state.site, await loadHorizons(data.site));
  const mission = missions.get(state.site)!;
  const cell = mission.cell(...state.aim);
  const codes = horizons.get(state.site)!.subarray(cell * index.horizon.count, (cell + 1) * index.horizon.count);
  const profile = Float32Array.from(codes, (code) => index.horizon.min + index.horizon.step * code);
  const [lon, lat] = aimLonLat();
  const observer = new Observer(lon, lat, data.ground[cell] + index.landerHeight);
  const hours = Array.from({ length: (index.days - state.date) * 24 }, (_, h) => state.date * 24 + h);
  const sun = withVisibility(profile, hours.map((h) => observer.look(ephemeris, h, SUN)));
  const earth = withVisibility(profile, hours.map((h) => observer.look(ephemeris, h, EARTH)));
  const sunEvent = hoursUntilChange(sun);
  const earthEvent = hoursUntilChange(earth);
  byId("events").textContent = [
    event("Sun", sunEvent.up, sunEvent.hours),
    event("Earth", earthEvent.up, earthEvent.hours),
    `Sun ${sun[0].el.toFixed(1)}° high`,
  ].join(" · ");
  const span = WINDOW_DAYS * 24;
  skyView = { profile, sun: sun.slice(0, span), earth: earth.slice(0, span) };
  drawSkyViews();
}

function drawSkyViews() {
  if (!skyView) return;
  fitCanvas(timelineCanvas);
  fitCanvas(skyCanvas);
  const now = Math.floor(hour);
  const moment = new Date(firstDay + (state.date * 24 + now) * 3600000);
  const when = `Day ${(now / 24).toFixed(1)} · ${moment.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}, ${moment.toISOString().slice(11, 16)} UTC`;
  const where = (p: Seen) => (p.visible ? "up" : "hidden");
  const status = `Sun ${where(skyView.sun[now])} · Earth ${where(skyView.earth[now])}`;
  drawTimeline(
    timelineCanvas,
    [
      { label: "Sunlight", path: skyView.sun, fill: "amber" },
      { label: "Earth in view", path: skyView.earth, fill: "earth" },
    ],
    hour,
    [label(state.date), label(state.date + 7), label(state.date + WINDOW_DAYS)],
  );
  drawSky(skyCanvas, skyView, now);
  byId("moment").textContent = `${when} · ${status}`;
  timelineCanvas.setAttribute("aria-valuenow", String(now));
  timelineCanvas.setAttribute("aria-valuetext", `${when}. ${status}`);
}

function renderYear() {
  fitCanvas(yearCanvas);
  drawYear(yearCanvas, { chances, date: state.date, slip, hover: yearHover, firstDay });
  const good = chances.filter((chance) => chance >= GOOD_CHANCE).length;
  byId("year-hover").textContent =
    yearHover === null
      ? `${good} good dates in 2027 with this aim`
      : `${label(yearHover, { weekday: "short", month: "short", day: "numeric" })} · ${percent(chances[yearHover])}`;
  yearCanvas.setAttribute("aria-valuemax", String(dates - 1));
  yearCanvas.setAttribute("aria-valuenow", String(state.date));
  yearCanvas.setAttribute("aria-valuetext", `${label(state.date)} · ${percent(chances[state.date])}`);
}

function renderVerdict(chance: number, counts: number[]) {
  const meets = chance >= GOOD_CHANCE;
  const gap = Math.max(1, Math.ceil((GOOD_CHANCE - chance) * 100 - 1e-9));
  const badge = byId("badge");
  badge.textContent = meets ? "Meets the 90% target" : `${gap} ${gap === 1 ? "point" : "points"} below target`;
  badge.classList.toggle("short", !meets);
  byId("chance").textContent = percent(chance);
  byId("map-chance").textContent = percent(chance);
  byId("meter-fill").style.width = `${100 * chance}%`;
  byId("meter-fill").classList.toggle("short", !meets);
  byId("count").textContent = counts[0].toLocaleString("en-US");

  const fails = LANDINGS - counts[0];
  byId("causes-heading").textContent = fails > 0 ? `Why ${fails.toLocaleString("en-US")} landings fail` : "Every landing works";
  const shown = CAUSES.map((cause, i) => ({ ...cause, count: counts[i] })).filter((cause) => cause.count > 0);
  byId("causes-bar").replaceChildren(
    ...shown.map((cause) => {
      const part = document.createElement("span");
      part.style.width = `${(100 * cause.count) / LANDINGS}%`;
      part.style.background = `var(--${cause.color})`;
      return part;
    }),
  );
  byId("causes-list").innerHTML = shown
    .map((cause) => `<li><i style="background:var(--${cause.color})"></i><span>${cause.label} <span class="muted">· ${cause.hint}</span></span><span>${cause.count.toLocaleString("en-US")}</span></li>`)
    .join("");
}

function renderNeed(id: string, text: string, ok: boolean, fill: number, threshold: number, kind: string) {
  byId(id).innerHTML =
    `<span class="need-value${ok ? "" : " short"}">${text}</span>` +
    `<span class="need-bar"><span class="need-fill" style="width:${100 * Math.min(1, fill)}%;background:var(--${ok ? kind : "fail"})"></span>` +
    `<span class="need-tick" style="left:${100 * threshold}%"></span></span>`;
}

function renderNeeds(mission: Mission, window: Window, cell: number) {
  const sun = (value: number) => [percent(value), value >= NEEDS_SUNLIGHT, value, NEEDS_SUNLIGHT, "amber"] as const;
  const earth = (value: number) => [percent(value), value >= NEEDS_EARTH, value, NEEDS_EARTH, "earth"] as const;
  renderNeed("need-sun-day", ...sun(window.landingSun[cell]));
  renderNeed("need-sun-14", ...sun(window.sunlight[cell]));
  renderNeed("need-earth-day", ...earth(window.landingEarth[cell]));
  renderNeed("need-earth-14", ...earth(window.earth[cell]));
  const slope = mission.slope[cell];
  renderNeed("need-slope", `${slope.toFixed(1)}°`, slope <= MAX_SLOPE_DEG, slope / (2 * MAX_SLOPE_DEG), 0.5, "muted");
}

function renderWhen(chance: number) {
  const meets = chance >= GOOD_CHANCE;
  const next = meets ? -1 : chances.findIndex((c, d) => d > state.date && c >= GOOD_CHANCE);
  byId("when-label").textContent = meets ? "If the launch slips" : "Next good date with this aim";
  byId("when-text").textContent = meets
    ? slipText(slip)
    : next < 0
      ? "No good date later in 2027"
      : `${label(next, { weekday: "short", month: "short", day: "numeric" })} · ${percent(chances[next])}`;
  const go = byId<HTMLButtonElement>("go-next");
  go.hidden = next < 0;
  go.onclick = () => update({ date: next });
  byId("strip-start").textContent = label(state.date);
  byId("days-strip").replaceChildren(
    ...Array.from({ length: WINDOW_DAYS + 1 }, (_, i) => {
      const date = state.date + i;
      const cell = document.createElement("span");
      if (date < dates) {
        cell.title = `${label(date)} · ${percent(chances[date])}`;
        cell.className = chances[date] >= GOOD_CHANCE ? "good" : chances[date] > 0 ? "some" : "";
      }
      cell.classList.toggle("today", i === 0);
      return cell;
    }),
  );
}

function renderBest(mission: Mission, chance: number) {
  const best = bestAim(state.site, state.date);
  const bestChance = mission.chance(state.date, ...best);
  const atBest = bestChance <= chance + 1e-9;
  const button = byId<HTMLButtonElement>("best");
  button.hidden = atBest;
  byId("at-best").hidden = !atBest;
  button.classList.toggle("primary", chance < GOOD_CHANCE);
  const [dx, dy] = [best[0] - state.aim[0], best[1] - state.aim[1]];
  const north = northOf(sites.get(state.site)!.site, mission.extent);
  byId("best-preview").textContent = `${distance(Math.hypot(dx, dy))} ${compass(north, dx, dy)} → ${percent(bestChance)}`;
}

function rankingRows() {
  const rows = index.sites.map((site, order) => {
    const mission = missions.get(site.id);
    if (!mission) return { site, chance: -1, late: -1, good: -1, order };
    const aim = bestAim(site.id, state.date);
    const chance = mission.chance(state.date, ...aim);
    const late = chance < GOOD_CHANCE ? -1 : mission.slipDays(state.date, ...aim);
    return { site, chance, late, good: goodDates(site.id, state.date), order };
  });
  return rows.sort((a, b) => b.chance - a.chance || b.late - a.late || a.order - b.order);
}

function renderRanking() {
  byId("ranking-date").textContent = label(state.date, { month: "long", day: "numeric", year: "numeric" });
  const rows = rankingRows();
  const slipShort = (late: number) => (late < 0 ? "Not a good date" : late === 0 ? "Only on this date" : `Up to ${days(late)} late`);
  byId("ranking").replaceChildren(
    ...rows.map(({ site, chance, late, good }) => {
      const loaded = chance >= 0;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ranking-row";
      row.dataset.site = site.id;
      row.setAttribute("aria-pressed", String(site.id === state.site));
      row.innerHTML =
        `<span class="ranking-name">${site.name}</span>` +
        `<span class="ranking-chance${chance >= GOOD_CHANCE ? "" : " short"}">${loaded ? percent(chance) : "…"}</span>` +
        `<span class="muted">${loaded ? slipShort(late) : "Loading"}</span>` +
        `<span class="ranking-good">${loaded ? good : ""}</span>`;
      return row;
    }),
  );
  menu.render(
    state.site,
    `Chance at each site's safest spot on ${label(state.date)}, best first.`,
    rows.map(({ site, chance, late }) => ({
      id: site.id,
      name: site.name,
      chance: chance >= 0 ? percent(chance) : "…",
      detail: `${site.note} · ${chance >= 0 ? slipShort(late) : "Loading"}`,
      good: chance >= GOOD_CHANCE,
    })),
  );
}

function renderMap(mission: Mission, outcomes: Uint8Array) {
  const data = sites.get(state.site)!;
  const landed = data.site.landed;
  const marker = landed
    ? (([x, y]) => ({ x: x - data.site.x0, y: data.site.y0 - y, label: landed.label }))(toXY(landed.lon, landed.lat))
    : null;
  fitCanvas(mapCanvas);
  drawMap(mapCanvas, {
    shade: shadeOf(state.site),
    zone: zoneOf(state.site, state.date),
    extent: mission.extent,
    aim: state.aim,
    outcomes,
    marker,
    north: northOf(data.site, mission.extent),
  });
}

function aimLonLat(): [number, number] {
  const site = sites.get(state.site)!.site;
  return toLonLat(site.x0 + state.aim[0], site.y0 - state.aim[1]);
}

function renderAim(cell: number) {
  const data = sites.get(state.site)!;
  const [lon, lat] = aimLonLat();
  const [x, y] = [data.site.x0 + state.aim[0], data.site.y0 - state.aim[1]];
  byId("aim-coords").textContent = `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? "S" : "N"}, ${lon.toFixed(3)}° E`;
  byId("aim-detail").textContent = `Ground ${data.ground[cell].toLocaleString("en-US")} m · ${(Math.hypot(x, y) / 1000).toFixed(1)} km from the south pole`;
}

function render() {
  const mission = missions.get(state.site)!;
  const outcomes = mission.outcomes(state.date, ...state.aim);
  const chance = outcomes.reduce((sum, v) => sum + v, 0) / LANDINGS;
  const window = windowOf(state.site, state.date);
  const cell = mission.cell(...state.aim);
  chances = Array.from({ length: dates }, (_, date) => mission.chance(date, ...state.aim));
  slip = chance >= GOOD_CHANCE ? mission.slipDays(state.date, ...state.aim) : -1;

  renderMap(mission, outcomes);
  renderAim(cell);
  renderVerdict(chance, mission.causes(window, ...state.aim));
  renderNeeds(mission, window, cell);
  renderWhen(chance);
  renderBest(mission, chance);
  renderYear();
  picker.render(state.date, chances);
  byId("summary").textContent = `${percent(chance)} chance the mission works. Slope ${mission.slope[cell].toFixed(1)}°. On landing day, Sun ${percent(window.landingSun[cell])} and Earth ${percent(window.landingEarth[cell])}. Over 14 days, sunlight ${percent(window.sunlight[cell])} and Earth in view ${percent(window.earth[cell])}.`;
  writeUrl();
  void renderHorizon();
}

function update(change: Partial<typeof state>) {
  const dateChanged = change.date !== undefined && change.date !== state.date;
  const siteChanged = change.site !== undefined && change.site !== state.site;
  Object.assign(state, change);
  if (dateChanged || siteChanged) hour = 0;
  render();
  if (dateChanged || siteChanged) renderRanking();
}

async function select(site: string) {
  await ensure(site);
  update({ site, aim: bestAim(site, state.date) });
}

function setDate(date: number) {
  update({ date: Math.min(dates - 1, Math.max(0, date)) });
}

const menu = siteMenu(select);
const picker = datePicker(firstDay, dates, setDate);
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-shift]")) {
  button.addEventListener("click", () => setDate(state.date + Number(button.dataset.shift)));
}
byId("ranking").addEventListener("click", (event) => {
  const site = (event.target as HTMLElement).closest<HTMLElement>(".ranking-row")?.dataset.site;
  if (site !== undefined) void select(site);
});

const yearDate = (event: PointerEvent) => {
  const box = yearCanvas.getBoundingClientRect();
  return Math.min(dates - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * dates)));
};
yearCanvas.addEventListener("pointerdown", (event) => {
  yearCanvas.setPointerCapture(event.pointerId);
  setDate(yearDate(event));
});
yearCanvas.addEventListener("pointermove", (event) => {
  if (yearCanvas.hasPointerCapture(event.pointerId)) setDate(yearDate(event));
  yearHover = yearDate(event);
  renderYear();
});
yearCanvas.addEventListener("pointerleave", () => {
  yearHover = null;
  renderYear();
});
yearCanvas.addEventListener("keydown", (event) => {
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -7, ArrowUp: 7 };
  if (!(event.key in steps)) return;
  event.preventDefault();
  setDate(state.date + steps[event.key]);
});

function setPlaying(value: boolean) {
  playing = value;
  playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
  playButton.dataset.playing = String(playing);
}

function tick(time: number) {
  if (playing && onScreen && skyView) {
    hour = (hour + Math.min(100, time - lastFrame) * HOURS_PER_MS) % (WINDOW_DAYS * 24);
    drawSkyViews();
  }
  lastFrame = time;
  requestAnimationFrame(tick);
}

playButton.addEventListener("click", () => setPlaying(!playing));
onDrag(timelineCanvas, (fx) => {
  setPlaying(false);
  hour = Math.round(fx * (WINDOW_DAYS * 24 - 1));
  drawSkyViews();
});
timelineCanvas.addEventListener("keydown", (event) => {
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 };
  const last = WINDOW_DAYS * 24 - 1;
  const now = Math.floor(hour);
  if (event.key === "Home") hour = 0;
  else if (event.key === "End") hour = last;
  else if (event.key in steps) hour = Math.min(last, Math.max(0, now + steps[event.key] * (event.shiftKey ? 24 : 1)));
  else return;
  event.preventDefault();
  setPlaying(false);
  drawSkyViews();
});
new IntersectionObserver(([entry]) => (onScreen = entry.isIntersecting)).observe(timelineCanvas);
setPlaying(!matchMedia("(prefers-reduced-motion: reduce)").matches);
requestAnimationFrame(tick);

onDrag(mapCanvas, (fx, fy) => {
  byId("drag-hint").hidden = true;
  const mission = missions.get(state.site)!;
  update({ aim: mission.clampAim(fx * mission.extent, fy * mission.extent) });
});
mapCanvas.addEventListener("keydown", (event) => {
  const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  const step = event.shiftKey ? 100 : 20;
  const mission = missions.get(state.site)!;
  update({ aim: mission.clampAim(state.aim[0] + move[0] * step, state.aim[1] + move[1] * step) });
});
byId("copy-aim").addEventListener("click", async () => {
  const [lon, lat] = aimLonLat();
  await navigator.clipboard.writeText(`${lat.toFixed(4)}, ${lon.toFixed(3)}`);
  flash(byId("copy-aim"), "Copied");
});
byId("copy-link").addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  flash(byId("copy-link"), "Link copied");
});
byId("best").addEventListener("click", () => update({ aim: bestAim(state.site, state.date) }));
addEventListener("resize", render);
onThemeChange(() => {
  render();
  renderRanking();
});

readUrl();
render();
renderRanking();
for (const site of index.sites) void ensure(site.id).then(renderRanking);
