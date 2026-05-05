/**
 * Prompt Builder — System prompt construction + out-of-scope guardrail.
 * Extracted from chatOrchestrationService.ts — zero logic change.
 */

import { DOMAIN_CONFIG, DomainId } from '../../domains';
import { ChatContext } from './chatTypes';

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

export function isOutOfScope(message: string): string | null {
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
// System prompt builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildAgenticSystemPrompt(context: ChatContext): string {
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
