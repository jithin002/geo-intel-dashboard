import { nearbySearch, PlaceResult } from './placesAPIService';
import { DomainId, DOMAINS_LIST } from '../domains';

type POIMap = Record<DomainId, PlaceResult[]>;

/** Map domains to Google place types (from domains config) */
export const mapDomainToPlaceTypes = (domainId: DomainId): string[] => {
  const d = DOMAINS_LIST.find(x => x.id === domainId);
  return d ? d.competitorTypes : [];
};

/**
 * Fetch POIs for a list of domains in parallel and return a map of results.
 * This is a small adapter to keep domain logic out of components.
 */
export async function getPOIsForDomains(
  lat: number,
  lng: number,
  radiusMeters: number,
  domains: DomainId[]
): Promise<POIMap> {
  const tasks = domains.map(async (d) => {
    const types = mapDomainToPlaceTypes(d);
    if (types.length === 0) return { id: d, places: [] } as any;
    const places = await nearbySearch(lat, lng, radiusMeters, types);
    return { id: d, places } as any;
  });

  const results = await Promise.all(tasks);

  // Reduce into map
  const map = results.reduce((acc: any, r: any) => {
    acc[r.id] = r.places;
    return acc;
  }, {} as POIMap);

  // Ensure all requested domains exist in map
  domains.forEach(d => { if (!map[d]) map[d] = []; });

  return map as POIMap;
}
