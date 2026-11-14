export interface Site {
  id: string;
  name: string;
  lon: number;
  lat: number;
  source: string;
  x0: number;
  y0: number;
  pixel: number;
  landed?: { lon: number; lat: number; label: string };
}

export interface Index {
  firstDay: string;
  days: number;
  size: number;
  landerHeight: number;
  horizon: { min: number; step: number; count: number };
  sites: Site[];
}

export interface SiteData {
  site: Site;
  sunlight: Uint8Array;
  earth: Uint8Array;
  ground: Int16Array;
}

async function gunzip(path: string): Promise<ArrayBuffer> {
  const response = await fetch(path);
  return new Response(response.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

export async function loadIndex(): Promise<Index> {
  return (await fetch("/data/sites.json")).json();
}

export async function loadEphemeris(): Promise<Float32Array> {
  return new Float32Array(await gunzip("/data/ephemeris.f32.gzip"));
}

export async function loadSite(site: Site): Promise<SiteData> {
  const [sunlight, earth, ground] = await Promise.all([
    gunzip(`/data/${site.id}/sunlight.u8.gzip`),
    gunzip(`/data/${site.id}/earth.u8.gzip`),
    gunzip(`/data/${site.id}/ground.i16.gzip`),
  ]);
  return { site, sunlight: new Uint8Array(sunlight), earth: new Uint8Array(earth), ground: new Int16Array(ground) };
}

export async function loadHorizons(site: Site): Promise<Uint8Array> {
  return new Uint8Array(await gunzip(`/data/${site.id}/horizon.u8.gzip`));
}
