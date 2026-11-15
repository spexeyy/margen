import json
from pathlib import Path
from urllib.parse import urlencode

import fsspec
import numpy as np
import spiceypy as sp

from build_sites import DEM_20M, NEAR_HALF_M, SITES
from moon import EARTH_RADIUS_KM, RAW, body_positions, horizons, read_raster, read_window, to_lonlat, to_xy, topocentric, visibility

OUT = Path(__file__).resolve().parents[1] / "public" / "data" / "validation.json"
AVGVISIB_SCALE = 4e-5
ATHENA = {"lon": 29.1957, "lat": -84.7906, "time": "2025-03-06 17:28"}
SITE_SAMPLES = 30
CHECK_TIMES = [f"2027-{month:02d}-{day:02d} {hour:02d}:00" for month in (1, 2, 3) for day in (1, 15) for hour in (0, 12)]


def horizons_az_el(body, lon, lat, height_km, times):
    query = urlencode({
        "format": "text",
        "COMMAND": f"'{body}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon},{lat},{height_km}'",
        "TLIST": "'" + "' '".join(times) + "'",
        "TIME_TYPE": "'UT'",
        "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'",
        "EXTRA_PREC": "'YES'",
    })
    with fsspec.open(f"https://ssd.jpl.nasa.gov/api/horizons.api?{query}", "rt") as f:
        text = f.read()
    rows = text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    return np.array([[float(v) for v in row.split()[-2:]] for row in rows])


def spice_az_el(index, lon, lat, height_m, times):
    et = np.array([sp.str2et(f"{t} UTC") for t in times])
    az, el, _ = topocentric(body_positions(et)[index], np.array([lon]), np.array([lat]), np.array([height_m]))
    return np.c_[az[:, 0], el[:, 0]]


def angle_error(a, b):
    return np.abs((a - b + 180) % 360 - 180)


def ephemeris_check(far):
    worst = 0.0
    for lon, lat in ((ATHENA["lon"], ATHENA["lat"]), (196.739, -89.684)):
        height = float(far.sample(*to_xy(lon, lat)))
        for index, body in enumerate(("10", "399")):
            ours = spice_az_el(index, lon, lat, height, CHECK_TIMES)
            nasa = horizons_az_el(body, lon, lat, height / 1000, CHECK_TIMES)
            worst = max(worst, angle_error(ours, nasa).max())
    return worst


def athena_check(far):
    mouton = next(site for site in SITES if site["id"] == "mouton")
    near = read_window(DEM_20M, *to_xy(mouton["lon"], mouton["lat"]), NEAR_HALF_M, RAW / "mouton_20m.npz")
    x, y = to_xy(ATHENA["lon"], ATHENA["lat"])
    height = float(near.sample(x, y))
    ours = spice_az_el(0, ATHENA["lon"], ATHENA["lat"], height, [ATHENA["time"]])[0]
    nasa = horizons_az_el("10", ATHENA["lon"], ATHENA["lat"], height / 1000, [ATHENA["time"]])[0]
    horizon = horizons(np.array([x]), np.array([y]), np.array([height]), near, far)[0]
    terrain = np.interp(ours[0], np.arange(361), np.r_[horizon, horizon[0]])
    return {
        "time": ATHENA["time"],
        "sunAzimuth": round(float(ours[0]), 2),
        "sunElevation": round(float(ours[1]), 3),
        "horizonsSunElevation": round(float(nasa[1]), 3),
        "terrainHorizon": round(float(terrain), 2),
    }


def random_points(count, rng):
    lon = rng.uniform(0, 360, count)
    lat = -90 + np.degrees(np.arccos(rng.uniform(np.cos(np.radians(5)), 1, count)))
    return lon, lat


def long_term_visibility(horizon, lon, lat, eye):
    start, end = sp.str2et("2008-01-01 00:00 UTC"), sp.str2et("2026-08-01 00:00 UTC")
    sunlight, earth, samples = np.zeros(len(lon)), np.zeros(len(lon)), 0
    for chunk in np.array_split(np.arange(start, end, 4 * 3600.0), 40):
        s, e = visibility(chunk, lon, lat, eye, horizon, earth_margin_km=EARTH_RADIUS_KM)
        sunlight += s.sum(0)
        earth += e.sum(0)
        samples += len(chunk)
    return sunlight / samples, earth / samples


def summary(ours, nasa):
    diff = 100 * (ours - nasa)
    return {
        "meanDifference": round(float(np.abs(diff).mean()), 2),
        "bias": round(float(diff.mean()), 2),
        "correlation": round(float(np.corrcoef(ours, nasa)[0, 1]), 3),
    }


def against_nasa(x, y, horizon, eye):
    lon, lat = to_lonlat(x, y)
    sunlight, earth = long_term_visibility(horizon, lon, lat, eye)
    nasa_sun = read_raster(RAW / "AVGVISIB_85S_060M_201608.TIF").sample(x, y) * AVGVISIB_SCALE
    nasa_earth = read_raster(RAW / "AVGVISIB_85S_060M_201608_EARTH.TIF").sample(x, y) * AVGVISIB_SCALE
    return {
        "points": np.round(np.c_[lon, lat, sunlight, nasa_sun, earth, nasa_earth], 4).tolist(),
        "sunlight": summary(sunlight, nasa_sun),
        "earth": summary(earth, nasa_earth),
    }


def avgvisib_check(far):
    lon, lat = random_points(160, np.random.default_rng(2026))
    x, y = to_xy(lon, lat)
    eye = far.sample(x, y)
    return against_nasa(x, y, horizons(x, y, eye, far, far), eye)


def site_check(far):
    rng = np.random.default_rng(2027)
    covered = [site for site in SITES if site["lat"] <= -85]
    xs, ys, eyes, profiles = [], [], [], []
    for site in covered:
        cx, cy = to_xy(site["lon"], site["lat"])
        near = read_window(DEM_20M, cx, cy, NEAR_HALF_M, RAW / f"{site['id']}_20m.npz")
        x = cx + rng.uniform(-1000, 1000, SITE_SAMPLES)
        y = cy + rng.uniform(-1000, 1000, SITE_SAMPLES)
        eye = near.sample(x, y)
        xs.append(x)
        ys.append(y)
        eyes.append(eye)
        profiles.append(horizons(x, y, eye, near, far))
    x, y = np.concatenate(xs), np.concatenate(ys)
    result = against_nasa(x, y, np.concatenate(profiles), np.concatenate(eyes))
    eye80 = far.sample(x, y)
    coarse = against_nasa(x, y, horizons(x, y, eye80, far, far), eye80)
    return result | {"sites": [site["name"] for site in covered], "terrain80m": {k: coarse[k] for k in ("sunlight", "earth")}}


def main():
    far = read_raster(RAW / "LDEM_80S_80MPP_ADJ.TIF")
    result = {
        "ephemerisMaxError": round(float(ephemeris_check(far)), 5),
        "athena": athena_check(far),
        "avgvisib": avgvisib_check(far),
        "sites20m": site_check(far),
    }
    OUT.write_text(json.dumps(result))
    print(json.dumps({k: v for k, v in result.items() if k not in ("avgvisib", "sites20m")}, indent=2))
    for key in ("avgvisib", "sites20m"):
        print(key, json.dumps({k: result[key][k] for k in ("sunlight", "earth")}))


if __name__ == "__main__":
    main()
