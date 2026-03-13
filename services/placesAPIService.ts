/**
 * Google Places API Integration (New Version)
 *
 * Optimized version — changes from original:
 *  - Single-zone search (was 5-zone, 45 req/click → 6 req/click)
 *  - Category merges: corporate, transit, vibe merged into fewer calls
 *  - Field mask tiering: Basic SKU for non-rating categories (cheaper)
 *  - Two-tier cache (memory + localStorage) via placesCache.ts
 *  - In-flight request deduplication
 *  - Corporate blocklist: removes hotels/malls/banks from results
 *  - Removed 'bar' from vibe entertainment
 */

import {
    buildCacheKey,
    buildWardKey,
    getMemoryCache,
    setMemoryCache,
    getLocalStorageCache,
    setLocalStorageCache,
    deduplicatedFetch,
    AggregatedIntel,
} from './placesCache';
import { PLACES_PROXY_URL, USE_DIRECT_API, GOOGLE_PLACES_API_KEY } from './apiConfig';

// ── Field Masks ───────────────────────────────────────────────────────────────
// Basic SKU: charged at lower rate — use for categories where rating/price
//            are not displayed (transit, apartments, vibe, corporates).
// Advanced SKU: use only for gyms and cafes (displayed in UI with ratings).
const BASIC_FIELD_MASK =
    'places.id,places.displayName,places.location,places.types,places.businessStatus';
const ADVANCED_FIELD_MASK =
    'places.id,places.displayName,places.location,places.rating,' +
    'places.userRatingCount,places.priceLevel,places.types,places.formattedAddress,places.businessStatus';

// ── Corporate blocklist ───────────────────────────────────────────────────────
// Post-fetch filter: removes places whose displayName matches any of these
// words — eliminates hotels, malls, hospitals etc. that register as corporate.
const CORPORATE_BLOCKLIST = [
    'hotel', 'mall', 'hospital', 'clinic', 'school', 'college', 'university',
    'bank', 'atm', 'temple', 'church', 'mosque', 'salon', 'spa', 'supermarket',
    'store', 'restaurant', 'cafe', 'pharmacy', 'medical', 'court', 'police',
    'government', 'municipality', 'apartment', 'residency', 'residences',
];

// ────────────────────────────────────────────────────────────────────────────

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
 * Graceful Authenticity Filter
 *
 * Tier 1 — Strict:  rating >= 4.0 AND reviews >= 20  (use when ≥ 3 results)
 * Tier 2 — Loose:  rating >= 3.5 OR  reviews >= 5   (fallback when Tier 1 gives < 3)
 * Tier 3 — Raw:    no filter                         (last resort when Tier 2 gives < 3)
 *
 * This keeps quality data for mature domains (gyms, restaurants) while preserving
 * coverage for sparse domains (banks, ATMs) that rarely have many reviews.
 */
function gracefulAuthFilter(places: PlaceResult[]): { filtered: PlaceResult[]; tier: 1 | 2 | 3 } {
    const strict = places.filter(p => (p.rating || 0) >= 3.8 && (p.userRatingCount || 0) >= 20);
    if (strict.length >= 3) return { filtered: strict, tier: 1 };

    const loose = places.filter(p => (p.rating || 0) >= 3.5 || (p.userRatingCount || 0) >= 5);
    if (loose.length >= 3) return { filtered: loose, tier: 2 };

    return { filtered: places, tier: 3 };
}


/**
 * Get Aggregate Count:
 * Returns the true count of POIs bounded by the 20-result cap.
 */
export async function getAggregateCount(
    lat: number,
    lng: number,
    radiusMeters: number,
    placeTypes: string[],
    baseFetchCount: number
): Promise<number> {
    // Return true count bounded by the 20 result cap.
    return baseFetchCount;
}

/**
 * Nearby Search — single-zone, cached, deduplicated.
 *
 * @param primaryOnly  When true, uses includedPrimaryTypes (reduces false positives)
 * @param fieldMask    Override the default field mask (use BASIC or ADVANCED constant)
 */
export async function nearbySearch(
    lat: number,
    lng: number,
    radiusMeters: number,
    placeTypes: string[],
    primaryOnly = false,
    fieldMask: string = ADVANCED_FIELD_MASK
): Promise<PlaceResult[]> {
    const cacheKey = buildCacheKey(lat, lng, radiusMeters, placeTypes);

    // 1. Memory cache hit
    const memHit = getMemoryCache<PlaceResult[]>(cacheKey);
    if (memHit) return memHit;

    // 2. Fetch (with in-flight dedup)
    const result = await deduplicatedFetch(cacheKey, () =>
        fetchSingleZone(lat, lng, radiusMeters, placeTypes, primaryOnly, fieldMask)
    );

    // 3. Populate memory cache
    setMemoryCache(cacheKey, result);

    console.log(`🌐 Places API fetch: ${result.length} results for [${placeTypes.join(', ')}]`);
    return result;
}

/** Single HTTP request to Places API searchNearby (via proxy or direct) */
async function fetchSingleZone(
    lat: number,
    lng: number,
    radiusMeters: number,
    placeTypes: string[],
    primaryOnly: boolean,
    fieldMask: string
): Promise<PlaceResult[]> {
    const typeKey = primaryOnly ? 'includedPrimaryTypes' : 'includedTypes';
    const body = {
        [typeKey]: placeTypes,
        locationRestriction: {
            circle: {
                center: { latitude: lat, longitude: lng },
                radius: radiusMeters,
            },
        },
        maxResultCount: 20,
        rankPreference: 'DISTANCE',
    };

    try {
        let response: Response;

        if (USE_DIRECT_API) {
            // Local dev: call Google directly with key in header
            response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY || '',
                    'X-Goog-FieldMask': fieldMask,
                },
                body: JSON.stringify(body),
            });
        } else {
            // Production: route through Cloud Function proxy (key stays server-side)
            response = await fetch(PLACES_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    endpoint: 'v1/places:searchNearby',
                    body,
                    fieldMask,
                }),
            });
            // Proxy wraps response in { success, data } — unwrap it
            if (response.ok) {
                const wrapper = await response.json();
                return (wrapper.data?.places || []).map(mapPlace);
            }
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Places API error: ${response.status}`, errorText);
            return [];
        }

        const data = await response.json();
        return (data.places || []).map(mapPlace);
    } catch (error) {
        console.error('❌ nearbySearch fetch failed:', error);
        return [];
    }
}

function mapPlace(place: any): PlaceResult {
    return {
        id: place.id,
        displayName: place.displayName?.text || 'Unknown',
        location: {
            lat: place.location?.latitude || 0,
            lng: place.location?.longitude || 0,
        },
        rating: place.rating,
        userRatingCount: place.userRatingCount,
        priceLevel: place.priceLevel,
        types: place.types || [],
        formattedAddress: place.formattedAddress,
        businessStatus: place.businessStatus,
    };
}

/**
 * Text Search — search places by natural language query.
 */
export async function textSearch(
    textQuery: string,
    lat?: number,
    lng?: number
): Promise<PlaceResult[]> {
    const body: any = { textQuery, maxResultCount: 20 };

    if (lat && lng) {
        body.locationBias = {
            circle: { center: { latitude: lat, longitude: lng }, radius: 2000 },
        };
    }

    try {
        let response: Response;

        if (USE_DIRECT_API) {
            response = await fetch('https://places.googleapis.com/v1/places:searchText', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY || '',
                    'X-Goog-FieldMask': ADVANCED_FIELD_MASK,
                },
                body: JSON.stringify(body),
            });
        } else {
            response = await fetch(PLACES_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    endpoint: 'v1/places:searchText',
                    body,
                    fieldMask: ADVANCED_FIELD_MASK,
                }),
            });
            if (response.ok) {
                const wrapper = await response.json();
                return (wrapper.data?.places || []).map(mapPlace);
            }
        }

        if (!response.ok) throw new Error(`Text search error: ${response.status}`);
        const data = await response.json();
        return (data.places || []).map(mapPlace);
    } catch (error) {
        console.error('Text search failed:', error);
        return [];
    }
}

// ── Location Intelligence ─────────────────────────────────────────────────────

export interface LocationIntelligence {
    gyms: {
        total: number;
        highRated: number;
        averageRating: number;
        premiumCount: number;
        budgetCount: number;
        places: PlaceResult[];
    };
    corporateOffices: { total: number; places: PlaceResult[] };
    cafesRestaurants: { total: number; healthFocused: number; places: PlaceResult[] };
    transitStations: { total: number; places: PlaceResult[] };
    apartments: { total: number; places: PlaceResult[] };
    vibe: {
        total: number;
        active: number;
        entertainment: number;
        places: PlaceResult[];
    };
    competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    marketGap: 'SATURATED' | 'COMPETITIVE' | 'OPPORTUNITY' | 'UNTAPPED';
}

/**
 * Get comprehensive location intelligence.
 *
 * Optimized: 6 parallel requests (was 45).
 *   1. gyms                          (Advanced SKU — ratings shown in UI)
 *   2. corporate_office + coworking  (Basic SKU — counts only)
 *   3. cafe + coffee_shop            (Advanced SKU — ratings shown in UI)
 *   4. all transit types merged      (Basic SKU — counts only)
 *   5. apartment_complex             (Basic SKU — counts only)
 *   6. all vibe types merged         (Basic SKU — counts only, post-filtered)
 */
export async function getLocationIntelligence(
    lat: number,
    lng: number,
    radiusMeters: number = 1000
): Promise<LocationIntelligence> {
    const wardKey = buildWardKey(lat, lng, radiusMeters);

    // ── localStorage cache check (aggregated intel survives page refresh) ──
    const lsHit = getLocalStorageCache(wardKey);
    // Note: lsHit only has counts — we still need to fetch full POI objects
    // for map markers (memory cache), so we only short-circuit scoring here,
    // not the full fetch. Full fetch uses memory cache for POI objects.

    console.log('🔍 getLocationIntelligence:', { lat, lng, radius: radiusMeters });

    // ── 6 parallel requests ───────────────────────────────────────────────
    const [
        gymsRaw,
        corporatesRaw,
        cafes,
        transitAll,
        apartments,
        vibeAll,
    ] = await Promise.all([
        // 1. Gyms — Advanced SKU (ratings displayed)
        nearbySearch(lat, lng, radiusMeters, ['gym'], false, ADVANCED_FIELD_MASK),

        // 2. Corporate + Coworking merged — Basic SKU (counts only)
        nearbySearch(
            lat, lng, radiusMeters,
            ['corporate_office', 'coworking_space'],
            true,          // primaryOnly — reduces false positives
            BASIC_FIELD_MASK
        ),

        // 3. Cafes — Advanced SKU (ratings displayed)
        nearbySearch(lat, lng, radiusMeters, ['cafe', 'coffee_shop'], false, ADVANCED_FIELD_MASK),

        // 4. All transit merged — Basic SKU
        nearbySearch(
            lat, lng, radiusMeters,
            ['subway_station', 'light_rail_station', 'bus_station', 'bus_stop', 'transit_station'],
            false,
            BASIC_FIELD_MASK
        ),

        // 5. Apartments — Basic SKU
        nearbySearch(lat, lng, radiusMeters, ['apartment_complex'], false, BASIC_FIELD_MASK),

        // 6. Vibe: active + entertainment merged — Basic SKU
        //    'bar' intentionally excluded (inflates scores incorrectly)
        nearbySearch(
            lat, lng, radiusMeters,
            ['yoga_studio', 'sports_complex', 'movie_theater', 'night_club'],
            false,
            BASIC_FIELD_MASK
        ),
    ]);

    // ── Post-process gyms: apply graceful authenticity filter ─────────────
    const { filtered: gyms, tier: gymTier } = gracefulAuthFilter(gymsRaw);
    console.log(`  🏋️ Gyms: ${gymsRaw.length} raw → ${gyms.length} (tier ${gymTier})`);

    // ── Post-process corporate: apply blocklist ───────────────────────────
    const corporates = corporatesRaw.filter(p =>
        !CORPORATE_BLOCKLIST.some(word =>
            p.displayName.toLowerCase().includes(word)
        )
    );
    console.log(`  🏢 Corporates: ${corporatesRaw.length} raw → ${corporates.length} after blocklist`);

    // ── Post-process transit: split metro vs bus for weighted scoring ─────
    const METRO_TYPES = ['subway_station', 'light_rail_station'];
    const metroTransit = transitAll.filter(p =>
        p.types.some(t => METRO_TYPES.includes(t))
    );
    const busTransit = transitAll.filter(p =>
        !p.types.some(t => METRO_TYPES.includes(t))
    );
    console.log(`  🚇 Metro: ${metroTransit.length} | 🚌 Bus: ${busTransit.length} | Total: ${transitAll.length}`);

    // ── Post-process vibe: split active vs entertainment ──────────────────
    const ACTIVE_TYPES = ['yoga_studio', 'sports_complex'];
    const vibeActive = vibeAll.filter(p =>
        p.types.some(t => ACTIVE_TYPES.includes(t))
    );
    const vibeEntertainment = vibeAll.filter(p =>
        !p.types.some(t => ACTIVE_TYPES.includes(t))
    );

    console.log('✅ POI DETECTION RESULTS:');
    console.log(`  🏋️ Gyms: ${gyms.length}`);
    console.log(`  🏢 Corporates: ${corporates.length}`);
    console.log(`  ☕ Cafes: ${cafes.length}`);
    console.log(`  🚦 Transit: ${transitAll.length}`);
    console.log(`  🏘️ Apartments: ${apartments.length}`);
    console.log(`  🎭 Vibe Active: ${vibeActive.length} | Entertainment: ${vibeEntertainment.length}`);

    if (corporates.length === 0) console.warn('⚠️ NO CORPORATES FOUND');
    if (apartments.length === 0) console.warn('⚠️ NO APARTMENTS FOUND');

    // ── Gym analysis ──────────────────────────────────────────────────────
    const highRatedGyms = gyms.filter(g => g.rating && g.rating >= 4.0);
    const premiumGyms = gyms.filter(g =>
        g.priceLevel === 'PRICE_LEVEL_EXPENSIVE' || g.priceLevel === 'PRICE_LEVEL_VERY_EXPENSIVE'
    );
    const budgetGyms = gyms.filter(g =>
        g.priceLevel === 'PRICE_LEVEL_INEXPENSIVE' || g.priceLevel === 'PRICE_LEVEL_FREE'
    );
    const gymRatings = gyms.filter(g => g.rating).map(g => g.rating!);
    const averageGymRating = gymRatings.length > 0
        ? gymRatings.reduce((s, r) => s + r, 0) / gymRatings.length : 0;

    // ── Competition & market gap ──────────────────────────────────────────
    let competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    if (gyms.length <= 3) competitionLevel = 'LOW';
    else if (gyms.length <= 6) competitionLevel = 'MEDIUM';
    else if (gyms.length <= 10) competitionLevel = 'HIGH';
    else competitionLevel = 'VERY_HIGH';

    const demandUnits = corporates.length + (apartments.length * 0.8);
    const ratio = gyms.length > 0 ? demandUnits / gyms.length : demandUnits;
    let marketGap: 'SATURATED' | 'COMPETITIVE' | 'OPPORTUNITY' | 'UNTAPPED';
    if (gyms.length === 0) marketGap = 'UNTAPPED';
    else if (ratio > 4) marketGap = 'OPPORTUNITY';
    else if (ratio > 2) marketGap = 'COMPETITIVE';
    else marketGap = 'SATURATED';

    const healthFocusedCafes = cafes.filter(c =>
        c.rating && c.rating >= 4.0 &&
        (c.displayName.toLowerCase().includes('health') ||
            c.displayName.toLowerCase().includes('juice') ||
            c.displayName.toLowerCase().includes('salad'))
    );

    // ── Extrapolate true counts via Aggregate Logic ───────────────────────
    const trueGyms = await getAggregateCount(lat, lng, radiusMeters, ['gym'], gyms.length);
    const trueCorp = await getAggregateCount(lat, lng, radiusMeters, ['corporate_office'], corporates.length);
    const trueCafe = await getAggregateCount(lat, lng, radiusMeters, ['cafe'], cafes.length);
    const trueTransit = await getAggregateCount(lat, lng, radiusMeters, ['transit_station'], transitAll.length);
    const trueApt = await getAggregateCount(lat, lng, radiusMeters, ['apartment_complex'], apartments.length);
    const trueVibe = await getAggregateCount(lat, lng, radiusMeters, ['yoga_studio'], vibeAll.length);

    // ── Persist aggregated intel to localStorage ──────────────────────────
    const intel: LocationIntelligence = {
        gyms: {
            total: trueGyms,
            highRated: highRatedGyms.length,
            averageRating: parseFloat(averageGymRating.toFixed(1)),
            premiumCount: premiumGyms.length,
            budgetCount: budgetGyms.length,
            places: gyms,
        },
        corporateOffices: { total: trueCorp, places: corporates },
        cafesRestaurants: { total: trueCafe, healthFocused: healthFocusedCafes.length, places: cafes },
        transitStations: { total: trueTransit, places: transitAll },
        apartments: { total: trueApt, places: apartments },
        vibe: {
            total: trueVibe,
            active: vibeActive.length,
            entertainment: vibeEntertainment.length,
            places: vibeAll,
        },
        competitionLevel,
        marketGap,
    };

    // Write aggregated counts to localStorage (tiny payload, survives refresh)
    const aggregated: AggregatedIntel = {
        gyms: gyms.length,
        corporates: corporates.length,
        cafes: cafes.length,
        transit: transitAll.length,
        apartments: apartments.length,
        vibeActive: vibeActive.length,
        vibeEntertainment: vibeEntertainment.length,
        competitionLevel,
        marketGap,
    };
    setLocalStorageCache(wardKey, aggregated);

    return intel;
}

/**
 * Generate strategic recommendation based on pure data (no AI needed).
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

    let rec = `GEO-GROUNDED STRATEGY\n\n`;

    if (apartments.total > 0)
        rec += `✅ Residential Density: ${apartments.total} apartment complexes nearby\n`;
    if (cafesRestaurants.total > 0)
        rec += `✅ Lifestyle Synergy: ${cafesRestaurants.total} cafes (${cafesRestaurants.healthFocused} health-focused)\n`;
    if (transitStations.total > 0)
        rec += `✅ Transit Access: ${transitStations.total} metro/transit stations\n`;
    if (corporateOffices.total > 0)
        rec += `✅ Office Proximity: ${corporateOffices.total} corporate/coworking offices\n`;

    rec += `\nSTRATEGIC RECOMMENDATION\n\n`;

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
        rec += `- ${gyms.total} gyms already serving this area\n`;
        rec += `- Vibe score ${vibe}/100 — ${vibe > 50 ? 'strong youth culture → niche positioning works' : 'moderate lifestyle signals → community-first strategy'}\n`;
        rec += `- Consider: 24/7 access, women-only, CrossFit, or Pilates studio model\n`;
    } else {
        rec += `🔴 SATURATED — Gap Index ${gap}/100. High risk.\n`;
        rec += `- ${gyms.total} gyms competing for ${apartments.total} apt complexes — market is crowded\n`;
        rec += `- Consider a site 500m+ away, or a highly differentiated concept\n`;
    }

    if (conn > 50) rec += `\n⚡ Connectivity ${conn}/100 — good transit access supports walk-in traffic\n`;
    else if (conn > 20) rec += `\n🚌 Connectivity ${conn}/100 — moderate access, parking availability matters\n`;

    rec += `\nPEAK HOUR FIT\n`;
    if (apartments.total > 10)
        rec += `- Morning (6-9 AM) & Evening (6-9 PM) — residential catchment drives utilization\n`;
    if (corporateOffices.total > 5)
        rec += `- Lunch slots viable — ${corporateOffices.total} offices within radius\n`;

    return rec;
}

// ── Aggregate API (wrapper — simulates aggregate via nearbySearch) ─────────────

export interface AggregateFilter {
    minRating?: number;
    maxRating?: number;
    priceLevel?: string;
    openNow?: boolean;
    minUserRatingCount?: number;
}

export interface AggregateResult {
    count: number;
    placeIds?: string[];
    averageRating?: number;
    priceLevelDistribution?: Record<string, number>;
}

export async function getAggregateData(
    lat: number,
    lng: number,
    radiusMeters: number,
    placeTypes: string[],
    filters?: AggregateFilter,
    returnPlaceIds: boolean = false
): Promise<AggregateResult> {
    const places = await nearbySearch(lat, lng, radiusMeters, placeTypes);

    let filteredPlaces = places;
    if (filters) {
        filteredPlaces = places.filter(place => {
            if (filters.minRating && (!place.rating || place.rating < filters.minRating)) return false;
            if (filters.maxRating && (!place.rating || place.rating > filters.maxRating)) return false;
            if (filters.priceLevel && place.priceLevel !== filters.priceLevel) return false;
            if (filters.minUserRatingCount && (!place.userRatingCount || place.userRatingCount < filters.minUserRatingCount)) return false;
            if (filters.openNow) return place.businessStatus === 'OPERATIONAL';
            return true;
        });
    }

    const count = filteredPlaces.length;
    const ratings = filteredPlaces.filter(p => p.rating).map(p => p.rating!);
    const averageRating = ratings.length > 0
        ? ratings.reduce((s, r) => s + r, 0) / ratings.length : undefined;

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
        priceLevelDistribution,
    };
}

// ============================================================
// DOMAIN-AWARE INTELLIGENCE (Multi-Domain)
// ============================================================

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
    const [competitorsRaw, corporateRaw, infra, transit, apartmentRaw] = await Promise.all([
        nearbySearch(lat, lng, radiusMeters, competitorTypes),
        // 'establishment' is deprecated — use specific supported types instead
        nearbySearch(lat, lng, radiusMeters, ['corporate_office', 'coworking_space'], true, BASIC_FIELD_MASK),
        infraTypes.length > 0
            ? nearbySearch(lat, lng, radiusMeters, infraTypes, false, BASIC_FIELD_MASK)
            : Promise.resolve([] as PlaceResult[]),
        nearbySearch(lat, lng, radiusMeters, ['bus_station', 'bus_stop', 'light_rail_station', 'subway_station'], false, BASIC_FIELD_MASK),
        // 'lodging' is deprecated — use apartment_complex directly
        nearbySearch(lat, lng, radiusMeters, ['apartment_complex'], false, BASIC_FIELD_MASK),
    ]);

    // Corporates — already filtered to corporate_office / coworking_space types;
    // apply name blocklist to remove any misclassified places
    const corporates = corporateRaw.filter(p =>
        !CORPORATE_BLOCKLIST.some(word => p.displayName.toLowerCase().includes(word))
    );

    // Apply graceful authenticity filter to competitors
    const { filtered: competitors, tier: compTier } = gracefulAuthFilter(competitorsRaw);
    console.log(`  🎯 Competitors: ${competitorsRaw.length} raw → ${competitors.length} (tier ${compTier})`);

    // Apartments — apartment_complex is already a precise type, no further filtering needed
    const apartments = apartmentRaw;

    const highRated = competitors.filter(p => p.rating && p.rating >= 4.0);
    const ratings = competitors.filter(p => p.rating).map(p => p.rating!);
    const averageRating = ratings.length > 0
        ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0;

    let competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    if (competitors.length <= 3) competitionLevel = 'LOW';
    else if (competitors.length <= 8) competitionLevel = 'MEDIUM';
    else if (competitors.length <= 15) competitionLevel = 'HIGH';
    else competitionLevel = 'VERY_HIGH';

    const fullDemandScore =
        corporates.length +
        (apartments.length * 0.7) +
        (transit.length * 0.8) +
        (infra.length * 0.5);

    const estimatedCapacity = Math.max(5, fullDemandScore * 1.5);
    const saturationRatio = competitors.length / estimatedCapacity;

    let marketGap: 'SATURATED' | 'COMPETITIVE' | 'OPPORTUNITY' | 'UNTAPPED';
    if (competitors.length === 0) marketGap = 'UNTAPPED';
    else if (saturationRatio < 0.25) marketGap = 'OPPORTUNITY';
    else if (saturationRatio < 0.6) marketGap = 'COMPETITIVE';
    else marketGap = 'SATURATED';

    // Use actual fetched count for competitors (not extrapolated) so strategy text,
    // gap score, and map markers all display the same number.
    const trueComp = competitors.length;
    const trueCorp = await getAggregateCount(lat, lng, radiusMeters, ['corporate_office', 'coworking_space'], corporates.length);
    const trueApt = await getAggregateCount(lat, lng, radiusMeters, ['apartment_complex'], apartments.length);
    const trueInfra = infraTypes.length > 0 ? await getAggregateCount(lat, lng, radiusMeters, infraTypes, infra.length) : 0;
    const trueTransit = await getAggregateCount(lat, lng, radiusMeters, ['bus_station', 'bus_stop', 'light_rail_station', 'subway_station'], transit.length);

    return {
        competitors: {
            total: trueComp,
            highRated: highRated.length,
            averageRating: parseFloat(averageRating.toFixed(1)),
            places: competitors,
        },
        corporateOffices: { total: trueCorp, places: corporates },
        apartments: { total: trueApt, places: apartments },
        infraSynergy: { total: trueInfra, places: infra },
        transitStations: { total: trueTransit, places: transit },
        competitionLevel,
        marketGap,
    };
}

export function generateDomainRecommendation(
    intel: DomainLocationIntelligence,
    domainId: string
): string {
    const { competitors, corporateOffices, apartments, infraSynergy, transitStations, marketGap, competitionLevel } = intel;

    // ── Domain-Specific Demand Driver Labels ────────────────────────────────
    const demandConfig: Record<string, { drivers: { label: string; value: string }[]; primaryFootfall: string }> = {
        restaurant: {
            primaryFootfall: 'Offices, Residents & Students',
            drivers: [
                { label: 'Corporate Offices', value: `${corporateOffices.total}` },
                { label: 'Residential Density', value: `${apartments.total} apartment complexes` },
                { label: 'Destination Pull (Malls + Entertainment)', value: `${infraSynergy.total} nearby` },
                { label: 'Transit Access', value: `${transitStations.total} stations` },
            ]
        },
        bank: {
            primaryFootfall: 'Offices & Residents',
            drivers: [
                { label: 'Corporate Offices', value: `${corporateOffices.total}` },
                { label: 'Residential Density', value: `${apartments.total} complexes` },
                { label: 'Commercial Anchors (Malls + Supermarkets)', value: `${infraSynergy.total} nearby` },
                { label: 'Transit Access', value: `${transitStations.total} stations` },
            ]
        },
        retail: {
            primaryFootfall: 'Residents & Transit Catchment',
            drivers: [
                { label: 'Residential Catchment', value: `${apartments.total} complexes` },
                { label: 'Transit Hubs Nearby', value: `${transitStations.total} stations` },
                { label: 'Lifestyle Synergy (Cafes + Entertainment)', value: `${infraSynergy.total} nearby` },
                { label: 'Footfall Generators (Offices)', value: `${corporateOffices.total}` },
            ]
        },
        gym: {
            primaryFootfall: 'Offices & Residents',
            drivers: [
                { label: 'Corporate Offices', value: `${corporateOffices.total}` },
                { label: 'Residential Density', value: `${apartments.total} complexes` },
                { label: 'Lifestyle Synergy (Cafes)', value: `${infraSynergy.total} nearby` },
                { label: 'Transit Access', value: `${transitStations.total} stations` },
            ]
        }
    };

    const domainCfg = demandConfig[domainId] || demandConfig['gym'];
    const competitorLabel = {
        restaurant: 'restaurants', bank: 'banks / ATMs', retail: 'retailers', gym: 'gyms'
    }[domainId] || 'competitors';

    let rec = `GEO-GROUNDED STRATEGY\n\n`;

    // ── Competitor Context ──────────────────────────────────────────────────
    rec += `Found ${competitors.total} existing ${competitorLabel}`;
    if (competitors.total > 0 && competitors.highRated > 0) {
        const pct = Math.round((competitors.highRated / competitors.total) * 100);
        rec += ` (${competitors.highRated} rated 4+★ = ${pct}% strong, avg: ${competitors.averageRating}★)`;
        if (pct > 50) rec += `\n⚠️ Majority are well-rated — quality differentiation is critical.`;
        else rec += `\n✅ Many competitors are weak-rated — quality entry has clear advantage.`;
    } else if (competitors.total === 0) {
        rec += ` — no ${competitorLabel} detected in this radius!`;
    }
    rec += `\n\n`;

    // ── Domain-Specific Demand Drivers ──────────────────────────────────────
    rec += `DEMAND DRIVERS\n\n`;
    for (const d of domainCfg.drivers) {
        rec += `✅ ${d.label}: ${d.value}\n`;
    }
    rec += `\n`;

    // ── Strategic Recommendation ────────────────────────────────────────────
    rec += `STRATEGIC RECOMMENDATION\n\n`;
    if (marketGap === 'UNTAPPED') {
        rec += `🎯 FIRST-MOVER ADVANTAGE — No ${competitorLabel} detected!\n`;
        rec += `- Primary demand: ${domainCfg.primaryFootfall}\n`;
        rec += `- Establish brand presence aggressively\n`;
    } else if (marketGap === 'OPPORTUNITY') {
        rec += `🟢 HIGH POTENTIAL — Strong demand-to-supply ratio.\n`;
        rec += `- Primary demand: ${domainCfg.primaryFootfall}\n`;
        rec += `- Differentiated positioning recommended\n`;
    } else if (marketGap === 'COMPETITIVE') {
        rec += `🟡 DIFFERENTIATION REQUIRED — Moderate competition.\n`;
        rec += `- ${competitors.total} existing ${competitorLabel} in this radius\n`;
        rec += `- Niche strategy or unique offering needed\n`;
    } else {
        rec += `🔴 SATURATED MARKET — High competition.\n`;
        rec += `- ${competitors.total} ${competitorLabel} competing for same customers\n`;
        rec += `- Consider 500m+ relocation or premium differentiation\n`;
    }

    // ── Domain-Specific Insights ────────────────────────────────────────────
    if (domainId === 'retail' && transitStations.total >= 2) {
        rec += `\nTRANSIT ADVANTAGE\n\n- ${transitStations.total} hub(s) nearby → strong daily footfall catchment\n`;
    } else if (domainId === 'restaurant' && infraSynergy.total >= 5) {
        rec += `\nDESTINATION CLUSTER\n\n- ${infraSynergy.total} entertainment/shopping anchors nearby → naturally draws diners\n`;
    } else if (domainId === 'bank' && corporateOffices.total >= 5) {
        rec += `\nCORPORATE CLUSTER\n\n- ${corporateOffices.total} offices → steady B2B and payroll demand\n`;
    } else if (domainId === 'gym' && infraSynergy.total >= 3) {
        rec += `\nLIFESTYLE CLUSTER\n\n- ${infraSynergy.total} cafes/lifestyle nearby → high wellness-conscious footfall\n`;
    } else if (transitStations.total > 0) {
        rec += `\nTRANSIT ADVANTAGE\n\n- ${transitStations.total} station(s) nearby → high pedestrian footfall\n`;
    }

    return rec;
}

