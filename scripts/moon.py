from pathlib import Path

import fsspec
import numpy as np
import spiceypy as sp
import tifffile
from scipy.ndimage import map_coordinates

MOON_RADIUS_M = 1737400.0
SUN_RADIUS_KM = 696000.0
EARTH_RADIUS_KM = 6371.0
RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
NEAR_DISTANCES_M = np.concatenate([np.arange(20, 2000, 20), np.geomspace(2000, 10000, 60)])
FAR_DISTANCES_M = np.geomspace(10000, 250000, 120)

for kernel in ("naif0012.tls", "pck00011.tpc", "de440s.bsp", "moon_pa_de440_200625.bpc", "moon_de440_250416.tf"):
    sp.furnsh(str(RAW / kernel))


def to_xy(lon, lat):
    rho = 2 * MOON_RADIUS_M * np.tan(np.pi / 4 + np.radians(lat) / 2)
    return rho * np.sin(np.radians(lon)), rho * np.cos(np.radians(lon))


def to_lonlat(x, y):
    lat = np.degrees(2 * np.arctan(np.hypot(x, y) / (2 * MOON_RADIUS_M)) - np.pi / 2)
    return np.degrees(np.arctan2(x, y)) % 360, lat


class Raster:
    def __init__(self, z, x0, y0, size):
        self.z, self.x0, self.y0, self.size = z, x0, y0, size

    def sample(self, x, y):
        rows = np.atleast_1d((self.y0 - y) / self.size - 0.5)
        cols = np.atleast_1d((x - self.x0) / self.size - 0.5)
        # Off the map there is no terrain to block the view.
        values = map_coordinates(self.z, [rows, cols], order=1, mode="constant", cval=-1e9)
        return values.reshape(np.shape(x))


def georef(page):
    x0, y0 = page.tags["ModelTiepointTag"].value[3:5]
    return x0, y0, page.tags["ModelPixelScaleTag"].value[0]


def read_raster(path):
    with tifffile.TiffFile(path) as tif:
        return Raster(tif.pages[0].asarray(), *georef(tif.pages[0]))


def read_window(url, x, y, half, cache):
    if cache.exists():
        saved = np.load(cache)
        return Raster(saved["z"], *saved["georef"])
    with fsspec.open(url, block_size=2**20) as f:
        page = tifffile.TiffFile(f).pages[0]
        x0, y0, size = georef(page)
        r0, r1 = int((y0 - y - half) // size), int((y0 - y + half) // size)
        c0, c1 = int((x - half - x0) // size), int((x + half - x0) // size)
        th, tw = page.tilelength, page.tilewidth
        across = -(-page.imagewidth // tw)

        def tile(row, col):
            index = row * across + col
            f.seek(page.dataoffsets[index])
            return page.decode(f.read(page.databytecounts[index]), index)[0].reshape(th, tw)

        rows, cols = range(r0 // th, r1 // th + 1), range(c0 // tw, c1 // tw + 1)
        block = np.block([[tile(r, c) for c in cols] for r in rows])
        z = block[r0 - rows[0] * th : r1 - rows[0] * th, c0 - cols[0] * tw : c1 - cols[0] * tw]
    window = (x0 + c0 * size, y0 - r0 * size, size)
    np.savez(cache, z=z, georef=window)
    return Raster(z, *window)


def horizons(x, y, eye_m, near, far, n_az=360):
    # In the south polar projection, local north points away from the pole and east is north turned clockwise.
    north = np.stack([x, y], -1) / np.hypot(x, y)[:, None]
    east = np.stack([north[:, 1], -north[:, 0]], -1)
    out = np.empty((len(x), n_az), np.float32)
    for k, az in enumerate(np.radians(np.arange(n_az) * 360 / n_az)):
        direction = np.cos(az) * north + np.sin(az) * east
        best = np.full(len(x), -90.0)
        for raster, d in ((near, NEAR_DISTANCES_M), (far, FAR_DISTANCES_M)):
            z = raster.sample(x[:, None] + direction[:, :1] * d, y[:, None] + direction[:, 1:] * d)
            drop = d**2 / (2 * MOON_RADIUS_M)
            best = np.maximum(best, np.degrees(np.arctan2(z - eye_m[:, None] - drop, d)).max(1))
        out[:, k] = best
    return out


def body_positions(et):
    sun = np.array(sp.spkpos("SUN", et, "MOON_ME", "LT+S", "MOON")[0])
    earth = np.array(sp.spkpos("EARTH", et, "MOON_ME", "LT+S", "MOON")[0])
    return sun, earth


def topocentric(body_km, lon, lat, eye_m):
    lo, la = np.radians(lon), np.radians(lat)
    up = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)
    east = np.stack([-np.sin(lo), np.cos(lo), np.zeros_like(lo)], -1)
    north = np.cross(up, east)
    v = body_km[:, None, :] - up[None] * ((MOON_RADIUS_M + eye_m) / 1000)[None, :, None]
    distance = np.linalg.norm(v, axis=-1)
    el = np.degrees(np.arcsin(np.einsum("tnk,nk->tn", v, up) / distance))
    az = np.degrees(np.arctan2(np.einsum("tnk,nk->tn", v, east), np.einsum("tnk,nk->tn", v, north))) % 360
    return az, el, distance


def horizon_at(horizon, az):
    n_az = horizon.shape[1]
    position = az * n_az / 360
    i = np.floor(position).astype(int)
    f = position - i
    rows = np.arange(horizon.shape[0])
    return horizon[rows, i % n_az] * (1 - f) + horizon[rows, (i + 1) % n_az] * f


def disc_above(offset_deg, radius_deg):
    h = np.clip(offset_deg / radius_deg, -1, 1)
    return (np.pi - np.arccos(h) + h * np.sqrt(1 - h * h)) / np.pi


def visibility(et, lon, lat, eye_m, horizon, earth_margin_km=0.0):
    sun, earth = body_positions(et)
    az, el, distance = topocentric(sun, lon, lat, eye_m)
    sunlight = disc_above(el - horizon_at(horizon, az), np.degrees(np.arcsin(SUN_RADIUS_KM / distance)))
    az, el, distance = topocentric(earth, lon, lat, eye_m)
    earth_in_view = el + np.degrees(np.arcsin(earth_margin_km / distance)) > horizon_at(horizon, az)
    return sunlight, earth_in_view
