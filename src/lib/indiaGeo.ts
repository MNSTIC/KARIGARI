/**
 * Minimal city gazetteer for the demand-forecast map.
 *
 * The map is Leaflet (src/components/DemandMap.tsx), which places markers by
 * lat/lng and derives its own viewport, so a pin only needs a coordinate — the
 * old fixed-bbox percentage projection is gone, along with the drift it caused.
 * Locations we cannot resolve are listed beside the map rather than dropped or
 * pinned somewhere invented.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

export const CITY_COORDS: Record<string, GeoPoint> = {
  'delhi': { lat: 28.61, lon: 77.21 },
  'new delhi': { lat: 28.61, lon: 77.21 },
  'delhi ncr': { lat: 28.61, lon: 77.21 },
  'gurugram': { lat: 28.46, lon: 77.03 },
  'noida': { lat: 28.54, lon: 77.39 },
  'mumbai': { lat: 19.08, lon: 72.88 },
  'pune': { lat: 18.52, lon: 73.86 },
  'nagpur': { lat: 21.15, lon: 79.09 },
  'surat': { lat: 21.17, lon: 72.83 },
  'ahmedabad': { lat: 23.02, lon: 72.57 },
  'vadodara': { lat: 22.31, lon: 73.18 },
  'jaipur': { lat: 26.91, lon: 75.79 },
  'jodhpur': { lat: 26.24, lon: 73.02 },
  'lucknow': { lat: 26.85, lon: 80.95 },
  'varanasi': { lat: 25.32, lon: 82.97 },
  'khurja': { lat: 28.25, lon: 77.85 },
  'kanpur': { lat: 26.45, lon: 80.33 },
  'patna': { lat: 25.59, lon: 85.14 },
  'ranchi': { lat: 23.34, lon: 85.31 },
  'raipur': { lat: 21.25, lon: 81.63 },
  'bhopal': { lat: 23.26, lon: 77.41 },
  'indore': { lat: 22.72, lon: 75.86 },
  'kolkata': { lat: 22.57, lon: 88.36 },
  'bhubaneswar': { lat: 20.3, lon: 85.82 },
  // Everyday abbreviation, and what one real profile already had saved.
  'bbsr': { lat: 20.3, lon: 85.82 },
  'cuttack': { lat: 20.46, lon: 85.88 },
  'bargarh': { lat: 21.33, lon: 83.62 },
  'sambalpur': { lat: 21.47, lon: 83.97 },
  'sonepur': { lat: 20.83, lon: 83.92 },
  'guwahati': { lat: 26.14, lon: 91.74 },
  'hyderabad': { lat: 17.39, lon: 78.49 },
  'pochampally': { lat: 17.35, lon: 78.82 },
  'visakhapatnam': { lat: 17.69, lon: 83.22 },
  'bengaluru': { lat: 12.97, lon: 77.59 },
  'bangalore': { lat: 12.97, lon: 77.59 },
  'mysuru': { lat: 12.3, lon: 76.64 },
  'mysore': { lat: 12.3, lon: 76.64 },
  'chennai': { lat: 13.08, lon: 80.27 },
  'coimbatore': { lat: 11.02, lon: 76.96 },
  'madurai': { lat: 9.93, lon: 78.12 },
  'kochi': { lat: 9.93, lon: 76.27 },
  'thiruvananthapuram': { lat: 8.52, lon: 76.94 },
  'goa': { lat: 15.3, lon: 74.12 },
  'chandigarh': { lat: 30.73, lon: 76.78 },
  'amritsar': { lat: 31.63, lon: 74.87 },
  'ludhiana': { lat: 30.9, lon: 75.86 },
  'dehradun': { lat: 30.32, lon: 78.03 },
  'srinagar': { lat: 34.08, lon: 74.8 },
  'shimla': { lat: 31.1, lon: 77.17 },

  // ---- Craft clusters -----------------------------------------------------
  // Handloom and handicraft towns the artisan roster actually comes from. A
  // profile that names one of these resolves; a bare state name deliberately
  // does not, because a state centroid is a guess, not the artisan's village.
  'sualkuchi': { lat: 26.16, lon: 91.57 },
  'jorhat': { lat: 26.75, lon: 94.22 },
  'dimapur': { lat: 25.9, lon: 93.73 },
  'kohima': { lat: 25.67, lon: 94.11 },
  'imphal': { lat: 24.82, lon: 93.94 },
  'shillong': { lat: 25.57, lon: 91.88 },
  'agartala': { lat: 23.83, lon: 91.28 },
  'aizawl': { lat: 23.73, lon: 92.72 },
  'itanagar': { lat: 27.08, lon: 93.61 },
  'gangtok': { lat: 27.33, lon: 88.61 },
  'siliguri': { lat: 26.72, lon: 88.43 },
  'bishnupur': { lat: 23.07, lon: 87.32 },
  'santiniketan': { lat: 23.68, lon: 87.68 },
  'shantipur': { lat: 23.25, lon: 88.44 },
  'murshidabad': { lat: 24.18, lon: 88.27 },
  'bhagalpur': { lat: 25.24, lon: 86.99 },
  'madhubani': { lat: 26.35, lon: 86.07 },
  'darbhanga': { lat: 26.15, lon: 85.9 },
  'bhadohi': { lat: 25.39, lon: 82.57 },
  'mirzapur': { lat: 25.15, lon: 82.57 },
  'moradabad': { lat: 28.84, lon: 78.78 },
  'firozabad': { lat: 27.15, lon: 78.4 },
  'saharanpur': { lat: 29.97, lon: 77.55 },
  'aligarh': { lat: 27.9, lon: 78.08 },
  'chanderi': { lat: 24.72, lon: 78.14 },
  'maheshwar': { lat: 22.18, lon: 75.59 },
  'jagdalpur': { lat: 19.08, lon: 82.03 },
  'bastar': { lat: 19.1, lon: 81.95 },
  'bilaspur': { lat: 22.08, lon: 82.15 },
  'bhuj': { lat: 23.24, lon: 69.67 },
  'bhujodi': { lat: 23.2, lon: 69.73 },
  'patan': { lat: 23.85, lon: 72.13 },
  'rajkot': { lat: 22.3, lon: 70.8 },
  'barmer': { lat: 25.75, lon: 71.39 },
  'bikaner': { lat: 28.02, lon: 73.31 },
  'nagaur': { lat: 27.2, lon: 73.73 },
  'sanganer': { lat: 26.82, lon: 75.79 },
  'bagru': { lat: 26.81, lon: 75.55 },
  'udaipur': { lat: 24.58, lon: 73.68 },
  'bhilwara': { lat: 25.35, lon: 74.64 },
  'kota': { lat: 25.18, lon: 75.83 },
  'kaithun': { lat: 25.1, lon: 75.93 },
  'kanchipuram': { lat: 12.84, lon: 79.7 },
  'thanjavur': { lat: 10.79, lon: 79.14 },
  'karur': { lat: 10.96, lon: 78.08 },
  'erode': { lat: 11.34, lon: 77.72 },
  'salem': { lat: 11.66, lon: 78.15 },
  'channapatna': { lat: 12.65, lon: 77.21 },
  'ilkal': { lat: 16.13, lon: 76.11 },
  'bidar': { lat: 17.91, lon: 77.52 },
  'dharwad': { lat: 15.46, lon: 75.01 },
  'gadwal': { lat: 16.23, lon: 77.8 },
  'narayanpet': { lat: 16.74, lon: 77.5 },
  'warangal': { lat: 17.98, lon: 79.59 },
  'karimnagar': { lat: 18.44, lon: 79.13 },
  'nirmal': { lat: 19.1, lon: 78.34 },
  'siddipet': { lat: 18.1, lon: 78.85 },
  'nalgonda': { lat: 17.05, lon: 79.27 },
  'guntur': { lat: 16.31, lon: 80.44 },
  'chirala': { lat: 15.82, lon: 80.35 },
  'dharmavaram': { lat: 14.41, lon: 77.72 },
  'venkatagiri': { lat: 13.96, lon: 79.58 },
  'uppada': { lat: 17.09, lon: 82.34 },
  'etikoppaka': { lat: 17.5, lon: 82.73 },
  'srikalahasti': { lat: 13.75, lon: 79.7 },
  'machilipatnam': { lat: 16.19, lon: 81.14 },
  'kondapalli': { lat: 16.62, lon: 80.53 },
  'raghurajpur': { lat: 19.87, lon: 85.83 },
  'puri': { lat: 19.81, lon: 85.83 },
  'pipili': { lat: 20.11, lon: 85.83 },
  'berhampur': { lat: 19.31, lon: 84.79 },
  'balasore': { lat: 21.49, lon: 86.93 },
  'baripada': { lat: 21.93, lon: 86.73 },
  'nuapatna': { lat: 20.48, lon: 85.68 },
  'kendrapara': { lat: 20.5, lon: 86.42 },
  'koraput': { lat: 18.81, lon: 82.71 },
  'rayagada': { lat: 19.17, lon: 83.42 },
  'bhawanipatna': { lat: 19.91, lon: 83.17 },
  'jeypore': { lat: 18.86, lon: 82.57 },
  'aranmula': { lat: 9.32, lon: 76.68 },
  'balaramapuram': { lat: 8.41, lon: 77.02 },
  'chendamangalam': { lat: 10.18, lon: 76.24 },
  'kannur': { lat: 11.87, lon: 75.37 },
  'kasaragod': { lat: 12.5, lon: 74.99 },
  'kullu': { lat: 31.96, lon: 77.11 },
  'leh': { lat: 34.16, lon: 77.58 },
  'jammu': { lat: 32.73, lon: 74.87 },
};

/**
 * Aliases that resolve but should not be offered twice in a picker.
 * Keeping them in CITY_COORDS is what lets free text like "Bangalore" work.
 */
const OPTION_ALIASES = new Set(['new delhi', 'delhi ncr', 'bangalore', 'mysore', 'goa', 'bbsr']);

function titleCase(key: string): string {
  return key
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Display labels for the location pickers on registration and profile edit.
 * Picking from this list guarantees the artisan lands on the demand map.
 */
export const CITY_OPTIONS: string[] = Object.keys(CITY_COORDS)
  .filter((key) => !OPTION_ALIASES.has(key))
  .map(titleCase)
  .sort((a, b) => a.localeCompare(b));

/**
 * Resolve a free-text location ("Delhi NCR", "Bargarh, Odisha") to a point.
 * Returns null when nothing matches — the caller must handle that, not guess.
 */
export function locateCity(location?: string | null): GeoPoint | null {
  const raw = (location ?? '').toLowerCase().trim();
  if (!raw) return null;

  if (CITY_COORDS[raw]) return CITY_COORDS[raw];

  // Longest key first so "delhi ncr" wins over "delhi" on the same string.
  const keys = Object.keys(CITY_COORDS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (raw.includes(key)) return CITY_COORDS[key];
  }
  return null;
}

/** Haversine distance in kilometers. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLon = (b.lon - a.lon) * (Math.PI / 180);
  const aLat = a.lat * (Math.PI / 180);
  const bLat = b.lat * (Math.PI / 180);

  const aVal =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(aLat) * Math.cos(bLat);
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return Math.round(R * c);
}
