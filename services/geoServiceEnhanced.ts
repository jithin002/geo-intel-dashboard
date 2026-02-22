
import { GeoPoint, ScoringMatrix, LocationType } from '../types';

/**
 * Enhanced Geospatial Service with Google Places API Integration
 * 
 * This service fetches REAL POI data from Google Places API instead of mock data.
 * You'll need both:
 * 1. GEMINI_API_KEY (for AI insights)
 * 2. GOOGLE_MAPS_API_KEY (for Places API)
 */

// Haversine distance calculation
const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

interface PlacesAPIResult {
    gyms: any[];
    corporateOffices: any[];
    parks: any[];
    cafes: any[];
    metroStations: any[];
    busStations: any[];
    apartments: any[];
    vibeActive: any[];        // yoga studios, sports complexes
    vibeEntertainment: any[]; // movie theaters, bars, night clubs
}

/**
 * Fetch real POI data from Google Places API (New)
 * Uses the new Places API with Field Mask
 */
export const fetchRealPOIData = async (
    lat: number,
    lng: number,
    radiusMeters: number = 1000
): Promise<PlacesAPIResult> => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
        console.warn('Google Maps API key not found. Using fallback mock data.');
        return {
            gyms: [], corporateOffices: [], parks: [], cafes: [],
            metroStations: [], busStations: [], apartments: [],
            vibeActive: [], vibeEntertainment: []
        };
    }

    const baseURL = 'https://places.googleapis.com/v1/places:searchNearby';

    // Common headers for new Places API
    const headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.location,places.types,places.rating,places.userRatingCount'
    };

    const makeRequest = async (includedTypes: string[]): Promise<any[]> => {
        const fetchZone = async (zoneLat: number, zoneLng: number, zoneRadius: number): Promise<any[]> => {
            const body = {
                includedTypes,
                locationRestriction: {
                    circle: {
                        center: { latitude: zoneLat, longitude: zoneLng },
                        radius: zoneRadius
                    }
                },
                maxResultCount: 20
            };

            try {
                const response = await fetch(baseURL, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body)
                });

                if (!response.ok) {
                    throw new Error(`Places API error: ${response.status}`);
                }

                const data = await response.json();
                return data.places || [];
            } catch (error) {
                console.error('Places API request failed:', error);
                return [];
            }
        };

        // Multi-zone: center + 4 quadrant offsets => up to 100 results
        const offset = radiusMeters * 0.0000055;
        const subRadius = radiusMeters * 0.7;

        const zones = [
            { lat, lng, radius: radiusMeters },
            { lat: lat + offset, lng: lng + offset, radius: subRadius },
            { lat: lat + offset, lng: lng - offset, radius: subRadius },
            { lat: lat - offset, lng: lng + offset, radius: subRadius },
            { lat: lat - offset, lng: lng - offset, radius: subRadius },
        ];

        const zoneResults = await Promise.all(zones.map(z => fetchZone(z.lat, z.lng, z.radius)));

        // Haversine: only keep places strictly within the original radius
        const withinRadius = (placeLat: number, placeLng: number): boolean => {
            const R = 6371000;
            const dLat = (placeLat - lat) * Math.PI / 180;
            const dLng = (placeLng - lng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(lat * Math.PI / 180) * Math.cos(placeLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= radiusMeters;
        };

        const seenIds = new Set<string>();
        const allPlaces: any[] = [];
        for (const results of zoneResults) {
            for (const place of results) {
                const id = place.id || place.displayName?.text;
                const pLat = place.location?.latitude;
                const pLng = place.location?.longitude;
                if (id && !seenIds.has(id) && pLat != null && pLng != null && withinRadius(pLat, pLng)) {
                    seenIds.add(id);
                    allPlaces.push(place);
                }
            }
        }
        return allPlaces;
    };

    // Fetch all POI types in parallel
    const [gyms, corporateOffices, parks, cafes, metroStations, busStations, apartments, vibeActive, vibeEntertainment] = await Promise.all([
        makeRequest(['gym', 'fitness_center']),
        makeRequest(['corporate_office', 'coworking_space']),
        makeRequest(['park']),
        makeRequest(['cafe', 'coffee_shop']),
        makeRequest(['subway_station', 'light_rail_station']),
        makeRequest(['bus_station']),
        makeRequest(['apartment_complex']),
        // Vibe: active lifestyle (fitness culture signal)
        makeRequest(['yoga_studio', 'sports_complex']),
        // Vibe: entertainment / social (youth congregation zones)
        makeRequest(['movie_theater', 'bar', 'night_club'])
    ]);

    return {
        gyms, corporateOffices, parks, cafes,
        metroStations, busStations, apartments,
        vibeActive, vibeEntertainment
    };
};

/**
 * Enhanced scoring with REAL Google Places data
 */
export const calculateSuitabilityWithRealData = async (
    lat: number,
    lng: number,
    searchRadiusKm: number = 1.0
): Promise<ScoringMatrix> => {
    const pois = await fetchRealPOIData(lat, lng, searchRadiusKm * 1000);
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    // log1p normalization — diminishing returns, prevents single-category overflow
    const logNorm = (count: number, sat: number) => Math.log1p(count) / Math.log1p(sat) * 100;

    const gymCount = pois.gyms.length;
    const aptCount = pois.apartments.length;
    const corpCount = pois.corporateOffices.length;
    const cafeCount = pois.cafes.length;

    // ── DEMAND (40%) — apartments lead, gyms erode up to 35% ──
    const rawApt = logNorm(aptCount, 40);  // 40 complexes → ~100
    const rawCorp = logNorm(corpCount, 30);  // 30 IT offices → ~100
    const rawCafe = logNorm(cafeCount, 30);  // 30 cafes → ~100
    const rawDemand = clamp(rawApt * 0.45 + rawCorp * 0.35 + rawCafe * 0.20);
    // Competition penalty: saturated market erodes demand by up to 35%
    const gymPenalty = logNorm(gymCount, 15) / 100 * 0.35;
    const finalDemo = clamp(rawDemand * (1 - gymPenalty));

    // ── MARKET GAP INDEX (30%) — demand-to-supply ratio ──
    // Ratio: (apts + corps*0.8) per gym — higher = more untapped demand
    const demandUnits = aptCount + (corpCount * 0.8);
    const gapRatio = demandUnits / Math.max(gymCount, 1);
    const finalGap = clamp(logNorm(gapRatio, 5)); // ratio of 5:1 → ~100

    // ── VIBE / INFRASTRUCTURE (20%) — simplified two-signal index ──
    const activeScore = logNorm(pois.vibeActive.length, 6);        // yoga + sports
    const socialScore = logNorm(pois.vibeEntertainment.length, 8); // movies + bars
    const finalVibe = clamp(activeScore * 0.55 + socialScore * 0.45);

    // ── CONNECTIVITY (10%) ──
    const metroScore = logNorm(pois.metroStations.length, 5);
    const busScore = logNorm(pois.busStations.length, 10) * 0.6;
    const finalConn = clamp(metroScore * 0.65 + busScore * 0.35);

    // ── FINAL SCORE ──
    const total = finalDemo * 0.40 + finalGap * 0.30 + finalVibe * 0.20 + finalConn * 0.10;

    console.log('📊 Scoring V2:', {
        demand: Math.round(finalDemo), gap: Math.round(finalGap),
        vibe: Math.round(finalVibe), conn: Math.round(finalConn),
        total: Math.round(total),
        gymPenalty: (gymPenalty * 100).toFixed(0) + '%',
        gapRatio: gapRatio.toFixed(2)
    });

    return {
        demographicLoad: Math.round(finalDemo),
        connectivity: Math.round(finalConn),
        competitorRatio: Math.round(finalGap),   // reuse field as Gap Index
        infrastructure: Math.round(finalVibe),
        total: Math.round(total)
    };
};

/**
 * Enhanced POI counts with real data
 */
export const getRealPOICounts = async (
    lat: number,
    lng: number,
    radiusKm: number = 1.0
): Promise<{ gyms: number; corporates: number; parks: number; cafes: number; metro: number }> => {
    const pois = await fetchRealPOIData(lat, lng, radiusKm * 1000);

    return {
        gyms: pois.gyms.length,
        corporates: pois.corporateOffices.length,
        parks: pois.parks.length,
        cafes: pois.cafes.length,
        metro: pois.metroStations.length
    };
};
