/**
 * Intent Parser — JSON stripping, tool-call parsing, compare-intent detection.
 * Extracted from chatOrchestrationService.ts — zero logic change.
 */

import { PlacesDataRequest, CompareIntent } from './chatTypes';

// ─────────────────────────────────────────────────────────────────────────────
// Fix 4 — Complex / compare query detector
// ─────────────────────────────────────────────────────────────────────────────

export function detectCompareIntent(message: string): CompareIntent {
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
// Fix 1 — Robust JSON strip
// ─────────────────────────────────────────────────────────────────────────────

export function stripJsonBlocks(text: string): string {
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

export function parseToolRequest(geminiText: string): PlacesDataRequest | null {
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
