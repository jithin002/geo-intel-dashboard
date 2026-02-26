
import { LocationType, GeoPoint } from './types';

// Precise Center of HSR Layout Sector 7
export const HSR_CENTER = { lat: 12.9121, lng: 77.6446 };

export const MOCK_LOCATIONS: GeoPoint[] = [
  // --- REAL SCRAPED GYMS (COMPETITORS) ---
  { 
    id: 'ypid:YN4070x17575383325742572303', 
    name: 'Cult Hsr 14th Main', 
    type: LocationType.GYM, 
    lat: 12.91051769, 
    lng: 77.63787842,
    details: 'Near California Burrito, 14th Main' 
  },
  { 
    id: 'ypid:YN4070x16896788489746774007', 
    name: 'Iconic Fitness HSR', 
    type: LocationType.GYM, 
    lat: 12.90592861, 
    lng: 77.64655304,
    details: 'Sector 2 Garden Layout' 
  },
  { 
    id: 'ypid:YN4070x15757029264503036716', 
    name: 'Fitness Fuel Factory', 
    type: LocationType.GYM, 
    lat: 12.91597557, 
    lng: 77.64416504,
    details: '9th Main, 7th Sector' 
  },
  { 
    id: 'ypid:YN4070x5793488960191317392', 
    name: 'Snap Fitness', 
    type: LocationType.GYM, 
    lat: 12.91181564, 
    lng: 77.64412689,
    details: 'BDA Complex' 
  },
  { 
    id: 'ypid:YN4070x8904115352415494587', 
    name: 'Zest Fitness Studio', 
    type: LocationType.GYM, 
    lat: 12.90906143, 
    lng: 77.63791656,
    details: 'SS Arcade, 14th Main' 
  },
  { 
    id: 'ypid:YN4070x3172182038915931514', 
    name: 'Play on Fitness (Cult)', 
    type: LocationType.GYM, 
    lat: 12.91542244, 
    lng: 77.64916992,
    details: '1st Sector, 14th Cross' 
  },
  { 
    id: 'ypid:YN4070x9891766172398972035', 
    name: 'Contorus Women\'s Studio', 
    type: LocationType.GYM, 
    lat: 12.91664124, 
    lng: 77.65155029,
    details: '27th Main Road' 
  },
  { 
    id: 'ypid:YN4070x9339879105253119573', 
    name: 'Stance Active Clinical', 
    type: LocationType.GYM, 
    lat: 12.90942001, 
    lng: 77.64021301,
    details: '22nd Cross Road' 
  },
  { 
    id: 'ypid:YN4070x7036683860542287874', 
    name: 'Cult HSR Sector 4', 
    type: LocationType.GYM, 
    lat: 12.91333008, 
    lng: 77.64465332,
    details: '19th Main Rd' 
  },
  { 
    id: 'ypid:YN4070x3643257836982905398', 
    name: 'Eurofit Gym', 
    type: LocationType.GYM, 
    lat: 12.91617584, 
    lng: 77.63206482,
    details: '6th Sector Service Line' 
  },
  { 
    id: 'ypid:YN4070x18108810463846497967', 
    name: 'HSR Fitness World', 
    type: LocationType.GYM, 
    lat: 12.91518784, 
    lng: 77.65158844,
    details: '27th Main Road, Sector 1' 
  },
  { 
    id: 'ypid:YN4070x249143088', 
    name: 'SLIM GYM', 
    type: LocationType.GYM, 
    lat: 12.92149544, 
    lng: 77.64938354,
    details: 'Agara, 1st Sector' 
  },

  // --- DEMAND GENERATORS (CORPORATE & RESIDENTIAL) ---
  { id: 'c1', name: 'HSR BDA Complex (Commercial Hub)', type: LocationType.CORPORATE, lat: 12.9115, lng: 77.6440, details: 'High footfall commercial zone' },
  { id: 'c2', name: 'Startups Hub (27th Main)', type: LocationType.CORPORATE, lat: 12.9150, lng: 77.6510, details: 'Heavy tech workforce density' },
  { id: 'c3', name: 'Ozone Manay Tech Park', type: LocationType.CORPORATE, lat: 12.8990, lng: 77.6430, details: 'Major IT Park' },
  
  { id: 'o1', name: 'Sobha Marvella', type: LocationType.HIGH_RISE, lat: 12.9180, lng: 77.6520, details: 'Premium Residential' },
  { id: 'o2', name: 'Purva Fairmont', type: LocationType.HIGH_RISE, lat: 12.9050, lng: 77.6460, details: 'Large Gated Community' },
  { id: 'o3', name: 'Salarpuria Serenity', type: LocationType.HIGH_RISE, lat: 12.9130, lng: 77.6400, details: 'High density housing' },

  // --- LIFESTYLE ANCHORS (SYNERGY) ---
  { id: 'p1', name: 'Agara Lake Park', type: LocationType.PARK, lat: 12.9230, lng: 77.6400, details: 'Active runner hotspot' },
  { id: 'p2', name: 'HSR Sector 4 Park', type: LocationType.PARK, lat: 12.9140, lng: 77.6435, details: 'Community fitness spot' },
  { id: 's1', name: 'Starbucks HSR', type: LocationType.SYNERGY, lat: 12.9125, lng: 77.6465, details: 'Premium crowd indicator' },
  { id: 's2', name: 'Third Wave Coffee', type: LocationType.SYNERGY, lat: 12.9140, lng: 77.6430, details: 'Remote worker hub' },
  { id: 's3', name: 'California Burrito', type: LocationType.SYNERGY, lat: 12.9105, lng: 77.6378 },

  // --- INFRASTRUCTURE ---
  { id: 'm1', name: 'Silk Board Metro Station', type: LocationType.METRO, lat: 12.9175, lng: 77.6230 },
];
