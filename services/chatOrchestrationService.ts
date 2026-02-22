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

// ============================================
// Types & Interfaces
// ============================================

export interface ChatContext {
    recentMessages?: Array<{ role: string; content: string }>;
    currentLocation?: [number, number];
    selectedWard?: string;
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
    mapAction?: MapAction; // NEW: Trigger map UI updates
    placesData?: any; // Raw Places API data (optional)
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

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY || '';
    if (!apiKey) {
        return {
            text: "⚠️ Gemini API key not configured. Please add VITE_GEMINI_API_KEY to .env.local",
            usedPlacesAPI: false,
            usedGemini: false
        };
    }

    const ai = new GoogleGenAI({ apiKey });

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

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: fullPrompt,
            config: {
                temperature: 0.3,
                maxOutputTokens: 800
            }
        });

        const geminiText = response.text || '';
        console.log('💬 Gemini response:', geminiText.substring(0, 200) + '...');

        // ============================================
        // Step 3: Parse for Places API tool request
        // ============================================

        const toolRequest = parseToolRequest(geminiText);

        if (toolRequest) {
            console.log('🔧 Gemini requested Places API data:', toolRequest.action);

            // ============================================
            // Step 4: Fetch Places API data
            // ============================================

            const placesData = await fetchPlacesData(toolRequest, context);

            // ============================================
            // Step 5: Format results and create map action
            // ============================================

            const formattedResults = formatPlacesResults(placesData, toolRequest.action);
            const mapAction = createMapAction(toolRequest, placesData);

            // ============================================
            // Step 6: Second Gemini call with data context
            // ============================================

            const contextualPrompt = `${systemPrompt}\n\nUser: ${userMessage}\n\nPlaces API Results:\n${formattedResults}\n\nProvide a natural language response incorporating this data. Be specific with numbers and recommendations.`;

            const finalResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: contextualPrompt,
                config: {
                    temperature: 0.4,
                    maxOutputTokens: 600
                }
            });

            const finalText = finalResponse.text || 'Analysis complete.';

            return {
                text: finalText,
                mapAction,
                placesData,
                usedPlacesAPI: true,
                usedGemini: true
            };

        } else {
            // No Places data needed - direct response
            console.log('💬 Direct response (no Places API needed)');

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
 * Build system prompt explaining Places API capabilities
 */
function buildAgenticSystemPrompt(context: ChatContext): string {
    let prompt = `You are a geo-intelligence assistant helping users find optimal gym locations in Bangalore.

You have access to a **Places API Tool** that can fetch real-time location data. When users ask about locations, businesses, or area analysis, you can request data by responding with:

\`\`\`json
{
  "tool": "places_api",
  "action": "analyze_location" | "search_places" | "get_intelligence",
  "params": {
    "lat": number,
    "lng": number,
    "radius": number (in meters),
    "types": ["gym", "cafe", "restaurant", etc.],
    "query": "natural language search query"
  }
}
\`\`\`

**Available Actions:**
- \`analyze_location\`: Full area analysis (gyms, competition, demand, scores)
- \`search_places\`: Find specific places by type or query
- \`get_intelligence\`: Comprehensive location intelligence report

**When to use Places API:**
- User asks about specific locations ("Find gyms in HSR Layout")
- User wants competition analysis ("How many gyms are nearby?")
- User asks for recommendations ("Best area for a gym?")
- User wants to compare areas

**When NOT to use Places API:**
- General questions (greetings, clarifications)
- Questions about current visible data
- Simple conversations

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
    const radius = params.radius || 1000;

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
    placesData: any
): MapAction | undefined {

    const { action, params } = request;
    const lat = params.lat;
    const lng = params.lng;

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
