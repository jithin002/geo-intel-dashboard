/**
 * API Configuration
 *
 * Routes all external API calls through Cloud Run proxy services
 * so that API keys are NEVER exposed in the frontend JS bundle.
 *
 * Architecture:
 *   Browser → Cloud Run Proxy (holds keys server-side) → Google APIs
 *
 * Local dev:  USE_DIRECT_API = true  → calls Google directly (uses .env.local keys)
 * Production: USE_DIRECT_API = false → routes through proxy Cloud Run services
 */

// ── Cloud Run Proxy URLs ───────────────────────────────────────────────────────
// In production: relative path → same Express server handles both frontend + API proxy.
// In dev: point to local Express dev server on port 3001.
export const PLACES_PROXY_URL =
  import.meta.env.VITE_PLACES_PROXY_URL ||
  (import.meta.env.PROD ? '/api/places' : 'http://localhost:3001/api/places');

export const GEMINI_PROXY_URL =
  import.meta.env.VITE_GEMINI_PROXY_URL ||
  'https://gemini-proxy-PLACEHOLDER-el.a.run.app';

// ── Dev mode switch ────────────────────────────────────────────────────────────
// Always route through our own server proxy (server.cjs handles the key server-side)
// so the API key is never exposed in the browser bundle.
export const USE_DIRECT_API = false;


// Direct key — only used in dev mode (never reaches the production bundle meaningfully)
export const GOOGLE_PLACES_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
