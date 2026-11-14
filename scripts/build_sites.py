import gzip
import json
import time
from pathlib import Path

import numpy as np
import spiceypy as sp

from moon import RAW, body_positions, horizons, read_raster, read_window, to_lonlat, to_xy, visibility

OUT = Path(__file__).resolve().parents[1] / "public" / "data"
DEM_20M = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF"
FIRST_DAY = "2027-01-01"
DAYS = 103
SIZE = 100
NEAR_HALF_M = 12000
LANDER_HEIGHT_M = 2.0
HORIZON_MIN_DEG, HORIZON_STEP_DEG = -5.0, 0.1

SITES = [
    {
        "id": "ridge",
        "name": "Shackleton connecting ridge",
        "lon": 196.739,
        "lat": -89.684,
        "source": "Ridge center, LPSC 2025 abstract 2443",
    },
    {
        "id": "mouton",
        "name": "Mons Mouton",
        "lon": 29.13,
        "lat": -84.78,
        "source": "Athena (IM-2) aim point, LROC",
        "landed": {"lon": 29.1957, "lat": -84.7906, "label": "Athena landed here, 2025"},
    },
    {
        "id": "gerlache",
        "name": "de Gerlache rim",
        "lon": 291.496,
        "lat": -88.313,
        "source": "Best-lit spot within 5 km of the Artemis candidate region de Gerlache Rim 2, from NASA AVGVISIB",
    },
    {
        "id": "nobile",
        "name": "Nobile rim",
        "lon": 37.270,
        "lat": -85.270,
        "source": "Best-lit spot within 5 km of the Artemis candidate region Nobile Rim 1, from NASA AVGVISIB",
    },
]


def save(path, array):
    with gzip.open(path, "wb") as f:
        f.write(array.tobytes())


def hourly_et():
    return sp.str2et(f"{FIRST_DAY} 00:00 UTC") + np.arange(DAYS * 24) * 3600.0


def site_grid(near, x, y):
    r0 = int((near.y0 - y) // near.size) - SIZE // 2
    c0 = int((x - near.x0) // near.size) - SIZE // 2
    rows, cols = np.mgrid[r0 : r0 + SIZE, c0 : c0 + SIZE]
    px = near.x0 + (cols.ravel() + 0.5) * near.size
    py = near.y0 - (rows.ravel() + 0.5) * near.size
    return px, py, near.z[r0 : r0 + SIZE, c0 : c0 + SIZE].ravel().astype(float)


def daily_fractions(et, lon, lat, eye, horizon):
    sunlight = np.empty((DAYS, len(lon)), np.float32)
    earth = np.empty((DAYS, len(lon)), np.float32)
    for day in range(DAYS):
        s, e = visibility(et[day * 24 : (day + 1) * 24], lon, lat, eye, horizon)
        sunlight[day], earth[day] = s.mean(0), e.mean(0)
    return sunlight, earth


def build(site, far, et):
    start = time.time()
    x, y = to_xy(site["lon"], site["lat"])
    near = read_window(DEM_20M, x, y, NEAR_HALF_M, RAW / f"{site['id']}_20m.npz")
    px, py, ground = site_grid(near, x, y)
    eye = ground + LANDER_HEIGHT_M
    horizon = horizons(px, py, eye, near, far)
    lon, lat = to_lonlat(px, py)
    sunlight, earth = daily_fractions(et, lon, lat, eye, horizon)

    folder = OUT / site["id"]
    folder.mkdir(parents=True, exist_ok=True)
    save(folder / "sunlight.u8.gzip", np.round(sunlight * 255).astype(np.uint8))
    save(folder / "earth.u8.gzip", np.round(earth * 255).astype(np.uint8))
    encoded = np.round((horizon - HORIZON_MIN_DEG) / HORIZON_STEP_DEG)
    save(folder / "horizon.u8.gzip", np.clip(encoded, 0, 255).astype(np.uint8))
    save(folder / "ground.i16.gzip", np.round(ground).astype(np.int16))
    print(f"{site['id']}: {time.time() - start:.0f} s, ground {ground.min():.0f} to {ground.max():.0f} m")
    return site | {"x0": px[0] - near.size / 2, "y0": py[0] + near.size / 2, "pixel": near.size}


def main():
    far = read_raster(RAW / "LDEM_80S_80MPP_ADJ.TIF")
    et = hourly_et()
    sites = [build(site, far, et) for site in SITES]
    sun, earth = body_positions(et)
    save(OUT / "ephemeris.f32.gzip", np.hstack([sun, earth]).astype(np.float32))
    index = {
        "firstDay": FIRST_DAY,
        "days": DAYS,
        "size": SIZE,
        "landerHeight": LANDER_HEIGHT_M,
        "horizon": {"min": HORIZON_MIN_DEG, "step": HORIZON_STEP_DEG, "count": 360},
        "sites": sites,
    }
    (OUT / "sites.json").write_text(json.dumps(index, indent=2))


if __name__ == "__main__":
    main()
