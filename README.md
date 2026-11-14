# MARGEN

**Miss the target. Keep the mission.**

Most tools ask whether a Moon landing site works if everything goes right. MARGEN asks whether it still works when things go wrong: when the lander comes down hundreds of meters off target, or the launch slips by a week. Then it finds the next good date.

A landing works when, for the first 14 days:

- **Sunlight** (powers the lander) reaches it at least 50% of the time;
- **Earth is in view** (lets it talk to home) at least 30% of the time.

MARGEN simulates 1,000 landings scattered around the aim point (100 m typical miss) and reports the chance the mission works, for every site and landing date.

Built for the NASA Space Apps Challenge 2026, challenge "Lunar Landing Site Navigator", by team MARGEN (Buenos Aires).

## What you can do

- **Pick a site** near the lunar south pole: Shackleton connecting ridge, Mons Mouton (where Athena landed), and two Artemis candidate regions (de Gerlache rim, Nobile rim). Each site card shows the chance the mission works on the chosen date.
- **Drag the aim point** on a 2 × 2 km terrain map. The amber zone has enough sunlight and Earth in view; each dot is one possible landing.
- **Change the landing date** (January to March 2027) or let the launch slip a week, and see the next good date.
- **See what the lander sees:** the terrain horizon in every direction, the paths of the Sun and Earth over the next 14 days, and when they set. A spot a few hundred meters away can fail because the Sun hides behind a hill.
- **Share any state** with a link: `?site=ridge&date=2027-01-15&aim=1630,1370`.

## How it works

1. **Terrain.** For every 20 m spot in each 2 × 2 km site, `scripts/build_sites.py` traces the horizon in 360 directions across LOLA terrain (20 m nearby, 80 m out to 250 km), including the Moon's curvature.
2. **Sky.** JPL DE440 (NAIF SPICE) gives the Sun and Earth every hour, 2027-01-01 to 2027-04-13. Sunlight counts the visible part of the Sun's disc; Earth in view needs Earth's center above the terrain. Solar panels and antenna sit 2 m above the ground.
3. **Landings.** The browser scatters 1,000 landings around the aim and checks each against the 14-day requirement. Everything after step 2 runs in the browser; there is no server.

## Validation criteria

Written before any result was computed:

- **Sun and Earth positions:** within 0.01° of JPL Horizons.
- **Sunlight and Earth in view:** compared with NASA's long-term maps (LOLA AVGVISIB, PGDA), mean difference under 3 points and correlation above 0.95 for both.
- **Athena (IM-2) landing, 2025-03-06:** computed Sun elevation at the landing site within 0.05° of JPL Horizons.
- **Landing simulation:** 1,000 landings give the chance to within ±3 points (95% interval) in the worst case.

## Validation results

From `scripts/validate.py`, shown on the validation page:

| Check | Result |
|---|---|
| Sun and Earth vs JPL Horizons (2 sites, 12 times, both bodies) | 0.00003° worst |
| Sunlight vs AVGVISIB (160 random spots, 85°S to the pole, 2008–2026) | mean difference 1.75 points, correlation 0.985 |
| Earth in view vs AVGVISIB (same spots) | mean difference 1.16 points, correlation 0.982 |
| Sun elevation at Athena's landing, 2025-03-06 17:28 UTC | 2.464°, JPL Horizons 2.464° |
| Landing simulation | ±3.1 points worst case; the ±3 above was rounded down |

At Athena's landing spot, the 20 m terrain puts the hills only 0.8° high in the Sun's direction: the small crater Athena landed in is below the map's resolution.

## What it doesn't model

Rocks, craters and slopes smaller than 20 m; lander tilt, dust, temperature and batteries; radio links and ground stations (Earth in view is line of sight only); light during descent; direction-dependent landing errors; terrain beyond 250 km.

## Run it

```bash
npm install
npm run dev
```

Rebuild the data (Python 3 with numpy, scipy, spiceypy, tifffile, imagecodecs, fsspec, aiohttp):

```bash
bash scripts/fetch_data.sh
python scripts/build_sites.py
python scripts/validate.py
```

## Data and references

- NASA LRO LOLA south pole elevation models, 20 m and 80 m ([PGDA](https://pgda.gsfc.nasa.gov/products/90))
- NASA LOLA average illumination and Earth visibility maps, AVGVISIB ([PGDA](https://pgda.gsfc.nasa.gov/products/69))
- JPL DE440 ephemerides and lunar frames via [NAIF SPICE](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/), and [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)
- Site positions: Shackleton connecting ridge center (LPSC 2025 abstract 2443); Athena aim and landing point (LROC); Artemis candidate region centers (USGS), with each box placed on the best-lit spot within 5 km in AVGVISIB
- Mazarico, E. et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. Icarus 211, 1066–1081.
- Barker, M. K. et al. (2021). Improved LOLA elevation maps for south pole landing sites: error estimates and their impact on illumination conditions. Planetary and Space Science 203, 105119.
- Software: NumPy, SciPy, SpiceyPy, tifffile, fsspec, Vite, TypeScript. Font: Geist (SIL Open Font License).

## AI use

An AI coding assistant was used to help write code during the hackathon. All code, data processing and the demo video were produced during the hackathon, and every number was checked against NASA data. The video narration voice is AI-generated.

## License

Apache-2.0
