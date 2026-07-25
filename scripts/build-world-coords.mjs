/**
 * Build the OCONUS geocoding data from public-domain sources:
 *   - src/data/country-centroids.json : ISO3 -> [lat,lng]  (mledoze/countries)
 *   - src/data/iso3-to-iso2.json      : ISO3 -> ISO2        (mledoze/countries)
 *   - src/data/world-city-coords.json : "CITYUPPER|ISO2" -> [lat,lng]  (GeoNames cities15000, non-US)
 *
 * Foreign place-of-performance resolves to its real location instead of falling through to the
 * US buying office (which put Rome/Jeddah/Vienna in Washington DC). US cities stay in the
 * existing us-city-coords.json. Run: node scripts/build-world-coords.mjs <countries.json> <cities15000.txt>
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'src', 'data');
const [, , countriesPath, citiesPath] = process.argv;

// --- country centroids + ISO3->ISO2 ---
const countries = JSON.parse(readFileSync(countriesPath, 'utf8'));
const centroids = {};
const iso3to2 = {};
for (const c of countries) {
  if (c.cca3 && Array.isArray(c.latlng) && c.latlng.length === 2) {
    centroids[c.cca3] = [Number(c.latlng[0].toFixed(4)), Number(c.latlng[1].toFixed(4))];
    if (c.cca2) iso3to2[c.cca3] = c.cca2;
  }
}

// --- world cities (non-US; US already covered by us-city-coords.json). Highest-population wins. ---
const cityPop = {};
const cityCoord = {};
const lines = readFileSync(citiesPath, 'utf8').split('\n');
for (const line of lines) {
  if (!line) continue;
  const f = line.split('\t');
  const name = f[2] || f[1];      // asciiname, fall back to name
  const lat = parseFloat(f[4]);
  const lng = parseFloat(f[5]);
  const cc = f[8];                // ISO2 country
  const pop = parseInt(f[14] || '0', 10);
  if (!name || !cc || cc === 'US' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  const key = `${name.toUpperCase()}|${cc}`;
  if (cityPop[key] === undefined || pop > cityPop[key]) {
    cityPop[key] = pop;
    cityCoord[key] = [Number(lat.toFixed(4)), Number(lng.toFixed(4))];
  }
}

writeFileSync(join(DATA, 'country-centroids.json'), JSON.stringify(centroids));
writeFileSync(join(DATA, 'iso3-to-iso2.json'), JSON.stringify(iso3to2));
writeFileSync(join(DATA, 'world-city-coords.json'), JSON.stringify(cityCoord));
console.log(`country-centroids: ${Object.keys(centroids).length}`);
console.log(`iso3-to-iso2: ${Object.keys(iso3to2).length}`);
console.log(`world-city-coords (non-US): ${Object.keys(cityCoord).length}`);
