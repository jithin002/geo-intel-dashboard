/**
 * Google Places API Integration (New Version + Aggregate API)
 * 
 * This service integrates BOTH:
 * 1. Places API (New) - Detailed place information
 * 2. Places Aggregate API - Statistical insights and density analysis
 * 
 * No Gemini required - pure data-driven analysis!
 */

const GOOGLE_PLACES_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

// ============================================
// PLACES API (NEW) - Detailed Information
// ============================================

export interface PlaceResult {
    id: string;
    displayName: string;
    location: { lat: number; lng: number };
    rating?: number;
    userRatingCount?: number;
    priceLevel?: string;
    types: string[];
    formattedAddress?: string;
    businessStatus?: string;
}

/**
 * Nearby Search - Find places within radius
 * Uses the NEW Places API with enhanced search
 */
export async function nearbySearch(
    lat: number,
    lng: number,
    radiusMeters: number,
    placeTypes: string[],
    primaryOnly = false  // when true, uses includedPrimaryTypes (fewer false positives)
): Promise<PlaceResult[]> {
    const url = 'https://places.googleapis.com/v1/places:searchNearby';

    const headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY || '',
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.types,places.formattedAddress,places.businessStatus'
    };

    const mapPlace = (place: any): PlaceResult => ({
        id: place.id,
        displayName: place.displayName?.text || 'Unknown',
        location: {
            lat: place.location?.latitude || 0,
            lng: place.location?.longitude || 0
        },
        rating: place.rating,
        userRatingCount: place.userRatingCount,
        priceLevel: place.priceLevel,
        types: place.types || [],
        formattedAddress: place.formattedAddress,
        businessStatus: place.businessStatus
    });

    const fetchZone = async (zoneLat: number, zoneLng: number, zoneRadius: number): Promise<PlaceResult[]> => {
        const typeKey = primaryOnly ? 'includedPrimaryTypes' : 'includedTypes';
        const body = {
            [typeKey]: placeTypes,
            locationRestriction: {
                circle: {
                    center: { latitude: zoneLat, longitude: zoneLng },
                    radius: zoneRadius
                }
            },
            maxResultCount: 20
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Places API error: ${response.status}`, errorText);
                console.error(`API Key configured:`, GOOGLE_PLACES_API_KEY ? 'YES' : 'NO (MISSING!)');
                return [];
            }

            const data = await response.json();
            return (data.places || []).map(mapPlace);
        } catch (error) {
            console.error('❌ Nearby search zone failed:', error);
            return [];
        }
    };

    // Strategy: search center + 4 quadrant offsets to collect up to 100 results
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

    // Haversine to check if a place is within the original radius
    const withinRadius = (placeLat: number, placeLng: number): boolean => {
        const R = 6371000; // Earth radius in meters
        const dLat = (placeLat - lat) * Math.PI / 180;
        const dLng = (placeLng - lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat * Math.PI / 180) * Math.cos(placeLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return dist <= radiusMeters;
    };

    // Deduplicate by place ID and filter strictly to original radius
    const seenIds = new Set<string>();
    const allPlaces: PlaceResult[] = [];
    for (const results of zoneResults) {
        for (const place of results) {
            if (!seenIds.has(place.id) && withinRadius(place.location.lat, place.location.lng)) {
                seenIds.add(place.id);
                allPlaces.push(place);
            }
        }
    }

    console.log(`✅ Places API (multi-zone): ${allPlaces.length} unique places within radius for types:`, placeTypes);
    return allPlaces;
}


/**
 * Text Search - Search for places by text query
 * Example: "gyms in HSR Layout Bangalore"
 */
export async function textSearch(
    textQuery: string,
    lat?: number,
    lng?: number
): Promise<PlaceResult[]> {
    const url = 'https://places.googleapis.com/v1/places:searchText';

    const headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY || '',
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.types,places.formattedAddress'
    };

    const body: any = {
        textQuery,
        maxResultCount: 20 // Text search is capped at 20 per page by Google
    };

    // Add location bias if provided
    if (lat && lng) {
        body.locationBias = {
            circle: {
                center: { latitude: lat, longitude: lng },
                radius: 2000 // 2km bias
            }
        };
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Text search error: ${response.status}`);
        }

        const data = await response.json();
        const places = data.places || [];

        return places.map((place: any) => ({
            id: place.id,
            displayName: place.displayName?.text || 'Unknown',
            location: {
                lat: place.location?.latitude || 0,
                lng: place.location?.longitude || 0
            },
            rating: place.rating,
            userRatingCount: place.userRatingCount,
            priceLevel: place.priceLevel,
            types: place.types || [],
            formattedAddress: place.formattedAddress
        }));
    } catch (error) {
        console.error('Text search failed:', error);
        return [];
    }
}

// ============================================
// PLACES AGGREGATE API - Statistical Insights
// ============================================

export interface AggregateFilter {
    minRating?: number;
    maxRating?: number;
    priceLevel?: string; // 'PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_VERY_EXPENSIVE'
    openNow?: boolean;
    minUserRatingCount?: number;
}

export interface AggregateResult {
    count: number;
    placeIds?: string[];
    averageRating?: number;
    priceLevelDistribution?: Record<string, number>;
}

/**
 * Get aggregate statistics for places in an area
 * PERFECT for: "How many 4+ star gyms within 1km?"
 */
export async function getAggregateData(
    lat: number,
    lng: number,
    radiusMeters: number,
    placeTypes: string[],
    filters?: AggregateFilter,
    returnPlaceIds: boolean = false
): Promise<AggregateResult> {
    // Note: As of now, Places Aggregate API is in preview
    // The endpoint structure might be: https://places.googleapis.com/v1/places:aggregate
    // For now, we'll simulate it using the standard Nearby Search and post-process

    const places = await nearbySearch(lat, lng, radiusMeters, placeTypes);

    // Apply filters
    let filteredPlaces = places;

    if (filters) {
        filteredPlaces = places.filter(place => {
            if (filters.minRating && (!place.rating || place.rating < filters.minRating)) {
                return false;
            }
            if (filters.maxRating && (!place.rating || place.rating > filters.maxRating)) {
                return false;
            }
            if (filters.priceLevel && place.priceLevel !== filters.priceLevel) {
                return false;
            }
            if (filters.minUserRatingCount && (!place.userRatingCount || place.userRatingCount < filters.minUserRatingCount)) {
                return false;
            }
            if (filters.openNow) {
                return place.businessStatus === 'OPERATIONAL';
            }
            return true;
        });
    }

    // Calculate aggregate statistics
    const count = filteredPlaces.length;
    const ratings = filteredPlaces.filter(p => p.rating).map(p => p.rating!);
    const averageRating = ratings.length > 0
        ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
        : undefined;

    // Price level distribution
    const priceLevelDistribution: Record<string, number> = {};
    filteredPlaces.forEach(place => {
        if (place.priceLevel) {
            priceLevelDistribution[place.priceLevel] = (priceLevelDistribution[place.priceLevel] || 0) + 1;
        }
    });

    return {
        count,
        placeIds: returnPlaceIds ? filteredPlaces.map(p => p.id) : undefined,
        averageRating,
        priceLevelDistribution
    };
}

/**
 * Comprehensive POI Analysis for a location
 * This is what you need for gym location intelligence!
 */
export interface LocationIntelligence {
    gyms: {
        total: number;
        highRated: number; // 4+ stars
        averageRating: number;
        premiumCount: number; // Expensive price level
        budgetCount: number; // Inexpensive price level
        places: PlaceResult[];
    };
    corporateOffices: {
        total: number;
        places: PlaceResult[];
    };
    cafesRestaurants: {
        total: number;
        healthFocused: number; // Cafes/restaurants with high ratings
        places: PlaceResult[];
    };
    transitStations: {
        total: number;
        places: PlaceResult[];
    };
    apartments: {
        total: number;
        places: PlaceResult[];
    };
    vibe: {
        total: number;
        active: number;        // yoga studios, sports complexes
        entertainment: number; // bars, movie theaters, night clubs
        places: PlaceResult[];
    };
    competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    marketGap: 'SATURATED' | 'COMPETITIVE' | 'OPPORTUNITY' | 'UNTAPPED';
}

/**
 * Get comprehensive location intelligence
 * This replaces the need for Gemini with pure data analysis!
 */
export async function getLocationIntelligence(
    lat: number,
    lng: number,
    radiusMeters: number = 1000
): Promise<LocationIntelligence> {

    console.log('🔍 Fetching POI data for location:', { lat, lng, radius: radiusMeters });

    // Transit split: metro stations (high value) vs bus stops (lower value)
    const [gyms, corporates, cafes, metroTransit, busTransit, apartments] = await Promise.all([
        nearbySearch(lat, lng, radiusMeters, ['gym']),

        // Corporates: primaryOnly=true cuts false positives (malls, hotels, mixed-use buildings)
        Promise.all([
            nearbySearch(lat, lng, radiusMeters, ['corporate_office'], true),
            nearbySearch(lat, lng, radiusMeters, ['coworking_space'], true),
        ]).then(([offices, coworking]) => {
            const seenIds = new Set<string>();
            const merged: PlaceResult[] = [];
            for (const list of [offices, coworking]) {
                for (const p of list) {
                    if (!seenIds.has(p.id)) { seenIds.add(p.id); merged.push(p); }
                }
            }
            console.log(`  🏢 Corporates (primary only): ${offices.length} offices + ${coworking.length} coworking = ${merged.length} total`);
            return merged;
        }),


        // Cafes only — no restaurants (butcher shops, dhabas, etc. all excluded)
        nearbySearch(lat, lng, radiusMeters, ['cafe', 'coffee_shop']),

        // Metro/rail stations (high connectivity weight)
        nearbySearch(lat, lng, radiusMeters, ['subway_station', 'light_rail_station']),

        // Bus stops — bus_station = major terminal only; bus_stop covers individual BMTC stops
        nearbySearch(lat, lng, radiusMeters, ['bus_station', 'bus_stop', 'transit_station']),

        // Apartments: apartment_complex only — residential_complex is invalid in Places API
        nearbySearch(lat, lng, radiusMeters, ['apartment_complex']).then(apts => {
            console.log(`  🏘️ Apartments: ${apts.length} apartment_complex found`);
            return apts;
        })
    ]);

    // Merge metro + bus into transit for backward compatibility
    const transit = [...metroTransit, ...busTransit];
    console.log(`  🚇 Metro: ${metroTransit.length} | 🚌 Bus/Stop: ${busTransit.length} | 🚦 Transit total: ${transit.length}`);

    // Fetch vibe POIs
    const [vibeActive, vibeEntertainment] = await Promise.all([
        nearbySearch(lat, lng, radiusMeters, ['yoga_studio', 'sports_complex']),
        nearbySearch(lat, lng, radiusMeters, ['movie_theater', 'bar', 'night_club'])
    ]);

    // Log final POI counts
    console.log('✅ POI DETECTION RESULTS:');
    console.log(`  🏋️ Gyms: ${gyms.length}`);
    console.log(`  🏢 Corporates: ${corporates.length}`);
    console.log(`  ☕ Cafes: ${cafes.length}`);
    console.log(`  🚇 Transit: ${transit.length}`);
    console.log(`  🏘️ Apartments: ${apartments.length}`);

    if (corporates.length === 0) {
        console.warn('⚠️ NO CORPORATES FOUND - May need broader search criteria');
    }
    if (apartments.length === 0) {
        console.warn('⚠️ NO APARTMENTS FOUND - May need broader search criteria');
    }

    // Analyze gyms
    const highRatedGyms = gyms.filter(g => g.rating && g.rating >= 4.0);
    const premiumGyms = gyms.filter(g =>
        g.priceLevel === 'PRICE_LEVEL_EXPENSIVE' ||
        g.priceLevel === 'PRICE_LEVEL_VERY_EXPENSIVE'
    );
    const budgetGyms = gyms.filter(g =>
        g.priceLevel === 'PRICE_LEVEL_INEXPENSIVE' ||
        g.priceLevel === 'PRICE_LEVEL_FREE'
    );
    const gymRatings = gyms.filter(g => g.rating).map(g => g.rating!);
    const averageGymRating = gymRatings.length > 0
        ? gymRatings.reduce((sum, r) => sum + r, 0) / gymRatings.length
        : 0;

    // Determine competition level
    let competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    if (gyms.length === 0) competitionLevel = 'LOW';
    else if (gyms.length <= 3) competitionLevel = 'LOW';
    else if (gyms.length <= 6) competitionLevel = 'MEDIUM';
    else if (gyms.length <= 10) competitionLevel = 'HIGH';
    else competitionLevel = 'VERY_HIGH';

    // Market gap — calibrated demand:supply ratio
    let marketGap: 'SATURATED' | 'COMPETITIVE' | 'OPPORTUNITY' | 'UNTAPPED';
    const demandUnits = corporates.length + (apartments.length * 0.8);
    const ratio = gyms.length > 0 ? demandUnits / gyms.length : demandUnits;

    if (gyms.length === 0) marketGap = 'UNTAPPED';
    else if (ratio > 4) marketGap = 'OPPORTUNITY';
    else if (ratio > 2) marketGap = 'COMPETITIVE';
    else marketGap = 'SATURATED';

    // Analyze cafes
    const healthFocusedCafes = cafes.filter(c =>
        c.rating && c.rating >= 4.0 &&
        (c.displayName.toLowerCase().includes('health') ||
            c.displayName.toLowerCase().includes('juice') ||
            c.displayName.toLowerCase().includes('salad'))
    );

    return {
        gyms: {
            total: gyms.length,
            highRated: highRatedGyms.length,
            averageRating: parseFloat(averageGymRating.toFixed(1)),
            premiumCount: premiumGyms.length,
            budgetCount: budgetGyms.length,
            places: gyms
        },
        corporateOffices: {
            total: corporates.length,
            places: corporates
        },
        cafesRestaurants: {
            total: cafes.length,
            healthFocused: healthFocusedCafes.length,
            places: cafes
        },
        transitStations: { total: transit.length, places: transit },
        apartments: { total: apartments.length, places: apartments },
        vibe: {
            total: vibeActive.length + vibeEntertainment.length,
            active: vibeActive.length,       // yoga studios, sports complexes
            entertainment: vibeEntertainment.length, // bars, clubs, cinemas
            places: [...vibeActive, ...vibeEntertainment]
        },
        competitionLevel,
        marketGap
    };
}

/**
 * Generate strategic recommendation based on pure data
 * No AI needed - just logic!
 */
export function generateDataDrivenRecommendation(
    intel: LocationIntelligence,
    scores?: { demographicLoad: number; competitorRatio: number; infrastructure: number; connectivity: number; total: number }
): string {
    const { gyms, corporateOffices, cafesRestaurants, transitStations, apartments } = intel;
    const gap = scores?.competitorRatio ?? 0;
    const demand = scores?.demographicLoad ?? 0;
    const vibe = scores?.infrastructure ?? 0;
    const conn = scores?.connectivity ?? 0;

    let rec = '';

    // ── GEO-GROUNDED STRATEGY ──
    rec += `GEO-GROUNDED STRATEGY\n\n`;

    // Demand signals
    if (apartments.total > 0)
        rec += `✅ Residential Density: ${apartments.total} apartment complexes nearby\n`;
    if (cafesRestaurants.total > 0)
        rec += `✅ Lifestyle Synergy: ${cafesRestaurants.total} cafes/restaurants (${cafesRestaurants.healthFocused} health-focused)\n`;
    if (transitStations.total > 0)
        rec += `✅ Transit Access: ${transitStations.total} metro/transit stations\n`;
    if (corporateOffices.total > 0)
        rec += `✅ Office Proximity: ${corporateOffices.total} corporate/coworking offices\n`;

    rec += `\nSTRATEGIC RECOMMENDATION\n\n`;

    // Score-driven headline
    if (gap >= 75) {
        rec += `🎯 GOLD MINE — Gap Index ${gap}/100. Strong demand, low competition.\n`;
        rec += `- Demand score ${demand}/100 backed by ${apartments.total} apt complexes + ${cafesRestaurants.total} cafes\n`;
        rec += gyms.total === 0
            ? `- No direct competitors detected — first-mover advantage\n`
            : `- Only ${gyms.total} gym(s) serving this demand pool\n`;
    } else if (gap >= 55) {
        rec += `🟢 HIGH POTENTIAL — Gap Index ${gap}/100. Room to capture market.\n`;
        rec += `- Demand score ${demand}/100 — ${apartments.total} residential complexes as primary catchment\n`;
        if (gyms.premiumCount > gyms.budgetCount) {
            rec += `- ${gyms.premiumCount} premium gyms dominate → budget tier (₹800-1200/month) is underserved\n`;
        } else {
            rec += `- ${gyms.budgetCount} budget gyms dominate → premium segment (₹1500-2500/month) has headroom\n`;
        }
    } else if (gap >= 35) {
        rec += `🟡 COMPETITIVE — Gap Index ${gap}/100. Differentiation required.\n`;
        rec += `- ${gyms.total} gyms already serving this area (demand:gym ratio is tight)\n`;
        rec += `- Vibe score ${vibe}/100 — ${vibe > 50 ? 'strong youth culture signals → niche positioning works' : 'moderate lifestyle signals → community-first strategy'}\n`;
        rec += `- Consider: 24/7 access, women-only, CrossFit, or Pilates studio model\n`;
    } else {
        rec += `🔴 SATURATED — Gap Index ${gap}/100. High risk.\n`;
        rec += `- ${gyms.total} gyms competing for ${apartments.total} apt complexes — market is crowded\n`;
        rec += `- Consider a site 500m+ away, or a highly differentiated concept\n`;
    }

    // Connectivity insight
    if (conn > 50) {
        rec += `\n⚡ Connectivity ${conn}/100 — good transit access supports walk-in traffic\n`;
    } else if (conn > 20) {
        rec += `\n🚌 Connectivity ${conn}/100 — moderate access, parking availability matters\n`;
    }

    // Peak hour guidance
    rec += `\nPEAK HOUR FIT\n`;
    if (apartments.total > 10)
        rec += `- Morning (6-9 AM) & Evening (6-9 PM) — residential catchment drives utilization\n`;
    if (corporateOffices.total > 5)
        rec += `- Lunch slots viable — ${corporateOffices.total} offices within radius\n`;

    return rec;
}

