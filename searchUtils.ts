import type { DomainId } from './domains';

// ─────────────────────────────────────────────────────────────────────────────
// Smart Search Intent Parser
// ─────────────────────────────────────────────────────────────────────────────

/** Keyword → domain mapping. Order matters: more-specific terms first. */
const DOMAIN_KEYWORDS: { keywords: string[]; domain: DomainId }[] = [
    {
        keywords: [
            'gym', 'fitness', 'exercise', 'workout', 'crossfit',
            'pilates', 'yoga studio', 'sports club', 'health club',
        ],
        domain: 'gym',
    },
    {
        keywords: [
            'restaurant', 'restaurants', 'cafe', 'cafes', 'coffee',
            'food', 'dining', 'eat', 'eatery', 'bistro', 'diner',
            'bakery', 'pizza', 'burger', 'biryani', 'sushi',
        ],
        domain: 'restaurant',
    },
    {
        keywords: [
            'bank', 'banks', 'atm', 'finance', 'financial',
            'credit union', 'branch', 'loan', 'savings',
        ],
        domain: 'bank',
    },
    {
        keywords: [
            'retail', 'shop', 'shopping', 'store', 'stores',
            'supermarket', 'grocery', 'market', 'mall', 'outlet',
        ],
        domain: 'retail',
    },
];

/** Filler words that should be removed when extracting the location string. */
const LOCATION_FILLER = [
    'in', 'near', 'around', 'at', 'for', 'best', 'top',
    'good', 'spots', 'spot', 'place', 'places', 'location',
    'options', 'option', 'area', 'nearby', 'closest', 'find',
    'show', 'get', 'search', 'where', 'are', 'is', 'the', 'a',
    'an', 'some',
];

export interface SearchIntent {
    /** Detected business domain, or null if none found */
    domain: DomainId | null;
    /** Cleaned location string for geocoding (e.g. "Koramangala") */
    locationQuery: string;
    /** True if a domain was detected */
    hasDomain: boolean;
}

/**
 * Parse a natural language query to extract the target domain and location.
 *
 * Examples:
 *   "cafes in Koramangala"      → { domain: 'restaurant', locationQuery: 'Koramangala' }
 *   "banks near HSR layout"     → { domain: 'bank',       locationQuery: 'HSR layout' }
 *   "top 5 spots"               → { domain: null,         locationQuery: 'top 5 spots' }
 *   "Indiranagar"               → { domain: null,         locationQuery: 'Indiranagar' }
 */
export function parseSearchIntent(query: string): SearchIntent {
    const lower = query.toLowerCase().trim();
    let detectedDomain: DomainId | null = null;
    let remaining = lower;

    // 1. Detect domain — try multi-word phrases first, then single words
    outer: for (const entry of DOMAIN_KEYWORDS) {
        for (const kw of entry.keywords) {
            if (lower.includes(kw)) {
                detectedDomain = entry.domain;
                // Remove the matched keyword from the remaining string
                remaining = remaining.replace(new RegExp(`\\b${kw}\\b`, 'g'), ' ');
                break outer;
            }
        }
    }

    // 2. Strip filler words
    const words = remaining.split(/\s+/).filter(w => w && !LOCATION_FILLER.includes(w));

    // 3. Restore original casing for the location portion
    //    by finding the corresponding tokens in the original query
    const originalTokens = query.trim().split(/\s+/);
    const locationWords: string[] = [];

    for (const word of words) {
        // Match back to the original-cased word
        const match = originalTokens.find(t => t.toLowerCase() === word);
        if (match) locationWords.push(match);
    }

    const locationQuery = locationWords.join(' ').trim();

    return {
        domain: detectedDomain,
        locationQuery: locationQuery || query.trim(), // fallback to full query
        hasDomain: detectedDomain !== null,
    };
}

export interface WardCluster {
    id: string;
    wardId: string;
    wardName: string;
    lat: number;
    lng: number;
    opportunityScore: number;
    finalScore: number;
    gymCount: number;
    cafeCount: number;
    growthRate: number;
    color: string;
}

const getScore = (ward: WardCluster, wardScores: Record<string, any>, key: string): number => {
    if (wardScores && wardScores[ward.id]) {
        return wardScores[ward.id][key as keyof typeof wardScores[string]] || 0;
    }
    return (ward as any)[key] || 0;
};

export const executeSearch = (
    query: string,
    wardClusters: WardCluster[],
    wardScores: Record<string, any>
): WardCluster[] => {
    if (!query) return [];

    const lowerQuery = query.toLowerCase().trim();

    // 1. "Top X" Pattern (e.g., "top 3 spots", "top 5")
    const topMatch = lowerQuery.match(/top\s+(\d+)/);
    if (topMatch) {
        const count = parseInt(topMatch[1], 10);
        return [...wardClusters]
            .sort((a, b) => {
                const scoreA = getScore(a, wardScores, 'finalScore');
                const scoreB = getScore(b, wardScores, 'finalScore');
                return scoreB - scoreA;
            })
            .slice(0, count);
    }

    // 2. "High Growth" Pattern
    if (lowerQuery.includes('high growth') || lowerQuery.includes('growth')) {
        return [...wardClusters]
            .sort((a, b) => {
                const scoreA = getScore(a, wardScores, 'growthRate');
                const scoreB = getScore(b, wardScores, 'growthRate');
                return scoreB - scoreA;
            })
            .slice(0, 5);
    }

    // 3. "Untapped" / "Opportunity" Pattern
    if (lowerQuery.includes('untapped') || lowerQuery.includes('opportunity') || lowerQuery.includes('potential')) {
        return [...wardClusters]
            .sort((a, b) => {
                const scoreA = getScore(a, wardScores, 'opportunityScore');
                const scoreB = getScore(b, wardScores, 'opportunityScore');
                return scoreB - scoreA;
            })
            .slice(0, 5);
    }

    // 4. "Low Competition" Pattern
    if (lowerQuery.includes('low competition') || lowerQuery.includes('no gyms')) {
        return [...wardClusters]
            .filter(w => getScore(w, wardScores, 'gymCount') < 3)
            .sort((a, b) => {
                const scoreA = getScore(a, wardScores, 'opportunityScore');
                const scoreB = getScore(b, wardScores, 'opportunityScore');
                return scoreB - scoreA;
            })
            .slice(0, 5);
    }

    // 5. Default: Name Search
    return wardClusters.filter(cluster =>
        cluster.wardName.toLowerCase().includes(lowerQuery) ||
        cluster.wardId.toLowerCase().includes(lowerQuery)
    );
};

export const getQueryDescription = (query: string): string => {
    if (!query) return '';
    const lowerQuery = query.toLowerCase().trim();

    const topMatch = lowerQuery.match(/top\s+(\d+)/);
    if (topMatch) {
        return `Showing top ${topMatch[1]} locations by overall score`;
    }

    if (lowerQuery.includes('high growth') || lowerQuery.includes('growth')) {
        return 'Showing top 5 areas with highest predicted growth rate';
    }

    if (lowerQuery.includes('untapped') || lowerQuery.includes('opportunity') || lowerQuery.includes('potential')) {
        return 'Showing top 5 untapped opportunities (High Potential)';
    }

    if (lowerQuery.includes('low competition') || lowerQuery.includes('no gyms')) {
        return 'Showing areas with low competition and high potential';
    }

    return `Showing results matching "${query}"`;
};
