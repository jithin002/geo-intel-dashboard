/**
 * Chat Orchestration Service
 * 
 * Central coordinator between:
 * - Gemini API (conversational AI)
 * - Places API (location data)
 * - Map UI (visualization)
 * 
 * This creates an "agentic flow" where Gemini intelligently decides when to:
 * 1. Request Places API data
 * 2. Trigger map visualization updates
 * 3. Format responses with natural language + data
 */

import { GoogleGenAI } from "@google/genai";
import {
    getLocationIntelligence,
    generateDataDrivenRecommendation,
    textSearch,
    PlaceResult
} from './placesAPIService';
import { ScoringMatrix } from '../types';
import { GEMINI_PROXY_URL, USE_DIRECT_API } from './apiConfig';

const DIRECT_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY || '';

// ============================================
// Types & Interfaces
// ============================================

export interface ChatContext {
    recentMessages?: Array<{ role: string; content: string }>;
    currentLocation?: [number, number];
    selectedWard?: string;
    domain?: string; // currently active domain: 'gym' | 'retail' | 'restaurant' | 'bank'
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
        triggerAnalysis?: boolean; // NEW: Trigger the existing performAnalysis() flow
    };
}

export interface ChatResponse {
    text: string;
    mapAction?: MapAction;
    placesData?: any;
    prefetchedIntel?: any; // LocationIntelligence already fetched — App.tsx skips re-fetch
    usedPlacesAPI: boolean;
    usedGemini: boolean;
}

// ============================================
// Main Orchestration Function
// ============================================

/**
 * Process user query through agentic flow:
 * 1. Send to Gemini with Places API tool description
 * 2. Gemini decides if Places data needed
 * 3. Fetch Places data if requested
 * 4. Format results + trigger map actions
 * 5. Return natural language response
 */
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

    // ============================================
    // Step 1: Build agentic system prompt
    // ============================================

    const systemPrompt = buildAgenticSystemPrompt(context);
    const fullPrompt = `${systemPrompt}\n\nUser: ${userMessage}`;

    console.log('🤖 Sending query to Gemini (agentic mode)...');

    try {
        // ============================================
        // Step 2: First Gemini call - detect intent
        // ============================================

        let geminiText = '';
        
        if (USE_DIRECT_API) {
            const ai = new GoogleGenAI({ apiKey: DIRECT_API_KEY });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: fullPrompt,
                config: { temperature: 0.3, maxOutputTokens: 1500 }
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

        console.log('💬 Gemini response:', geminiText.substring(0, 200) + '...');

        // ============================================
        // Step 3: Parse for Places API tool request
        // ============================================

        const toolRequest = parseToolRequest(geminiText);

        if (toolRequest) {
            console.log('🔧 Gemini requested Places API data:', toolRequest.action);

            // ============================================
            // Step 3.5: Resolve coordinates — geocode query to get the RIGHT location
            // ============================================

            // PROBLEM: When a cluster is selected, Gemini gets the cluster coordinates in
            // context and "helpfully" puts those coords in its JSON, even when the user
            // asked about a completely different place (e.g. "Indiranagar").
            // SOLUTION: When a query string is present (e.g. "Indiranagar"), ALWAYS geocode
            // it. If the geocoded result differs from the context location by more than ~1km,
            // it means the user is asking about a NEW place — use the geocoded coords.
            if (toolRequest.params.query) {
                const geocoded = await geocodeQuery(toolRequest.params.query);
                if (geocoded) {
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
                    // Geocoding failed and Gemini didn't provide coords — log the issue
                    console.warn(`⚠️ Geocoding failed for "${toolRequest.params.query}" and Gemini provided no coords`);
                }
            }

            // ============================================
            // Step 4: Fetch Places API data
            // ============================================

            const placesData = await fetchPlacesData(toolRequest, context);

            // ============================================
            // Step 5: Format results and create map action
            // ============================================

            const formattedResults = formatPlacesResults(placesData, toolRequest.action);
            const mapAction = createMapAction(toolRequest, placesData, context);

            // ============================================
            // Step 6: Second Gemini call with data context
            // ============================================

            const contextualPrompt = `${systemPrompt}

User: ${userMessage}

Places API Analysis Results:
${formattedResults}

INSTRUCTIONS:
You are provided with a pre-computed "GEO-GROUNDED STRATEGY" above. 
DO NOT re-calculate or invent your own strategy from scratch. 
Simply summarize this existing strategic analysis naturally for the user. Be concise, highlight the key numbers, and seamlessly weave in the provided tactical recommendation.`;

            let finalText = '';
            
            if (USE_DIRECT_API) {
                const ai = new GoogleGenAI({ apiKey: DIRECT_API_KEY });
                const finalResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: contextualPrompt,
                    config: { temperature: 0.4, maxOutputTokens: 2048 }
                });
                finalText = finalResponse.text || 'Analysis complete.';
            } else {
                const resp = await fetch(GEMINI_PROXY_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages: [{ role: 'user', content: contextualPrompt }] }),
                });
                const data = await resp.json();
                finalText = data.text || 'Analysis complete.';
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
            // No Places data needed - direct response
            console.log('💬 Direct response (no Places API needed)');

            // Fail-safe: Only block if the ENTIRE response is a raw JSON tool call
            // (i.e., Gemini returned ONLY the JSON with no surrounding text).
            // Don't block if it's a normal text reply that happens to mention JSON.
            const trimmed = geminiText.trim();
            const isRawJsonLeak = (trimmed.startsWith('```json') || trimmed.startsWith('{')) &&
                geminiText.includes('"tool": "places_api"') &&
                !geminiText.match(/[A-Za-z]{20,}/); // No substantial English prose

            if (isRawJsonLeak) {
                console.warn('⚠️ Intercepted raw JSON tool call in fallback path — Gemini JSON parse failed');
                // Instead of showing an error, gracefully ask to retry
                const domainName = context.domain || 'business';
                const area = context.selectedWard || 'this area';
                return {
                    text: `I understand you're asking about ${domainName} options in ${area}. Could you be more specific about what you'd like to know — e.g. competition, best spots, or footfall potential?`,
                    usedPlacesAPI: false,
                    usedGemini: true
                };
            }

            return {
                text: geminiText,
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

// ============================================
// Helper Functions
// ============================================

/**
 * Geocode a place name to coordinates using Nominatim.
 * Returns [lat, lng] or null if not found.
 */
async function geocodeQuery(query: string): Promise<[number, number] | null> {
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query + ', Bangalore')}`;
        const resp = await fetch(url);
        const data = await resp.json();
        if (data && data.length > 0) {
            return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        }
        // Try without "Bangalore" suffix as fallback
        const resp2 = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
        const data2 = await resp2.json();
        if (data2 && data2.length > 0) {
            return [parseFloat(data2[0].lat), parseFloat(data2[0].lon)];
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Build system prompt explaining Places API capabilities
 */
function buildAgenticSystemPrompt(context: ChatContext): string {
    // Map domain keys to human-readable labels
    const domainLabels: Record<string, string> = {
        gym: 'gym / fitness centre',
        retail: 'retail store',
        restaurant: 'restaurant / food & beverage outlet',
        bank: 'bank / financial services branch',
    };
    const activeDomain = context.domain || 'gym';
    const domainLabel = domainLabels[activeDomain] || activeDomain;

    let prompt = `You are a geo-intelligence assistant helping users find optimal **${domainLabel}** locations in Bangalore.

You have access to a **Places API Tool** that can fetch real-time location data. When users ask about locations, businesses, or area analysis, respond with ONLY a valid JSON block like this (choose one action):

\`\`\`json
{
  "tool": "places_api",
  "action": "get_intelligence",
  "params": {
    "lat": 12.9716,
    "lng": 77.5946,
    "radius": 1000,
    "types": ["${activeDomain}"],
    "query": "search term if needed"
  }
}
\`\`\`

**Available Actions:**
- \`analyze_location\`: Full area analysis (${domainLabel}s, competition, demand, scores)
- \`search_places\`: Find specific places by type or query
- \`get_intelligence\`: Comprehensive location intelligence report

**When to use Places API:**
- User asks about specific locations ("Find ${domainLabel}s in HSR Layout")
- User wants competition analysis ("How many ${domainLabel}s are nearby?")
- User asks for recommendations ("Best area for a ${domainLabel}?")
- User wants to compare areas

**When NOT to use Places API:**
- General questions (greetings, clarifications)
- Questions about current visible data
- Simple conversations

**CRITICAL:** If you decide to call the Places API, respond with ONLY the JSON block above. Do not add any extra text before or after the JSON — this will cause a parsing error.

**IMPORTANT - Coordinates:** Always provide accurate lat/lng for named locations (e.g. HSR Layout = 12.9116, 77.6389; Koramangala = 12.9352, 77.6245; Whitefield = 12.9698, 77.7500; Hebbal = 13.0352, 77.5970; Indiranagar = 12.9784, 77.6408; Jayanagar = 12.9308, 77.5838; Marathahalli = 12.9591, 77.6972). If unsure of exact coords, include the area name in the "query" field and omit lat/lng.

`;

    // Add current context
    if (context.selectedWard || context.currentLocation) {
        prompt += `\n**Current Context:**\n`;
        if (context.selectedWard) {
            prompt += `- Selected Area: ${context.selectedWard}\n`;
        }
        if (context.currentLocation) {
            prompt += `- Location: [${context.currentLocation[0].toFixed(4)}, ${context.currentLocation[1].toFixed(4)}]\n`;
        }
        if (context.scores) {
            prompt += `- Site Score: ${context.scores.total}/100\n`;
            prompt += `- Gyms Nearby: ${context.realPOIs?.gyms?.length || 0}\n`;
            prompt += `- Corporate Offices: ${context.realPOIs?.corporates?.length || 0}\n`;
        }
    }

    // Add conversation history
    if (context.recentMessages && context.recentMessages.length > 0) {
        prompt += `\n**Recent Conversation:**\n`;
        context.recentMessages.slice(-3).forEach(msg => {
            prompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.substring(0, 150)}...\n`;
        });
    }

    return prompt;
}

/**
 * Parse Gemini response for tool request
 */
function parseToolRequest(geminiText: string): PlacesDataRequest | null {
    try {
        // Look for JSON code blocks
        const jsonMatch = geminiText.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            const json = JSON.parse(jsonMatch[1]);
            if (json.tool === 'places_api' && json.action && json.params) {
                return {
                    action: json.action,
                    params: json.params
                };
            }
        }

        // Look for inline JSON
        const inlineMatch = geminiText.match(/\{.*"tool":\s*"places_api".*\}/s);
        if (inlineMatch) {
            const json = JSON.parse(inlineMatch[0]);
            if (json.action && json.params) {
                return {
                    action: json.action,
                    params: json.params
                };
            }
        }

        return null;
    } catch (error) {
        console.error('Tool request parsing error:', error);
        return null;
    }
}

/**
 * Fetch data from Places API based on request
 */
async function fetchPlacesData(
    request: PlacesDataRequest,
    context: ChatContext
): Promise<any> {

    const { action, params } = request;

    // Use context location if not provided
    const lat = params.lat || context.currentLocation?.[0];
    const lng = params.lng || context.currentLocation?.[1];
    // Enforce context radius over params.radius to prevent Gemini from inflating search boundaries
    const radius = context.radius || params.radius || 1000;

    if (!lat || !lng) {
        throw new Error('Location coordinates required for Places API');
    }

    console.log(`📍 Fetching Places data: ${action} at [${lat}, ${lng}] radius ${radius}m`);

    switch (action) {
        case 'analyze_location':
        case 'get_intelligence':
            return await getLocationIntelligence(lat, lng, radius);

        case 'search_places':
            if (params.query) {
                return await textSearch(params.query, lat, lng);
            } else if (params.types && params.types.length > 0) {
                // Use nearbySearch from placesAPIService
                const { nearbySearch } = await import('./placesAPIService');
                return await nearbySearch(lat, lng, radius, params.types);
            }
            throw new Error('Search requires either query or types');

        default:
            throw new Error(`Unknown action: ${action}`);
    }
}

/**
 * Format Places API results for Gemini
 */
function formatPlacesResults(data: any, action: string): string {
    let formatted = `=== Places API Results ===\n\n`;

    if (action === 'analyze_location' || action === 'get_intelligence') {
        // Location intelligence format
        const intel = data;
        formatted += `**Area Analysis:**\n`;
        formatted += `- Gyms: ${intel.gyms.total} (${intel.gyms.highRated} rated 4+★, avg ${intel.gyms.averageRating}★)\n`;
        formatted += `- Corporate Offices: ${intel.corporateOffices.total}\n`;
        formatted += `- Residential Complexes: ${intel.apartments.total}\n`;
        formatted += `- Cafes/Restaurants: ${intel.cafesRestaurants.total} (${intel.cafesRestaurants.healthFocused} health-focused)\n`;
        formatted += `- Transit Stations: ${intel.transitStations.total}\n`;
        formatted += `- Competition Level: ${intel.competitionLevel}\n`;
        formatted += `- Market Opportunity: ${intel.marketGap}\n\n`;

        // Add data-driven recommendation
        const recommendation = generateDataDrivenRecommendation(intel);
        formatted += `**Strategic Recommendation:**\n${recommendation}\n`;

    } else if (action === 'search_places') {
        // Search results format
        const places = Array.isArray(data) ? data : data.places || [];
        formatted += `**Found ${places.length} places:**\n`;
        places.slice(0, 10).forEach((place: PlaceResult, idx: number) => {
            formatted += `${idx + 1}. ${place.displayName}`;
            if (place.rating) formatted += ` (${place.rating}★)`;
            if (place.formattedAddress) formatted += ` - ${place.formattedAddress}`;
            formatted += `\n`;
        });
    }

    return formatted;
}

/**
 * Create map action to visualize results
 * This triggers the existing framework flow (zoom, markers, scores)
 */
function createMapAction(
    request: PlacesDataRequest,
    placesData: any,
    context: ChatContext
): MapAction | undefined {

    const { action, params } = request;

    // Prefer Gemini/geocoded coords. Only fall back to context.currentLocation when
    // there is no query (i.e. the user is explicitly asking about the currently selected
    // spot). When a query IS present, the geocoding step above has already resolved
    // the correct lat/lng — do NOT fall back to the cluster coords.
    const lat = params.lat ?? (params.query ? undefined : context.currentLocation?.[0]);
    const lng = params.lng ?? (params.query ? undefined : context.currentLocation?.[1]);

    if (!lat || !lng) return undefined;

    // ALL actions trigger full analysis visualization
    return {
        type: 'analyze',
        payload: {
            location: [lat, lng],
            zoom: 15,
            triggerAnalysis: true, // KEY: This triggers performAnalysis() in App.tsx
            wardName: params.query || undefined
        }
    };
}
