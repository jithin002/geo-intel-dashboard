const express = require('express');
const cors = require('cors');
const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');

const app = express();
const port = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize BigQuery client
// Pointing directly to the service account JSON we downloaded in the scraper phase
const keyFilename = path.join(__dirname, 'rent-scraper', 'service-account.json');
const bigquery = new BigQuery({
  projectId: 'testing-jithin',
  keyFilename: keyFilename,
});

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

app.listen(port, () => {
  console.log(`Rent Intelligence API running on http://localhost:${port}`);
});
