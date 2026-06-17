const express = require('express');
const cors = require('cors');
const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files (compiled React app)
app.use(express.static(path.join(__dirname, 'dist')));

// Initialize BigQuery client
// Uses Application Default Credentials in production on Cloud Run,
// or local service account JSON for local development.
const bigQueryConfig = { projectId: 'testing-jithin' };
if (process.env.NODE_ENV !== 'production') {
  bigQueryConfig.keyFilename = path.join(__dirname, 'rent-scraper', 'service-account.json');
}
const bigquery = new BigQuery(bigQueryConfig);

app.get('/api/rent-insights', async (req, res) => {
  try {
    const { lat, lng, radius = 5000, domain = 'Retail' } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Missing lat or lng query parameters' });
    }

    // Convert string query params to numbers
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const searchRadius = parseFloat(radius);

    // BigQuery SQL using spatial function ST_DWithin
    // It finds listings within the searchRadius (meters) of the target point
    const query = `
      SELECT 
        AVG(price_per_sqft) as avg_rent,
        MIN(price_per_sqft) as min_rent,
        MAX(price_per_sqft) as max_rent,
        COUNT(*) as sample_size,
        ARRAY_AGG(
          STRUCT(title, monthly_rent, area_sqft, price_per_sqft, listing_url) 
          ORDER BY price_per_sqft DESC 
          LIMIT 5
        ) as comparables
      FROM \`testing-jithin.geo_intel.commercial_rent_listings\`
      WHERE ST_DWithin(geo_point, ST_GEOGPOINT(@lng, @lat), @radius)
        AND domain_type = @domain
    `;

    const options = {
      query: query,
      params: {
        lat: latitude,
        lng: longitude,
        radius: searchRadius,
        domain: domain
      },
    };

    const [rows] = await bigquery.query(options);
    
    // If no results, BigQuery still returns a row with null aggregates
    if (!rows || rows.length === 0 || !rows[0].sample_size) {
      return res.json({
        avg_rent: 0,
        min_rent: 0,
        max_rent: 0,
        sample_size: 0,
        comparables: []
      });
    }

    res.json(rows[0]);

  } catch (error) {
    console.error('Error fetching rent insights:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── /api/rent-listings — individual rows for map pin rendering ──────────────
app.get('/api/rent-listings', async (req, res) => {
  try {
    const { lat, lng, radius = 5000, domain = 'Retail' } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'Missing lat or lng' });

    const latitude  = parseFloat(lat);
    const longitude = parseFloat(lng);
    const searchRadius = parseFloat(radius);

    const query = `
      SELECT
        listing_id, title, locality, domain_type,
        monthly_rent, area_sqft, price_per_sqft, listing_url,
        ST_Y(geo_point) AS lat,
        ST_X(geo_point) AS lng
      FROM \`testing-jithin.geo_intel.commercial_rent_listings\`
      WHERE ST_DWithin(geo_point, ST_GEOGPOINT(@lng, @lat), @radius)
        AND domain_type = @domain
        AND geo_point IS NOT NULL
      ORDER BY price_per_sqft ASC
      LIMIT 20
    `;

    const [rows] = await bigquery.query({
      query,
      params: { lat: latitude, lng: longitude, radius: searchRadius, domain }
    });

    res.json(rows || []);
  } catch (error) {
    console.error('Error fetching rent listings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── /api/places — Google Places API proxy (keeps key server-side) ─────────────
//
// Request body from frontend (placesAPIService.ts):
//   { endpoint: 'v1/places:searchNearby' | 'v1/places:searchText', body: {...}, fieldMask: string }
// Response: { success: true, data: <Google response> }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/places', async (req, res) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error('[Places] GOOGLE_MAPS_API_KEY env var is not set');
    return res.status(500).json({ success: false, error: 'Places API key not configured on server' });
  }

  const { endpoint = 'v1/places:searchNearby', body: reqBody, fieldMask } = req.body;

  if (!reqBody) {
    return res.status(400).json({ success: false, error: 'Missing body in request' });
  }

  const googleUrl = `https://places.googleapis.com/${endpoint}`;
  const mask = fieldMask ||
    'places.id,places.displayName,places.location,places.types,places.businessStatus,places.rating,places.userRatingCount,places.priceLevel,places.formattedAddress';

  // Helper — one attempt with an 8-second timeout
  const attemptFetch = () => fetch(googleUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': mask,
    },
    body: JSON.stringify(reqBody),
    signal: AbortSignal.timeout(8000), // fail fast instead of hanging the gateway
  });

  try {
    let googleRes;
    try {
      googleRes = await attemptFetch();
    } catch (firstErr) {
      // Retry once on transient network errors (ECONNRESET, AbortError, etc.)
      const isTransient = firstErr.name === 'AbortError' ||
        firstErr.code === 'ECONNRESET' || firstErr.code === 'ETIMEDOUT';
      if (isTransient) {
        console.warn('[Places] Transient error on first attempt, retrying once:', firstErr.message);
        await new Promise(r => setTimeout(r, 300)); // brief pause before retry
        googleRes = await attemptFetch();
      } else {
        throw firstErr; // non-transient — propagate to outer catch
      }
    }

    const data = await googleRes.json();

    if (!googleRes.ok) {
      console.error('[Places] Google API error:', googleRes.status, JSON.stringify(data).slice(0, 200));
      return res.status(googleRes.status).json({ success: false, error: data });
    }

    res.json({ success: true, data });
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';
    console.error(`[Places] Proxy ${isTimeout ? 'TIMEOUT' : 'NETWORK'} error:`, err.message);
    res.status(502).json({
      success: false,
      error: isTimeout ? 'Places API request timed out' : 'Failed to reach Google Places API',
    });
  }
});


// ── /api/analyze-location — Single Source of Truth ───────────────────────────
//
// This is THE canonical intelligence + scoring endpoint. Both the Intelligence
// Panel (frontend) and the ADK Chat agent call this endpoint so they always
// show identical numbers.
//
// Request body:  { lat, lng, radius, domainId }
// Response:      { intel, scores, competitionLevel, marketGap }
//   - intel  → DomainLocationIntelligence (competitors, corporates, apartments, etc.)
//   - scores → CalculatedScores (demographicLoad, connectivity, competitorRatio, infrastructure, total)
// ─────────────────────────────────────────────────────────────────────────────

// ── Domain config (mirrors domains.ts) ───────────────────────────────────────
const DOMAIN_CONFIG_SERVER = {
  gym:        { competitorTypes: ['gym'],                                              infraTypes: ['cafe', 'restaurant'],                                            scoring: { demand: { weight: 0.30, saturationLimit: 18 }, connectivity: { weight: 0.15, saturationLimit: 8 }, gap: { weight: 0.30, saturationLimit: 6 }, infra: { weight: 0.25, saturationLimit: 15 } } },
  restaurant: { competitorTypes: ['restaurant', 'cafe'],                               infraTypes: ['shopping_mall', 'movie_theater', 'tourist_attraction', 'night_club', 'university'], scoring: { demand: { weight: 0.35, saturationLimit: 20 }, connectivity: { weight: 0.20, saturationLimit: 8 }, gap: { weight: 0.30, saturationLimit: 5  }, infra: { weight: 0.15, saturationLimit: 12 } } },
  bank:       { competitorTypes: ['bank', 'atm'],                                      infraTypes: ['shopping_mall', 'supermarket', 'department_store'],               scoring: { demand: { weight: 0.40, saturationLimit: 20 }, connectivity: { weight: 0.25, saturationLimit: 8 }, gap: { weight: 0.25, saturationLimit: 5  }, infra: { weight: 0.10, saturationLimit: 12 } } },
  retail:     { competitorTypes: ['supermarket', 'department_store', 'convenience_store'], infraTypes: ['cafe', 'restaurant', 'shopping_mall', 'movie_theater'],      scoring: { demand: { weight: 0.35, saturationLimit: 20 }, connectivity: { weight: 0.20, saturationLimit: 8 }, gap: { weight: 0.25, saturationLimit: 6  }, infra: { weight: 0.20, saturationLimit: 14 } } },
  cafe:       { competitorTypes: ['cafe', 'coffee_shop'],                              infraTypes: ['coworking_space', 'library'],                                     scoring: { demand: { weight: 0.35, saturationLimit: 18 }, connectivity: { weight: 0.20, saturationLimit: 8 }, gap: { weight: 0.25, saturationLimit: 5  }, infra: { weight: 0.20, saturationLimit: 12 } } },
  coworking:  { competitorTypes: ['coworking_space'],                                  infraTypes: ['cafe', 'restaurant'],                                             scoring: { demand: { weight: 0.35, saturationLimit: 18 }, connectivity: { weight: 0.20, saturationLimit: 8 }, gap: { weight: 0.25, saturationLimit: 5  }, infra: { weight: 0.20, saturationLimit: 12 } } },
};

const CORPORATE_BLOCKLIST_SERVER = [
  'hotel', 'mall', 'hospital', 'clinic', 'school', 'college', 'university',
  'bank', 'atm', 'temple', 'church', 'mosque', 'salon', 'spa', 'supermarket',
  'store', 'restaurant', 'cafe', 'pharmacy', 'medical', 'court', 'police',
  'government', 'municipality', 'apartment', 'residency', 'residences',
];

// ── Scoring helpers (mirrors scoringEngine.ts exactly) ───────────────────────
function linearNorm(count, limit) {
  if (!limit || limit <= 0) return 0;
  const r = (count / limit) * 100;
  return isFinite(r) ? r : 0;
}
function clampScore(val) {
  if (!isFinite(val) || isNaN(val)) return 0;
  return Math.max(0, Math.min(100, Math.round(val)));
}
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function calculateEffectiveCount(places, centerLat, centerLng, searchRadius, supportRating = false) {
  if (!places || places.length === 0) return 0;
  let total = 0;
  for (const p of places) {
    const loc = p.location;
    if (!loc) { total += 0.5; continue; }
    const pLat = loc.latitude ?? loc.lat;
    const pLng = loc.longitude ?? loc.lng;
    const dist = getDistanceMeters(centerLat, centerLng, pLat, pLng);
    const clamped = Math.min(dist, searchRadius);
    let weight = 1.0 - (0.6 * (clamped / Math.max(searchRadius, 1)));
    if (supportRating && p.rating !== undefined && p.userRatingCount && p.userRatingCount >= 5) {
      weight *= p.rating >= 3.5 ? 1.05 : 0.95;
    }
    total += weight;
  }
  return total;
}
// gracefulAuthFilter — mirrors placesAPIService.ts
function gracefulAuthFilter(places) {
  const strict = places.filter(p => (p.rating || 0) >= 3.8 && (p.userRatingCount || 0) >= 20);
  if (strict.length >= 3) return strict;
  const loose = places.filter(p => (p.rating || 0) >= 3.5 || (p.userRatingCount || 0) >= 5);
  if (loose.length >= 3) return loose;
  return places;
}

// Fetch one Places API page (internal, server-side — uses process.env key directly)
async function serverFetchPlaces(apiKey, types, lat, lng, radiusMeters, primaryOnly = false, fieldMask = null) {
  const BASIC  = 'places.id,places.displayName,places.location,places.types,places.businessStatus';
  const ADV    = 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.types,places.formattedAddress,places.businessStatus';
  const mask   = fieldMask || ADV;
  const body   = {
    [primaryOnly ? 'includedPrimaryTypes' : 'includedTypes']: types,
    locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters } },
    maxResultCount: 20,
    rankPreference: 'DISTANCE',
  };
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': mask },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.places || []).filter(p => !p.businessStatus || p.businessStatus === 'OPERATIONAL');
  } catch { return []; }
}

function runScoring(competitors, corporates, apartments, infra, transit, domainId, lat, lng, radius) {
  const config = DOMAIN_CONFIG_SERVER[domainId];
  if (!config) return null;

  const competitorsCt = calculateEffectiveCount(competitors, lat, lng, radius, true);
  const apartmentsCt  = calculateEffectiveCount(apartments,  lat, lng, radius, false);
  const officesCt     = calculateEffectiveCount(corporates,  lat, lng, radius, false);
  const transitPlaces = transit;
  const transitCt     = calculateEffectiveCount(transitPlaces, lat, lng, radius, false);
  const infraCt       = calculateEffectiveCount(infra, lat, lng, radius, true);

  const metroPlaces = transitPlaces.filter(p => p.types?.some(t => t.includes('subway') || t.includes('light_rail')));
  const busPlaces   = transitPlaces.filter(p => !p.types?.some(t => t.includes('subway') || t.includes('light_rail')));
  const metroCt = calculateEffectiveCount(metroPlaces, lat, lng, radius, false);
  const busCt   = calculateEffectiveCount(busPlaces,   lat, lng, radius, false);

  // Demand score
  let demandRaw = 0;
  const dLimit = config.scoring.demand.saturationLimit;
  if (domainId === 'gym') {
    demandRaw = linearNorm(apartmentsCt, dLimit) * 0.55 + linearNorm(officesCt, dLimit) * 0.20 + linearNorm(infraCt, dLimit) * 0.25;
  } else if (domainId === 'restaurant') {
    const universities = infra.filter(p => p.types?.includes('university')).length || 0;
    demandRaw = linearNorm(apartmentsCt, dLimit) * 0.35 + linearNorm(officesCt, dLimit) * 0.40 + linearNorm(universities, 5) * 0.15 + linearNorm(transitCt, 8) * 0.10;
  } else if (domainId === 'bank') {
    demandRaw = linearNorm(apartmentsCt, dLimit) * 0.50 + linearNorm(officesCt, dLimit) * 0.50;
  } else {
    demandRaw = linearNorm(apartmentsCt, dLimit) * 0.60 + linearNorm(officesCt, dLimit) * 0.40;
  }
  const demandScore = clampScore(demandRaw);

  // Connectivity
  const cLimit = config.scoring.connectivity.saturationLimit;
  const connRaw = linearNorm(metroCt, cLimit) * 0.65 + linearNorm(busCt, cLimit * 2) * 0.35;
  const connScore = clampScore(connRaw);

  // Gap score
  const demandUnits = apartmentsCt + (officesCt * 0.8) + (infraCt * 0.5);
  const gapRatio    = demandUnits / Math.max(competitorsCt, 1);
  const gapScore    = clampScore(linearNorm(gapRatio, config.scoring.gap.saturationLimit));

  // Infra score
  const infraScore = clampScore(linearNorm(infraCt, config.scoring.infra.saturationLimit));

  // Weighted total + saturation penalty
  let totalRaw = demandScore * config.scoring.demand.weight + connScore * config.scoring.connectivity.weight + gapScore * config.scoring.gap.weight + infraScore * config.scoring.infra.weight;
  if (gapRatio < 1) totalRaw -= 25;
  else if (gapRatio < 2) totalRaw -= 10;
  const totalScore = clampScore(totalRaw);

  return { demographicLoad: demandScore, connectivity: connScore, competitorRatio: gapScore, infrastructure: infraScore, total: totalScore };
}

app.post('/api/analyze-location', async (req, res) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { lat, lng, radius = 1000, domainId = 'gym' } = req.body;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng are required' });

  const domainCfg = DOMAIN_CONFIG_SERVER[domainId];
  if (!domainCfg) return res.status(400).json({ error: `Unknown domainId: ${domainId}` });

  const BASIC_MASK = 'places.id,places.displayName,places.location,places.types,places.businessStatus';

  try {
    // Fetch all POI categories in parallel — same calls as getDomainIntelligence()
    const [competitorsRaw, corporateRaw, infraRaw, transitRaw, apartmentRaw] = await Promise.all([
      serverFetchPlaces(apiKey, domainCfg.competitorTypes, lat, lng, radius, false),
      serverFetchPlaces(apiKey, ['corporate_office', 'coworking_space'], lat, lng, radius, true, BASIC_MASK),
      domainCfg.infraTypes.length > 0 ? serverFetchPlaces(apiKey, domainCfg.infraTypes, lat, lng, radius, false, BASIC_MASK) : Promise.resolve([]),
      serverFetchPlaces(apiKey, ['bus_station', 'bus_stop', 'light_rail_station', 'subway_station'], lat, lng, radius, false, BASIC_MASK),
      serverFetchPlaces(apiKey, ['apartment_complex'], lat, lng, radius, false, BASIC_MASK),
    ]);

    // Apply the exact same filters as the frontend
    const competitors = gracefulAuthFilter(competitorsRaw);
    const corporates  = corporateRaw.filter(p => !CORPORATE_BLOCKLIST_SERVER.some(w => (p.displayName?.text || '').toLowerCase().includes(w)));
    const infra       = infraRaw;
    const transit     = transitRaw;
    const apartments  = apartmentRaw;

    console.log(`[analyze-location] ${domainId} @ [${lat},${lng}] r=${radius}: ${competitorsRaw.length}→${competitors.length} competitors, ${corporates.length} corp, ${apartments.length} apt, ${transit.length} transit`);

    // High-rated competitors stat for UI
    const highRated   = competitors.filter(p => (p.rating || 0) >= 4.0);
    const ratings     = competitors.filter(p => p.rating).map(p => p.rating);
    const avgRating   = ratings.length > 0 ? parseFloat((ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1)) : 0;

    // Competition level (same thresholds as frontend)
    let competitionLevel;
    if (competitors.length <= 3)       competitionLevel = 'LOW';
    else if (competitors.length <= 8)  competitionLevel = 'MEDIUM';
    else if (competitors.length <= 15) competitionLevel = 'HIGH';
    else                               competitionLevel = 'VERY_HIGH';

    // Market gap via saturation ratio (same as frontend)
    const fullDemand = corporates.length + (apartments.length * 0.7) + (transit.length * 0.8) + (infra.length * 0.5);
    const estimatedCapacity = Math.max(5, fullDemand * 1.5);
    const saturationRatio = competitors.length / estimatedCapacity;
    let marketGap;
    if (competitors.length === 0)      marketGap = 'UNTAPPED';
    else if (saturationRatio < 0.25)   marketGap = 'OPPORTUNITY';
    else if (saturationRatio < 0.6)    marketGap = 'COMPETITIVE';
    else                               marketGap = 'SATURATED';

    // Build the intel shape that matches DomainLocationIntelligence
    const intel = {
      competitors:    { total: competitors.length, highRated: highRated.length, averageRating: avgRating, places: competitors },
      corporateOffices: { total: corporates.length, places: corporates },
      apartments:     { total: apartments.length,   places: apartments },
      infraSynergy:   { total: infra.length,        places: infra },
      transitStations:{ total: transit.length,      places: transit },
      competitionLevel,
      marketGap,
    };

    // Run the canonical scoring engine
    const scores = runScoring(competitors, corporates, apartments, infra, transit, domainId, lat, lng, radius);

    res.json({ intel, scores });

  } catch (err) {
    console.error('[analyze-location] Error:', err.message);
    res.status(502).json({ error: 'Failed to analyze location' });
  }
});




// ── /api/chat — Geo-Intel ADK Agent proxy ────────────────────────────────────
//
// Architecture:
//   React frontend  →  POST /api/chat  →  server.cjs  →  ADK agent (port 8000)
//
// Request body:  { message: string, sessionId?: string, userId?: string }
// Response:      { text: string, sessionId: string }
//
// sessionId is returned on every response and should be passed back on the
// next request to maintain full conversation context across turns.
// ─────────────────────────────────────────────────────────────────────────────

const ADK_URL      = process.env.ADK_URL || 'http://localhost:8000';
const ADK_APP      = 'agent';          // matches the filename: geo-intel-agent/agent.ts
const ADK_AGENT    = 'geo_intel_agent'; // matches name: in LlmAgent({name: ...})
const DEFAULT_USER = 'geo-intel-user';

app.post('/api/chat', async (req, res) => {
  const { message, sessionId, userId = DEFAULT_USER } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    // ── Step 1: Resolve session ──────────────────────────────────────────────
    // If no sessionId was passed, create a new ADK session.
    let activeSessionId = sessionId;

    if (!activeSessionId) {
      const sessionRes = await fetch(
        `${ADK_URL}/apps/${ADK_APP}/users/${encodeURIComponent(userId)}/sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );

      if (!sessionRes.ok) {
        const err = await sessionRes.text();
        console.error('ADK session creation failed:', err);
        return res.status(502).json({
          error: 'Could not start an agent session. The AI service may be temporarily unavailable.',
        });
      }

      const sessionData = await sessionRes.json();
      activeSessionId = sessionData.id || sessionData.session_id || sessionData.sessionId;
      console.log(`[ADK] Session response:`, JSON.stringify(sessionData));
      console.log(`[ADK] New session created: ${activeSessionId}`);
    }

    // ── Step 2: Send message to ADK via /run_sse ─────────────────────────────
    // Use AbortController with 60s timeout to handle cold starts on Cloud Run.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const runRes = await fetch(`${ADK_URL}/run_sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appName:    ADK_APP,
        userId:     userId,
        sessionId:  activeSessionId,
        newMessage: {
          role:  'user',
          parts: [{ text: message.trim() }],
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!runRes.ok) {
      const err = await runRes.text();
      console.error('ADK /run_sse error:', runRes.status, err.slice(0, 500));
      return res.status(502).json({
        error: 'Agent returned an error. Please try again.',
      });
    }

    // ── Step 3: Parse SSE stream → extract agent text + tool data ────────────
    // /run_sse returns a stream of "data: <json>\n\n" lines.
    // ADK event shapes vary by version — we try multiple extraction paths.
    const rawText = await runRes.text();
    const lines   = rawText.split('\n');
    let agentText = '';
    let fallbackText = '';  // any non-user text, used if primary match fails
    let toolData  = null;

    const TOOL_NAMES = new Set(['analyze_location', 'compare_locations', 'search_nearby']);

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const event = JSON.parse(payload);
        const author = event.author || '';
        const parts  = event.content?.parts || event.parts || [];

        // ── Primary: match our agent by name ──────────────────────────────
        if (author === ADK_AGENT) {
          // Text response (multiple possible shapes)
          const txt = parts[0]?.text ?? event.text ?? event.content?.text ?? '';
          if (txt) agentText = txt;

          // Tool response (functionResponse in parts)
          for (const part of parts) {
            const fr = part?.functionResponse;
            if (fr && TOOL_NAMES.has(fr.name)) {
              const output = fr.response?.output ?? fr.response;
              if (output?.status === 'success') toolData = output;
            }
          }
        }

        // ── Fallback: capture any non-user, non-tool text ─────────────────
        if (author && author !== 'user' && author !== ADK_AGENT) {
          const txt = parts[0]?.text ?? event.text ?? '';
          if (txt && !fallbackText) fallbackText = txt;
        }

        // ── Final response marker (some ADK versions emit this) ────────────
        if (event.type === 'final_response' || event.is_final_response) {
          const txt = parts[0]?.text ?? event.text ?? event.response ?? '';
          if (txt) agentText = txt;
        }

      } catch {
        // malformed SSE line — skip
      }
    }

    // If primary agent name didn't match, use fallback text
    if (!agentText && fallbackText) {
      console.warn(`[ADK] Primary author "${ADK_AGENT}" not found in SSE — using fallback text`);
      agentText = fallbackText;
    }

    // Log raw SSE for debugging when no text was extracted
    if (!agentText) {
      console.warn('[ADK] No agent text extracted. Raw SSE (first 800 chars):', rawText.slice(0, 800));
    }

    console.log(`[ADK] Session ${activeSessionId} → text: ${agentText.length} chars | toolData: ${toolData ? JSON.stringify(toolData).slice(0, 80) : 'none'}`);

    return res.json({
      text:      agentText || 'I am ready to help! Ask me about any Bangalore area for business location intelligence.',
      sessionId: activeSessionId,
      toolData,  // coordinates, scores, comparison winner — used by frontend for map nav
    });


  } catch (error) {
    console.error('[ADK] Proxy error:', error);
    return res.status(502).json({
      error: 'Unable to reach the AI agent. Please try again in a moment.',
    });
  }
});

// ── SPA catch-all — must be LAST route ───────────────────────────────────────
// Use regex instead of '*' for Express v5 / path-to-regexp v8+ compatibility.
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`🚀 Geo-Intel server running on port ${port} (NODE_ENV=${process.env.NODE_ENV})`);
  console.log(`   Google Maps API key: ${process.env.GOOGLE_MAPS_API_KEY ? '✅ set' : '❌ MISSING'}`);
  console.log(`   ADK URL: ${process.env.ADK_URL || 'http://localhost:8000 (default)'}`);
});
