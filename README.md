# MARGEN

**Miss the target. Keep the mission.**

Most tools ask whether a Moon landing site works if everything goes right. MARGEN asks whether it still works when things go wrong: when the lander comes down hundreds of meters off target, or the launch slips by a week. Then it finds the next good date.

A landing works when, for the first 14 days:

- **Sunlight** (powers the lander) reaches it at least 50% of the time;
- **Earth is in view** (lets it talk to home) at least 30% of the time.

MARGEN simulates 1,000 landings scattered around the aim point (100 m typical miss) and reports the chance the mission works, for every site and landing date.

Built for the NASA Space Apps Challenge 2026, challenge "Lunar Landing Site Navigator", by team MARGEN (Buenos Aires).

## Validation criteria

Written before any result was computed:

- **Sun and Earth positions:** within 0.01° of JPL Horizons.
- **Sunlight and Earth in view:** compared with NASA's long-term maps (LOLA AVGVISIB, PGDA), mean difference under 3 points and correlation above 0.95 for both.
- **Athena (IM-2) landing, 2025-03-06:** computed Sun elevation at the landing site within 0.05° of JPL Horizons.
- **Landing simulation:** 1,000 landings give the chance to within ±3 points (95% interval) in the worst case.

## Data

- LRO LOLA south pole elevation models (NASA PGDA)
- LOLA average illumination and Earth visibility maps, AVGVISIB (NASA PGDA)
- JPL DE440 ephemerides via NAIF SPICE, and JPL Horizons

## AI use

An AI coding assistant was used to help write code during the hackathon. All code, data processing and the demo video were produced during the hackathon, and every number was checked against NASA data. The video narration voice is AI-generated.

## License

Apache-2.0
