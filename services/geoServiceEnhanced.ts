
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
    apartments: any[];
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
            gyms: [],
            corporateOffices: [],
            parks: [],
            cafes: [],
            metroStations: [],
            apartments: []
        };
    }

    const baseURL = 'https://places.googleapis.com/v1/places:searchNearby';

    // Common headers for new Places API
    const headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.location,places.types,places.rating,places.userRatingCount'
    };

    const makeRequest = async (includedTypes: string[]) => {
        const body = {
            includedTypes,
            locationRestriction: {
                circle: {
                    center: { latitude: lat, longitude: lng },
                    radius: radiusMeters
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

    // Fetch all POI types in parallel
    const [gyms, corporateOffices, parks, cafes, metroStations, apartments] = await Promise.all([
        makeRequest(['gym', 'fitness_center']),
        makeRequest(['office', 'corporate_office']),
        makeRequest(['park']),
        makeRequest(['cafe', 'restaurant']),
        makeRequest(['transit_station', 'subway_station']),
        makeRequest(['apartment_building', 'residential_complex'])
    ]);

    return {
        gyms,
        corporateOffices,
        parks,
        cafes,
        metroStations,
        apartments
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
    // Fetch real POI data
    const pois = await fetchRealPOIData(lat, lng, searchRadiusKm * 1000);

    // Initialize scores
    let demographicLoad = 30;
    let connectivity = 20;
    let competitorDensity = 0;
    let infrastructure = 20;

    // Process GYMS (Competitors)
    pois.gyms.forEach((gym: any) => {
        if (!gym.location) return;
        const dist = getDistance(lat, lng, gym.location.latitude, gym.location.longitude);
        if (dist < searchRadiusKm) {
            const weight = searchRadiusKm < 1 ? 45 : 30;
            competitorDensity += (searchRadiusKm - dist) * weight;
        }
    });

    // Process CORPORATE OFFICES (Demand)
    pois.corporateOffices.forEach((office: any) => {
        if (!office.location) return;
        const dist = getDistance(lat, lng, office.location.latitude, office.location.longitude);
        if (dist < searchRadiusKm) {
            demographicLoad += (searchRadiusKm - dist) * (150 / searchRadiusKm);
        }
    });

    // Process APARTMENTS (Residential Demand)
    pois.apartments.forEach((apt: any) => {
        if (!apt.location) return;
        const dist = getDistance(lat, lng, apt.location.latitude, apt.location.longitude);
        if (dist < searchRadiusKm) {
            demographicLoad += (searchRadiusKm - dist) * (120 / searchRadiusKm);
        }
    });

    // Process PARKS (Lifestyle Synergy)
    pois.parks.forEach((park: any) => {
        if (!park.location) return;
        const dist = getDistance(lat, lng, park.location.latitude, park.location.longitude);
        if (dist < searchRadiusKm * 0.8) {
            infrastructure += (searchRadiusKm * 0.8 - dist) * (140 / searchRadiusKm);
        }
    });

    // Process CAFES (Lifestyle Synergy)
    pois.cafes.forEach((cafe: any) => {
        if (!cafe.location) return;
        const dist = getDistance(lat, lng, cafe.location.latitude, cafe.location.longitude);
        if (dist < searchRadiusKm * 0.8) {
            infrastructure += (searchRadiusKm * 0.8 - dist) * (80 / searchRadiusKm);
        }
    });

    // Process METRO STATIONS (Connectivity)
    pois.metroStations.forEach((station: any) => {
        if (!station.location) return;
        const dist = getDistance(lat, lng, station.location.latitude, station.location.longitude);
        if (dist < searchRadiusKm * 1.5) {
            connectivity += (searchRadiusKm * 1.5 - dist) * (60 / searchRadiusKm);
        }
    });

    // Calculate final scores
    const competitorRatio = Math.max(0, 100 - competitorDensity);
    const clamp = (v: number) => Math.max(0, Math.min(100, v));

    const finalDemo = clamp(demographicLoad);
    const finalConn = clamp(connectivity);
    const finalComp = clamp(finalDemo > 80 ? competitorRatio + 15 : competitorRatio);
    const finalInfra = clamp(infrastructure);

    const total = (finalDemo * 0.45) + (finalConn * 0.1) + (finalComp * 0.25) + (finalInfra * 0.2);

    return {
        demographicLoad: Math.round(finalDemo),
        connectivity: Math.round(finalConn),
        competitorRatio: Math.round(finalComp),
        infrastructure: Math.round(finalInfra),
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
