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

// ── Cloud Run Proxy URLs (deployed on testing-jithin / asia-south1) ───────────
// These are set at build time via VITE_PLACES_PROXY_URL / VITE_GEMINI_PROXY_URL.
// Fallback values point to the deployed services on testing-jithin.
export const PLACES_PROXY_URL =
  import.meta.env.VITE_PLACES_PROXY_URL ||
  'https://places-api-proxy-PLACEHOLDER-el.a.run.app';

export const GEMINI_PROXY_URL =
  import.meta.env.VITE_GEMINI_PROXY_URL ||
  'https://gemini-proxy-PLACEHOLDER-el.a.run.app';

// ── Dev mode switch ────────────────────────────────────────────────────────────
// true  → local dev: calls Google APIs directly using keys from .env.local
// false → production: all calls routed through secure Cloud Run proxies
export const USE_DIRECT_API =
  import.meta.env.DEV && !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

// Direct key — only used in dev mode (never reaches the production bundle meaningfully)
export const GOOGLE_PLACES_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
