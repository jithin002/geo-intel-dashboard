/**
 * Chat Orchestration Service  (v3 — merged & hardened)
 *
 * Central coordinator between:
 *  - Gemini API  (conversational AI)
 *  - Places API  (location data)
 *  - Map UI      (visualization)
 *
 * Fixes applied vs v2:
 *  1. JSON leak / crash hardening  — tighter strip, per-call try/catch, prose-only retry
 *  2. Named-place geocoding        — Nominatim lookup before Places API call
 *  3. Cluster → map navigation     — cluster name passed as ward context; force-navigate
 *  4. Complex / multi-intent       — compare queries run two parallel fetches
 *  5. Out-of-domain guardrail      — identity banner + Bangalore-only restriction
 */

import { GoogleGenAI } from "@google/genai";
import {
    getLocationIntelligence,
    getDomainIntelligence,
    generateDataDrivenRecommendation,
    generateDomainRecommendation,
    textSearch,
    PlaceResult,
    LocationIntelligence,
    DomainLocationIntelligence,
} from './placesAPIService';
import { DOMAIN_CONFIG, DomainId } from '../domains';
import { calculateDomainScores } from './scoringEngine';
import { ScoringMatrix } from '../types';
import { GEMINI_PROXY_URL, USE_DIRECT_API } from './apiConfig';

const DIRECT_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY || '';

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatContext {
    recentMessages?: Array<{ role: string; content: string }>;
    currentLocation?: [number, number];
    selectedWard?: string;
    domain?: string;
    radius?: number;
    scores?: ScoringMatrix;
    realPOIs?: any;
    wardClusters?: any[];
}

export interface PlacesDataRequest {
    action: 'analyze_location' | 'search_places' | 'get_intelligence' | 'compare_locations';
    params: {
        lat?: number;
        lng?: number;
        radius?: number;
        types?: string[];
        query?: string;
        locations?: Array<{ lat: number; lng: number; name: string }>;
    };
}

export interface MapAction {
    type: 'zoom' | 'navigate' | 'highlight' | 'analyze';
    payload: {
        location?: [number, number];
        zoom?: number;
        wardName?: string;
        poiType?: string;
        triggerAnalysis?: boolean;
    };
}

export interface ChatResponse {
    text: string;
    mapAction?: MapAction;
    placesData?: any;
    prefetchedIntel?: any;
    usedPlacesAPI: boolean;
    usedGemini: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 5 — Out-of-scope keyword guard  (no API cost, instant response)
// ─────────────────────────────────────────────────────────────────────────────

const OUT_OF_SCOPE_KEYWORDS = [
    // Weather / news
    'weather', 'temperature', 'rain', 'forecast', 'news', 'politics', 'election',
    // Sports
    'cricket', 'ipl', 'football', 'match', 'score', 'fifa', 'nba',
    // Finance/markets
    'stock price', 'share price', 'nifty', 'sensex', 'crypto', 'bitcoin',
    // Coding
    'write code', 'python script', 'javascript function', 'debug this', 'help me code',
    // Cooking / recipes
    'recipe', 'how to cook', 'ingredients',
    // Out-of-Bangalore cities (common ones)
    'in mumbai', 'in delhi', 'in chennai', 'in hyderabad', 'in pune', 'in kolkata',
    'in new york', 'in london', 'in dubai', 'in singapore',
];

function isOutOfScope(message: string): string | null {
    const lower = message.toLowerCase();
    for (const kw of OUT_OF_SCOPE_KEYWORDS) {
        if (lower.includes(kw)) {
            // Detect city-outside-Bangalore pattern
            const cityMatch = kw.startsWith('in ');
            if (cityMatch) {
                return `I'm the **Geo-Intel Assistant** — built exclusively to help you find optimal business locations in **Bangalore**. It looks like you're asking about ${kw.replace('in ', '')}. I'm focused on Bangalore only.\n\nWould you like me to find a similar opportunity zone within Bangalore instead?`;
            }
            return `I'm the **Geo-Intel Assistant** — built to help entrepreneurs and analysts find the best business locations in **Bangalore**.\n\nFor "${kw}" queries, I'd suggest a general search engine or a dedicated tool. But if you have a location in Bangalore you'd like me to analyse, I'm ready! 🗺️`;
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 4 — Complex / compare query detector
// ─────────────────────────────────────────────────────────────────────────────

interface CompareIntent {
    isCompare: boolean;
    locations: string[];  // up to 2 named locations
}

function detectCompareIntent(message: string): CompareIntent {
    const lower = message.toLowerCase();
    const vsPattern = /\bvs\.?\b|\bversus\b|\bcompare\b|\bvs compared\b/i;
    if (!vsPattern.test(lower)) return { isCompare: false, locations: [] };

    // Extract the two location tokens around "vs / versus / compare"
    const parts = lower.split(/\bvs\.?\b|\bversus\b|\bcompare\b/i);
    if (parts.length < 2) return { isCompare: false, locations: [] };

    // Clean fillers and pick last meaningful word chunks as location names
    const clean = (s: string) =>
        s.replace(/^(gyms?|restaurants?|banks?|retail|shops?|in|near|around|and|for|the|a|an)\s+/gi, '').trim();

    const loc1 = clean(parts[0]).split(/\s+/).slice(-3).join(' ');
    const loc2 = clean(parts[1]).split(/\s+/).slice(0, 3).join(' ');

    if (!loc1 || !loc2) return { isCompare: false, locations: [] };
    return { isCompare: true, locations: [loc1, loc2] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope Fix — Strict Geographic Bounds for Bangalore
// ─────────────────────────────────────────────────────────────────────────────

const BANGALORE_BOUNDS = {
    north: 13.1436 + 0.05,
    south: 12.8340 - 0.05,
    east: 77.7840 + 0.05,
    west: 77.4601 - 0.05
};

function isInsideBangalore(lat: number, lng: number): boolean {
    return lat >= BANGALORE_BOUNDS.south &&
           lat <= BANGALORE_BOUNDS.north &&
           lng >= BANGALORE_BOUNDS.west &&
           lng <= BANGALORE_BOUNDS.east;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2 — Nominatim geocoder
// ─────────────────────────────────────────────────────────────────────────────

async function geocodeQuery(query: string): Promise<[number, number] | null> {
    try {
        // Try with ", Bangalore" suffix first
        const url1 = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query + ', Bangalore')}`;
        const resp1 = await fetch(url1);
        const data1 = await resp1.json();
        if (data1 && data1.length > 0) {
            return [parseFloat(data1[0].lat), parseFloat(data1[0].lon)];
        }
        // Fallback — try without the city suffix
        const url2 = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
        const resp2 = await fetch(url2);
        const data2 = await resp2.json();
        if (data2 && data2.length > 0) {
            return [parseFloat(data2[0].lat), parseFloat(data2[0].lon)];
        }
        return null;
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestration entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function processUserQuery(
    userMessage: string,
    context: ChatContext
): Promise<ChatResponse> {

    if (USE_DIRECT_API && !DIRECT_API_KEY) {
        return {
            text: "⚠️ Gemini API key not configured. Please add VITE_GEMINI_API_KEY to .env.local",
            usedPlacesAPI: false,
            usedGemini: false
        };
    }

    // ── Fix 5: Out-of-scope guard (zero API cost) ──────────────────────────
    const scopeReply = isOutOfScope(userMessage);
    if (scopeReply) {
        return { text: scopeReply, usedPlacesAPI: false, usedGemini: false };
    }

    // ── Fix 4: Detect compare intent before calling Gemini ─────────────────
    const compareIntent = detectCompareIntent(userMessage);
    if (compareIntent.isCompare && compareIntent.locations.length === 2) {
        return handleCompareQuery(userMessage, compareIntent.locations, context);
    }

    const systemPrompt = buildAgenticSystemPrompt(context);
    const fullPrompt = `${systemPrompt}\n\nUser: ${userMessage}`;

    console.log('🤖 Sending query to Gemini (agentic mode)...');

    try {
        // ── Step 1: Intent detection call ─────────────────────────────────
        let geminiText = '';
        try {
            if (USE_DIRECT_API) {
                const ai = new GoogleGenAI({ apiKey: DIRECT_API_KEY });
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: fullPrompt,
                    config: { temperature: 0.2, maxOutputTokens: 400 }  // Fix 1: cap at 400
                });
                geminiText = response.text || '';
            } else {
                const resp = await fetch(GEMINI_PROXY_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages: [{ role: 'user', content: fullPrompt }] }),
                });
                const data = await resp.json();
                geminiText = data.text || '';
            }
        } catch (intentErr) {
            console.error('❌ Gemini intent call failed:', intentErr);
            return {
                text: 'I had trouble connecting to the AI service. Please try again in a moment.',
                usedPlacesAPI: false,
                usedGemini: false
            };
        }

        console.log('💬 Gemini raw intent response:', geminiText.substring(0, 250));

        // ── Step 2: Parse tool request ─────────────────────────────────────
        let toolRequest = parseToolRequest(geminiText);

        // Fix 1: If parse failed but output looks like escaped/broken JSON → retry with prose-only instruction
        if (!toolRequest) {
            const looksLikeJson = (geminiText.trim().startsWith('{') || geminiText.trim().startsWith('```')) &&
                geminiText.length < 600;
            if (looksLikeJson) {
                console.warn('⚠️ Suspected broken JSON from Gemini — retrying with prose-only instruction');
                try {
                    const retryPrompt = `${systemPrompt}\n\nUser: ${userMessage}\n\nIMPORTANT: Respond ONLY in natural language — no JSON, no code blocks.`;
                    let retryText = '';
                    if (USE_DIRECT_API) {
                        const ai = new GoogleGenAI({ apiKey: DIRECT_API_KEY });
                        const retryResponse = await ai.models.generateContent({
                            model: 'gemini-2.5-flash',
                            contents: retryPrompt,
                            config: { temperature: 0.4, maxOutputTokens: 800 }
                        });
                        retryText = retryResponse.text || '';
                    } else {
                        const resp = await fetch(GEMINI_PROXY_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ messages: [{ role: 'user', content: retryPrompt }] }),
                        });
                        const data = await resp.json();
                        retryText = data.text || '';
                    }
                    return {
                        text: stripJsonBlocks(retryText) || 'I can help you analyse locations in Bangalore. Could you clarify what you need?',
                        usedPlacesAPI: false,
                        usedGemini: true
                    };
                } catch (retryErr) {
                    console.error('❌ Retry call also failed:', retryErr);
                }
            }
        }

        if (toolRequest) {
            console.log('🔧 Gemini requested Places API data:', toolRequest.action);

            // ── Fix 2: Geocode named places before fetching ────────────────
            // PROBLEM: When a cluster is selected, Gemini may "helpfully" copy those coords
            // into its JSON even when the user is asking about a different place.
            // SOLUTION: When a query string is present, ALWAYS geocode it and use the result
            // when it differs from the context location by more than ~1km.
            if (toolRequest.params.query) {
                const geocoded = await geocodeQuery(toolRequest.params.query);
                if (geocoded) {
                    // Fix 2a: Bangalore bounds check
                    if (!isInsideBangalore(geocoded[0], geocoded[1])) {
                        return {
                            text: "I found that location, but it appears to be outside Bangalore. I am strictly focused on analyzing business opportunities within Bangalore city limits. Please try a location within Bangalore.",
                            usedPlacesAPI: false,
                            usedGemini: false
                        };
                    }

                    const ctxLat = context.currentLocation?.[0];
                    const ctxLng = context.currentLocation?.[1];
                    const isSameAsCluster = ctxLat !== undefined && ctxLng !== undefined &&
                        Math.abs(geocoded[0] - ctxLat) < 0.01 &&  // ~1.1 km
                        Math.abs(geocoded[1] - ctxLng) < 0.01;

                    if (!isSameAsCluster) {
                        // Geocoded place is different from the selected cluster → use it
                        console.log(`🌍 Geocoded "${toolRequest.params.query}" → [${geocoded[0]}, ${geocoded[1]}] (overriding context/Gemini coords)`);
                        toolRequest.params.lat = geocoded[0];
                        toolRequest.params.lng = geocoded[1];
                    } else if (!toolRequest.params.lat || !toolRequest.params.lng) {
                        // Geocode returned same location but Gemini omitted coords — still fill them in
                        toolRequest.params.lat = geocoded[0];
                        toolRequest.params.lng = geocoded[1];
                    }
                } else if (!toolRequest.params.lat || !toolRequest.params.lng) {
                    console.warn(`⚠️ Geocoding failed for "${toolRequest.params.query}" and Gemini provided no coords`);
                }
            }

            // ── Step 3: Fetch Places data (domain-aware) ───────────────────
            const placesData = await fetchPlacesData(toolRequest, context);

            // ── Step 4: Format + map action ────────────────────────────────
            const activeDomain = (context.domain || 'gym') as DomainId;
            const formattedResults = formatPlacesResults(placesData, toolRequest.action, activeDomain);
            const mapAction = createMapAction(toolRequest, placesData, context);


            // ── Step 5: Synthesiser Gemini call ────────────────────────────
            const domainCfg = DOMAIN_CONFIG[activeDomain] || DOMAIN_CONFIG['gym'];
            const contextualPrompt = `${systemPrompt}

User: ${userMessage}

Places API Analysis Results:
${formattedResults}

INSTRUCTIONS:
You are provided with a pre-computed "GEO-GROUNDED STRATEGY" for a **${domainCfg.label}** (${domainCfg.tagline}).
DO NOT re-calculate or invent strategies. Summarise the above analysis naturally for the user.
Use domain context (${domainCfg.label}) throughout — never refer to a different domain.
Be concise, highlight key numbers, and weave in the tactical recommendation.
Respond ONLY in natural language — no JSON, no code blocks.`;

            let finalText = '';
            try {
                if (USE_DIRECT_API) {
                    const ai = new GoogleGenAI({ apiKey: DIRECT_API_KEY });
                    const finalResponse = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: contextualPrompt,
                        config: { temperature: 0.4, maxOutputTokens: 3000 }  // 3000 for rich answers
                    });
                    finalText = stripJsonBlocks(finalResponse.text || 'Analysis complete.');
                } else {
                    const resp = await fetch(GEMINI_PROXY_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ messages: [{ role: 'user', content: contextualPrompt }] }),
                    });
                    const data = await resp.json();
                    finalText = stripJsonBlocks(data.text || 'Analysis complete.');
                }
            } catch (synthErr) {
                console.error('❌ Gemini synthesiser call failed:', synthErr);
                finalText = 'I gathered the location data but had trouble generating the summary. Please try again.';
            }

            // Determine if placesData is a LocationIntelligence object (analyze/get_intelligence)
            const isLocationIntel =
                toolRequest.action === 'analyze_location' ||
                toolRequest.action === 'get_intelligence';

            return {
                text: finalText,
                mapAction,
                placesData,
                prefetchedIntel: isLocationIntel ? placesData : undefined,
                usedPlacesAPI: true,
                usedGemini: true
            };

        } else {
            // No Places API needed — clean and return prose directly
            console.log('💬 Direct response (no Places API needed)');
            const cleanText = stripJsonBlocks(geminiText);

            // Fix 1: Guard against raw-JSON leaking as prose
            const isRawLeak = (geminiText.trim().startsWith('```json') || geminiText.trim().startsWith('{')) &&
                geminiText.includes('"tool": "places_api"') &&
                !geminiText.match(/[A-Za-z]{20,}/);

            if (isRawLeak) {
                console.warn('⚠️ Raw JSON tool call intercepted in prose path');
                const area = context.selectedWard || 'this area';
                return {
                    text: `I understand you're asking about ${context.domain || 'business'} options in ${area}. Could you be more specific — e.g. competition level, best spots, or footfall potential?`,
                    usedPlacesAPI: false,
                    usedGemini: true
                };
            }

            return {
                text: cleanText || geminiText,
                usedPlacesAPI: false,
                usedGemini: true
            };
        }

    } catch (error) {
        console.error('❌ Chat orchestration error:', error);
        return {
            text: 'Sorry, I encountered an error processing your request. Please try again.',
            usedPlacesAPI: false,
            usedGemini: false
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 4 — Compare handler  (two parallel Places API calls)
// ─────────────────────────────────────────────────────────────────────────────

async function handleCompareQuery(
    userMessage: string,
    locations: string[],
    context: ChatContext
): Promise<ChatResponse> {
    console.log(`⚖️ Compare query detected: "${locations[0]}" vs "${locations[1]}"`);

    const activeDomain = (context.domain || 'gym') as DomainId;
    const domainCfg = DOMAIN_CONFIG[activeDomain];
    const radius = context.radius || 1000;

    try {
        // Geocode both locations in parallel
        const [geo1, geo2] = await Promise.all([
            geocodeQuery(locations[0]),
            geocodeQuery(locations[1])
        ]);

        if (!geo1 || !geo2) {
            return {
                text: `I couldn't find one or both locations ("${locations[0]}", "${locations[1]}") in Bangalore. Could you double-check the area names?`,
                usedPlacesAPI: false,
                usedGemini: false
            };
        }

        // Fetch intelligence for both in parallel
        let intel1: any, intel2: any;
        if (activeDomain === 'gym') {
            [intel1, intel2] = await Promise.all([
                getLocationIntelligence(geo1[0], geo1[1], radius),
                getLocationIntelligence(geo2[0], geo2[1], radius)
            ]);
        } else {
            [intel1, intel2] = await Promise.all([
                getDomainIntelligence(geo1[0], geo1[1], radius, domainCfg.competitorTypes, domainCfg.infraTypes),
                getDomainIntelligence(geo2[0], geo2[1], radius, domainCfg.competitorTypes, domainCfg.infraTypes)
            ]);
        }

        const score1 = calculateDomainScores(intel1, activeDomain, radius);
        const score2 = calculateDomainScores(intel2, activeDomain, radius);

        const fmt = (intel: any, label: string, score: any) =>
            formatPlacesResults(intel, 'get_intelligence', activeDomain, label, score);

        const systemPrompt = buildAgenticSystemPrompt(context);

        const comparePrompt = `${systemPrompt}

User: ${userMessage}

=== LOCATION COMPARISON DATA ===

--- ${locations[0].toUpperCase()} ---
${fmt(intel1, locations[0], score1)}

--- ${locations[1].toUpperCase()} ---
${fmt(intel2, locations[1], score2)}

INSTRUCTIONS:
Compare both areas for a **${domainCfg.label}** opportunity. Present a side-by-side comparison highlighting:
- Which area has higher demand / footfall
- Which has lower competition
- Which has better transit access
- Final recommendation: which area is the better bet and why
Respond in natural language with a clear recommendation. No JSON. Be concise but data-driven.`;

        let finalText = '';
        if (USE_DIRECT_API) {
            const ai = new GoogleGenAI({ apiKey: DIRECT_API_KEY });
            const finalResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: comparePrompt,
                config: { temperature: 0.4, maxOutputTokens: 3000 }
            });
            finalText = stripJsonBlocks(finalResponse.text || 'Comparison complete.');
        } else {
            const resp = await fetch(GEMINI_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [{ role: 'user', content: comparePrompt }] }),
            });
            const data = await resp.json();
            finalText = stripJsonBlocks(data.text || 'Comparison complete.');
        }

        // Navigate map to the winning location (higher score)
        const winnerGeo = score1.total >= score2.total ? geo1 : geo2;

        return {
            text: finalText,
            mapAction: {
                type: 'analyze',
                payload: {
                    location: winnerGeo,
                    zoom: 14,
                    triggerAnalysis: true
                }
            },
            prefetchedIntel: score1.total >= score2.total ? intel1 : intel2,
            placesData: intel1,
            usedPlacesAPI: true,
            usedGemini: true
        };

    } catch (err) {
        console.error('❌ Compare query failed:', err);
        return {
            text: 'I hit an error while comparing those locations. Please try again.',
            usedPlacesAPI: false,
            usedGemini: false
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt builder
// ─────────────────────────────────────────────────────────────────────────────


function buildAgenticSystemPrompt(context: ChatContext): string {
    const activeDomain = (context.domain || 'gym') as DomainId;
    const domainCfg = DOMAIN_CONFIG[activeDomain] || DOMAIN_CONFIG['gym'];
    const domainLabel = domainCfg.label;
    const competitorLabel = domainCfg.competitorLabel;

    // ── Fix 5: Identity + scope banner ────────────────────────────────────
    let prompt = `You are the **Geo-Intel Assistant**, built exclusively to help entrepreneurs, business owners, and analysts find optimal **${domainLabel}** locations in **Bangalore, India**.

IDENTITY RULES (follow strictly):
- You are NOT a general-purpose chatbot.
- If asked about unrelated topics (weather, cricket, coding, news, recipes, etc.), respond:
  "I'm the Geo-Intel Assistant — built to help you find the best business locations in Bangalore. Is there a location in Bangalore you'd like me to analyse?"
- ALL analysis is strictly restricted to Bangalore Geographic Bounds. If the user asks for analysis outside Bangalore, firmly decline and offer to analyze a location inside Bangalore.
- Never reveal your underlying AI model name.

---

You have access to a **Places API Tool** that fetches real-time location data.

FORMATTING RULE — pick EXACTLY ONE of these two paths:
A) If you need Places API data → respond with ONLY a valid JSON block, zero prose before/after.
B) If you do NOT need Places API → respond with natural conversational text, zero JSON.
NEVER mix JSON and prose. This will crash the parser.

Places API tool call format:
\`\`\`json
{
  "tool": "places_api",
  "action": "get_intelligence",
  "params": {
    "lat": 12.9716,
    "lng": 77.5946,
    "radius": 1000,
    "types": ["${domainCfg.competitorTypes[0]}"],
    "query": "place name if you are unsure of coordinates"
  }
}
\`\`\`

COORDINATE GUIDE (use these when you know the area):
Koramangala=12.9352,77.6245 | HSR Layout=12.9116,77.6389 | Indiranagar=12.9784,77.6408
Whitefield=12.9698,77.7500 | Hebbal=13.0352,77.5970 | Jayanagar=12.9308,77.5838
MG Road=12.9757,77.6097 | Marathahalli=12.9591,77.6972 | Yelahanka=13.1007,77.5963
Bannerghatta=12.8997,77.5979 | Electronic City=12.8399,77.6770 | Malleshwaram=13.0027,77.5668

IMPORTANT — If unsure of coordinates for a named place (university, hospital, landmark):
  → Set "query" to the place name, and OMIT lat/lng. The system will geocode it automatically.

Available actions:
- \`analyze_location\` : Full area analysis (${competitorLabel}, competition, demand, scores)
- \`search_places\`    : Find specific places by type or query  
- \`get_intelligence\` : Comprehensive location intelligence report

When to use Places API:
- User asks about specific locations ("Find ${competitorLabel} in HSR Layout")
- User wants competition analysis ("How many ${competitorLabel} are nearby?")
- User asks for recommendations ("Best area for a ${domainLabel}?")
- Complex area or multi-location analysis

When NOT to use Places API:
- Greetings, general clarifications, simple follow-up questions
- Questions about currently visible data

**CRITICAL:** If you decide to call the Places API, respond with ONLY the JSON block above. Do not add any extra text before or after the JSON — this will cause a parsing error.

**IMPORTANT - Coordinates:** Always provide accurate lat/lng for named locations (e.g. HSR Layout = 12.9116, 77.6389; Koramangala = 12.9352, 77.6245; Whitefield = 12.9698, 77.7500; Hebbal = 13.0352, 77.5970; Indiranagar = 12.9784, 77.6408; Jayanagar = 12.9308, 77.5838; Marathahalli = 12.9591, 77.6972). If unsure of exact coords, include the area name in the "query" field and omit lat/lng.


`;

    // ── Fix 3: Include cluster context so Gemini uses the right coords ─────
    if (context.selectedWard || context.currentLocation) {
        prompt += `\n**Current Context:**\n`;
        if (context.selectedWard) {
            prompt += `- Selected Area / Cluster: ${context.selectedWard}\n`;
        }
        if (context.currentLocation) {
            prompt += `- Coordinates: [${context.currentLocation[0].toFixed(4)}, ${context.currentLocation[1].toFixed(4)}]\n`;
            prompt += `  (Use THESE coordinates when the user refers to "this area", "here", or "current location")\n`;
        }
        if (context.scores) {
            prompt += `- Site Score: ${context.scores.total}/100\n`;
            prompt += `- Active Domain: ${domainLabel}\n`;
        }
    }

    // Conversation history
    if (context.recentMessages && context.recentMessages.length > 0) {
        prompt += `\n**Recent Conversation:**\n`;
        context.recentMessages.slice(-4).forEach(msg => {
            prompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.substring(0, 200)}\n`;
        });
    }

    return prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1 — Robust JSON strip
// ─────────────────────────────────────────────────────────────────────────────

function stripJsonBlocks(text: string): string {
    // Remove fenced ```json … ``` blocks
    let cleaned = text.replace(/```json[\s\S]*?```/gi, '').trim();
    // Remove bare top-level { "tool": "places_api" … } objects
    cleaned = cleaned.replace(/\{[\s\S]*?"tool"\s*:\s*"places_api"[\s\S]*?\}/g, '').trim();
    // Remove any stray { "action": … } objects that don't have surrounding prose
    cleaned = cleaned.replace(/^\s*\{[\s\S]*?"action"\s*:[\s\S]*?\}\s*$/gm, '').trim();
    // Collapse 3+ blank lines left by removal
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool request parser
// ─────────────────────────────────────────────────────────────────────────────

function parseToolRequest(geminiText: string): PlacesDataRequest | null {
    try {
        // Strategy 1: fenced ```json … ```
        const fencedMatch = geminiText.match(/```json\s*([\s\S]*?)\s*```/);
        if (fencedMatch) {
            const json = JSON.parse(fencedMatch[1]);
            if (json.tool === 'places_api' && json.action && json.params) {
                return { action: json.action, params: json.params };
            }
        }

        // Strategy 2: inline { "tool": "places_api" … }
        const inlineMatch = geminiText.match(/\{[\s\S]*?"tool"\s*:\s*"places_api"[\s\S]*?\}/);
        if (inlineMatch) {
            const json = JSON.parse(inlineMatch[0]);
            if (json.action && json.params) {
                return { action: json.action, params: json.params };
            }
        }

        return null;
    } catch (err) {
        console.error('Tool request parse error:', err);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Places data fetcher  (domain-aware)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPlacesData(
    request: PlacesDataRequest,
    context: ChatContext
): Promise<LocationIntelligence | DomainLocationIntelligence | PlaceResult[]> {

    const { action, params } = request;
    const lat = params.lat || context.currentLocation?.[0];
    const lng = params.lng || context.currentLocation?.[1];
    const radius = context.radius || params.radius || 1000;

    if (!lat || !lng) {
        throw new Error('Location coordinates required for Places API — neither Gemini nor geocoder resolved them');
    }

    const activeDomain = (context.domain || 'gym') as DomainId;
    console.log(`📍 Fetching Places data: ${action} at [${lat}, ${lng}] r=${radius}m domain=${activeDomain}`);

    switch (action) {
        case 'analyze_location':
        case 'get_intelligence': {
            if (activeDomain === 'gym') {
                return await getLocationIntelligence(lat, lng, radius);
            }
            const domainCfg = DOMAIN_CONFIG[activeDomain];
            return await getDomainIntelligence(lat, lng, radius, domainCfg.competitorTypes, domainCfg.infraTypes);
        }

        case 'search_places':
            if (params.query) {
                return await textSearch(params.query, lat, lng);
            } else if (params.types && params.types.length > 0) {
                const { nearbySearch } = await import('./placesAPIService');
                return await nearbySearch(lat, lng, radius, params.types);
            }
            throw new Error('search_places requires either query or types');

        default:
            throw new Error(`Unknown action: ${action}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Results formatter  (domain-aware)
// ─────────────────────────────────────────────────────────────────────────────

function formatPlacesResults(
    data: LocationIntelligence | DomainLocationIntelligence | PlaceResult[] | any,
    action: string,
    domain: DomainId = 'gym',
    locationLabel?: string,  // Fix 4: optional label for compare queries
    precomputedScore?: any
): string {
    const header = locationLabel ? `=== ${locationLabel.toUpperCase()} ===\n\n` : `=== Places API Results ===\n\n`;
    let formatted = header;

    if (action === 'analyze_location' || action === 'get_intelligence') {
        const domainCfg = DOMAIN_CONFIG[domain] || DOMAIN_CONFIG['gym'];

        const isGymShape = 'gyms' in data;
        const isDomainShape = 'competitors' in data;

        formatted += `**Domain:** ${domainCfg.label}\n`;
        formatted += `**Area Analysis:**\n`;

        if (isGymShape) {
            const intel = data as LocationIntelligence;
            formatted += `- ${domainCfg.competitorLabel}: ${intel.gyms.total} (${intel.gyms.highRated} rated 4+★, avg ${intel.gyms.averageRating}★)\n`;
            formatted += `- Corporate Offices: ${intel.corporateOffices.total}\n`;
            formatted += `- Residential Complexes: ${intel.apartments.total}\n`;
            formatted += `- Cafes/Restaurants: ${intel.cafesRestaurants.total} (${intel.cafesRestaurants.healthFocused} health-focused)\n`;
            formatted += `- Transit Stations: ${intel.transitStations.total}\n`;
            formatted += `- Competition Level: ${intel.competitionLevel}\n`;
            formatted += `- Market Opportunity: ${intel.marketGap}\n\n`;

            const scores = precomputedScore || calculateDomainScores(intel, domain, 1000);
            formatted += `**Site Score:** ${scores.total}/100\n`;
            const recommendation = generateDataDrivenRecommendation(intel, scores);
            formatted += `**Strategic Recommendation:**\n${recommendation}\n`;

        } else if (isDomainShape) {
            const intel = data as DomainLocationIntelligence;
            formatted += `- ${domainCfg.competitorLabel}: ${intel.competitors.total} (${intel.competitors.highRated} rated 4+★, avg ${intel.competitors.averageRating}★)\n`;
            formatted += `- Corporate Offices: ${intel.corporateOffices.total}\n`;
            formatted += `- Residential Complexes: ${intel.apartments.total}\n`;
            formatted += `- Infra / Synergy: ${intel.infraSynergy.total}\n`;
            formatted += `- Transit Stations: ${intel.transitStations.total}\n`;
            formatted += `- Competition Level: ${intel.competitionLevel}\n`;
            formatted += `- Market Opportunity: ${intel.marketGap}\n\n`;

            const scores = precomputedScore || calculateDomainScores(intel, domain, 1000);
            formatted += `**Site Score:** ${scores.total}/100\n`;
            const recommendation = generateDomainRecommendation(intel, domain);
            formatted += `**Strategic Recommendation:**\n${recommendation}\n`;
        }

    } else if (action === 'search_places') {
        const places = Array.isArray(data) ? data : (data as any).places || [];
        formatted += `**Found ${places.length} places:**\n`;
        (places as PlaceResult[]).slice(0, 10).forEach((place, idx) => {
            formatted += `${idx + 1}. ${place.displayName}`;
            if (place.rating) formatted += ` (${place.rating}★)`;
            if (place.formattedAddress) formatted += ` — ${place.formattedAddress}`;
            formatted += '\n';
        });
    }

    return formatted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 3 — Map action creator  (cluster-aware, geocoder-coord-aware)
// ─────────────────────────────────────────────────────────────────────────────

function createMapAction(
    request: PlacesDataRequest,
    placesData: any,
    context: ChatContext
): MapAction | undefined {
    const { params } = request;

    // Fix 3: When a query is present, the geocoder has already overridden lat/lng above.
    // Prefer Gemini/geocoded coords. Only fall back to context.currentLocation when
    // there is no query (i.e. the user is explicitly asking about the currently selected
    // spot). When a query IS present, the geocoding step above has already resolved
    // the correct lat/lng — do NOT fall back to the cluster coords.
    const lat = params.lat ?? (params.query ? undefined : context.currentLocation?.[0]);
    const lng = params.lng ?? (params.query ? undefined : context.currentLocation?.[1]);

    if (!lat || !lng) return undefined;

    return {
        type: 'analyze',
        payload: {
            location: [lat, lng],
            zoom: 15,
            triggerAnalysis: true,
            wardName: params.query || undefined
        }
    };
}
