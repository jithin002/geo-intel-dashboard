/**
 * Chat Orchestration Service  (v4 — modularized)
 *
 * Central coordinator between:
 *  - Gemini API  (conversational AI)
 *  - Places API  (location data)
 *  - Map UI      (visualization)
 *
 * Logic is unchanged from v3. This file now imports helpers from:
 *  - ./chat/chatTypes       → shared interfaces
 *  - ./chat/locationUtils   → geocodeQuery, isInsideBangalore
 *  - ./chat/intentParser    → parseToolRequest, stripJsonBlocks, detectCompareIntent
 *  - ./chat/promptBuilder   → buildAgenticSystemPrompt, isOutOfScope
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
import { GEMINI_PROXY_URL, USE_DIRECT_API } from './apiConfig';

// ── Split-module imports (zero logic change) ─────────────────────────────────
import { geocodeQuery, isInsideBangalore } from './chat/locationUtils';
import { detectCompareIntent, parseToolRequest, stripJsonBlocks } from './chat/intentParser';
import { buildAgenticSystemPrompt, isOutOfScope } from './chat/promptBuilder';

// ── Re-export types so existing callers of this module don't break ────────────
export type {
    ChatContext,
    PlacesDataRequest,
    MapAction,
    ChatResponse,
    CompareIntent,
} from './chat/chatTypes';

const DIRECT_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY || '';

// ─────────────────────────────────────────────────────────────────────────────
// Gemini API Retry Logic (Handles 503 / 429)
// ─────────────────────────────────────────────────────────────────────────────

async function callGeminiWithRetry(callFn: () => Promise<any>, maxRetries = 3, baseDelayMs = 2000): Promise<any> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await callFn();
        } catch (error: any) {
            const isRetryable =
                error?.status === 503 ||
                error?.status === 'UNAVAILABLE' ||
                error?.message?.includes('503') ||
                error?.status === 429 ||
                error?.message?.includes('429');

            if (isRetryable && attempt < maxRetries - 1) {
                const delayMs = baseDelayMs * Math.pow(1.5, attempt);
                console.warn(`⚠️ Gemini API heavily loaded. Retrying in ${Math.round(delayMs)}ms... (Attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            } else {
                throw error;
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestration entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function processUserQuery(
    userMessage: string,
    context: import('./chat/chatTypes').ChatContext
): Promise<import('./chat/chatTypes').ChatResponse> {

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
            geminiText = await callGeminiWithRetry(async () => {
                if (USE_DIRECT_API) {
                    const ai = new GoogleGenAI({ apiKey: DIRECT_API_KEY });
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: fullPrompt,
                        config: { temperature: 0.2, maxOutputTokens: 400 }  // Fix 1: cap at 400
                    });
                    return response.text || '';
                } else {
                    const resp = await fetch(GEMINI_PROXY_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ messages: [{ role: 'user', content: fullPrompt }] }),
                    });
                    const data = await resp.json();
                    return data.text || '';
                }
            });
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
                    let retryText = await callGeminiWithRetry(async () => {
                        if (USE_DIRECT_API) {
                            const ai = new GoogleGenAI({ apiKey: DIRECT_API_KEY });
                            const retryResponse = await ai.models.generateContent({
                                model: 'gemini-2.5-flash',
                                contents: retryPrompt,
                                config: { temperature: 0.4, maxOutputTokens: 800 }
                            });
                            return retryResponse.text || '';
                        } else {
                            const resp = await fetch(GEMINI_PROXY_URL, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ messages: [{ role: 'user', content: retryPrompt }] }),
                            });
                            const data = await resp.json();
                            return data.text || '';
                        }
                    });
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
                        console.log(`🌍 Geocoded "${toolRequest.params.query}" → [${geocoded[0]}, ${geocoded[1]}] (overriding context/Gemini coords)`);
                        toolRequest.params.lat = geocoded[0];
                        toolRequest.params.lng = geocoded[1];
                    } else if (!toolRequest.params.lat || !toolRequest.params.lng) {
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
                finalText = await callGeminiWithRetry(async () => {
                    if (USE_DIRECT_API) {
                        const ai = new GoogleGenAI({ apiKey: DIRECT_API_KEY });
                        const finalResponse = await ai.models.generateContent({
                            model: 'gemini-2.5-flash',
                            contents: contextualPrompt,
                            config: { temperature: 0.4, maxOutputTokens: 3000 }  // 3000 for rich answers
                        });
                        return stripJsonBlocks(finalResponse.text || 'Analysis complete.');
                    } else {
                        const resp = await fetch(GEMINI_PROXY_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ messages: [{ role: 'user', content: contextualPrompt }] }),
                        });
                        const data = await resp.json();
                        return stripJsonBlocks(data.text || 'Analysis complete.');
                    }
                });
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
    context: import('./chat/chatTypes').ChatContext
): Promise<import('./chat/chatTypes').ChatResponse> {
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

        const finalText = await callGeminiWithRetry(async () => {
            if (USE_DIRECT_API) {
                const ai = new GoogleGenAI({ apiKey: DIRECT_API_KEY });
                const finalResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: comparePrompt,
                    config: { temperature: 0.4, maxOutputTokens: 3000 }
                });
                return stripJsonBlocks(finalResponse.text || 'Comparison complete.');
            } else {
                const resp = await fetch(GEMINI_PROXY_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages: [{ role: 'user', content: comparePrompt }] }),
                });
                const data = await resp.json();
                return stripJsonBlocks(data.text || 'Comparison complete.');
            }
        });

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
// Places data fetcher  (domain-aware)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPlacesData(
    request: import('./chat/chatTypes').PlacesDataRequest,
    context: import('./chat/chatTypes').ChatContext
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
    request: import('./chat/chatTypes').PlacesDataRequest,
    placesData: any,
    context: import('./chat/chatTypes').ChatContext
): import('./chat/chatTypes').MapAction | undefined {
    const { params } = request;

    // Fix 3: When a query is present, the geocoder has already overridden lat/lng above.
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
