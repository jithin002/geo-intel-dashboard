/**
 * Multi-Domain POI Configuration
 * Each domain defines its own competitor types, infra types, scoring weights,
 * chart labels, and display metadata. Add new domains here without touching App.tsx.
 */

export type DomainId = 'gym' | 'restaurant' | 'bank' | 'retail';

export interface ScoreMetricConfig {
  label: string;   // short Y-axis label for the bar chart
  desc: string;    // tooltip / sub-label
  color: string;   // bar fill color
  weight: number;  // scoring weight (all 4 must sum to 1.0)
  saturationLimit: number; // For density-aware or aggregate scoring
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
      demand: { label: 'Demand', desc: 'Corp + Residents', color: '#6366f1', weight: 0.30, saturationLimit: 18 },
      connectivity: { label: 'Access', desc: 'Metro / Bus', color: '#34d399', weight: 0.15, saturationLimit: 8 },
      gap: { label: 'Gap', desc: 'Market Space', color: '#f59e0b', weight: 0.30, saturationLimit: 6 },
      infra: { label: 'Vibe', desc: 'Cafes / Lifestyle', color: '#ec4899', weight: 0.25, saturationLimit: 15 },
    },
  },
  restaurant: {
    id: 'restaurant',
    label: 'Restaurants',
    emoji: '🍽️',
    tagline: 'Food & beverage location intelligence',
    color: '#f59e0b',
    competitorLabel: 'Restaurants',
    generatorLabel: 'Offices + Residents + Students',
    competitorTypes: ['restaurant', 'cafe'],
    // Added 'university' to natively extract student data from the same request
    infraTypes: ['shopping_mall', 'movie_theater', 'tourist_attraction', 'night_club', 'university'],
    scoring: {
      demand: { label: 'Footfall', desc: 'Offices + Residents + Students', color: '#f59e0b', weight: 0.35, saturationLimit: 20 },
      connectivity: { label: 'Access', desc: 'Metro / Bus proximity', color: '#34d399', weight: 0.20, saturationLimit: 8 },
      gap: { label: 'Dining Gap', desc: 'Supply vs Demand', color: '#ef4444', weight: 0.30, saturationLimit: 5 },
      infra: { label: 'Dest. Pull', desc: 'Malls + Entertainment + Tourism', color: '#8b5cf6', weight: 0.15, saturationLimit: 12 },
    },
  },
  bank: {
    id: 'bank',
    label: 'Banks',
    emoji: '🏦',
    tagline: 'Banking location intelligence',
    color: '#3b82f6',
    competitorLabel: 'Banks / ATMs',
    generatorLabel: 'Offices + Residents',
    competitorTypes: ['bank', 'atm'],
    infraTypes: ['shopping_mall', 'supermarket', 'department_store'],
    scoring: {
      demand: { label: 'Demand', desc: 'Offices + Residents', color: '#3b82f6', weight: 0.40, saturationLimit: 20 },
      connectivity: { label: 'Access', desc: 'Transit + Footfall', color: '#34d399', weight: 0.25, saturationLimit: 8 },
      gap: { label: 'Gap', desc: 'Bank Competition', color: '#f59e0b', weight: 0.25, saturationLimit: 5 },
      infra: { label: 'Commercial', desc: 'Retail + Commercial', color: '#ec4899', weight: 0.10, saturationLimit: 12 },
    },
  },
  retail: {
    id: 'retail',
    label: 'Retail / Shopping',
    emoji: '🛍️',
    tagline: 'Retail footprint intelligence',
    color: '#8b5cf6',
    competitorLabel: 'Retailers',
    generatorLabel: 'Residents + Transit',
    competitorTypes: ['supermarket', 'department_store', 'convenience_store'],
    infraTypes: ['cafe', 'restaurant', 'shopping_mall', 'movie_theater'],
    scoring: {
      demand: { label: 'Catchment', desc: 'Residents + Corporates', color: '#8b5cf6', weight: 0.35, saturationLimit: 20 },
      connectivity: { label: 'Transit', desc: 'Metro + Bus Hubs', color: '#34d399', weight: 0.20, saturationLimit: 8 },
      gap: { label: 'Supply Gap', desc: 'Retail Competition', color: '#f59e0b', weight: 0.25, saturationLimit: 6 },
      infra: { label: 'Synergy', desc: 'Cafes & Entertainment', color: '#ec4899', weight: 0.20, saturationLimit: 14 },
    }
  }
};

export const DOMAINS_LIST: DomainConfig[] = Object.values(DOMAIN_CONFIG);
