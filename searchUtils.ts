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
