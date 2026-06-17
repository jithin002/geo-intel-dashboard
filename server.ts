import express from 'express';
import cors from 'cors';
import { BigQuery } from '@google-cloud/bigquery';
import path from 'path';
import { fileURLToPath } from 'url';
import { DOMAIN_CONFIG } from './domains.js';
import { calculateDomainScores } from './services/scoringEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files (compiled React app)
app.use(express.static(path.join(__dirname, 'dist')));

// Initialize BigQuery client
const bigQueryConfig: any = { projectId: 'testing-jithin' };
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
    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);
    const searchRadius = parseFloat(radius as string);

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

    const latitude  = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);
    const searchRadius = parseFloat(radius as string);

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

    // Return in { success, data } wrapper — matches what placesAPIService.ts expects
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

// ── gracefulAuthFilter (Ported from frontend) ──────────────────────────────────
function gracefulAuthFilter(places) {
    const strict = places.filter(p => (p.rating || 0) >= 3.8 && (p.userRatingCount || 0) >= 20);
    if (strict.length >= 3) return { filtered: strict, tier: 1 };

    const loose = places.filter(p => (p.rating || 0) >= 3.5 || (p.userRatingCount || 0) >= 5);
    if (loose.length >= 3) return { filtered: loose, tier: 2 };

    return { filtered: places, tier: 3 };
}

// ── /api/analyze-location — Centralized Intelligence API ─────────────────────
// Executes frontend TS logic directly on the server for perfect sync.
app.post('/api/analyze-location', async (req, res) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Places API key missing' });

  const { lat, lng, radius, domainId } = req.body;
  if (!lat || !lng || !domainId) return res.status(400).json({ error: 'Missing parameters' });

  const config = DOMAIN_CONFIG[domainId];
  if (!config) return res.status(400).json({ error: 'Invalid domainId' });

  const BASIC_FIELD_MASK = 'places.id,places.displayName,places.location,places.types,places.businessStatus';
  const ADV_FIELD_MASK = 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.types,places.formattedAddress,places.businessStatus';

  const mapPlace = p => ({
      id: p.id,
      displayName: p.displayName?.text || 'Unknown',
      location: { lat: p.location?.latitude || 0, lng: p.location?.longitude || 0 },
      rating: p.rating,
      userRatingCount: p.userRatingCount,
      priceLevel: p.priceLevel,
      types: p.types || [],
      formattedAddress: p.formattedAddress,
      businessStatus: p.businessStatus,
  });

  const fetchPlaces = async (types, fieldMask) => {
      if (types.length === 0) return [];
      const body = {
          includedTypes: types,
          maxResultCount: 20,
          locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } }
      };
      const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': apiKey,
              'X-Goog-FieldMask': fieldMask,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8000)
      });
      const data = await response.json();
      return (data.places || []).map(mapPlace).filter(p => !p.businessStatus || p.businessStatus === 'OPERATIONAL');
  };

  try {
      const [compRaw, corpRaw, infraRaw, transitRaw, aptRaw] = await Promise.all([
          fetchPlaces(config.competitorTypes, ADV_FIELD_MASK),
          fetchPlaces(['corporate_office', 'coworking_space'], BASIC_FIELD_MASK),
          fetchPlaces(config.infraTypes, BASIC_FIELD_MASK),
          fetchPlaces(['bus_station', 'bus_stop', 'light_rail_station', 'subway_station'], BASIC_FIELD_MASK),
          fetchPlaces(['apartment_complex'], BASIC_FIELD_MASK),
      ]);

      // Apply filters identical to frontend
      const CORPORATE_BLOCKLIST = ['hotel', 'mall', 'hospital', 'clinic', 'school', 'college', 'university', 'bank', 'atm', 'temple', 'church', 'mosque', 'salon', 'spa', 'supermarket', 'store', 'restaurant', 'cafe', 'pharmacy', 'medical', 'court', 'police', 'government', 'municipality', 'apartment', 'residency', 'residences'];
      const corporates = corpRaw.filter(p => !CORPORATE_BLOCKLIST.some(word => p.displayName.toLowerCase().includes(word)));
      const { filtered: competitors } = gracefulAuthFilter(compRaw);

      const intel: any = {
          competitors: { total: competitors.length, places: competitors },
          corporateOffices: { total: corporates.length, places: corporates },
          infraSynergy: { total: infraRaw.length, places: infraRaw },
          transitStations: { total: transitRaw.length, places: transitRaw },
          apartments: { total: aptRaw.length, places: aptRaw },
          competitionLevel: 'Unknown',
          marketGap: 'Unknown',
      };

      const scores = calculateDomainScores(intel, domainId, radius);

      res.json({ success: true, intel, scores });
  } catch (error) {
      console.error('Analyze Location API error:', error);
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
