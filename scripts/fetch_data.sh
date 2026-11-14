#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw

naif=https://naif.jpl.nasa.gov/pub/naif/generic_kernels
pgda=https://pgda.gsfc.nasa.gov/data

for url in \
  $naif/lsk/naif0012.tls \
  $naif/pck/pck00011.tpc \
  $naif/spk/planets/de440s.bsp \
  $naif/pck/moon_pa_de440_200625.bpc \
  $naif/fk/satellites/moon_de440_250416.tf \
  $pgda/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF \
  $pgda/MoonIllumination/AVGVISIB_85S_060M_201608.TIF \
  $pgda/MoonIllumination/AVGVISIB_85S_060M_201608_EARTH.TIF
do
  out="data/raw/$(basename "$url")"
  [ -f "$out" ] && continue
  curl -fL --retry 3 -C - -o "$out.part" "$url"
  mv "$out.part" "$out"
done
