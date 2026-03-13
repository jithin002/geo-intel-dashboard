
export enum LocationType {
  GYM = 'gym',
  SYNERGY = 'synergy',      // Starbucks, Health Cafes
  METRO = 'metro',          // Transit
  HIGH_RISE = 'high_rise',  // Residential Density
  CORPORATE = 'corporate',  // Tech Parks/Offices (New)
  PARK = 'park'             // Green Spaces/Jogging Tracks (New)
}

export interface GeoPoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  type: LocationType;
  details?: string;
}

export interface ScoringMatrix {
  demographicLoad: number; // Residents + Corporate
  connectivity: number;   // Transit + Accessibility
  competitorRatio: number; // Market Void
  infrastructure: number;  // Lifestyle Synergy
  total: number;
}

export interface SiteAnalysis {
  point: GeoPoint;
  score: ScoringMatrix;
  recommendation: string;
}
