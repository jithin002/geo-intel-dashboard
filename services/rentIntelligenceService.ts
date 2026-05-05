/**
 * rentIntelligenceService.ts
 * Fetches commercial rent insights and individual listing pins from the local
 * Express API server (server.cjs) which queries BigQuery using ST_DWithin.
 */

const API_BASE = 'http://localhost:3001';

// ── Interfaces ────────────────────────────────────────────────────────────────

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

export interface RentListing {
  listing_id: string;
  title: string;
  locality: string;
  domain_type: string;
  monthly_rent: number;
  area_sqft: number;
  price_per_sqft: number;
  listing_url: string;
  lat: number;
  lng: number;
}

// ── Domain mapping — distinct per business type ───────────────────────────────

const DOMAIN_MAP: Record<string, string> = {
  gym:        'Retail',    // Ground-floor shops/showrooms
  restaurant: 'Retail',   // Ground-floor shops/showrooms
  bank:       'Showroom',  // Professional/showroom spaces
  retail:     'Retail',   // Retail shops and showrooms
};

// ── Aggregated insights (sidebar panel) ──────────────────────────────────────

export async function getRentInsights(
  lat: number,
  lng: number,
  radiusMeters: number = 5000,
  domainId: string = 'retail'
): Promise<RentInsights | null> {
  try {
    const domain = DOMAIN_MAP[domainId] || 'Retail';
    const url = `${API_BASE}/api/rent-insights?lat=${lat}&lng=${lng}&radius=${radiusMeters}&domain=${domain}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });

    if (!response.ok) {
      console.warn('[RentIntelligence] API returned error:', response.status);
      return null;
    }

    const data = await response.json();
    return {
      avg_rent:    Number(data.avg_rent)    || 0,
      min_rent:    Number(data.min_rent)    || 0,
      max_rent:    Number(data.max_rent)    || 0,
      sample_size: Number(data.sample_size) || 0,
      comparables: Array.isArray(data.comparables) ? data.comparables : [],
      domain,
      radius: radiusMeters,
    };
  } catch {
    console.warn('[RentIntelligence] Local API unavailable. Run: node server.cjs');
    return null;
  }
}

// ── Individual listing rows (map pins) ────────────────────────────────────────

export async function getRentListings(
  lat: number,
  lng: number,
  radiusMeters: number = 5000,
  domainId: string = 'retail'
): Promise<RentListing[]> {
  try {
    const domain = DOMAIN_MAP[domainId] || 'Retail';
    const url = `${API_BASE}/api/rent-listings?lat=${lat}&lng=${lng}&radius=${radiusMeters}&domain=${domain}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!response.ok) return [];
    const data = await response.json();
    // Filter out rows without valid coordinates
    return Array.isArray(data)
      ? data.filter((r: RentListing) => r.lat && r.lng)
      : [];
  } catch {
    console.warn('[RentIntelligence] Listings fetch failed. Is server.cjs running?');
    return [];
  }
}
