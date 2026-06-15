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
    return res.status(500).json({ error: 'Places API key not configured on server' });
  }

  const { endpoint = 'v1/places:searchNearby', body: reqBody, fieldMask } = req.body;

  if (!reqBody) {
    return res.status(400).json({ error: 'Missing body in request' });
  }

  const googleUrl = `https://places.googleapis.com/${endpoint}`;
  const mask = fieldMask || 
    'places.id,places.displayName,places.location,places.types,places.businessStatus,places.rating,places.userRatingCount,places.priceLevel,places.formattedAddress';

  try {
    const googleRes = await fetch(googleUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': mask,
      },
      body: JSON.stringify(reqBody),
    });

    const data = await googleRes.json();

    if (!googleRes.ok) {
      console.error('[Places] Google API error:', googleRes.status, JSON.stringify(data).slice(0, 200));
      return res.status(googleRes.status).json({ success: false, error: data });
    }

    // Return in { success, data } wrapper — matches what placesAPIService.ts expects
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Places] Proxy fetch error:', err.message);
    res.status(502).json({ success: false, error: 'Failed to reach Google Places API' });
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
          error: 'Could not create agent session. Make sure the ADK server is running on port 8000.',
        });
      }

      const sessionData = await sessionRes.json();
      activeSessionId = sessionData.id || sessionData.session_id || sessionData.sessionId;
      console.log(`[ADK] Session response:`, JSON.stringify(sessionData));
      console.log(`[ADK] New session created: ${activeSessionId}`);
    }

    // ── Step 2: Send message to ADK via /run_sse ─────────────────────────────
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
    });

    if (!runRes.ok) {
      const err = await runRes.text();
      console.error('ADK /run_sse error:', runRes.status, err);
      return res.status(502).json({
        error: 'Agent returned an error. Please try again.',
      });
    }

    // ── Step 3: Parse SSE stream → extract agent text + tool data ────────────
    // /run_sse returns a stream of "data: <json>\n\n" lines.
    // Events of interest:
    //   author === ADK_AGENT          → final text response
    //   author === 'analyze_location' → tool result with coordinates + scores
    //   author === 'compare_locations'→ tool result with two-location comparison
    const rawText = await runRes.text();
    const lines   = rawText.split('\n');
    let agentText = '';
    let toolData  = null;

    const TOOL_NAMES = new Set(['analyze_location', 'compare_locations', 'search_nearby']);

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6));

        // Final agent prose response
        if (event.author === ADK_AGENT && event.content?.parts?.[0]?.text) {
          agentText = event.content.parts[0].text;
        }

        // Tool response — identified by functionResponse part (author is still geo_intel_agent)
        if (event.author === ADK_AGENT) {
          for (const part of (event.content?.parts || [])) {
            const fr = part?.functionResponse;
            if (fr && TOOL_NAMES.has(fr.name)) {
              // ADK wraps return value in fr.response.output
              const output = fr.response?.output ?? fr.response;
              if (output?.status === 'success') {
                toolData = output;
              }
            }
          }
        }
      } catch {
        // malformed SSE line — skip
      }
    }

    console.log(`[ADK] Session ${activeSessionId} → text: ${agentText.length} chars | toolData: ${toolData ? JSON.stringify(toolData).slice(0, 80) : 'none'}`);

    return res.json({
      text:      agentText || 'No response received from the agent.',
      sessionId: activeSessionId,
      toolData,  // coordinates, scores, comparison winner — used by frontend for map nav
    });

  } catch (error) {
    console.error('[ADK] Proxy error:', error);
    return res.status(502).json({
      error: 'Failed to reach the Geo-Intel agent. Make sure the ADK server is running on port 8000.',
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
