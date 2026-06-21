/**
 * ADK Chat Service
 *
 * Replaces the fragile JSON-parsing Gemini loop in chatOrchestrationService.ts
 * with a clean proxy call to the ADK agent running on server.cjs:3001/api/chat.
 *
 * Returns the same ChatResponse shape so no callers (App.tsx) need to change.
 * Session ID is persisted in module-level state to maintain conversation context
 * across turns within the same browser session.
 */

import type { ChatContext, ChatResponse } from './chat/chatTypes';

// ── ADK session state (module-level = persists across messages in same session) ─
let adkSessionId: string | null = null;

// In production (Cloud Run) use a relative path — same Express server handles /api/chat.
// In local dev, explicitly point to port 3001.
const ADK_CHAT_URL = import.meta.env.PROD ? '/api/chat' : 'http://localhost:3001/api/chat';


// ─────────────────────────────────────────────────────────────────────────────
// Main entry point — drop-in replacement for processUserQuery
// ─────────────────────────────────────────────────────────────────────────────

export async function processUserQueryADK(
    userMessage: string,
    context: ChatContext
): Promise<ChatResponse> {

    // Basic out-of-scope guard (zero API cost, same as before)
    const lower = userMessage.toLowerCase();
    const outOfScopeKeywords = [
        'weather', 'cricket', 'ipl', 'stock price', 'recipe',
        'in mumbai', 'in delhi', 'in chennai', 'in hyderabad', 'in new york',
    ];
    for (const kw of outOfScopeKeywords) {
        if (lower.includes(kw)) {
            return {
                text: `I specialise in business location analysis for Bangalore. Is there an area or business type you would like me to evaluate?`,
                usedPlacesAPI: false,
                usedGemini: false,
            };
        }
    }

    try {
        const res = await fetch(ADK_CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: userMessage,
                sessionId: adkSessionId,  // null on first message → ADK creates one
                userId: 'geo-intel-user',
                // Forward the panel's live state so the agent analyzes the SAME
                // pin / domain / radius the Intelligence Panel is showing
                // (otherwise it re-geocodes the name and defaults to gym / 1 km).
                context: {
                    currentLocation: context.currentLocation,
                    domain: context.domain,
                    radius: context.radius,
                },
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error('❌ ADK chat error:', err);
            return {
                text: 'I had trouble connecting to the intelligence agent. Please try again.',
                usedPlacesAPI: false,
                usedGemini: false,
            };
        }

        const data = await res.json();

        // Persist the session ID so the next message continues the same conversation
        if (data.sessionId) {
            adkSessionId = data.sessionId;
        }

        console.log(`🤖 ADK response (session: ${adkSessionId?.slice(0, 8)}...):`, data.text?.slice(0, 100));

        // ── Build mapAction from tool data ────────────────────────────────────
        // The ADK server extracts coordinates from the tool response SSE events.
        // We use them here to navigate the map and trigger performAnalysis(),
        // which updates the Intelligence Panel with real scores — same as before.
        let mapAction: ChatResponse['mapAction'] = undefined;

        // ── Detect domain from user message ───────────────────────────────────
        // Use a broad keyword map (including common typos) so the domain switches
        // even when the user misspells (e.g. "restuarant" → restaurant).
        const msgLower = userMessage.toLowerCase();
        const DOMAIN_MAP: Record<string, string> = {
            // Restaurant / cafe
            'restaurant': 'restaurant', 'restuarant': 'restaurant', 'restaraunt': 'restaurant',
            'cafe': 'restaurant', 'coffee': 'restaurant', 'food': 'restaurant',
            'dining': 'restaurant', 'eat': 'restaurant', 'eatery': 'restaurant',
            'bakery': 'restaurant', 'pizza': 'restaurant', 'biryani': 'restaurant',
            // Gym
            'gym': 'gym', 'fitness': 'gym', 'workout': 'gym', 'crossfit': 'gym',
            'pilates': 'gym', 'yoga': 'gym', 'health club': 'gym',
            // Bank
            'bank': 'bank', 'atm': 'bank', 'finance': 'bank', 'branch': 'bank',
            // Retail
            'retail': 'retail', 'shop': 'retail', 'store': 'retail', 'shopping': 'retail',
            'supermarket': 'retail', 'grocery': 'retail', 'market': 'retail',
        };
        let detectedDomain: string | undefined;
        // Check multi-word first, then single-word
        for (const [kw, dom] of Object.entries(DOMAIN_MAP)) {
            if (msgLower.includes(kw)) { detectedDomain = dom; break; }
        }

        const td = data.toolData;
        if (td) {
            if (td.coordinates && td.location) {
                // analyze_location tool was called
                mapAction = {
                    type: 'analyze',
                    payload: {
                        location: [td.coordinates.lat, td.coordinates.lng],
                        zoom: 15,
                        triggerAnalysis: true,
                        wardName: td.location,
                        domain: detectedDomain,
                    },
                };
            } else if (td.comparison && td.location1 && td.location2) {
                // compare_locations — navigate to the winner
                const winner = td.comparison.winner;
                const winnerData = winner === td.location1.name ? td.location1 : td.location2;
                if (winnerData?.coordinates) {
                    mapAction = {
                        type: 'analyze',
                        payload: {
                            location: [winnerData.coordinates.lat, winnerData.coordinates.lng],
                            zoom: 15,
                            triggerAnalysis: true,
                            wardName: winner,
                            domain: detectedDomain,
                        },
                    };
                }
            }
        }


        return {
            text: data.text || 'No response received.',
            mapAction,
            usedPlacesAPI: true,
            usedGemini: true,
        };

    } catch (error) {
        console.error('❌ ADK chat fetch failed:', error);
        return {
            text: 'Unable to reach the AI agent. Please try again in a moment.',
            usedPlacesAPI: false,
            usedGemini: false,
        };
    }
}

/** Call this when the user clears the chat to start a fresh ADK session */
export function resetADKSession(): void {
    adkSessionId = null;
    console.log('🔄 ADK session reset');
}
