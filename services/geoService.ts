
import { GeoPoint, ScoringMatrix, LocationType } from '../types';
import { MOCK_LOCATIONS } from '../constants';

/**
 * Advanced Geospatial Scoring Logic v2:
 * Includes Commercial (Corporate), Green Spaces (Parks), and Residential Density.
 */

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

export const calculateSuitability = (lat: number, lng: number, searchRadiusKm: number = 1.0): ScoringMatrix => {
  // Base scores adjusted for the specific catchment size
  let demographicLoad = 30; // Base population score
  let connectivity = 20;    
  let competitorDensity = 0;
  let infrastructure = 20;  // Lifestyle score

  // Heuristic thresholds scale with the search radius
  const synergyThreshold = searchRadiusKm * 0.8;
  const connectivityThreshold = searchRadiusKm * 1.5;
  const demandThreshold = searchRadiusKm * 1.0;

  MOCK_LOCATIONS.forEach(loc => {
    const dist = getDistance(lat, lng, loc.lat, loc.lng);
    
    // Only consider points within the selected search radius + small buffer for context
    if (dist > searchRadiusKm * 1.2) return;

    // 1. COMPETITOR DENSITY (Negative)
    if (loc.type === LocationType.GYM && dist < searchRadiusKm) {
      // High penalty for direct proximity
      const weight = searchRadiusKm < 1 ? 45 : 30;
      competitorDensity += (searchRadiusKm - dist) * weight; 
    }

    // 2. DEMAND GENERATORS (Positive)
    // Corporate/Tech Parks: Critical for Morning/Evening peak
    if (loc.type === LocationType.CORPORATE && dist < demandThreshold) {
      demographicLoad += (demandThreshold - dist) * (150 / searchRadiusKm);
    }
    // Residential High Rises: Critical for consistency
    if (loc.type === LocationType.HIGH_RISE && dist < demandThreshold) {
      demographicLoad += (demandThreshold - dist) * (120 / searchRadiusKm);
    }

    // 3. INFRASTRUCTURE & SYNERGY (Positive)
    // Parks: Indicates health-conscious neighborhood
    if (loc.type === LocationType.PARK && dist < synergyThreshold) {
      infrastructure += (synergyThreshold - dist) * (140 / searchRadiusKm);
    }
    // Lifestyle (Cafes, etc.)
    if (loc.type === LocationType.SYNERGY && dist < synergyThreshold) {
      infrastructure += (synergyThreshold - dist) * (80 / searchRadiusKm);
    }

    // 4. CONNECTIVITY
    if (loc.type === LocationType.METRO && dist < connectivityThreshold) {
      connectivity += (connectivityThreshold - dist) * (60 / searchRadiusKm);
    }
  });

  // Calculate Competitor Ratio as a "Market Gap"
  const competitorRatio = Math.max(0, 100 - competitorDensity);

  // Clamp values to 0-100 range
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  
  const finalDemo = clamp(demographicLoad);
  const finalConn = clamp(connectivity);
  const finalComp = clamp(finalDemo > 80 ? competitorRatio + 15 : competitorRatio); // High demand offsets competition
  const finalInfra = clamp(infrastructure);

  // Weighted Average: Demand is King (45%), then Competition (25%)
  const total = (finalDemo * 0.45) + (finalConn * 0.1) + (finalComp * 0.25) + (finalInfra * 0.2);

  return {
    demographicLoad: Math.round(finalDemo),
    connectivity: Math.round(finalConn),
    competitorRatio: Math.round(finalComp),
    infrastructure: Math.round(finalInfra),
    total: Math.round(total)
  };
};
