import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./style.css";
import { loadEphemeris, loadHorizons, loadIndex, loadSite } from "./data";
import { datePicker } from "./datePicker";
import { drawHorizon, hoursUntilChange } from "./horizon";
import { drawMap, onAim, shade, zone } from "./map";
import { GOOD_CHANCE, LANDINGS, Mission, NEEDS_EARTH, NEEDS_SUNLIGHT, WINDOW_DAYS } from "./mission";
import type { Window } from "./mission";
import { EARTH, Observer, SUN, toLonLat, toXY } from "./sky";
import { isLight, onThemeChange } from "./theme";

const DAY_MS = 86400000;

const index = await loadIndex();
const [ephemeris, sites] = await Promise.all([loadEphemeris(), Promise.all(index.sites.map(loadSite))]);
const missions = new Map(sites.map((data) => [data.site.id, new Mission(data, index.days)]));
const shades = new Map<string, HTMLCanvasElement>();
const horizons = new Map<string, Uint8Array>();
const windows = new Map<string, Window>();
const zones = new Map<string, HTMLCanvasElement>();
const bestAims = new Map<string, [number, number]>();

const firstDay = Date.parse(`${index.firstDay}T00:00:00Z`);
const isoDate = (date: number) => new Date(firstDay + date * DAY_MS).toISOString().slice(0, 10);
const label = (date: number, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(firstDay + date * DAY_MS).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
const percent = (value: number) => `${Math.round(100 * value)}%`;
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const mapCanvas = byId<HTMLCanvasElement>("map");
const horizonCanvas = byId<HTMLCanvasElement>("horizon");
const calendar = byId("calendar");
const cards = byId("cards");

const state = { site: index.sites[0].id, date: 14, aim: [0, 0] as [number, number] };

function bestAim(site: string, date: number): [number, number] {
  const key = `${site}:${date}`;
  if (!bestAims.has(key)) bestAims.set(key, missions.get(site)!.bestAim(date));
  return bestAims.get(key)!;
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
  const data = sites.find((s) => s.site.id === site)!;
  if (!shades.has(key)) shades.set(key, shade(data.ground, index.size, data.site.pixel));
  return shades.get(key)!;
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  const site = params.get("site");
  if (site && missions.has(site)) state.site = site;
  const dates = missions.get(state.site)!.dates;
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

function duration(hours: number) {
  return hours < 72 ? `${hours} h` : `${(hours / 24).toFixed(1)} days`;
}

function event(name: string, up: boolean, hours: number | null) {
  const what = up ? `${name}set` : `${name}rise`;
  return hours === null ? `No ${what.toLowerCase()} before ${label(index.days)}` : `${what} in ${duration(hours)}`;
}

async function renderHorizon() {
  const data = sites.find((s) => s.site.id === state.site)!;
  if (!horizons.has(state.site)) horizons.set(state.site, await loadHorizons(data.site));
  const mission = missions.get(state.site)!;
  const cell = mission.cell(...state.aim);
  const codes = horizons.get(state.site)!.subarray(cell * index.horizon.count, (cell + 1) * index.horizon.count);
  const profile = Float32Array.from(codes, (code) => index.horizon.min + index.horizon.step * code);
  const [lon, lat] = toLonLat(data.site.x0 + state.aim[0], data.site.y0 - state.aim[1]);
  const observer = new Observer(lon, lat, data.ground[cell] + index.landerHeight);
  const hours = Array.from({ length: (index.days - state.date) * 24 }, (_, h) => state.date * 24 + h);
  const sun = hours.map((h) => observer.look(ephemeris, h, SUN));
  const earth = hours.map((h) => observer.look(ephemeris, h, EARTH));
  const sunEvent = hoursUntilChange(profile, sun);
  const earthEvent = hoursUntilChange(profile, earth);
  byId("events").textContent = [
    event("Sun", sunEvent.up, sunEvent.hours),
    event("Earth", earthEvent.up, earthEvent.hours),
    `Sun elevation ${sun[0].el.toFixed(1)}°`,
  ].join(" · ");
  fitCanvas(horizonCanvas);
  const span = WINDOW_DAYS * 24;
  drawHorizon(horizonCanvas, { profile, sun: sun.slice(0, span), earth: earth.slice(0, span) });
}

function renderCalendar(mission: Mission, chances: number[]) {
  if (calendar.childElementCount !== mission.dates) {
    calendar.replaceChildren(
      ...Array.from({ length: mission.dates }, (_, date) => {
        const button = document.createElement("button");
        button.dataset.date = String(date);
        if (label(date, { day: "numeric" }) === "1") button.dataset.month = label(date, { month: "short" });
        return button;
      }),
    );
  }
  for (const button of calendar.children as HTMLCollectionOf<HTMLButtonElement>) {
    const date = Number(button.dataset.date);
    const chance = chances[date];
    button.style.setProperty("--chance", String(chance));
    button.classList.toggle("good", chance >= GOOD_CHANCE);
    button.setAttribute("aria-pressed", String(date === state.date));
    button.title = `${label(date)} · ${percent(chance)}`;
  }
}

function renderWhen(mission: Mission, chance: number) {
  const box = byId("when");
  if (chance >= GOOD_CHANCE) {
    let late = 0;
    while (state.date + late + 1 < mission.dates && mission.chance(state.date + late + 1, ...state.aim) >= GOOD_CHANCE) late++;
    const margin = late === 0 ? "Works only on this date" : `Still works up to ${late} ${late === 1 ? "day" : "days"} late`;
    box.innerHTML = `<span>If the launch slips</span><strong>${margin}</strong>`;
    return;
  }
  const next = mission.nextGoodDate(state.date, ...state.aim);
  if (next === null) {
    box.innerHTML = `<span>Next good date</span><strong>None before ${label(mission.dates - 1)}</strong>`;
    return;
  }
  const odds = percent(mission.chance(next, ...state.aim));
  box.innerHTML = `<span>Next good date</span><strong>${label(next, { weekday: "short", month: "short", day: "numeric" })} · ${odds}</strong><button type="button">Go</button>`;
  box.querySelector("button")!.onclick = () => update({ date: next });
}

function renderCards() {
  byId("cards-date").textContent = label(state.date, { month: "long", day: "numeric", year: "numeric" });
  cards.replaceChildren(
    ...sites.map(({ site }) => {
      const aim = bestAim(site.id, state.date);
      const chance = missions.get(site.id)!.chance(state.date, ...aim);
      const card = document.createElement("button");
      card.className = "card";
      card.setAttribute("aria-pressed", String(site.id === state.site));
      card.innerHTML = `<span class="card-name">${site.name}</span><span class="card-value">${percent(chance)}</span><span class="card-label">Chance the mission works</span><span class="card-source">${site.source}</span>`;
      card.onclick = () => update({ site: site.id, aim: aim });
      return card;
    }),
  );
}

function renderMap(mission: Mission, outcomes: Uint8Array) {
  const data = sites.find((s) => s.site.id === state.site)!;
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
  });
}

function render() {
  const mission = missions.get(state.site)!;
  const outcomes = mission.outcomes(state.date, ...state.aim);
  const chance = outcomes.reduce((sum, v) => sum + v, 0) / LANDINGS;
  const window = windowOf(state.site, state.date);
  const cell = mission.cell(...state.aim);

  renderMap(mission, outcomes);
  byId("site-name").textContent = sites.find((s) => s.site.id === state.site)!.site.name;
  byId("chance").textContent = percent(chance);
  byId("chance").classList.toggle("good", chance >= GOOD_CHANCE);
  byId("sunlight").textContent = percent(window.sunlight[cell]);
  byId("sunlight").classList.toggle("short", window.sunlight[cell] < NEEDS_SUNLIGHT);
  byId("earth").textContent = percent(window.earth[cell]);
  byId("earth").classList.toggle("short", window.earth[cell] < NEEDS_EARTH);
  const chances = Array.from({ length: mission.dates }, (_, date) => mission.chance(date, ...state.aim));
  picker.render(state.date, chances);
  renderWhen(mission, chance);
  renderCalendar(mission, chances);
  writeUrl();
  void renderHorizon();
}

function update(change: Partial<typeof state>) {
  const dateChanged = change.date !== undefined && change.date !== state.date;
  const siteChanged = change.site !== undefined && change.site !== state.site;
  Object.assign(state, change);
  render();
  if (dateChanged || siteChanged) renderCards();
}

const firstMission = missions.get(index.sites[0].id)!;
const picker = datePicker(firstDay, firstMission.dates, (date) => update({ date }));
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-shift]")) {
  button.addEventListener("click", () => {
    update({ date: Math.min(firstMission.dates - 1, Math.max(0, state.date + Number(button.dataset.shift))) });
  });
}
calendar.addEventListener("click", (event) => {
  const date = (event.target as HTMLElement).dataset.date;
  if (date !== undefined) update({ date: Number(date) });
});
onAim(mapCanvas, (fx, fy) => {
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
byId("best").addEventListener("click", () => update({ aim: bestAim(state.site, state.date) }));
addEventListener("resize", render);
onThemeChange(render);

readUrl();
render();
renderCards();
