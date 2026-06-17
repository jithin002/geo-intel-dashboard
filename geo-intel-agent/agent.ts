/**
 * Geo-Intel ADK Agent
 *
 * A structured ADK agent that replaces the fragile JSON-parsing loop in
 * chatOrchestrationService.ts with proper ADK FunctionTools.
 *
 * Tools:
 *  - analyze_location   → full location intelligence + scoring for a Bangalore area
 *  - compare_locations  → side-by-side comparison of two Bangalore areas
 *  - search_nearby      → find specific place types near a location
 */

import 'dotenv/config';
import { FunctionTool, LlmAgent } from '@google/adk';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

// Field masks
const BASIC_MASK = 'places.id,places.displayName,places.location,places.types,places.businessStatus';
const ADVANCED_MASK =
  'places.id,places.displayName,places.location,places.rating,' +
  'places.userRatingCount,places.priceLevel,places.types,places.formattedAddress,places.businessStatus';

// Bangalore geographic bounds
const BANGALORE_BOUNDS = {
  north: 13.1936, south: 12.7840,
  east: 77.8340,  west: 77.4101,
};

// Known area coordinates — used as hints when geocoding fails
const AREA_COORDS: Record<string, [number, number]> = {
  koramangala: [12.9352, 77.6245],
  'hsr layout': [12.9116, 77.6389],
  indiranagar: [12.9784, 77.6408],
  whitefield: [12.9698, 77.7500],
  hebbal: [13.0352, 77.5970],
  jayanagar: [12.9308, 77.5838],
  'mg road': [12.9757, 77.6097],
  marathahalli: [12.9591, 77.6972],
  yelahanka: [13.1007, 77.5963],
  'electronic city': [12.8399, 77.6770],
  malleshwaram: [13.0027, 77.5668],
  'bannerghatta road': [12.8997, 77.5979],
  'jp nagar': [12.9063, 77.5857],
  rajajinagar: [12.9906, 77.5521],
  'old airport road': [12.9591, 77.6404],
  sarjapur: [12.8626, 77.6860],
  'bellandur': [12.9261, 77.6762],
  'btm layout': [12.9166, 77.6101],
};

// Domain-to-competitor-types mapping
// ⚠️ Must match domains.ts (frontend) competitorTypes + infraTypes exactly
const DOMAIN_TYPES: Record<string, { competitors: string[]; infra: string[]; label: string }> = {
  gym: {
    competitors: ['gym'],
    infra: ['cafe', 'restaurant'],
    label: 'Gym / Fitness Studio',
  },
  restaurant: {
    competitors: ['restaurant', 'cafe'],   // matches frontend: competitorTypes
    infra: ['shopping_mall', 'movie_theater', 'tourist_attraction', 'night_club', 'university'],
    label: 'Restaurant / Cafe',
  },
  cafe: {
    competitors: ['cafe', 'coffee_shop'],
    infra: ['coworking_space', 'library'],
    label: 'Cafe',
  },
  retail: {
    competitors: ['supermarket', 'department_store', 'convenience_store'], // matches frontend
    infra: ['cafe', 'restaurant', 'shopping_mall', 'movie_theater'],
    label: 'Retail Store',
  },
  bank: {
    competitors: ['bank', 'atm'],
    infra: ['shopping_mall', 'supermarket', 'department_store'],
    label: 'Bank / ATM',
  },
  coworking: {
    competitors: ['coworking_space'],
    infra: ['cafe', 'restaurant'],
    label: 'Co-Working Space',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isInsideBangalore(lat: number, lng: number): boolean {
  return (
    lat >= BANGALORE_BOUNDS.south &&
    lat <= BANGALORE_BOUNDS.north &&
    lng >= BANGALORE_BOUNDS.west &&
    lng <= BANGALORE_BOUNDS.east
  );
}

async function geocodeLocation(query: string): Promise<[number, number] | null> {
  // 1. Exact match in our known-coords table
  const lower = query.toLowerCase().trim();
  for (const [key, coords] of Object.entries(AREA_COORDS)) {
    if (lower.includes(key)) return coords;
  }

  // 2. Nominatim geocoder (free, no key required)
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query + ', Bangalore, India')}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'GeoIntelAgent/1.0' } });
    const data: any[] = await res.json();
    if (data && data.length > 0) {
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
  } catch {
    // Nominatim failed — fall through
  }

  // 3. Places text search geocoder (uses Places API key)
  try {
    const body = {
      textQuery: query.toLowerCase().includes('bangalore') ? query : `${query}, Bangalore`,
      maxResultCount: 1,
    };
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.location,places.displayName',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const first = data.places?.[0];
    if (first?.location) {
      return [first.location.latitude, first.location.longitude];
    }
  } catch {
    // Places geocoder also failed
  }

  return null;
}

async function nearbySearch(
  lat: number,
  lng: number,
  radiusMeters: number,
  types: string[],
  fieldMask = ADVANCED_MASK
): Promise<any[]> {
  const body = {
    includedTypes: types,
    locationRestriction: {
      circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters },
// ─────────────────────────────────────────────────────────────────────────────
// callAnalyzeLocation — calls the centralized /api/analyze-location endpoint
// This is the SINGLE SOURCE OF TRUTH shared with the Intelligence Panel.
// ─────────────────────────────────────────────────────────────────────────────

async function callAnalyzeLocation(
  lat: number,
  lng: number,
  radius: number,
  domainId: string
): Promise<{ intel: any; scores: any } | null> {
  const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';
  try {
    const res = await fetch(`${BACKEND}/api/analyze-location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, radius, domainId }),
    });
    if (!res.ok) {
      console.error(`[analyze-location] HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.error('[analyze-location] fetch failed:', err.message);
    return null;
  }
}

// Map ADK domain names to the domainId expected by /api/analyze-location
function mapDomain(domain: string): string {
  const MAP: Record<string, string> = {
    gym: 'gym', restaurant: 'restaurant', cafe: 'restaurant',
    retail: 'retail', bank: 'bank', coworking: 'gym',
  };
  return MAP[domain] || 'gym';
}

function buildReport(
  location: string,
  domain: string,
  intel: any,
  scores: any
): string {
  const domainCfg = DOMAIN_TYPES[domain] || DOMAIN_TYPES['gym'];
  const competitors = intel.competitors.places || [];
  const highRated = competitors.filter((p: any) => (p.rating || 0) >= 4.0);
  const avgRating = intel.competitors.averageRating;

  // Competition level labels
  const levelLabel: Record<string, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', VERY_HIGH: 'Very High' };
  const gapLabel:   Record<string, string> = { UNTAPPED: 'Untapped', OPPORTUNITY: 'Opportunity', COMPETITIVE: 'Competitive', SATURATED: 'Saturated' };

  let report = `LOCATION: ${location}\n`;
  report += `DOMAIN: ${domainCfg.label}\n`;
  report += `SITE SCORE: ${scores.total}/100\n`;
  report += `  - Demand: ${scores.demographicLoad}\n`;
  report += `  - Competition Gap: ${scores.competitorRatio}\n`;
  report += `  - Connectivity: ${scores.connectivity}\n`;
  report += `  - Infra/Vibe: ${scores.infrastructure}\n\n`;

  report += `AREA INTELLIGENCE:\n`;
  report += `  Competitors (${domainCfg.label}): ${competitors.length} total`;
  if (avgRating) report += `, ${highRated.length} rated 4+ stars, average rating ${avgRating}`;
  report += `\n`;
  report += `  Corporate Offices: ${intel.corporateOffices.total}\n`;
  report += `  Residential Complexes: ${intel.apartments.total}\n`;
  report += `  Infra / Synergy Points: ${intel.infraSynergy.total}\n`;
  report += `  Transit Stations: ${intel.transitStations.total}\n`;
  report += `  Competition Level: ${levelLabel[intel.competitionLevel] || intel.competitionLevel}\n`;
  report += `  Market Gap: ${gapLabel[intel.marketGap] || intel.marketGap}\n`;

  // Top competitors list for context
  if (competitors.length > 0) {
    report += `\nNOTABLE COMPETITORS:\n`;
    competitors.slice(0, 5).forEach((p: any) => {
      const name = p.displayName?.text || p.displayName || 'Unknown';
      const rating = p.rating ? ` — ${p.rating}★` : '';
      report += `  - ${name}${rating}\n`;
    });
  }

  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 1: analyze_location
// ─────────────────────────────────────────────────────────────────────────────

const analyzeLocation = new FunctionTool({
  name: 'analyze_location',
  description:
    'Performs a full location intelligence analysis for a named area in Bangalore. ' +
    'Returns competitor count, demand drivers, transit access, site score, and a strategic recommendation. ' +
    'Use this when the user asks about a specific area, wants to know if a location is good for their business, ' +
    'or when answering questions about specific attributes of a location (e.g. "nearest premium gym", "least competitive cafe area"). ' +
    'Only supports these domains: gym, restaurant, cafe, retail, bank, coworking. ' +
    'If the user asks for an unsupported domain, still call this tool — it will return a graceful message.',
  parameters: z.object({
    location: z.string().describe(
      'Name of the Bangalore area or landmark to analyze (e.g. "Koramangala", "Indiranagar", "Forum Mall HSR").'
    ),
    domain: z
      .enum(['gym', 'restaurant', 'cafe', 'retail', 'bank', 'coworking'])
      .describe('Business domain / type being evaluated.')
      .default('gym'),
    radius_meters: z
      .number()
      .optional()
      .describe('Search radius in meters. Default is 1000 (1 km).')
      .default(1000),
  }),
  execute: async ({ location, domain, radius_meters }) => {
    const radius = radius_meters || 1000;

    // Guard: unsupported domain — inform the user, skip map analysis
    if (!DOMAIN_TYPES[domain]) {
      return {
        status: 'not_mapped',
        domain,
        message:
          `The "${domain}" domain is not currently supported for map-based analysis. ` +
          `Supported domains are: gym, restaurant, cafe, retail, bank, and co-working spaces. ` +
          `I can still share general location advice for "${domain}" businesses in ${location} based on my knowledge.`,
      };
    }

    // Geocode the location
    const coords = await geocodeLocation(location);
    if (!coords) {
      return {
        status: 'error',
        message: `Could not find "${location}" in Bangalore. Please try a more specific area name (e.g. "Koramangala 5th Block" or "Indiranagar 12th Main").`,
      };
    }

    const [lat, lng] = coords;
    if (!isInsideBangalore(lat, lng)) {
      return {
        status: 'error',
        message: `"${location}" appears to be outside Bangalore's boundaries. I am exclusively focused on analyzing locations within Bangalore city limits.`,
      };
    }

    console.log(`📍 Geocoded "${location}" → [${lat}, ${lng}]`);

    // Call the centralized endpoint — same data as the Intelligence Panel
    const mappedDomain = mapDomain(domain);
    const result = await callAnalyzeLocation(lat, lng, radius, mappedDomain);

    if (!result) {
      return {
        status: 'error',
        message: `Could not retrieve location intelligence for "${location}". The data service may be temporarily unavailable.`,
      };
    }

    const { intel, scores } = result;
    const report = buildReport(location, domain, intel, scores);

    return {
      status: 'success',
      location,
      coordinates: { lat, lng },
      report,
      scores: {
        total: scores.total,
        competitionLevel: intel.competitionLevel,
        marketGap: intel.marketGap,
        demographicLoad: scores.demographicLoad,
        connectivity: scores.connectivity,
        competitorRatio: scores.competitorRatio,
        infrastructure: scores.infrastructure,
      },
      summary: {
        competitors: intel.competitors.total,
        corporates: intel.corporateOffices.total,
        apartments: intel.apartments.total,
        transit: intel.transitStations.total,
        siteScore: scores.total,
        competitionLevel: intel.competitionLevel,
        marketGap: intel.marketGap,
      },
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool 2: compare_locations
// ─────────────────────────────────────────────────────────────────────────────

const compareLocations = new FunctionTool({
  name: 'compare_locations',
  description:
    'Compares two Bangalore areas side-by-side for a specific business domain. ' +
    'Returns scores, key metrics, and a clear winner recommendation. ' +
    'Use this when the user asks "which is better", "compare X vs Y", or "X or Y for my business". ' +
    'Only supports: gym, restaurant, cafe, retail, bank, coworking.',
  parameters: z.object({
    location1: z.string().describe('First Bangalore area to compare.'),
    location2: z.string().describe('Second Bangalore area to compare.'),
    domain: z
      .enum(['gym', 'restaurant', 'cafe', 'retail', 'bank', 'coworking'])
      .describe('Business domain / type being evaluated.')
      .default('gym'),
    radius_meters: z.number().optional().default(1000),
  }),
  execute: async ({ location1, location2, domain, radius_meters }) => {
    const radius = radius_meters || 1000;

    // Guard: unsupported domain
    if (!DOMAIN_TYPES[domain]) {
      return {
        status: 'not_mapped',
        domain,
        message:
          `The "${domain}" domain is not supported for map-based comparison. ` +
          `Supported domains are: gym, restaurant, cafe, retail, bank, and co-working spaces.`,
      };
    }

    // Geocode both in parallel
    const [coords1, coords2] = await Promise.all([
      geocodeLocation(location1),
      geocodeLocation(location2),
    ]);

    if (!coords1) {
      return { status: 'error', message: `Could not find "${location1}" in Bangalore.` };
    }
    if (!coords2) {
      return { status: 'error', message: `Could not find "${location2}" in Bangalore.` };
    }
    if (!isInsideBangalore(coords1[0], coords1[1])) {
      return { status: 'error', message: `"${location1}" is outside Bangalore bounds.` };
    }
    if (!isInsideBangalore(coords2[0], coords2[1])) {
      return { status: 'error', message: `"${location2}" is outside Bangalore bounds.` };
    }

    console.log(`⚖️  Comparing "${location1}" [${coords1}] vs "${location2}" [${coords2}]`);

    // Fetch intelligence for both in parallel via the centralized endpoint
    const mappedDomain = mapDomain(domain);
    const [result1, result2] = await Promise.all([
      callAnalyzeLocation(coords1[0], coords1[1], radius, mappedDomain),
      callAnalyzeLocation(coords2[0], coords2[1], radius, mappedDomain),
    ]);

    if (!result1) return { status: 'error', message: `Could not get intel for "${location1}".` };
    if (!result2) return { status: 'error', message: `Could not get intel for "${location2}".` };

    const { intel: intel1, scores: scores1 } = result1;
    const { intel: intel2, scores: scores2 } = result2;

    const report1 = buildReport(location1, domain, intel1, scores1);
    const report2 = buildReport(location2, domain, intel2, scores2);

    const winner = scores1.total >= scores2.total ? location1 : location2;
    const winnerScore = Math.max(scores1.total, scores2.total);
    const margin = Math.abs(scores1.total - scores2.total);

    return {
      status: 'success',
      domain,
      location1: {
        name: location1,
        coordinates: { lat: coords1[0], lng: coords1[1] },
        report: report1,
        scores: scores1,
      },
      location2: {
        name: location2,
        coordinates: { lat: coords2[0], lng: coords2[1] },
        report: report2,
        scores: scores2,
      },
      comparison: {
        winner,
        winnerScore,
        margin,
        recommendation: margin < 5
          ? `Both areas are closely matched (${scores1.total} vs ${scores2.total}). Consider practical factors like rent and accessibility.`
          : `${winner} leads by ${margin} points (${winnerScore}/100). It offers a meaningfully better opportunity for a ${DOMAIN_TYPES[domain]?.label || domain}.`,
      },
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool 3: search_nearby
// ─────────────────────────────────────────────────────────────────────────────

const searchNearby = new FunctionTool({
  name: 'search_nearby',
  description:
    'Searches for specific place types near a Bangalore location. ' +
    'Use this when the user wants to find specific businesses — e.g. "show me gyms near MG Road", ' +
    '"coffee shops in Whitefield", or "coworking spaces in HSR".',
  parameters: z.object({
    location: z.string().describe('Bangalore area or landmark to search near.'),
    place_type: z
      .string()
      .describe(
        'Google Places type to search for (e.g. "gym", "cafe", "restaurant", "coworking_space", "apartment_complex").'
      ),
    radius_meters: z.number().optional().default(1500),
  }),
  execute: async ({ location, place_type, radius_meters }) => {
    const radius = radius_meters || 1500;

    const coords = await geocodeLocation(location);
    if (!coords) {
      return { status: 'error', message: `Could not find "${location}" in Bangalore.` };
    }
    if (!isInsideBangalore(coords[0], coords[1])) {
      return { status: 'error', message: `"${location}" is outside Bangalore.` };
    }

    const places = await nearbySearch(coords[0], coords[1], radius, [place_type]);

    if (places.length === 0) {
      return {
        status: 'success',
        location,
        place_type,
        count: 0,
        message: `No ${place_type} found within ${radius}m of ${location}.`,
        places: [],
      };
    }

    const formatted = places.slice(0, 10).map((p: any) => ({
      name: p.displayName?.text || p.displayName || 'Unknown',
      rating: p.rating || null,
      reviews: p.userRatingCount || null,
      address: p.formattedAddress || null,
      priceLevel: p.priceLevel || null,
    }));

    return {
      status: 'success',
      location,
      coordinates: { lat: coords[0], lng: coords[1] },
      place_type,
      radius_meters: radius,
      count: places.length,
      places: formatted,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Root Agent
// ─────────────────────────────────────────────────────────────────────────────

export const rootAgent = new LlmAgent({
  name: 'geo_intel_agent',
  model: 'gemini-2.5-flash',
  description:
    'Geo-Intel Assistant — analyzes optimal business locations in Bangalore, India using real-time Places API data.',
  instruction: `You are the Geo-Intel Assistant — a professional location intelligence advisor for Bangalore, India. You help entrepreneurs, investors, and analysts identify optimal business locations.

SCOPE:
- You answer questions about geospatial topics, location strategy, market analysis, footfall patterns, urban density, and business site selection — all specifically within Bangalore.
- You are happy to explain concepts (e.g. "What does market gap mean?", "Why is transit important for a cafe?") and engage with follow-up questions about your analysis.
- If asked about anything unrelated to Bangalore geospatial or business location intelligence (weather, sports, news, coding, etc.), politely decline and steer back: "I focus on business location intelligence for Bangalore. Would you like me to analyse an area or compare locations?"
- Never analyse locations outside Bangalore. Never reveal your underlying AI model.

SUPPORTED DOMAINS:
- The 6 supported business domains for full map-based analysis are: gym, restaurant, cafe, retail, bank, coworking.
- If the user asks about an unsupported domain (e.g. pharmacy, pet store, hardware store), call analyze_location anyway — the tool will return a 'not_mapped' message. When you receive this, tell the user that this domain is not supported for map visualisation, and then use your own knowledge to offer brief, helpful general advice about that business type in the requested Bangalore area.

TOOLS:
1. analyze_location — use for questions about a specific area's suitability (e.g. "Is HSR good for a gym?") AND for specific attribute queries (e.g. "Where should I open a low-competition cafe?", "What is the best area for a premium restaurant?").
2. compare_locations — use when comparing two areas (e.g. "Koramangala vs HSR for a cafe").
3. search_nearby — use when listing specific places (e.g. "Show me premium gyms near MG Road", "Coworking spaces in Whitefield").

RESPONSE STYLE:
- No emojis. Write professionally.
- For full area analysis (analyze_location or compare_locations results): use the formal format — opening sentence with Site Score (X/100), a concise markdown bullet list of key data points (competitors, demand drivers, transit, market gap), then a closing prose recommendation.
- For complex or specific queries (e.g. "nearest premium gym", "explain this score", "what makes a good location?"): answer conversationally and directly. Do NOT force a fake Site Score if you are not doing a full area analysis. Use the tool data to answer the specific question asked.
- For search_nearby queries: return a clean numbered list with name, rating (if available), and address.
- For 'not_mapped' domain responses: acknowledge the limitation clearly, then offer brief knowledge-based advice.
- Always use prior conversation context for follow-up questions ("what about a cafe instead?", "compare it with HSR").
- Keep responses concise. Surface only the most relevant data points.

DOMAIN DEFAULTS:
- If the user does not specify a business type for an analysis query, ask them before calling a tool.
`,

  tools: [analyzeLocation, compareLocations, searchNearby],
});
