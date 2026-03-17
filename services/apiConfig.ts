/**
 * API Configuration
 *
 * Routes all external API calls through Cloud Function proxies
 * so that API keys are never exposed in the frontend bundle.
 */

// Cloud Function proxy URLs (deployed on GCP)
export const PLACES_PROXY_URL =
  import.meta.env.VITE_PLACES_PROXY_URL ||
  'https://us-central1-testing-anirban.cloudfunctions.net/places-api-proxy';

export const GEMINI_PROXY_URL =
  import.meta.env.VITE_GEMINI_PROXY_URL ||
  'https://us-central1-testing-anirban.cloudfunctions.net/gemini-proxy';

// Set to true when running locally with direct API keys (dev mode only)
export const USE_DIRECT_API =
  import.meta.env.DEV && !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

export const GOOGLE_PLACES_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
