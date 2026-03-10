import { DomainConfig, DOMAIN_CONFIG, DomainId } from '../domains';
import { DomainLocationIntelligence, LocationIntelligence } from './placesAPIService';

export interface CalculatedScores {
    demographicLoad: number;
    connectivity: number;
    competitorRatio: number;
    infrastructure: number;
    total: number;
}

/**
 * Linear normalisation: count / limit, capped at 100.
 * Half the cap → half the score (50%), unlike log which gave 78%.
 * This accurately reflects what the raw API count represents.
 */
function linearNorm(count: number, limit: number): number {
    if (!limit || limit <= 0) return 0;
    const result = (count / limit) * 100;
    return isFinite(result) ? result : 0;
}

function clampScore(val: number): number {
    // Guard: NaN / Infinity should resolve to 0, not propagate
    if (!isFinite(val) || isNaN(val)) return 0;
    return Math.max(0, Math.min(100, Math.round(val)));
}

// ─── Value-Weighted Counting Generators ──────────────────────────────

/**
 * Calculates distance in meters between two lat/lng points using the Haversine formula.
 */
function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth radius in meters
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Transforms an array of PlaceResults into an "Effective Count" instead of a flat raw count.
 * 1. Distance Falloff: Places closer to the pin count for more (up to 1.0). Places at the edge count for less (~0.1).
 * 2. Quality Adjustment: If supportRating is true, highly rated places (>3.5 & 5+ reviews) get a +5% bump. Poor get -5%.
 */
function calculateEffectiveCount(
    places: any[],
    centerLat: number,
    centerLng: number,
    searchRadius: number,
    supportRating: boolean = false
): number {
    if (!places || places.length === 0) return 0;

    let effectiveTotal = 0;

    for (const p of places) {
        if (!p.location || !p.location.lat || !p.location.lng) {
            effectiveTotal += 0.5; // fallback
            continue;
        }

        // 1. Distance Falloff (Gravity Model)
        const dist = getDistanceMeters(centerLat, centerLng, p.location.lat, p.location.lng);
        // Clamp distance to radius just in case API returns something slightly outside
        const clampedDist = Math.min(dist, searchRadius);
        // Weight: 1.0 at center, 0.4 at the very edge (eased from 0.1 so edge places still hold value)
        let weight = 1.0 - (0.6 * (clampedDist / Math.max(searchRadius, 1)));

        // 2. Softened Quality Adjustment (only if SKU supported)
        if (supportRating) {
            // Respecting user request: 3.5 is the threshold for a "good" place
            if (p.rating !== undefined && p.userRatingCount && p.userRatingCount >= 5) {
                if (p.rating >= 3.5) {
                    weight *= 1.05; // +5% bonus
                } else {
                    weight *= 0.95; // -5% penalty
                }
            }
        }

        effectiveTotal += weight;
    }

    return effectiveTotal;
}

/**
 * Generic Domain Scoring Engine
 * Decoupled from React to ensure pure business logic
 *
 * Calibration notes (v2):
 *  - Switched from logarithmic → linear scaling so 10/20 cap = 50% score (not 78%)
 *  - Added saturation penalty: oversupplied markets lose 10-25 pts from totalScore
 *  - No virtual scaling: we score actual API counts as-is for accuracy
 */
export function calculateDomainScores(
    intel: DomainLocationIntelligence | LocationIntelligence,
    domainId: DomainId,
    searchRadiusMeters: number
): CalculatedScores {
    const config = DOMAIN_CONFIG[domainId];
    if (!config) throw new Error(`Domain ${domainId} not found in config`);

    // Ensure we handle both the 'gym' intel structure and the generic 'domain' intel structure
    const isGymStruct = 'gyms' in intel;

    // Determine center pin coordinates from the first valid place (as a generic fallback),
    // or assume the intel object contains the original search center if available.
    // For this module, we will extract the center from the first POI found as a proxy
    // since the strict center lat/lng isn't passed down to standard scoring functions yet.
    // However, App.tsx passes searchRadiusMeters now. We will extract a proxy center.
    let cLat = 0, cLng = 0;
    const allPlaces = [
        ...(isGymStruct ? (intel as any).gyms?.places || [] : []),
        ...((intel as any).competitors?.places || []),
        ...(intel.apartments?.places || [])
    ];
    if (allPlaces.length > 0 && allPlaces[0].location) {
        cLat = allPlaces[0].location.lat;
        cLng = allPlaces[0].location.lng;
    }

    // Extract Value-Weighted Effective Counts (safely handling both interfaces)
    const competitorsPlaces = isGymStruct ? (intel as any).gyms?.places || [] : (intel as any).competitors?.places || [];
    const competitorsCt = calculateEffectiveCount(competitorsPlaces, cLat, cLng, searchRadiusMeters, true);

    const apartmentsCt = calculateEffectiveCount(intel.apartments?.places || [], cLat, cLng, searchRadiusMeters, false);
    const officesCt = calculateEffectiveCount((intel as any).corporateOffices?.places || [], cLat, cLng, searchRadiusMeters, false);

    // Transit is evaluated slightly differently later, but we capture the base places
    const transitPlaces = (intel as any).transitStations?.places || [];
    const transitCt = calculateEffectiveCount(transitPlaces, cLat, cLng, searchRadiusMeters, false);

    let infraCt = 0;
    if (domainId === 'gym') {
        infraCt = calculateEffectiveCount((intel as any).vibe?.places || [], cLat, cLng, searchRadiusMeters, true);
    } else {
        infraCt = calculateEffectiveCount((intel as any).infraSynergy?.places || [], cLat, cLng, searchRadiusMeters, true);
    }

    // Connectivity: separate metro (high value) from bus, still using effective counting
    const metroPlaces = transitPlaces.filter((p: any) =>
        p.types?.some((t: string) => t.includes('subway') || t.includes('light_rail'))
    );
    const busPlaces = transitPlaces.filter((p: any) =>
        !p.types?.some((t: string) => t.includes('subway') || t.includes('light_rail'))
    );
    const metroCt = calculateEffectiveCount(metroPlaces, cLat, cLng, searchRadiusMeters, false);
    const busCt = calculateEffectiveCount(busPlaces, cLat, cLng, searchRadiusMeters, false);

    // ─── 1. Demand Score ────────────────────────────────────────────────────
    let demandRaw = 0;
    const dLimit = config.scoring.demand.saturationLimit;

    if (domainId === 'gym') {
        demandRaw = linearNorm(apartmentsCt, dLimit) * 0.55
            + linearNorm(officesCt, dLimit) * 0.20
            + linearNorm(infraCt, dLimit) * 0.25;
    } else if (domainId === 'restaurant') {
        const universities = (intel as any).infraSynergy?.places?.filter(
            (p: any) => p.types?.includes('university')
        )?.length || 0;
        demandRaw = linearNorm(apartmentsCt, dLimit) * 0.35
            + linearNorm(officesCt, dLimit) * 0.40
            + linearNorm(universities, 5) * 0.15
            + linearNorm(transitCt, 8) * 0.10;
    } else if (domainId === 'bank') {
        demandRaw = linearNorm(apartmentsCt, dLimit) * 0.50
            + linearNorm(officesCt, dLimit) * 0.50;
    } else if (domainId === 'retail') {
        demandRaw = linearNorm(apartmentsCt, dLimit) * 0.60
            + linearNorm(officesCt, dLimit) * 0.40;
    }
    const demandScore = clampScore(demandRaw);

    // ─── 2. Connectivity Score ──────────────────────────────────────────────
    const cLimit = config.scoring.connectivity.saturationLimit;
    const connRaw = linearNorm(metroCt, cLimit) * 0.65
        + linearNorm(busCt, cLimit * 2) * 0.35;
    const connScore = clampScore(connRaw);

    // ─── 3. Gap Score (Supply vs Demand) ────────────────────────────────────
    // gapRatio: how many demand units per competitor (higher = more opportunity)
    const demandUnits = apartmentsCt + (officesCt * 0.8) + (infraCt * 0.5);
    const gapRatio = demandUnits / Math.max(competitorsCt, 1);
    const gapRaw = linearNorm(gapRatio, config.scoring.gap.saturationLimit);
    const gapScore = clampScore(gapRaw);

    // ─── 4. Infrastructure / Vibe Score ─────────────────────────────────────
    const infraRaw = linearNorm(infraCt, config.scoring.infra.saturationLimit);
    const infraScore = clampScore(infraRaw);

    // ─── 5. Weighted Total ───────────────────────────────────────────────────
    let totalRaw =
        demandScore * config.scoring.demand.weight +
        connScore * config.scoring.connectivity.weight +
        gapScore * config.scoring.gap.weight +
        infraScore * config.scoring.infra.weight;

    // ─── 6. Saturation Penalty ──────────────────────────────────────────────
    // Over-competition makes a location risky even with high demand.
    // This pulls saturated markets out of the artificially high zone.
    //   gapRatio < 1 → severe oversupply (more competitors than demand units) → -25 pts
    //   gapRatio < 2 → high competition (narrow market)                       → -10 pts
    let saturationPenalty = 0;
    if (gapRatio < 1) {
        saturationPenalty = 25;
    } else if (gapRatio < 2) {
        saturationPenalty = 10;
    }
    totalRaw = Math.max(0, totalRaw - saturationPenalty);

    const totalScore = clampScore(totalRaw);

    return {
        demographicLoad: demandScore || 0,
        connectivity: connScore || 0,
        competitorRatio: gapScore || 0,
        infrastructure: infraScore || 0,
        total: totalScore || 0,
    };
}
