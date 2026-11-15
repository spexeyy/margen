# MARGEN

**Miss the target. Keep the mission.**

Most tools ask whether a Moon landing site works if everything goes right. MARGEN asks whether it still works when things go wrong: when the lander comes down hundreds of meters off target, or the launch slips by a week. Then it finds the next good date.

A landing works when:

- **The ground is flat** (keeps the lander upright): it slopes 10° or less;
- **The Sun is up on landing day** (power from the first hours) at least 50% of the first 24 hours;
- **Earth is in view on landing day** (contact from the first hours) at least 30% of the first 24 hours;
- **Sunlight** (powers the lander) reaches it at least 50% of the first 14 days;
- **Earth is in view** (lets it talk to home) at least 30% of the first 14 days.

MARGEN simulates 1,000 landings scattered around the aim point (100 m typical miss: half fall closer than that) and reports the chance the mission works, for every site and landing date.

The sunniest spot is not always a landing spot. On January 15, 2027, the best aim on the Shackleton connecting ridge gives a 59% chance: its sunlit ground is a strip of flat terrain between steep slopes. On no landing date of 2027 does it reach 90%; its best date gives 68%. Athena's aim on Mons Mouton gives 100% on January 15, still works if the landing slips six days, and has 78 good dates in the year. The Artemis III candidate site on Mons Mouton has 132, the most of the eleven sites.

Built for the NASA Space Apps Challenge 2026, challenge "Lunar Landing Site Navigator", by team MARGEN (Buenos Aires).

## What you can do

- **Pick a site** near the lunar south pole: the Shackleton connecting ridge, Athena's aim on Mons Mouton, and all nine Artemis III candidate regions. A table ranks the sites, best first, by the chance the mission works on the chosen date and how many days late the launch can slip.
- **Drag the aim point** on a 2 × 2 km terrain map. The amber zone is flat ground with enough sunlight and Earth in view; each dot is one possible landing.
- **Change the landing date** (January 1 to December 18, 2027) or let the launch slip a week, and see the next good date.
- **See what the lander sees:** the terrain horizon in every direction, the paths of the Sun and Earth over the next 14 days, and when they set. A spot a few hundred meters away can fail because the Sun hides behind a hill.
- **Share any state** with a link: `?site=ridge&date=2027-01-15&aim=1630,1370`.

## How it works

1. **Terrain.** For every 20 m spot in each 2 × 2 km site, `scripts/build_sites.py` traces the horizon in 360 directions across LOLA terrain (20 m nearby, 80 m out to 250 km), including the Moon's curvature.
2. **Sky.** JPL DE440 (NAIF SPICE) gives the Sun and Earth every hour of 2027. Sunlight counts the visible part of the Sun's disc; Earth in view needs Earth's center above the terrain. Solar panels and antenna sit 2 m above the ground.
3. **Landings.** The browser measures the slope of every spot across 40 m of the same terrain, scatters 1,000 landings around the aim and checks each against the five requirements. "Aim at the safest spot" picks the aim with the highest chance; among ties, the one whose surroundings within 200 m work best, then the one with the most room to spare in its requirements. Landing is at 00:00 UTC on the chosen date. Everything after step 2 runs in the browser; there is no server.

## Validation criteria

Written before any result was computed:

- **Sun and Earth positions:** within 0.01° of JPL Horizons.
- **Sunlight and Earth in view:** compared with NASA's long-term maps (LOLA AVGVISIB, PGDA), mean difference under 3 points and correlation above 0.95 for both.
- **Athena (IM-2) landing, 2025-03-06:** computed Sun elevation at the landing site within 0.05° of JPL Horizons.
- **Landing simulation:** 1,000 landings give the chance to within ±3 points (95% interval) in the worst case.

## Validation results

From `scripts/validate.py`, shown on the validation page. Four of the five pass marks are met:

| Check | Result | |
|---|---|---|
| Sun and Earth vs JPL Horizons (2 sites, 12 times, both bodies) | 0.00003° worst | Pass |
| Sunlight vs AVGVISIB (160 random spots, 85°S to the pole, 2008–2026) | mean difference 1.75 points, correlation 0.985 | Pass |
| Earth in view vs AVGVISIB (same spots) | mean difference 1.16 points, correlation 0.982 | Pass |
| Sun elevation at Athena's landing, 2025-03-06 17:28 UTC | 2.464°, JPL Horizons 2.464° | Pass |
| Landing simulation | ±3.1 points worst case | Fail, by 0.1 |

Rebuilding the data on a second computer reproduced the first release's terrain, horizon, sunlight and Earth values for the ridge and Athena's aim exactly, and `validate.py` returned the same results.

What these checks do not cover:

- The AVGVISIB comparison runs the method on the 80 m terrain, seen from the ground. The 20 m terrain the navigator uses near each site is not tested.
- The Athena check tests the Sun's position only. On the 20 m terrain the hills rise 0.8° in the Sun's direction, so MARGEN would have called the spot sunlit. It was not: the small crater Athena landed in is below the map's resolution.
- The chance the mission works, the slope limit and the landing-day rules have no NASA reference to check against.

## What it doesn't model

Rocks, craters and slopes smaller than 20 m (slope is measured across 40 m, so ground that passes can still be too steep for a lander); lander tilt, dust, temperature and batteries; how long the lander survives in the dark; radio links and ground stations (Earth in view is line of sight only); light during descent and landing times other than 00:00 UTC; direction-dependent landing errors and misses larger than 100 m; terrain beyond 250 km or north of 80°S.

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
- Site positions: Shackleton connecting ridge center (LPSC 2025 abstract 2443); Athena aim and landing point (LROC); one candidate landing site in each of the nine Artemis III candidate regions, from the data of Wueller et al. (2026): the site with the highest "Sun and Earth" value for 2027, first listed among ties
- Mazarico, E. et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. Icarus 211, 1066–1081.
- Wueller et al. (2026). Assessing potential landing sites with favorable illumination and accessible, potentially volatile-rich permanently shadowed regions within Artemis candidate landing regions. JGR Planets 131, e2025JE009434. Data: [Zenodo](https://doi.org/10.5281/zenodo.17084058), CC BY 4.0.
- Barker, M. K. et al. (2021). Improved LOLA elevation maps for south pole landing sites: error estimates and their impact on illumination conditions. Planetary and Space Science 203, 105119.
- Software: NumPy, SciPy, SpiceyPy, tifffile, fsspec, Vite, TypeScript. Font: Geist (SIL Open Font License).

## AI use

An AI coding assistant was used to help write code during the hackathon. All code, data processing and the demo video were produced during the hackathon. The Sun and Earth positions and the long-term sunlight and Earth-in-view shares were checked against NASA data; the landing chances were not, as listed under Validation results. The video narration voice is AI-generated.

## License

Apache-2.0
