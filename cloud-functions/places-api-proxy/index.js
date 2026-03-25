const functions = require('@google-cloud/functions-framework');
const fetch = require('node-fetch');

functions.http('placesApiProxy', async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const { endpoint, params } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint parameter required' });
    }

    // Get API key from environment (stored securely)
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const { body: reqBody, fieldMask } = req.body;

    // Construct URL
    const url = `https://places.googleapis.com/${endpoint}`;

    console.log(`Calling Places API: ${endpoint}`);

    // Call Google Places API
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask || 'places.id,places.displayName,places.location,places.types,places.businessStatus'
      },
      body: JSON.stringify(reqBody || {})
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Places API error:', data);
      return res.status(response.status).json(data);
    }

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error('Places API Proxy Error:', error);
    res.status(500).json({ 
      error: 'Failed to call Places API',
      details: error.message 
    });
  }
});
