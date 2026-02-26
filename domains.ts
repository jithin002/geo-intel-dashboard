/**
 * Multi-Domain POI Configuration
 * Each domain defines its own competitor types, infra types, scoring weights,
 * chart labels, and display metadata. Add new domains here without touching App.tsx.
 */

export type DomainId = 'gym' | 'restaurant' | 'bank';

export interface ScoreMetricConfig {
  label: string;   // short Y-axis label for the bar chart
  desc: string;    // tooltip / sub-label
  color: string;   // bar fill color
  weight: number;  // scoring weight (all 4 must sum to 1.0)
}

export interface DomainConfig {
  id: DomainId;
  label: string;
  emoji: string;
  tagline: string;
  color: string;
  competitorLabel: string;
  generatorLabel: string;
  competitorTypes: string[];
  infraTypes: string[];
  scoring: {
    demand: ScoreMetricConfig;
    connectivity: ScoreMetricConfig;
    gap: ScoreMetricConfig;
    infra: ScoreMetricConfig;
  };
}

export const DOMAIN_CONFIG: Record<DomainId, DomainConfig> = {
  gym: {
    id: 'gym',
    label: 'Gym / Fitness',
    emoji: '🏋️',
    tagline: 'Fitness studio site intelligence',
    color: '#6366f1',
    competitorLabel: 'Gyms',
    generatorLabel: 'Corp + Residents',
    competitorTypes: ['gym'],
    infraTypes: ['cafe', 'restaurant'],
    scoring: {
      demand:       { label: 'Demand', desc: 'Corp + Residents',   color: '#6366f1', weight: 0.30 },
      connectivity: { label: 'Access', desc: 'Metro / Bus',        color: '#34d399', weight: 0.15 },
      gap:          { label: 'Gap',    desc: 'Market Space',       color: '#f59e0b', weight: 0.30 },
      infra:        { label: 'Vibe',   desc: 'Cafes / Lifestyle',  color: '#ec4899', weight: 0.25 },
    },
  },
  restaurant: {
    id: 'restaurant',
    label: 'Restaurant / Cafe',
    emoji: '🍽️',
    tagline: 'Food & beverage location intelligence',
    color: '#f59e0b',
    competitorLabel: 'Restaurants',
    generatorLabel: 'Offices + Residents + Hotels',
    competitorTypes: ['restaurant', 'cafe'],
    // Destination-pull infra: malls, entertainment, hotels, tourist spots + colleges (student footfall)
    infraTypes: ['shopping_mall', 'movie_theater', 'tourist_attraction', 'lodging', 'night_club', 'university'],
    scoring: {
      demand:       { label: 'Footfall',   desc: 'Offices + Residents + Students + Hotels',   color: '#f59e0b', weight: 0.40 },
      connectivity: { label: 'Access',     desc: 'Metro / Bus proximity',          color: '#34d399', weight: 0.15 },
      gap:          { label: 'Dining Gap', desc: 'Supply vs Demand',               color: '#ef4444', weight: 0.20 },
      infra:        { label: 'Dest. Pull', desc: 'Malls + Entertainment + Tourism', color: '#8b5cf6', weight: 0.25 },
    },
  },
  bank: {
    id: 'bank',
    label: 'Bank / ATM Branch',
    emoji: '🏦',
    tagline: 'Banking location intelligence',
    color: '#3b82f6',
    competitorLabel: 'Banks / ATMs',
    generatorLabel: 'Offices + Residents',
    competitorTypes: ['bank', 'atm'],
    infraTypes: ['store', 'shopping_mall', 'supermarket'],
    scoring: {
      demand:       { label: 'Pop',    desc: 'Offices + Residents',  color: '#3b82f6', weight: 0.40 },
      connectivity: { label: 'Access', desc: 'Transit + Footfall',   color: '#34d399', weight: 0.25 },
      gap:          { label: 'Gap',    desc: 'Bank Competition',     color: '#f59e0b', weight: 0.20 },
      infra:        { label: 'Comm',   desc: 'Retail + Commercial',  color: '#ec4899', weight: 0.15 },
    },
  },
};

export const DOMAINS_LIST: DomainConfig[] = Object.values(DOMAIN_CONFIG);
