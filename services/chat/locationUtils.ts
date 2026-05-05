/**
 * Location Utilities — Nominatim geocoding + Bangalore boundary check.
 * Extracted from chatOrchestrationService.ts — zero logic change.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Strict Geographic Bounds for Bangalore
// ─────────────────────────────────────────────────────────────────────────────

export const BANGALORE_BOUNDS = {
    north: 13.1436 + 0.05,
    south: 12.8340 - 0.05,
    east: 77.7840 + 0.05,
    west: 77.4601 - 0.05
};

export function isInsideBangalore(lat: number, lng: number): boolean {
    return lat >= BANGALORE_BOUNDS.south &&
           lat <= BANGALORE_BOUNDS.north &&
           lng >= BANGALORE_BOUNDS.west &&
           lng <= BANGALORE_BOUNDS.east;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nominatim Geocoder
// ─────────────────────────────────────────────────────────────────────────────

export async function geocodeQuery(query: string): Promise<[number, number] | null> {
    try {
        // Try with ", Bangalore" suffix first
        const url1 = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query + ', Bangalore')}`;
        const resp1 = await fetch(url1);
        const data1 = await resp1.json();
        if (data1 && data1.length > 0) {
            return [parseFloat(data1[0].lat), parseFloat(data1[0].lon)];
        }
        // Fallback — try without the city suffix
        const url2 = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
        const resp2 = await fetch(url2);
        const data2 = await resp2.json();
        if (data2 && data2.length > 0) {
            return [parseFloat(data2[0].lat), parseFloat(data2[0].lon)];
        }
        return null;
    } catch {
        return null;
    }
}
