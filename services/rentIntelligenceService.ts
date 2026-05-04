/**
 * rentIntelligenceService.ts
 * Fetches commercial rent insights from the local Express API server (server.cjs)
 * which queries BigQuery using ST_DWithin spatial SQL.
 */

const API_BASE = 'http://localhost:3001';

export interface RentComparable {
  title: string;
  monthly_rent: number;
  area_sqft: number;
  price_per_sqft: number;
  listing_url: string;
}

export interface RentInsights {
  avg_rent: number;       // ₹ per sqft per month
  min_rent: number;
  max_rent: number;
  sample_size: number;
  comparables: RentComparable[];
  domain: string;
  radius: number;
}

// Domain name mapping from app domain IDs to BigQuery domain_type values
const DOMAIN_MAP: Record<string, string> = {
  gym:        'Retail',
  restaurant: 'Retail',
  bank:       'Bank',
  retail:     'Retail',
};

/**
 * Fetches rent intelligence for a given lat/lng, radius, and domain.
 * Returns null if the local API is unavailable (graceful degradation).
 */
export async function getRentInsights(
  lat: number,
  lng: number,
  radiusMeters: number = 5000,
  domainId: string = 'retail'
): Promise<RentInsights | null> {
  try {
    const domain = DOMAIN_MAP[domainId] || 'Retail';
    const url = `${API_BASE}/api/rent-insights?lat=${lat}&lng=${lng}&radius=${radiusMeters}&domain=${domain}`;
    
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    
    if (!response.ok) {
      console.warn('[RentIntelligence] API returned error:', response.status);
      return null;
    }

    const data = await response.json();

    return {
      avg_rent:    Number(data.avg_rent)  || 0,
      min_rent:    Number(data.min_rent)  || 0,
      max_rent:    Number(data.max_rent)  || 0,
      sample_size: Number(data.sample_size) || 0,
      comparables: Array.isArray(data.comparables) ? data.comparables : [],
      domain,
      radius: radiusMeters,
    };
  } catch {
    // API is offline — return null so the UI degrades gracefully 
    console.warn('[RentIntelligence] Local API unavailable. Run: node server.cjs');
    return null;
  }
}
