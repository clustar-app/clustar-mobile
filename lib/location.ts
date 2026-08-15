import * as Location from "expo-location";

// Small wrapper so screens don't deal with Location's permission plumbing.
// Uses BalancedPowerAccuracy per PRD 6.4 — never continuous high-accuracy GPS.

export interface Coords {
  lat: number;
  lng: number;
  accuracy_m: number | null;
}

export async function getCurrentLocation(): Promise<Coords> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") {
    throw new Error(
      "Location permission not granted. Clustar needs it to show threads near you."
    );
  }

  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy_m: pos.coords.accuracy ?? null,
  };
}

// Reverse-geocode a coordinate to a short human place label like
// "Ikeja, Lagos". Two providers, tried in order:
//   1) expo-location's OS-native geocoder — free, offline-ish. Works well
//      in North America / Europe; spotty in Nigeria and other regions.
//   2) BigDataCloud — free public reverse-geocode API. No key needed for
//      client-side use. Solid coverage worldwide, especially Africa.
// Neither uses your data plan meaningfully (~1KB per call), and both are
// only called once per session when the user's coords first resolve.
export async function getPlaceName(lat: number, lng: number): Promise<string | null> {
  const native = await tryNativeGeocode(lat, lng);
  if (native) return native;
  return tryBigDataCloud(lat, lng);
}

async function tryNativeGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    const r = results?.[0];
    if (!r) return null;
    // Prefer neighborhood/district + city. Skip `name` (usually street address).
    const local = r.subregion ?? r.district ?? r.city ?? null;
    const region = r.region ?? r.country ?? null;
    if (local && region && local !== region) return `${local}, ${region}`;
    return local ?? region ?? null;
  } catch {
    return null;
  }
}

// BigDataCloud's public client-side endpoint. No API key required for the
// "-client" variant; they meter by IP. Fine for a single call per session.
// Response shape includes locality/city/countryName among many others.
async function tryBigDataCloud(lat: number, lng: number): Promise<string | null> {
  try {
    const url =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      locality?: string;
      city?: string;
      principalSubdivision?: string;
      countryName?: string;
      localityInfo?: { administrative?: Array<{ name: string; order: number }> };
    };
    // Order of specificity: locality (neighborhood) > city > principalSubdivision (state).
    const local = data.locality || data.city || null;
    const region = data.principalSubdivision || data.countryName || null;
    if (local && region && local !== region) return `${local}, ${region}`;
    return local ?? region ?? null;
  } catch {
    return null;
  }
}
