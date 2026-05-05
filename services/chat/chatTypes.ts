/**
 * Shared type definitions for the Chat Orchestration layer.
 * Extracted from chatOrchestrationService.ts — zero logic change.
 */

import { ScoringMatrix } from '../../types';

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

export interface CompareIntent {
    isCompare: boolean;
    locations: string[];
}
