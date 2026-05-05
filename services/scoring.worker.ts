/**
 * Scoring Web Worker
 * Runs calculateDomainScores off the main thread so the UI never drops frames.
 * Communicates via postMessage / onmessage.
 */

import { calculateDomainScores } from './scoringEngine';

self.onmessage = (event: MessageEvent) => {
    const { intel, domainId, searchRadiusMeters, requestId } = event.data;
    try {
        const scores = calculateDomainScores(intel, domainId, searchRadiusMeters);
        self.postMessage({ requestId, scores, error: null });
    } catch (err: any) {
        self.postMessage({ requestId, scores: null, error: err?.message || 'Scoring failed' });
    }
};
