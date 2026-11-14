import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./style.css";
import { loadEphemeris, loadHorizons, loadIndex, loadSite } from "./data";
import type { Site } from "./data";
import { datePicker } from "./datePicker";
import { siteMenu } from "./siteMenu";
import { drawSky, drawTimeline, hoursUntilChange, withVisibility } from "./horizon";
import type { Seen, Sky } from "./horizon";
import { drawMap, onDrag, shade, zone } from "./map";
import { GOOD_CHANCE, LANDINGS, MAX_SLOPE_DEG, Mission, NEEDS_EARTH, NEEDS_SUNLIGHT, WINDOW_DAYS, percent } from "./mission";
import type { Window } from "./mission";
import { EARTH, Observer, SUN, horizonAt, toLonLat, toXY } from "./sky";
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
const goodDates = new Map<string, number>();

const firstDay = Date.parse(`${index.firstDay}T00:00:00Z`);
const isoDate = (date: number) => new Date(firstDay + date * DAY_MS).toISOString().slice(0, 10);
const label = (date: number, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(firstDay + date * DAY_MS).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const mapCanvas = byId<HTMLCanvasElement>("map");
const timelineCanvas = byId<HTMLCanvasElement>("timeline");
const skyCanvas = byId<HTMLCanvasElement>("sky");
const playButton = byId<HTMLButtonElement>("play");
const HOURS_PER_MS = 0.028;
let skyView: Sky | null = null;
let hour = 0;
let playing = false;
let onScreen = false;
let lastFrame = 0;
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
  const [lon, lat] = aimLonLat();
  const observer = new Observer(lon, lat, data.ground[cell] + index.landerHeight);
  const hours = Array.from({ length: (index.days - state.date) * 24 }, (_, h) => state.date * 24 + h);
  const sun = withVisibility(profile, hours.map((h) => observer.look(ephemeris, h, SUN)));
  const earth = withVisibility(profile, hours.map((h) => observer.look(ephemeris, h, EARTH)));
  const sunEvent = hoursUntilChange(sun);
  const earthEvent = hoursUntilChange(earth);
  const clearance = sun[0].el - horizonAt(profile, sun[0].az);
  const hills = `${Math.abs(clearance).toFixed(1)}° ${clearance >= 0 ? "above" : "below"} the hills`;
  byId("events").textContent = [
    event("Sun", sunEvent.up, sunEvent.hours),
    event("Earth", earthEvent.up, earthEvent.hours),
    `Sun elevation ${sun[0].el.toFixed(1)}°, ${hills}`,
  ].join(" · ");
  const span = WINDOW_DAYS * 24;
  skyView = { profile, sun: sun.slice(0, span), earth: earth.slice(0, span) };
  drawSkyViews();
}

function drawSkyViews() {
  if (!skyView) return;
  const window = windowOf(state.site, state.date);
  const cell = missions.get(state.site)!.cell(...state.aim);
  fitCanvas(timelineCanvas);
  fitCanvas(skyCanvas);
  const now = Math.floor(hour);
  const moment = new Date(firstDay + (state.date * 24 + now) * 3600000);
  const when = `Day ${(now / 24).toFixed(1)} · ${moment.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}, ${moment.toISOString().slice(11, 16)} UTC`;
  const where = (p: Seen) => (p.visible ? "above the hills" : "behind the hills");
  const status = `Sun ${where(skyView.sun[now])} · Earth ${where(skyView.earth[now])}`;
  drawTimeline(
    timelineCanvas,
    [
      { label: "Sunlight", share: `${percent(window.sunlight[cell])} of the time · needs 50%`, path: skyView.sun, fill: "amber" },
      { label: "Earth in view", share: `${percent(window.earth[cell])} of the time · needs 30%`, path: skyView.earth, fill: "earth" },
    ],
    hour,
    [label(state.date), label(state.date + 7), label(state.date + WINDOW_DAYS)],
  );
  drawSky(skyCanvas, skyView, now);
  byId("moment").textContent = `${when} · ${status}`;
  timelineCanvas.setAttribute("aria-valuenow", String(now));
  timelineCanvas.setAttribute("aria-valuetext", `${when}. ${status}`);
}

function renderCalendar(mission: Mission, chances: number[]) {
  if (calendar.childElementCount !== mission.dates) {
    calendar.replaceChildren(
      ...Array.from({ length: mission.dates }, (_, date) => {
        const button = document.createElement("button");
        button.dataset.date = String(date);
        const day = Number(label(date, { day: "numeric" }));
        if (day === 1) button.dataset.tick = label(date);
        else if ([8, 15, 22].includes(day)) button.dataset.tick = String(day);
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
  byId("best").classList.toggle("primary", chance < GOOD_CHANCE);
  if (chance >= GOOD_CHANCE) {
    const late = mission.slipDays(state.date, ...state.aim);
    const margin = late === 0 ? "Works only on this date" : `Still works up to ${late} ${late === 1 ? "day" : "days"} late`;
    box.innerHTML = `<span>If the launch slips</span><strong>${margin}</strong>`;
    return;
  }
  const next = mission.nextGoodDate(state.date, ...state.aim);
  if (next === null) {
    box.innerHTML = `<span>Next good date</span><strong>No good date with this aim</strong>`;
    return;
  }
  const odds = percent(mission.chance(next, ...state.aim));
  box.innerHTML = `<span>Next good date</span><strong>${label(next, { weekday: "short", month: "short", day: "numeric" })} · ${odds}</strong><button type="button">Go</button>`;
  box.querySelector("button")!.onclick = () => update({ date: next });
}

function renderLocator() {
  const reach = toXY(0, -84)[1];
  const at = (x: number, y: number) => [190 + (95 * x) / reach, 110 - (95 * y) / reach];
  const rings = [-88, -86, -84].map((lat) => `<circle cx="190" cy="110" r="${(95 * toXY(0, lat)[1]) / reach}" class="ring"/>`);
  const dots = index.sites.map((site) => {
    const [x, y] = at(...toXY(site.lon, site.lat));
    const left = x < 190;
    return `<circle cx="${x}" cy="${y}" r="4" class="${site.id === state.site ? "current" : "site"}"/><text x="${left ? x - 8 : x + 8}" y="${y + 4}" text-anchor="${left ? "end" : "start"}">${site.name}</text>`;
  });
  byId("locator").innerHTML = `<svg viewBox="0 0 380 220" role="img" aria-label="Map of the lunar south pole with the four landing sites">
    ${rings.join("")}
    <path d="M185 110h10M190 105v10" class="ring"/>
    <text x="190" y="10" text-anchor="middle">Toward Earth</text>
    ${dots.join("")}
  </svg>`;
}

function renderCards() {
  renderLocator();
  byId("cards-date").textContent = label(state.date, { month: "long", day: "numeric", year: "numeric" });
  cards.replaceChildren(
    ...sites.map(({ site }) => {
      const aim = bestAim(site.id, state.date);
      const mission = missions.get(site.id)!;
      const chance = mission.chance(state.date, ...aim);
      const late = mission.slipDays(state.date, ...aim);
      const slip = chance < GOOD_CHANCE ? "Not a good date here" : late === 0 ? "Works only on this date" : `Works up to ${late} ${late === 1 ? "day" : "days"} late`;
      const good = goodDates.has(site.id) ? `${goodDates.get(site.id)} of ${mission.dates}` : "counting";
      const flat = mission.slope.filter((s) => s <= MAX_SLOPE_DEG).length / mission.slope.length;
      const card = document.createElement("button");
      card.className = "card";
      card.setAttribute("aria-pressed", String(site.id === state.site));
      card.innerHTML = `<span class="card-name">${site.name}</span><span class="card-value">${percent(chance)}</span><span class="card-label">Chance the mission works, at its safest spot</span><span class="card-fact">${slip}</span><span class="card-fact">Good dates Jan–Mar: ${good}</span><span class="card-fact">Flat ground: ${percent(flat)} of the map</span><span class="card-source">${site.source}</span>`;
      card.onclick = () => update({ site: site.id, aim: aim });
      return card;
    }),
  );
}

async function countGoodDates() {
  for (const { site } of sites) {
    const mission = missions.get(site.id)!;
    let count = 0;
    for (let date = 0; date < mission.dates; date++) {
      count += Number(mission.chance(date, ...bestAim(site.id, date)) >= GOOD_CHANCE);
      await new Promise((resolve) => setTimeout(resolve));
    }
    goodDates.set(site.id, count);
    renderCards();
  }
}

function northOf(site: Site, extent: number): [number, number] {
  // Near the south pole, local north points straight away from the pole; canvas y grows downward.
  const x = site.x0 + extent / 2;
  const y = site.y0 - extent / 2;
  const length = Math.hypot(x, y);
  return [x / length, -y / length];
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
    north: northOf(data.site, mission.extent),
  });
}

function aimLonLat(): [number, number] {
  const site = sites.find((s) => s.site.id === state.site)!.site;
  return toLonLat(site.x0 + state.aim[0], site.y0 - state.aim[1]);
}

function renderAim(cell: number) {
  const data = sites.find((s) => s.site.id === state.site)!;
  const [lon, lat] = aimLonLat();
  const [x, y] = [data.site.x0 + state.aim[0], data.site.y0 - state.aim[1]];
  byId("aim-coords").textContent = `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? "S" : "N"}, ${lon.toFixed(3)}° E`;
  byId("aim-detail").textContent = `Ground ${data.ground[cell].toLocaleString("en-US")} m above the lunar reference sphere · ${(Math.hypot(x, y) / 1000).toFixed(1)} km from the south pole`;
}

function render() {
  const mission = missions.get(state.site)!;
  const outcomes = mission.outcomes(state.date, ...state.aim);
  const chance = outcomes.reduce((sum, v) => sum + v, 0) / LANDINGS;
  const window = windowOf(state.site, state.date);
  const cell = mission.cell(...state.aim);

  renderMap(mission, outcomes);
  renderAim(cell);
  menu.render(state.site, (id) => percent(missions.get(id)!.chance(state.date, ...bestAim(id, state.date))));
  byId("count").textContent = (chance * LANDINGS).toLocaleString("en-US");
  const slope = `${mission.slope[cell].toFixed(1)}°`;
  byId("summary").textContent = `${percent(chance)} chance the mission works. Slope ${slope}. On landing day, Sun ${percent(window.landingSun[cell])} and Earth ${percent(window.landingEarth[cell])}. Over 14 days, sunlight ${percent(window.sunlight[cell])} and Earth in view ${percent(window.earth[cell])}.`;
  byId("chance").textContent = percent(chance);
  byId("map-chance").textContent = percent(chance);
  byId("chance").classList.toggle("good", chance >= GOOD_CHANCE);
  byId("slope").textContent = slope;
  byId("slope").classList.toggle("short", mission.slope[cell] > MAX_SLOPE_DEG);
  byId("landing-sun").textContent = percent(window.landingSun[cell]);
  byId("landing-sun").classList.toggle("short", window.landingSun[cell] < NEEDS_SUNLIGHT);
  byId("landing-earth").textContent = percent(window.landingEarth[cell]);
  byId("landing-earth").classList.toggle("short", window.landingEarth[cell] < NEEDS_EARTH);
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
  if (dateChanged || siteChanged) hour = 0;
  render();
  if (dateChanged || siteChanged) renderCards();
}

const menu = siteMenu(index.sites, (id) => update({ site: id, aim: bestAim(id, state.date) }));

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
  byId("copy-aim").textContent = "Copied";
  setTimeout(() => (byId("copy-aim").textContent = "Copy"), 1500);
});
byId("best").addEventListener("click", () => update({ aim: bestAim(state.site, state.date) }));
addEventListener("resize", render);
onThemeChange(render);

readUrl();
render();
renderCards();
void countGoodDates();
