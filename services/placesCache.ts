/**
 * Places API Cache — Two-Tier (Memory + localStorage)
 *
 * Tier 1 — Memory cache
 *   - Stores full POI arrays (for map markers)
 *   - TTL: 15 minutes
 *   - Cap: 50 entries (LRU eviction)
 *   - Resets on page refresh
 *
 * Tier 2 — localStorage cache
 *   - Stores aggregated intel ONLY (counts + scores, ~1 KB/ward)
 *   - TTL: 24 hours
 *   - Cap: 30 entries (LRU eviction)
 *   - Survives page refreshes
 *
 * Also handles in-flight request deduplication to prevent
 * burst duplicate fetches before the cache is populated.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface AggregatedIntel {
    gyms: number;
    corporates: number;
    cafes: number;
    transit: number;
    apartments: number;
    vibeActive: number;
    vibeEntertainment: number;
    competitionLevel: string;
    marketGap: string;
    scores?: {
        demographicLoad: number;
        connectivity: number;
        competitorRatio: number;
        infrastructure: number;
        total: number;
    };
}

interface MemoryCacheEntry<T> {
    data: T;
    expiresAt: number;
    lastAccessed: number;
}

interface LocalStorageCacheEntry {
    data: AggregatedIntel;
    expiresAt: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MEMORY_TTL_MS = 15 * 60 * 1000;        // 15 minutes
const LOCALSTORAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MEMORY_MAX_ENTRIES = 50;
const LOCALSTORAGE_MAX_ENTRIES = 30;
const LS_PREFIX = 'geo_intel_v1_';

// ── Memory Cache ─────────────────────────────────────────────────────────────

const memoryCache = new Map<string, MemoryCacheEntry<any>>();

/** Build a canonical cache key from search parameters */
export function buildCacheKey(
    lat: number,
    lng: number,
    radiusMeters: number,
    placeTypes: string[]
): string {
    const latR = lat.toFixed(4);
    const lngR = lng.toFixed(4);
    const types = [...placeTypes].sort().join('+');
    return `${latR}_${lngR}_${radiusMeters}_${types}`;
}

/** Build a ward-level key used for the localStorage aggregated cache */
export function buildWardKey(lat: number, lng: number, radiusMeters: number): string {
    return `${LS_PREFIX}${lat.toFixed(3)}_${lng.toFixed(3)}_${radiusMeters}`;
}

/** Evict the oldest accessed entry from memory cache if over cap */
function evictMemoryIfNeeded(): void {
    if (memoryCache.size < MEMORY_MAX_ENTRIES) return;
    let oldest: { key: string; lastAccessed: number } | null = null;
    for (const [key, entry] of memoryCache.entries()) {
        if (!oldest || entry.lastAccessed < oldest.lastAccessed) {
            oldest = { key, lastAccessed: entry.lastAccessed };
        }
    }
    if (oldest) memoryCache.delete(oldest.key);
}

/** Read from memory cache. Returns null on miss or expiry. */
export function getMemoryCache<T>(key: string): T | null {
    const entry = memoryCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        memoryCache.delete(key);
        return null;
    }
    entry.lastAccessed = Date.now();
    console.log(`✅ Memory cache HIT for [${key}]`);
    return entry.data as T;
}

/** Write to memory cache with LRU eviction. */
export function setMemoryCache<T>(key: string, data: T): void {
    evictMemoryIfNeeded();
    memoryCache.set(key, {
        data,
        expiresAt: Date.now() + MEMORY_TTL_MS,
        lastAccessed: Date.now(),
    });
}

/** Clear the entire memory cache (e.g. on forced refresh). */
export function clearMemoryCache(): void {
    memoryCache.clear();
}

// ── localStorage Cache ───────────────────────────────────────────────────────

function getLocalStorageKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) keys.push(k);
    }
    return keys;
}

function evictLocalStorageIfNeeded(): void {
    const keys = getLocalStorageKeys();
    if (keys.length < LOCALSTORAGE_MAX_ENTRIES) return;

    // Find the entry with the earliest expiry (oldest data)
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const key of keys) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const entry: LocalStorageCacheEntry = JSON.parse(raw);
            if (entry.expiresAt < oldestExpiry) {
                oldestExpiry = entry.expiresAt;
                oldestKey = key;
            }
        } catch { /* ignore corrupt entries */ }
    }
    if (oldestKey) localStorage.removeItem(oldestKey);
}

/** Read aggregated intel from localStorage. Returns null on miss/expiry. */
export function getLocalStorageCache(wardKey: string): AggregatedIntel | null {
    try {
        const raw = localStorage.getItem(wardKey);
        if (!raw) return null;
        const entry: LocalStorageCacheEntry = JSON.parse(raw);
        if (Date.now() > entry.expiresAt) {
            localStorage.removeItem(wardKey);
            return null;
        }
        console.log(`💾 localStorage HIT for [${wardKey}]`);
        return entry.data;
    } catch {
        return null;
    }
}

/** Write aggregated intel to localStorage with LRU eviction. */
export function setLocalStorageCache(wardKey: string, data: AggregatedIntel): void {
    try {
        evictLocalStorageIfNeeded();
        const entry: LocalStorageCacheEntry = {
            data,
            expiresAt: Date.now() + LOCALSTORAGE_TTL_MS,
        };
        localStorage.setItem(wardKey, JSON.stringify(entry));
    } catch (e) {
        // localStorage may be full or disabled — fail silently
        console.warn('⚠️ localStorage write failed (quota or disabled):', e);
    }
}

/** Remove all geo-intel localStorage entries (manual cache bust). */
export function clearLocalStorageCache(): void {
    getLocalStorageKeys().forEach(k => localStorage.removeItem(k));
    console.log('🗑️ localStorage cache cleared');
}

// ── In-flight Request Deduplication ─────────────────────────────────────────

const inFlight = new Map<string, Promise<any>>();

/**
 * Wrap a fetch factory with in-flight deduplication.
 * If a request for `key` is already in-progress, return the same Promise.
 */
export function deduplicatedFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
    if (inFlight.has(key)) {
        console.log(`🔄 In-flight dedup HIT for [${key}] — reusing pending request`);
        return inFlight.get(key) as Promise<T>;
    }
    const promise = fetchFn();
    inFlight.set(key, promise);
    promise.finally(() => inFlight.delete(key));
    return promise;
}
