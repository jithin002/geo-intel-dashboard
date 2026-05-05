/**
 * Map icon definitions — extracted from App.tsx.
 * Zero logic change.
 */

import L from 'leaflet';
import { LocationType } from '../../types';

// ─── Teardrop pin helper ────────────────────────────────────────────────────

export function createCompetitorPin(iconUrl: string, color: string): L.DivIcon {
    return L.divIcon({
        className: '',
        html: `
            <div style="
                position: relative;
                width: 34px;
                height: 42px;
                display: flex;
                align-items: flex-start;
                justify-content: center;
            ">
                <!-- Pin head: circle with domain color -->
                <div style="
                    width: 34px;
                    height: 34px;
                    background: ${color};
                    border-radius: 50% 50% 50% 0;
                    transform: rotate(-45deg);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.35);
                    border: 2px solid rgba(255,255,255,0.85);
                    flex-shrink: 0;
                ">
                    <img src="${iconUrl}" style="
                        width: 18px;
                        height: 18px;
                        transform: rotate(45deg);
                        object-fit: contain;
                    " />
                </div>
            </div>`,
        iconSize: [34, 42],
        iconAnchor: [17, 42],
        popupAnchor: [0, -44],
    });
}

// ─── Domain competitor pins ─────────────────────────────────────────────────

export const gymIcon     = createCompetitorPin('https://cdn-icons-png.flaticon.com/512/2964/2964514.png', '#6366f1');
export const restaurantIcon = createCompetitorPin('https://cdn-icons-png.flaticon.com/512/3448/3448609.png', '#f59e0b');
export const bankIcon    = createCompetitorPin('https://cdn-icons-png.flaticon.com/512/2830/2830284.png', '#3b82f6');
export const retailIcon  = createCompetitorPin('https://cdn-icons-png.flaticon.com/512/3081/3081648.png', '#8b5cf6');

// Rent listing pin — distinct emerald green, commercial building icon
export const rentListingIcon = createCompetitorPin(
  'https://cdn-icons-png.flaticon.com/512/2942/2942827.png', // commercial building / storefront
  '#10b981'  // emerald-500 — visually distinct from all domain pins
);

// ─── POI icons ──────────────────────────────────────────────────────────────

export const synergyIcon     = new L.Icon({ iconUrl: 'https://cdn-icons-png.freepik.com/256/17695/17695120.png?semt=ais_white_label', iconSize: [16, 16] });
export const cafeIcon        = new L.Icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/3054/3054889.png', iconSize: [15, 15] });
export const mallIcon        = new L.Icon({ iconUrl: 'https://cdn-icons-png.freepik.com/512/7835/7835563.png', iconSize: [16, 16] });
export const commercialIcon  = new L.Icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/7991/7991011.png', iconSize: [16, 16] });
export const corporateIcon   = new L.Icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/3061/3061341.png', iconSize: [16, 16] });
export const parkIcon        = new L.Icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/427/427503.png', iconSize: [15, 15] });
export const residentialIcon = new L.Icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/619/619032.png', iconSize: [14, 14] });
export const metroIcon       = new L.Icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/565/565350.png', iconSize: [15, 15] });
export const busIcon         = new L.Icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/128/1178/1178850.png', iconSize: [14, 14] });

// ─── Domain icon map ────────────────────────────────────────────────────────

export const DOMAIN_ICON_MAP = {
    gym:        { icon: gymIcon,        rawUrl: 'https://cdn-icons-png.flaticon.com/512/2964/2964514.png', emoji: '🏋️', competitorLabel: 'Gyms',        infraEmoji: '☕', infraLabel: 'Lifestyle', infraIcon: cafeIcon },
    restaurant: { icon: restaurantIcon, rawUrl: 'https://cdn-icons-png.flaticon.com/512/3448/3448609.png', emoji: '🍽️', competitorLabel: 'Restaurants', infraEmoji: '🛍️', infraLabel: 'Footfall',  infraIcon: synergyIcon },
    bank:       { icon: bankIcon,       rawUrl: 'https://cdn-icons-png.flaticon.com/512/2830/2830284.png', emoji: '🏦', competitorLabel: 'Banks',        infraEmoji: '🏬', infraLabel: 'Commercial', infraIcon: commercialIcon },
    retail:     { icon: retailIcon,     rawUrl: 'https://cdn-icons-png.flaticon.com/512/3081/3081648.png', emoji: '🛍️', competitorLabel: 'Stores',       infraEmoji: '🍿', infraLabel: 'Synergy',   infraIcon: synergyIcon },
};

// ─── LocationType → icon helper ─────────────────────────────────────────────

export function getIconForType(type: LocationType): L.Icon | L.DivIcon {
    switch (type) {
        case LocationType.GYM:       return gymIcon;
        case LocationType.CORPORATE: return corporateIcon;
        case LocationType.PARK:      return parkIcon;
        case LocationType.HIGH_RISE: return residentialIcon;
        case LocationType.METRO:     return metroIcon;
        default:                     return synergyIcon;
    }
}
