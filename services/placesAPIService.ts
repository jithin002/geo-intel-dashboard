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
    placeTypes: string[]
): Promise<PlaceResult[]> {
    const url = 'https://places.googleapis.com/v1/places:searchNearby';

    const headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY || '',
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.types,places.formattedAddress,places.businessStatus'
    };

    const body = {
        includedTypes: placeTypes,
        locationRestriction: {
            circle: {
                center: { latitude: lat, longitude: lng },
                radius: radiusMeters
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
            console.error(`Request URL:`, url);
            console.error(`Request body:`, body);
            throw new Error(`Places API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const places = data.places || [];

        console.log(`✅ Places API Success: Found ${places.length} places for types:`, placeTypes);

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
            formattedAddress: place.formattedAddress,
            businessStatus: place.businessStatus
        }));
    } catch (error) {
        console.error('❌ Nearby search failed:', error);
        console.error(`Check: 1) Is Places API (New) enabled? 2) Is API key valid? 3) Are there IP restrictions?`);
        return [];
    }
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

    // Fetch all data in parallel (PARKS REMOVED per user request)
    // UPDATED: Using valid, broader POI types for better data coverage
    // Reference: https://developers.google.com/maps/documentation/places/web-service/place-types

    console.log('🔍 Fetching POI data for location:', { lat, lng, radius: radiusMeters });

    const [gyms, corporates, cafes, transit, apartments] = await Promise.all([
        nearbySearch(lat, lng, radiusMeters, ['gym']),  // Valid: gym

        // Corporates: Use 'establishment' (broad) - RELAXED FILTERING
        // Accept most establishments as potential offices, exclude only obvious non-offices
        nearbySearch(lat, lng, radiusMeters, ['establishment']).then(all => {
            const filtered = all.filter(p => {
                const name = p.displayName.toLowerCase();
                const types = p.types.map(t => t.toLowerCase());

                // EXCLUDE obvious non-offices
                const isNonOffice = (
                    types.includes('restaurant') ||
                    types.includes('cafe') ||
                    types.includes('food') ||
                    types.includes('store') ||
                    types.includes('shopping') ||
                    types.includes('lodging') ||
                    types.includes('hospital') ||
                    types.includes('school') ||
                    name.includes('restaurant') ||
                    name.includes('hotel') ||
                    name.includes('cafe')
                );

                // INCLUDE if has office-like characteristics OR if not obviously non-office
                const isOffice = (
                    types.includes('office') ||
                    types.includes('business') ||
                    types.includes('professional_services') ||
                    name.includes('tech') ||
                    name.includes('software') ||
                    name.includes('corporate') ||
                    name.includes('pvt') ||
                    name.includes('ltd') ||
                    name.includes('inc') ||
                    name.includes('solutions') ||
                    name.includes('systems') ||
                    name.includes('services') ||
                    name.includes('consulting')
                );

                return isOffice || (!isNonOffice && all.length > 50); // If many results, be more selective
            });
            console.log(`  🏢 Corporates: ${all.length} establishments → ${filtered.length} filtered as offices`);
            return filtered;
        }),

        nearbySearch(lat, lng, radiusMeters, ['cafe', 'restaurant']),  // Valid: cafe, restaurant
        nearbySearch(lat, lng, radiusMeters, ['bus_station', 'light_rail_station', 'subway_station']),  // Valid transit types

        // Apartments: Use 'lodging' - RELAXED FILTERING
        nearbySearch(lat, lng, radiusMeters, ['lodging']).then(all => {
            const filtered = all.filter(p => {
                const name = p.displayName.toLowerCase();
                return (
                    name.includes('apartment') ||
                    name.includes('residency') ||
                    name.includes('residence') ||
                    name.includes('homes') ||
                    name.includes('enclave') ||
                    name.includes('tower') ||
                    name.includes('villa') ||
                    name.includes('flats') ||
                    name.includes('heights') ||
                    name.includes('gardens') ||
                    name.includes('park') || // Many apt complexes have 'Park' in name
                    (!name.includes('hotel') && !name.includes('guest') && all.length < 20) // If few results, be lenient
                );
            });
            console.log(`  🏘️ Apartments: ${all.length} lodging → ${filtered.length} filtered as apartments`);
            return filtered;
        })
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
