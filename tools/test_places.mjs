#!/usr/bin/env node
import fs from 'fs';

function loadKey() {
  if (process.env.GOOGLE_MAPS_API_KEY) return process.env.GOOGLE_MAPS_API_KEY;
  if (process.env.VITE_GOOGLE_MAPS_API_KEY) return process.env.VITE_GOOGLE_MAPS_API_KEY;
  const envFile = '.env.local';
  if (fs.existsSync(envFile)) {
    const txt = fs.readFileSync(envFile, 'utf8');
    const m = txt.match(/VITE_GOOGLE_MAPS_API_KEY\s*=\s*(.+)/);
    if (m) return m[1].trim();
  }
  return null;
}

async function run() {
  const key = loadKey();
  if (!key) {
    console.error('No Google Maps API key found. Set VITE_GOOGLE_MAPS_API_KEY in .env.local or env.');
    process.exit(1);
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': key,
    'X-Goog-FieldMask': 'places.displayName,places.location,places.types,places.rating,places.userRatingCount'
  };

  try {
    console.log('-> Calling Places Text Search (searchText)');
    const textBody = { textQuery: 'gyms in HSR Layout Bangalore', maxResultCount: 5 };
    const textRes = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers, body: JSON.stringify(textBody) });
    console.log('status:', textRes.status);
    const textJson = await textRes.text();
    console.log('body:', textJson);

    console.log('\n-> Calling Places Nearby Search (searchNearby)');
    const nearbyBody = {
      includedTypes: ['gym'],
      locationRestriction: { circle: { center: { latitude: 12.9716, longitude: 77.5946 }, radius: 1000 } },
      maxResultCount: 5
    };
    const nearbyRes = await fetch('https://places.googleapis.com/v1/places:searchNearby', { method: 'POST', headers, body: JSON.stringify(nearbyBody) });
    console.log('status:', nearbyRes.status);
    const nearbyJson = await nearbyRes.text();
    console.log('body:', nearbyJson);
  } catch (err) {
    console.error('Places test failed:', err);
  }
}

run();
