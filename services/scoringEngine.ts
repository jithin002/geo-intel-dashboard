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
 * Normalizes a count against a saturation limit to yield a 0-100 score.
 * Example: if limit is 40, and count is 40+, score is 100.
 * If count is 0, score is 0.
 * The scaling is logarithmic so the first few POIs matter more than the later ones.
 */
function logNorm(count: number, limit: number): number {
    // Guard: if limit is 0 or count/limit is non-finite, return 0 instead of NaN
    if (!limit || limit <= 0) return 0;
    const result = (Math.log1p(count) / Math.log1p(limit)) * 100;
    return isFinite(result) ? result : 0;
}

function clampScore(val: number): number {
    // Guard: NaN / Infinity should resolve to 0, not propagate
    if (!isFinite(val) || isNaN(val)) return 0;
    return Math.max(0, Math.min(100, Math.round(val)));
}

/**
 * Generic Domain Scoring Engine
 * Decoupled from React to ensure pure business logic
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

    // Extract raw counts (safely handling both interfaces)
    const competitorsCt = isGymStruct ? (intel as any).gyms?.total || 0 : (intel as any).competitors?.total || 0;
    const apartmentsCt = intel.apartments?.total || 0;
    const officesCt = (intel as any).corporateOffices?.total || 0;
    const transitCt = (intel as any).transitStations?.total || 0;

    const effectiveCompetitorsCt = competitorsCt;

    let infraCt = 0;
    if (domainId === 'gym') {
        infraCt = (intel as any).vibe?.total || 0;
    } else if (domainId === 'restaurant') {
        // specific generic intel
        infraCt = (intel as any).infraSynergy?.total || 0;
    } else {
        infraCt = (intel as any).infraSynergy?.total || 0;
    }

    // Advanced Connectivity Breakdown (Metro vs Bus)
    // Real implementation would inspect transit types, but fallback to total if unavailable
    const transitPlaces = (intel as any).transitStations?.places || [];
    const metroCt = transitPlaces.filter((p: any) => p.types?.some((t: string) => t.includes('subway') || t.includes('light_rail'))).length;
    const busCt = transitCt - metroCt;

    // --- Scoring Computations using domain configuration saturation limits ---

    // 1. Demand Score
    let demandRaw = 0;
    if (domainId === 'gym') {
        demandRaw = logNorm(apartmentsCt, 40) * 0.55 + logNorm(officesCt, 30) * 0.20 + logNorm(infraCt, 30) * 0.25;
    } else if (domainId === 'restaurant') {
        // Students (universities) extracted from infraSynergy; transit adds commuter demand
        const universities = (intel as any).infraSynergy?.places?.filter(
            (p: any) => p.types?.includes('university')
        )?.length || 0;
        demandRaw = logNorm(apartmentsCt, config.scoring.demand.saturationLimit) * 0.35
            + logNorm(officesCt, config.scoring.demand.saturationLimit) * 0.40
            + logNorm(universities, 5) * 0.15   // cap at 5; beyond that it's noise
            + logNorm(transitCt, 8) * 0.10;      // transit stops → commuter lunch/dinner traffic
    } else if (domainId === 'bank') {
        demandRaw = logNorm(apartmentsCt, config.scoring.demand.saturationLimit) * 0.50
            + logNorm(officesCt, config.scoring.demand.saturationLimit) * 0.50;
    } else if (domainId === 'retail') {
        demandRaw = logNorm(apartmentsCt, config.scoring.demand.saturationLimit) * 0.60
            + logNorm(officesCt, config.scoring.demand.saturationLimit) * 0.40;
    }
    const demandScore = clampScore(demandRaw);

    // 2. Connectivity Score
    // Metros generally carry much more weight than busses
    const connRaw = logNorm(metroCt, config.scoring.connectivity.saturationLimit) * 0.65
        + logNorm(busCt, config.scoring.connectivity.saturationLimit * 2) * 0.35;
    const connScore = clampScore(connRaw);

    // 3. Gap Score (Supply vs Demand)
    // How many demand units are there for every competitor?
    // High gap score = High opportunity (low competition)
    const demandUnits = apartmentsCt + (officesCt * 0.8) + (infraCt * 0.5);
    // effectiveCompetitorsCt = 4★+ rated count for restaurants; full count for other domains
    const gapRatio = demandUnits / Math.max(effectiveCompetitorsCt, 1);
    const gapRaw = logNorm(gapRatio, config.scoring.gap.saturationLimit);
    const gapScore = clampScore(gapRaw);

    // 4. Infrastructure / Vibe Score
    const infraRaw = logNorm(infraCt, config.scoring.infra.saturationLimit);
    const infraScore = clampScore(infraRaw);

    // 5. Total Weighted Score
    const totalScore = clampScore(
        demandScore * config.scoring.demand.weight +
        connScore * config.scoring.connectivity.weight +
        gapScore * config.scoring.gap.weight +
        infraScore * config.scoring.infra.weight
    );

    return {
        demographicLoad: demandScore || 0,
        connectivity: connScore || 0,
        competitorRatio: gapScore || 0,
        infrastructure: infraScore || 0,
        total: totalScore || 0,
    };
}
