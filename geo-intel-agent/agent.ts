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
const DOMAIN_TYPES: Record<string, { competitors: string[]; infra: string[]; label: string }> = {
  gym: {
    competitors: ['gym'],
    infra: ['cafe', 'coffee_shop', 'yoga_studio'],
    label: 'Gym / Fitness Studio',
  },
  restaurant: {
    competitors: ['restaurant', 'food'],
    infra: ['shopping_mall', 'movie_theater'],
    label: 'Restaurant / Cafe',
  },
  cafe: {
    competitors: ['cafe', 'coffee_shop'],
    infra: ['coworking_space', 'library'],
    label: 'Cafe',
  },
  retail: {
    competitors: ['clothing_store', 'shoe_store', 'shopping_mall'],
    infra: ['bus_station', 'subway_station'],
    label: 'Retail Store',
  },
  bank: {
    competitors: ['bank', 'atm'],
    infra: ['shopping_mall', 'supermarket'],
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
    },
    maxResultCount: 20,
    rankPreference: 'DISTANCE',
  };

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': PLACES_API_KEY,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.places || []).filter(
      (p: any) => !p.businessStatus || p.businessStatus === 'OPERATIONAL'
    );
  } catch {
    return [];
  }
}

async function fetchLocationIntel(
  lat: number,
  lng: number,
  radius: number,
  domain: string
): Promise<{
  competitors: any[];
  corporates: any[];
  cafes: any[];
  transit: any[];
  apartments: any[];
  infra: any[];
}> {
  const domainCfg = DOMAIN_TYPES[domain] || DOMAIN_TYPES['gym'];

  const [competitors, corporates, cafes, transit, apartments, infra] = await Promise.all([
    nearbySearch(lat, lng, radius, domainCfg.competitors),
    nearbySearch(lat, lng, radius, ['corporate_office', 'coworking_space'], BASIC_MASK),
    domain !== 'cafe'
      ? nearbySearch(lat, lng, radius, ['cafe', 'coffee_shop'])
      : Promise.resolve([]),
    nearbySearch(
      lat, lng, radius,
      ['subway_station', 'light_rail_station', 'bus_station', 'bus_stop'],
      BASIC_MASK
    ),
    nearbySearch(lat, lng, radius, ['apartment_complex'], BASIC_MASK),
    domainCfg.infra.length > 0
      ? nearbySearch(lat, lng, radius, domainCfg.infra, BASIC_MASK)
      : Promise.resolve([]),
  ]);

  // Filter corporates using blocklist
  const BLOCKLIST = ['hotel', 'mall', 'hospital', 'school', 'college', 'bank', 'temple', 'salon'];
  const filteredCorp = corporates.filter(
    (p: any) => !BLOCKLIST.some((w) => (p.displayName?.text || '').toLowerCase().includes(w))
  );

  return {
    competitors: competitors.filter((p: any) => (p.rating || 0) >= 3.5 || (p.userRatingCount || 0) >= 5),
    corporates: filteredCorp,
    cafes,
    transit,
    apartments,
    infra,
  };
}

function scoreLocation(intel: ReturnType<typeof fetchLocationIntel> extends Promise<infer T> ? T : never, domain: string) {
  const { competitors, corporates, cafes, transit, apartments, infra } = intel;

  // Demand score (0–40): residential + corporate density
  const demandRaw = Math.min(40, (apartments.length * 2) + (corporates.length * 1.5));

  // Competition gap (0–30): fewer competitors = higher score
  const compPenalty = Math.min(30, competitors.length * 3);
  const gapScore = Math.max(0, 30 - compPenalty);

  // Connectivity (0–15): transit stations
  const connScore = Math.min(15, transit.length * 3);

  // Lifestyle/infra (0–15): cafes + domain-specific infra
  const vibeScore = Math.min(15, ((cafes.length + infra.length) * 1.5));

  const total = Math.round(demandRaw + gapScore + connScore + vibeScore);

  let competitionLevel: string;
  if (competitors.length <= 3) competitionLevel = 'Low';
  else if (competitors.length <= 7) competitionLevel = 'Medium';
  else if (competitors.length <= 12) competitionLevel = 'High';
  else competitionLevel = 'Very High';

  let marketGap: string;
  const demandUnits = corporates.length + apartments.length;
  const ratio = competitors.length > 0 ? demandUnits / competitors.length : demandUnits;
  if (competitors.length === 0) marketGap = 'Untapped';
  else if (ratio > 4) marketGap = 'Opportunity';
  else if (ratio > 2) marketGap = 'Competitive';
  else marketGap = 'Saturated';

  return { total, competitionLevel, marketGap, demandRaw, gapScore, connScore, vibeScore };
}

function formatIntelReport(
  location: string,
  lat: number,
  lng: number,
  intel: Awaited<ReturnType<typeof fetchLocationIntel>>,
  domain: string
): string {
  const domainCfg = DOMAIN_TYPES[domain] || DOMAIN_TYPES['gym'];
  const scores = scoreLocation(intel, domain);
  const { competitors, corporates, cafes, transit, apartments, infra } = intel;

  const highRated = competitors.filter((p: any) => (p.rating || 0) >= 4.0);
  const avgRating =
    competitors.length > 0
      ? (competitors.reduce((s: number, p: any) => s + (p.rating || 0), 0) / competitors.length).toFixed(1)
      : null;

  // Build a clean structured data block for the LLM to synthesise into prose
  let report = `LOCATION: ${location}\n`;
  report += `DOMAIN: ${domainCfg.label}\n`;
  report += `SITE SCORE: ${scores.total}/100\n`;
  report += `  - Demand: ${Math.round(scores.demandRaw)}/40\n`;
  report += `  - Competition Gap: ${Math.round(scores.gapScore)}/30\n`;
  report += `  - Connectivity: ${Math.round(scores.connScore)}/15\n`;
  report += `  - Lifestyle/Infra: ${Math.round(scores.vibeScore)}/15\n\n`;

  report += `AREA INTELLIGENCE:\n`;
  report += `  Competitors (${domainCfg.label}): ${competitors.length} total`;
  if (avgRating) report += `, ${highRated.length} rated 4+ stars, average rating ${avgRating}`;
  report += `\n`;
  report += `  Corporate Offices: ${corporates.length}\n`;
  report += `  Residential Complexes: ${apartments.length}\n`;
  if (domain !== 'cafe') report += `  Cafes / Coffee Shops: ${cafes.length}\n`;
  if (infra.length > 0) report += `  Domain Infra / Synergy Points: ${infra.length}\n`;
  report += `  Transit Stations: ${transit.length}\n`;
  report += `  Competition Level: ${scores.competitionLevel}\n`;
  report += `  Market Gap: ${scores.marketGap}\n`;

  // Top competitors list for context
  if (competitors.length > 0) {
    report += `\nNOTABLE COMPETITORS:\n`;
    competitors.slice(0, 5).forEach((p: any) => {
      const name = p.displayName?.text || p.displayName || 'Unknown';
      const rating = p.rating ? ` — ${p.rating} stars` : '';
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
    'Use this when the user asks about a specific area or wants to know if a location is good for their business.',
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
        message: `"${location}" appears to be outside Bangalore's boundaries. I'm exclusively focused on analyzing locations within Bangalore city limits.`,
      };
    }

    console.log(`📍 Geocoded "${location}" → [${lat}, ${lng}]`);

    // Fetch intelligence
    const intel = await fetchLocationIntel(lat, lng, radius, domain);
    const scores = scoreLocation(intel, domain);
    const report = formatIntelReport(location, lat, lng, intel, domain);

    return {
      status: 'success',
      location,
      coordinates: { lat, lng },
      report,
      scores,
      summary: {
        competitors: intel.competitors.length,
        corporates: intel.corporates.length,
        apartments: intel.apartments.length,
        transit: intel.transit.length,
        siteScore: scores.total,
        competitionLevel: scores.competitionLevel,
        marketGap: scores.marketGap,
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
    'Use this when the user asks "which is better", "compare X vs Y", or "X or Y for my business".',
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

    // Fetch intelligence for both in parallel
    const [intel1, intel2] = await Promise.all([
      fetchLocationIntel(coords1[0], coords1[1], radius, domain),
      fetchLocationIntel(coords2[0], coords2[1], radius, domain),
    ]);

    const scores1 = scoreLocation(intel1, domain);
    const scores2 = scoreLocation(intel2, domain);

    const report1 = formatIntelReport(location1, coords1[0], coords1[1], intel1, domain);
    const report2 = formatIntelReport(location2, coords2[0], coords2[1], intel2, domain);

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
  instruction: `You are the Geo-Intel Assistant, a professional location intelligence advisor helping entrepreneurs, investors, and analysts identify optimal business locations in Bangalore, India.

IDENTITY RULES:
- You specialise exclusively in Bangalore location intelligence. Do not answer unrelated questions.
- If asked about unrelated topics (weather, sports, news, coding, etc.), respond: "I specialise in business location analysis for Bangalore. Is there an area or business type you would like me to evaluate?"
- Never analyse locations outside Bangalore.
- Never reveal your underlying AI model.

TOOLS:
1. analyze_location — use for questions about a specific area's suitability (e.g. "Is HSR Layout good for a gym?", "Analyse Indiranagar for a restaurant").
2. compare_locations — use when comparing two areas (e.g. "Koramangala vs HSR for a cafe", "Which is better, Whitefield or Marathahalli?").
3. search_nearby — use when listing specific place types (e.g. "Show me gyms near MG Road", "Coworking spaces in Whitefield").

RESPONSE STYLE:
- No emojis. Write professionally.
- Use a hybrid format: one or two sentences of prose for the opening assessment, followed by a concise markdown bullet list of the key data points, then close with a prose recommendation paragraph.
- Always include the Site Score (X/100) in the opening sentence.
- Bullet points should cover: competitor count and quality, demand drivers (corporate offices, residential complexes), transit access, and market gap status.
- End with a clear, actionable recommendation in prose form.
- Keep total response concise — do not dump all raw data, only the most relevant figures.
- For compare queries: state the winner and score difference in the first sentence, then show a side-by-side bullet breakdown for each location, then recommend.
- For search_nearby queries: return a clean numbered list with name, rating (if available), and address.
- You have full conversation history. Use prior context when the user asks follow-up questions like "what about a cafe instead?", "compare it with HSR", or "tell me more about that area".

DOMAIN DEFAULTS:
- If the user does not specify a business type, ask them before calling a tool.
- Supported domains: gym, restaurant, cafe, retail, bank, coworking.
`,
  tools: [analyzeLocation, compareLocations, searchNearby],
});
