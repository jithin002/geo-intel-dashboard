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

if (!GOOGLE_PLACES_API_KEY) {
    console.error('❌ CRITICAL: Google Maps API key is missing from environment variables (VITE_GOOGLE_MAPS_API_KEY).');
} else {
    console.log(`📡 Places API Service initialized with key: ${GOOGLE_PLACES_API_KEY.slice(0, 6)}...${GOOGLE_PLACES_API_KEY.slice(-4)}`);
}

/**
 * Simple in-memory cache to prevent duplicate requests to expensive APIs.
 * Key: JSON.stringify({lat, lng, radius, types})
 * Value: {data: PlaceResult[], timestamp: number}
 */
const resultCache = new Map<string, { data: PlaceResult[], timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

/**
 * Rounds coordinate to ~10m precision to increase cache hit rate for nearby clicks.
 */
function roundCoord(c: number): number {
    return Math.round(c * 10000) / 10000;
}

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
 * Single Places API call — internal helper, max 20 results per call (API hard limit).
 */
async function nearbySearchSingle(
    lat: number,
    lng: number,
    radiusMeters: number,
    placeTypes: string[]
): Promise<PlaceResult[]> {
    const rLat = roundCoord(lat);
    const rLng = roundCoord(lng);
    const cacheKey = JSON.stringify({ lat: rLat, lng: rLng, radius: radiusMeters, types: placeTypes.sort() });

    // 1. Check Cache
    const cached = resultCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        console.log(`💎 Cache hit for ${placeTypes.join(',')} at ${rLat},${rLng}`);
        return cached.data;
    }

    const url = 'https://places.googleapis.com/v1/places:searchNearby';
    const headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY || '',
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.types,places.formattedAddress,places.businessStatus'
    };
    const body = {
        includedTypes: placeTypes,
        locationRestriction: {
            circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters }
        },
        maxResultCount: 20
    };
    try {
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Places API error: ${response.status}`, errorText);
            throw new Error(`Places API error: ${response.status}`);
        }
        const data = await response.json();
        const results = (data.places || []).map((place: any) => ({
            id: place.id,
            displayName: place.displayName?.text || 'Unknown',
            location: { lat: place.location?.latitude || 0, lng: place.location?.longitude || 0 },
            rating: place.rating,
            userRatingCount: place.userRatingCount,
            priceLevel: place.priceLevel,
            types: place.types || [],
            formattedAddress: place.formattedAddress,
            businessStatus: place.businessStatus
        }));

        // 2. Save to Cache
        resultCache.set(cacheKey, { data: results, timestamp: Date.now() });
        return results;
    } catch (error) {
        console.error('❌ Nearby search failed:', error);
        return [];
    }
}

/**
 * Nearby Search - Find places within radius.
 * Supports "Triple Pass" sampling to bypass the Google API's 20-result hard limit.
 */
export async function nearbySearch(
    lat: number,
    lng: number,
    radiusMeters: number,
    placeTypes: string[],
    densityLevel: 'standard' | 'high' | 'ultra' = 'standard'
): Promise<PlaceResult[]> {
    if (placeTypes.length === 0) return [];

    const calls: Promise<PlaceResult[]>[] = [];
    
    // Always do the full radius pass
    calls.push(nearbySearchSingle(lat, lng, radiusMeters, placeTypes));

    if (densityLevel === 'high' || densityLevel === 'ultra') {
        // High Density: Add a 50% radius pass (Max 40 results)
        calls.push(nearbySearchSingle(lat, lng, Math.round(radiusMeters * 0.5), placeTypes));
    }

    if (densityLevel === 'ultra') {
        // Ultra Density: Add a 25% and 75% radius pass (Max 80 results)
        // This is perfect for Bangalore where there are often 50+ gyms/cafes in 1km
        calls.push(nearbySearchSingle(lat, lng, Math.round(radiusMeters * 0.25), placeTypes));
        calls.push(nearbySearchSingle(lat, lng, Math.round(radiusMeters * 0.75), placeTypes));
    }

    const resultsArray = await Promise.all(calls);
    const flat = resultsArray.flat();
    
    // Deduplicate by place ID
    const seen = new Set<string>();
    const unique = flat.filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
    });

    console.log(`✅ nearbySearch [${placeTypes.join(',')}] r=${radiusMeters}m (${densityLevel} mode) → ${unique.length} unique results`);
    return unique;
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
        maxResultCount: 20
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

    console.log('🔍 Fetching POI data for location (Density-Sensitive Mode):', { lat, lng, radius: radiusMeters });

    // BALANCED: Using "HIGH" density (2-Pass Mode) for critical counts (40 limit).
    // Standard Google API is 20 results. High Mode does 2-Pass sampling to catch up to 40 results!
    const [gyms, synergy, transit, establishments, lodging] = await Promise.all([
        nearbySearch(lat, lng, radiusMeters, ['gym'], 'high'), // ✅ Gyms (Up to 40 limit)
        nearbySearch(lat, lng, radiusMeters, ['cafe', 'restaurant'], 'high'), // ✅ Cafes (Up to 40 limit)
        nearbySearch(lat, lng, radiusMeters, ['bus_station', 'light_rail_station', 'subway_station'], 'standard'),
        nearbySearch(lat, lng, radiusMeters, ['establishment'], 'high'), // Corporations (Up to 40 limit)
        nearbySearch(lat, lng, radiusMeters, ['lodging'], 'standard') // Apartments (Standard 20)
    ]);

    // Local filtering/mapping
    const cafes = synergy;
    
    // Apartments filter (from dedicated lodging quota)
    const apartments = lodging.filter(p => {
        const name = p.displayName.toLowerCase();
        return (
            name.includes('apartment') || name.includes('residency') || name.includes('residence') ||
            name.includes('homes') || name.includes('enclave') || name.includes('tower') ||
            name.includes('villa') || name.includes('flats') || name.includes('heights') ||
            name.includes('gardens')
        );
    });

    // Corporates filter (from dedicated establishment quota)
    const corporates = establishments.filter(p => {
        const name = p.displayName.toLowerCase();
        const types = p.types.map(t => t.toLowerCase());

        const isNonOffice = (
            types.includes('restaurant') || types.includes('cafe') || types.includes('food') ||
            types.includes('store') || types.includes('shopping') || types.includes('lodging') ||
            types.includes('hospital') || types.includes('school') ||
            name.includes('restaurant') || name.includes('hotel') || name.includes('cafe')
        );

        const isOffice = (
            types.includes('office') || types.includes('business') || types.includes('professional_services') ||
            name.includes('tech') || name.includes('software') || name.includes('corporate') ||
            name.includes('pvt') || name.includes('ltd') || name.includes('inc') ||
            name.includes('solutions') || name.includes('systems') || name.includes('services') ||
            name.includes('consulting')
        );

        return isOffice || (!isNonOffice && establishments.length > 50);
    });

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

    // Determine market gap
    let marketGap: 'SATURATED' | 'COMPETITIVE' | 'OPPORTUNITY' | 'UNTAPPED';
    const demandScore = corporates.length + (apartments.length * 0.5);
    const supplyScore = gyms.length;
    const ratio = supplyScore > 0 ? demandScore / supplyScore : demandScore;

    if (gyms.length === 0) marketGap = 'UNTAPPED';
    else if (ratio > 3) marketGap = 'OPPORTUNITY';
    else if (ratio > 1.5) marketGap = 'COMPETITIVE';
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
        transitStations: {
            total: transit.length,
            places: transit
        },
        apartments: {
            total: apartments.length,
            places: apartments
        },
        competitionLevel,
        marketGap
    };
}

// ============================================
// DOMAIN-AWARE INTELLIGENCE (Multi-Domain v2)
// ============================================

export interface DomainLocationIntelligence {
    competitors: {
        total: number;
        highRated: number;
        averageRating: number;
        places: PlaceResult[];
    };
    corporateOffices: { total: number; places: PlaceResult[] };
    apartments: { total: number; places: PlaceResult[] };
    infraSynergy: { total: number; places: PlaceResult[] };
    transitStations: { total: number; places: PlaceResult[] };
    competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    marketGap: 'SATURATED' | 'COMPETITIVE' | 'OPPORTUNITY' | 'UNTAPPED';
}

/**
 * Generic location intelligence that works for any domain.
 * Pass the domain's competitorTypes and infraTypes from DOMAIN_CONFIG.
 */
export async function getDomainIntelligence(
    lat: number,
    lng: number,
    radiusMeters: number,
    competitorTypes: string[],
    infraTypes: string[]
): Promise<DomainLocationIntelligence> {
    const [competitors, establishments, infra, transit, lodging] = await Promise.all([
        nearbySearch(lat, lng, radiusMeters, competitorTypes, 'high'), // ✅ Core Competitors: High mode (Up to 40 limit)
        nearbySearch(lat, lng, radiusMeters, ['establishment'], 'high'), // ✅ Offices: High mode (Up to 40 limit)
        infraTypes.length > 0
            ? nearbySearch(lat, lng, radiusMeters, infraTypes, 'standard')
            : Promise.resolve([] as PlaceResult[]),
        nearbySearch(lat, lng, radiusMeters, ['bus_station', 'light_rail_station', 'subway_station'], 'standard'),
        nearbySearch(lat, lng, radiusMeters, ['lodging'], 'standard'),
    ]);

    // Reuse same corporate filter
    const corporates = establishments.filter(p => {
        const name = p.displayName.toLowerCase();
        const types = p.types.map(t => t.toLowerCase());
        const isNonOffice = (
            types.includes('restaurant') || types.includes('cafe') || types.includes('food') ||
            types.includes('store') || types.includes('shopping') || types.includes('lodging') ||
            types.includes('hospital') || types.includes('school') ||
            name.includes('restaurant') || name.includes('hotel') || name.includes('cafe')
        );
        const isOffice = (
            types.includes('office') || types.includes('business') || types.includes('professional_services') ||
            name.includes('tech') || name.includes('software') || name.includes('corporate') ||
            name.includes('pvt') || name.includes('ltd') || name.includes('inc') ||
            name.includes('solutions') || name.includes('systems') || name.includes('services') || name.includes('consulting')
        );
        return isOffice || (!isNonOffice && establishments.length > 50);
    });

    // Reuse same apartment filter
    const apartments = lodging.filter(p => {
        const name = p.displayName.toLowerCase();
        return (
            name.includes('apartment') || name.includes('residency') || name.includes('residence') ||
            name.includes('homes') || name.includes('enclave') || name.includes('tower') ||
            name.includes('villa') || name.includes('flats') || name.includes('heights') ||
            name.includes('gardens') || name.includes('park') ||
            (!name.includes('hotel') && !name.includes('guest') && lodging.length < 20)
        );
    });

    const highRated = competitors.filter(p => p.rating && p.rating >= 4.0);
    const ratings = competitors.filter(p => p.rating).map(p => p.rating!);
    const averageRating = ratings.length > 0
        ? ratings.reduce((s, r) => s + r, 0) / ratings.length
        : 0;

    let competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    if (competitors.length <= 3) competitionLevel = 'LOW';
    else if (competitors.length <= 8) competitionLevel = 'MEDIUM';
    else if (competitors.length <= 15) competitionLevel = 'HIGH';
    else competitionLevel = 'VERY_HIGH';

    // Use ALL demand signals — corporates + apartments + transit + infra
    // Previously only used corporates+apartments which are often 0 → wrongly calling everything SATURATED
    const fullDemandScore =
        corporates.length +
        (apartments.length * 0.7) +
        (transit.length * 0.8) +
        (infra.length * 0.5);

    // A single competitor never means saturation — minimum capacity is 5
    const estimatedCapacity = Math.max(5, fullDemandScore * 1.5);
    const saturationRatio   = competitors.length / estimatedCapacity;

    let marketGap: 'SATURATED' | 'COMPETITIVE' | 'OPPORTUNITY' | 'UNTAPPED';
    if (competitors.length === 0)  marketGap = 'UNTAPPED';
    else if (saturationRatio < 0.25) marketGap = 'OPPORTUNITY';   // < 25% of capacity filled
    else if (saturationRatio < 0.6)  marketGap = 'COMPETITIVE';   // 25–60% filled
    else                             marketGap = 'SATURATED';      // > 60% filled

    return {
        competitors: {
            total: competitors.length,
            highRated: highRated.length,
            averageRating: parseFloat(averageRating.toFixed(1)),
            places: competitors,
        },
        corporateOffices: { total: corporates.length, places: corporates },
        apartments: { total: apartments.length, places: apartments },
        infraSynergy: { total: infra.length, places: infra },
        transitStations: { total: transit.length, places: transit },
        competitionLevel,
        marketGap,
    };
}

export function generateDomainRecommendation(
    intel: DomainLocationIntelligence,
    competitorLabel: string
): string {
    const { competitors, corporateOffices, infraSynergy, transitStations, marketGap, competitionLevel } = intel;

    let rec = `MARKET ASSESSMENT\n\n`;
    rec += `Competition Level: ${competitionLevel}\n`;
    rec += `Market Opportunity: ${marketGap}\n\n`;
    rec += `Found ${competitors.total} existing ${competitorLabel.toLowerCase()}`;
    if (competitors.highRated > 0) {
        const highRatedPct = Math.round((competitors.highRated / competitors.total) * 100);
        rec += ` (${competitors.highRated} rated 4+★ = ${highRatedPct}% strong competitors, avg: ${competitors.averageRating}★)`;
        if (highRatedPct > 50) rec += `\n⚠️ Majority are well-rated — quality differentiation is critical.`;
        else rec += `\n✅ Many competitors are weak-rated — quality entry has clear advantage.`;
    } else if (competitors.total > 0) {
        rec += ` — no highly-rated competitors, quality entry has strong advantage`;
    }
    rec += `\n\n`;

    rec += `DEMAND DRIVERS\n\n`;
    rec += `✅ Corporate Offices: ${corporateOffices.total}\n`;
    rec += `✅ Residential Density: ${intel.apartments.total} apartment complexes\n`;
    rec += `✅ Infra / Synergy: ${infraSynergy.total} nearby places\n`;
    rec += `✅ Transit Access: ${transitStations.total} stations\n\n`;

    rec += `STRATEGIC RECOMMENDATION\n\n`;
    if (marketGap === 'UNTAPPED') {
        rec += `🎯 FIRST-MOVER ADVANTAGE — No ${competitorLabel.toLowerCase()} detected!\n`;
        rec += `- Strong demand: ${corporateOffices.total} offices & ${intel.apartments.total} residential\n`;
        rec += `- Establish brand presence aggressively\n`;
    } else if (marketGap === 'OPPORTUNITY') {
        rec += `🟢 HIGH POTENTIAL — Good demand-to-supply ratio.\n`;
        rec += `- ${corporateOffices.total} corporates + ${intel.apartments.total} residential = strong base\n`;
        rec += `- Differentiated positioning recommended\n`;
    } else if (marketGap === 'COMPETITIVE') {
        rec += `🟡 DIFFERENTIATION REQUIRED — Moderate competition.\n`;
        rec += `- ${competitors.total} existing ${competitorLabel.toLowerCase()} in radius\n`;
        rec += `- Niche strategy or unique offering needed\n`;
    } else {
        rec += `🔴 SATURATED MARKET — High competition.\n`;
        rec += `- ${competitors.total} ${competitorLabel.toLowerCase()} competing for same customers\n`;
        rec += `- Consider 500m+ relocation or strong differentiation\n`;
    }

    if (transitStations.total > 0) {
        rec += `\nTRANSIT ADVANTAGE\n\n- ${transitStations.total} station(s) nearby → high pedestrian footfall\n`;
    }

    return rec;
}

/**
 * Generate strategic recommendation based on pure data
 * No AI needed - just logic!
 */
export function generateDataDrivenRecommendation(intel: LocationIntelligence): string {
    const { gyms, corporateOffices, cafesRestaurants, transitStations, marketGap, competitionLevel } = intel;

    let recommendation = '';

    // Market Assessment
    recommendation += `MARKET ASSESSMENT\n\n`;
    recommendation += `Competition Level: ${competitionLevel}\n`;
    recommendation += `Market Opportunity: ${marketGap}\n\n`;
    recommendation += `Found ${gyms.total} existing gyms (${gyms.highRated} rated 4+ stars, avg: ${gyms.averageRating}★)\n\n`;

    // Demand Drivers
    recommendation += `DEMAND DRIVERS\n\n`;
    recommendation += `✅ Corporate Offices: ${corporateOffices.total} (target morning/evening rush)\n`;
    recommendation += `✅ Residential Density: ${intel.apartments.total} apartment complexes nearby\n`;
    recommendation += `✅ Lifestyle Synergy: ${cafesRestaurants.total} cafes/restaurants (${cafesRestaurants.healthFocused} health-focused)\n`;
    recommendation += `✅ Transit Access: ${transitStations.total} metro/transit stations\n\n`;

    // Strategic Recommendation
    recommendation += `STRATEGIC RECOMMENDATION\n\n`;

    if (marketGap === 'UNTAPPED') {
        recommendation += `🎯 GOLD MINE OPPORTUNITY - No gyms detected! First-mover advantage.\n`;
        recommendation += `- Consider mid-tier pricing (₹1000-1500/month)\n`;
        recommendation += `- Build brand awareness aggressively\n`;
    } else if (marketGap === 'OPPORTUNITY') {
        recommendation += `🟢 HIGH POTENTIAL - Good demand-to-supply ratio.\n`;
        if (gyms.premiumCount > gyms.budgetCount) {
            recommendation += `- Gap in budget segment (₹800-1200/month)\n`;
            recommendation += `- Competition is premium-focused\n`;
        } else {
            recommendation += `- Consider premium positioning (₹1500-2500/month)\n`;
            recommendation += `- Focus on quality & amenities\n`;
        }
    } else if (marketGap === 'COMPETITIVE') {
        recommendation += `🟡 DIFFERENTIATION REQUIRED - Moderate competition.\n`;
        recommendation += `- Niche strategy needed (24/7 access, Pilates, CrossFit, Boxing)\n`;
        recommendation += `- Partner with ${corporateOffices.total} corporate offices\n`;
    } else {
        recommendation += `🔴 SATURATED MARKET - High competition.\n`;
        recommendation += `- Only viable with unique value proposition\n`;
        recommendation += `- Consider location 500m away or different niche\n`;
    }

    // Peak Hours
    recommendation += `\nPEAK HOUR RECOMMENDATIONS\n\n`;
    if (corporateOffices.total > 5) {
        recommendation += `- Morning Rush: 6:00-9:00 AM (${corporateOffices.total} corporate offices)\n`;
        recommendation += `- Evening Rush: 6:00-9:00 PM (working professionals)\n`;
    }
    if (intel.apartments.total > 10) {
        recommendation += `- Weekend Focus: High residential density supports weekend traffic\n`;
    }

    return recommendation;
}
