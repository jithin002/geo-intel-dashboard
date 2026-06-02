/**
 * DashboardMap — Full Leaflet map area extracted from App.tsx.
 * Zero logic change. All marker logic, cluster rendering, and legend are preserved.
 */

import React from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import { PlaceResult } from '../../services/placesAPIService';
import { DomainId } from '../../domains';
import { DOMAIN_CONFIG } from '../../domains';
import {
    DOMAIN_ICON_MAP,
    corporateIcon,
    residentialIcon,
    metroIcon,
    busIcon,
    rentListingIcon,
} from './mapIcons';
import {
    BANGALORE_CENTER,
    MapEvents,
    MapRevalidator,
    MapZoomController,
    WardLayer,
} from './MapHelpers';

interface RealPOIs {
    gyms: PlaceResult[];
    cafes: PlaceResult[];
    parks: PlaceResult[];
    corporates: PlaceResult[];
    transit: PlaceResult[];
    apartments: PlaceResult[];
}

interface RentListing {
    listing_id: string;
    title: string;
    locality: string;
    monthly_rent: number;
    area_sqft: number;
    price_per_sqft: number;
    listing_url: string;
    lat: number;
    lng: number;
}

interface DashboardMapProps {
    selectedPos: [number, number] | null;
    searchRadius: number;
    competitors: number;
    activeDomain: DomainId;
    realPOIs: RealPOIs;
    wardClusters: any[];
    selectedCluster: string | null;
    wardScores: Record<string, any>;
    customParams: any[];
    customPOIs: Record<string, any[]>;
    mapZoom: number;
    mapNavigateKey: number;
    domain: typeof DOMAIN_CONFIG[DomainId];
    demandGenerators: number;
    onMapClick: (e: any) => void;
    onClusterClick: (clusterId: string, lat: number, lng: number) => void;
    onWardClick: (lat: number, lng: number, wardName: string) => void;
    rentListings?: RentListing[];
}

export const DashboardMap: React.FC<DashboardMapProps> = ({
    selectedPos,
    searchRadius,
    competitors,
    activeDomain,
    realPOIs,
    wardClusters,
    selectedCluster,
    wardScores,
    customParams,
    customPOIs,
    mapZoom,
    mapNavigateKey,
    domain,
    demandGenerators,
    onMapClick,
    onClusterClick,
    onWardClick,
    rentListings = [],
}) => {
    return (
        <div className="absolute inset-0 z-0">
            <MapContainer
                center={[BANGALORE_CENTER.lat, BANGALORE_CENTER.lng]}
                zoom={mapZoom}
                className="z-10 h-full w-full"
            >
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxZoom={19}
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />

                {/* Ward Boundaries Layer */}
                <WardLayer
                    onWardClick={onWardClick}
                    activeDomain={activeDomain}
                    wardScores={wardScores}
                />

                <MapEvents onMapClick={onMapClick} />
                <MapRevalidator />
                <MapZoomController center={selectedPos} zoom={mapZoom} navigateKey={mapNavigateKey} />

                {/* Catchment circle — primary zone */}
                {selectedPos && (
                    <Circle
                        center={selectedPos}
                        radius={searchRadius}
                        pathOptions={{
                            color: competitors > 4 ? '#ef4444' : '#6366f1',
                            fillColor: competitors > 4 ? '#ef4444' : '#6366f1',
                            fillOpacity: 0.08,
                            dashArray: '8, 8',
                            weight: 2
                        }}
                    />
                )}

                {/* Rent analysis zone — wider 5km area used for market rate data */}
                {selectedPos && rentListings.length > 0 && (
                    <Circle
                        center={selectedPos}
                        radius={Math.max(searchRadius * 3, 5000)}
                        pathOptions={{
                            color: '#059669',
                            fillColor: '#10b981',
                            fillOpacity: 0.07,
                            dashArray: '10, 8',
                            weight: 2.5
                        }}
                    />
                )}

                {/* User pin */}
                {selectedPos && (
                    <Marker
                        position={selectedPos}
                        icon={new L.DivIcon({
                            className: 'user-marker',
                            html: `<div class="relative flex items-center justify-center">
                                     <div class="absolute w-12 h-12 bg-indigo-600/10 rounded-full animate-pulse"></div>
                                     <div class="w-6 h-6 bg-indigo-600 border-[3px] border-white rounded-full shadow-2xl"></div>
                                   </div>`,
                            iconSize: [48, 48],
                            iconAnchor: [24, 24]
                        })}
                    />
                )}

                {/* Competitor markers (domain-aware) */}
                {selectedPos && realPOIs.gyms.length > 0 && realPOIs.gyms.map((gym, idx) => {
                    const domainMeta = DOMAIN_ICON_MAP[activeDomain];
                    return (
                        <Marker key={`competitor-${idx}`} position={[gym.location.lat, gym.location.lng]} icon={domainMeta.icon}>
                            <Popup>
                                <div className="p-2 min-w-[180px]">
                                    <div className="font-black text-slate-800 text-sm mb-1">{domainMeta.emoji} {gym.displayName}</div>
                                    {gym.rating && (
                                        <div className="flex items-center gap-1 mb-1">
                                            <span className="text-yellow-500 text-xs">★</span>
                                            <span className="text-xs font-bold">{gym.rating.toFixed(1)}</span>
                                            {gym.userRatingCount && (
                                                <span className="text-[9px] text-slate-400">({gym.userRatingCount} reviews)</span>
                                            )}
                                        </div>
                                    )}
                                    <span className="text-[9px] font-bold text-white px-2 py-0.5 rounded-full uppercase tracking-widest bg-red-500">COMPETITOR</span>
                                    {gym.formattedAddress && <div className="mt-2 text-[9px] text-slate-500 italic border-t pt-1">{gym.formattedAddress}</div>}
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}

                {/* Corporate markers */}
                {selectedPos && realPOIs.corporates.length > 0 && realPOIs.corporates.map((corp, idx) => (
                    <Marker key={`corp-${idx}`} position={[corp.location.lat, corp.location.lng]} icon={corporateIcon}>
                        <Popup>
                            <div className="p-2 min-w-[160px]">
                                <div className="font-black text-slate-800 text-sm mb-1">🏢 {corp.displayName}</div>
                                {corp.rating && (
                                    <div className="flex items-center gap-1 mb-1">
                                        <span className="text-yellow-500 text-xs">★</span>
                                        <span className="text-xs font-bold">{corp.rating.toFixed(1)}</span>
                                    </div>
                                )}
                                <span className="text-[9px] font-bold text-white px-2 py-0.5 rounded-full uppercase tracking-widest bg-blue-500">CORPORATE</span>
                                {corp.formattedAddress && <div className="mt-2 text-[9px] text-slate-500 italic border-t pt-1">{corp.formattedAddress}</div>}
                            </div>
                        </Popup>
                    </Marker>
                ))}

                {/* Apartment markers */}
                {selectedPos && realPOIs.apartments && realPOIs.apartments.length > 0 && realPOIs.apartments.map((apt, idx) => (
                    <Marker key={`apt-${idx}`} position={[apt.location.lat, apt.location.lng]} icon={residentialIcon}>
                        <Popup>
                            <div className="p-2 min-w-[160px]">
                                <div className="font-black text-slate-800 text-sm mb-1">🏘️ {apt.displayName}</div>
                                {apt.rating && (
                                    <div className="flex items-center gap-1 mb-1">
                                        <span className="text-yellow-500 text-xs">★</span>
                                        <span className="text-xs font-bold">{apt.rating.toFixed(1)}</span>
                                    </div>
                                )}
                                <span className="text-[9px] font-bold text-white px-2 py-0.5 rounded-full uppercase tracking-widest bg-purple-600">RESIDENTIAL</span>
                                {apt.formattedAddress && <div className="mt-2 text-[9px] text-slate-500 italic border-t pt-1">{apt.formattedAddress}</div>}
                            </div>
                        </Popup>
                    </Marker>
                ))}

                {/* Infra/Cafe markers (domain-aware) */}
                {selectedPos && realPOIs.cafes.length > 0 && realPOIs.cafes.map((cafe, idx) => {
                    const domainMeta = DOMAIN_ICON_MAP[activeDomain];
                    return (
                        <Marker key={`infra-${idx}`} position={[cafe.location.lat, cafe.location.lng]} icon={domainMeta.infraIcon}>
                            <Popup>
                                <div className="p-2 min-w-[160px]">
                                    <div className="font-black text-slate-800 text-sm mb-1">{domainMeta.infraEmoji} {cafe.displayName}</div>
                                    {cafe.rating && (
                                        <div className="flex items-center gap-1 mb-1">
                                            <span className="text-yellow-500 text-xs">★</span>
                                            <span className="text-xs font-bold">{cafe.rating.toFixed(1)}</span>
                                            {cafe.userRatingCount && (
                                                <span className="text-[9px] text-slate-400">({cafe.userRatingCount} reviews)</span>
                                            )}
                                        </div>
                                    )}
                                    <span className="text-[9px] font-bold text-white px-2 py-0.5 rounded-full uppercase tracking-widest bg-amber-500">{domainMeta.infraLabel}</span>
                                    {cafe.formattedAddress && <div className="mt-2 text-[9px] text-slate-500 italic border-t pt-1">{cafe.formattedAddress}</div>}
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}

                {/* Transit markers — split metro vs bus */}
                {selectedPos && realPOIs.transit.length > 0 && realPOIs.transit.map((station, idx) => {
                    const isMetro = station.types?.some((t: string) => t.includes('subway') || t.includes('light_rail'));
                    const nameHint = station.displayName?.toLowerCase() || '';
                    const icon = isMetro ? metroIcon : busIcon;
                    const label = isMetro ? '🚇 METRO' : '🚌 BUS';
                    const badgeColor = isMetro ? 'bg-purple-500' : 'bg-orange-500';
                    return (
                        <Marker key={`transit-${idx}`} position={[station.location.lat, station.location.lng]} icon={icon}>
                            <Popup>
                                <div className="p-2 min-w-[160px]">
                                    <div className="font-black text-slate-800 text-sm mb-1">{label.split(' ')[0]} {station.displayName}</div>
                                    <span className={`text-[9px] font-bold text-white px-2 py-0.5 rounded-full uppercase tracking-widest ${badgeColor}`}>{label}</span>
                                    {station.formattedAddress && <div className="mt-2 text-[9px] text-slate-500 italic border-t pt-1">{station.formattedAddress}</div>}
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}

                {/* Ward cluster markers */}
                {wardClusters.map(cluster => {
                    const isAnalyzed = selectedCluster === cluster.id && realPOIs.gyms.length > 0;
                    const displayGyms = isAnalyzed ? realPOIs.gyms.length : cluster.gymCount;
                    const displayCafes = isAnalyzed ? realPOIs.cafes.length : cluster.cafeCount;
                    const displayCorporates = isAnalyzed ? realPOIs.corporates.length : 0;
                    const displayApartments = isAnalyzed ? realPOIs.apartments.length : 0;

                    let markerColor = cluster.color;
                    const liveScore = wardScores[cluster.id];
                    if (liveScore) {
                        if (liveScore.finalScore >= 0.70) markerColor = '#10b981';
                        else if (liveScore.finalScore >= 0.45) markerColor = '#f59e0b';
                        else markerColor = '#ef4444';
                    }

                    return (
                        <Marker
                            key={cluster.id}
                            position={[cluster.lat, cluster.lng]}
                            icon={new L.DivIcon({
                                className: 'cluster-marker',
                                html: `<div class="relative flex items-center justify-center cursor-pointer group">
                                     <div class="absolute w-20 h-20 rounded-full animate-pulse" style="background: ${markerColor}20;"></div>
                                     <div class="w-12 h-12 rounded-full border-4 border-white shadow-2xl flex items-center justify-center font-black text-white text-base transition-transform group-hover:scale-110" style="background: ${markerColor};">
                                       🎯
                                     </div>
                                     <div class="absolute -top-1 -right-1 w-6 h-6 bg-white rounded-full shadow-lg flex items-center justify-center border-2 border-indigo-500 animate-bounce">
                                       <svg class="w-3 h-3 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                                         <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                                         <path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
                                       </svg>
                                     </div>
                                   </div>`,
                                iconSize: [80, 80],
                                iconAnchor: [40, 40]
                            })}
                            eventHandlers={{ click: () => onClusterClick(cluster.id, cluster.lat, cluster.lng) }}
                        >
                            <Popup>
                                <div className="p-3 min-w-[220px]">
                                    <div className="font-black text-slate-900 text-base mb-1">🎯 {cluster.wardName}</div>
                                    <div className="text-[10px] text-slate-500 mb-3">Ward ID: {cluster.wardId}</div>

                                    {isAnalyzed && wardScores[cluster.id] && (
                                        <div className="mb-2 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-md">
                                            <span className="text-[9px] font-black text-emerald-700 uppercase">✓ Live Calculated</span>
                                        </div>
                                    )}
                                    {isAnalyzed && !wardScores[cluster.id] && (
                                        <div className="mb-2 px-2 py-1 bg-blue-50 border border-blue-200 rounded-md">
                                            <span className="text-[9px] font-black text-blue-700 uppercase">⏳ Calculating...</span>
                                        </div>
                                    )}
                                    {!isAnalyzed && (
                                        <div className="mb-2 px-2 py-1 bg-amber-50 border border-amber-200 rounded-md">
                                            <span className="text-[9px] font-black text-amber-700 uppercase">📊 Static Data</span>
                                        </div>
                                    )}

                                    <div className="space-y-2 mb-3">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[9px] font-bold text-slate-600 uppercase">Opportunity Score</span>
                                            <span className="text-xs font-black text-indigo-600">
                                                {wardScores[cluster.id]
                                                    ? (wardScores[cluster.id].opportunityScore * 100).toFixed(1)
                                                    : (cluster.opportunityScore * 100).toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-[9px] font-bold text-slate-600 uppercase">Final Score</span>
                                            <span className="text-xs font-black text-emerald-600">
                                                {wardScores[cluster.id]
                                                    ? (wardScores[cluster.id].finalScore * 100).toFixed(1)
                                                    : (cluster.finalScore * 100).toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-[9px] font-bold text-slate-600 uppercase">Growth Rate</span>
                                            <span className="text-xs font-black text-emerald-600">
                                                +{wardScores[cluster.id]
                                                    ? (wardScores[cluster.id].growthRate * 100).toFixed(1)
                                                    : (cluster.growthRate * 100).toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-[9px] font-bold text-slate-600 uppercase">{domain.competitorLabel}</span>
                                            <span className="text-xs font-black text-slate-700">{displayGyms}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-[9px] font-bold text-slate-600 uppercase">{DOMAIN_ICON_MAP[activeDomain].infraLabel}</span>
                                            <span className="text-xs font-black text-slate-700">{displayCafes}</span>
                                        </div>
                                        {isAnalyzed && (
                                            <>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[9px] font-bold text-slate-600 uppercase">Corporate Offices</span>
                                                    <span className="text-xs font-black text-blue-600">{displayCorporates}</span>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[9px] font-bold text-slate-600 uppercase">Apartments</span>
                                                    <span className="text-xs font-black text-purple-600">{displayApartments}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <button
                                        onClick={() => onClusterClick(cluster.id, cluster.lat, cluster.lng)}
                                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-[10px] font-black py-2 px-3 rounded-lg hover:shadow-lg transition-all uppercase tracking-wider"
                                    >
                                        📊 Analyze This Area
                                    </button>
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}

                {/* Custom POI markers */}
                {selectedPos && customParams.map((param) => {
                    const places = customPOIs[param.id] || [];
                    const [cLat, cLng] = selectedPos;
                    return places
                        .filter((p: any) => {
                            if (!p.location?.lat || !p.location?.lng) return false;
                            const R = 6371e3;
                            const rad = Math.PI / 180;
                            const dLat = (p.location.lat - cLat) * rad;
                            const dLon = (p.location.lng - cLng) * rad;
                            const a = Math.sin(dLat / 2) ** 2 + Math.cos(cLat * rad) * Math.cos(p.location.lat * rad) * Math.sin(dLon / 2) ** 2;
                            const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                            return dist <= searchRadius;
                        })
                        .map((p: any, idx: number) => {
                            const mColor = param.color || '#a855f7';
                            const initials = (param.label || 'C').charAt(0).toUpperCase();
                            return (
                                <Marker
                                    key={`custom-${param.id}-${idx}`}
                                    position={[p.location.lat, p.location.lng]}
                                    icon={L.divIcon({
                                        className: '',
                                        html: `<div style="width:28px;height:28px;border-radius:50%;background:${mColor};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#fff;box-shadow:0 3px 6px rgba(0,0,0,0.3)">${initials}</div>`,
                                        iconSize: [28, 28],
                                        iconAnchor: [14, 14],
                                    })}
                                >
                                    <Popup>
                                        <div style={{ minWidth: 140 }}>
                                            <div style={{ fontWeight: 900, fontSize: 12, color: param.color || '#7c3aed', marginBottom: 2 }}>{param.label}</div>
                                            <div style={{ fontSize: 11, color: '#334155' }}>{p.displayName?.text || p.displayName || 'Unknown'}</div>
                                            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{param.poiType}</div>
                                        </div>
                                    </Popup>
                                </Marker>
                            );
                        });
                })}
                {/* ── Rent Listing Pins (distance-aware opacity) ─────────────── */}
                {rentListings.map((listing, idx) => {
                    // Determine if listing is inside the primary catchment radius
                    let isInsideRadius = false;
                    if (selectedPos) {
                        const R = 6371000;
                        const rad = Math.PI / 180;
                        const dLat = (listing.lat - selectedPos[0]) * rad;
                        const dLon = (listing.lng - selectedPos[1]) * rad;
                        const a = Math.sin(dLat / 2) ** 2 +
                            Math.cos(selectedPos[0] * rad) * Math.cos(listing.lat * rad) * Math.sin(dLon / 2) ** 2;
                        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                        isInsideRadius = dist <= searchRadius;
                    }

                    // Vibrant pin inside zone, softer-but-visible outside zone
                    const pinOpacity = 1;
                    const pinColor = isInsideRadius ? '#065f46' : '#6ee7b7';
                    const dynamicIcon = L.divIcon({
                        className: '',
                        html: `<div style="opacity:${pinOpacity};width:30px;height:38px;display:flex;align-items:flex-start;justify-content:center;">
                            <svg viewBox="0 0 30 38" width="30" height="38" xmlns="http://www.w3.org/2000/svg">
                                <path d="M15 0C6.716 0 0 6.716 0 15c0 8.284 15 23 15 23S30 23.284 30 15C30 6.716 23.284 0 15 0z"
                                    fill="${pinColor}" stroke="#fff" stroke-width="1.5"/>
                                <text x="15" y="20" text-anchor="middle" font-size="13" fill="#fff">🏢</text>
                            </svg>
                        </div>`,
                        iconSize: [30, 38],
                        iconAnchor: [15, 38],
                        popupAnchor: [0, -38],
                    });

                    return (
                        <Marker
                            key={`rent-${listing.listing_id || idx}`}
                            position={[listing.lat, listing.lng]}
                            icon={dynamicIcon}
                        >
                            <Popup maxWidth={220}>
                                <div className="p-2 min-w-[200px]">
                                    <div className="font-black text-slate-800 text-sm mb-1 leading-tight">
                                        🏢 {listing.title || 'Commercial Space'}
                                    </div>
                                    {listing.locality && (
                                        <div className="text-[9px] text-slate-400 font-medium mb-2">{listing.locality}</div>
                                    )}
                                    <div className="flex items-center justify-between bg-emerald-50 rounded-lg px-2 py-1.5 mb-2">
                                        <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-wide">₹/sqft</span>
                                        <span className="text-base font-black text-emerald-600">₹{Math.round(listing.price_per_sqft)}</span>
                                    </div>
                                    <div className="flex justify-between text-[9px] text-slate-500 font-medium mb-2">
                                        <span>Area: {listing.area_sqft ? `${Math.round(listing.area_sqft)} sqft` : '—'}</span>
                                        <span>Total: ₹{listing.monthly_rent ? `${(listing.monthly_rent / 1000).toFixed(0)}k/mo` : '—'}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className={`text-[9px] font-bold text-white px-2 py-0.5 rounded-full uppercase tracking-widest ${isInsideRadius ? 'bg-emerald-500' : 'bg-slate-400'}`}>
                                            {isInsideRadius ? 'FOR RENT' : 'NEARBY'}
                                        </span>
                                        {listing.listing_url && (
                                            <a href={listing.listing_url} target="_blank" rel="noreferrer"
                                                className="text-[9px] font-black text-indigo-600 hover:text-indigo-800 hover:underline transition-colors">
                                                View ↗
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}
            </MapContainer>

            {/* Map Legend */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[40] pointer-events-none hidden md:block w-max max-w-[90vw]">
                <div className="bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-full shadow-lg border border-white/80 pointer-events-auto flex flex-wrap justify-center items-center gap-x-3 gap-y-1.5">
                    <span className="text-[9px] font-black text-slate-800 uppercase tracking-widest border-r border-slate-200 pr-3">Legend</span>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1" title={`${domain.competitorLabel} (Competitors)`}>
                            <img src={DOMAIN_ICON_MAP[activeDomain].rawUrl} className="w-3.5 h-3.5" alt="competitor" />
                            <span className="text-[9px] text-slate-600 font-bold">{domain.competitorLabel}</span>
                        </div>
                        <div className="flex items-center gap-1" title={`${DOMAIN_ICON_MAP[activeDomain].infraLabel} (Synergy)`}>
                            <img src={(DOMAIN_ICON_MAP[activeDomain].infraIcon.options as any).iconUrl} className="w-3.5 h-3.5" alt="infra" />
                            <span className="text-[9px] text-slate-600 font-bold">{DOMAIN_ICON_MAP[activeDomain].infraLabel}</span>
                        </div>
                        <div className="flex items-center gap-1 border-l border-slate-200 pl-3">
                            <img src="https://cdn-icons-png.flaticon.com/512/3061/3061341.png" className="w-3.5 h-3.5" alt="office" />
                            <span className="text-[9px] text-slate-600 font-bold">Office</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <img src="https://cdn-icons-png.flaticon.com/512/619/619032.png" className="w-3.5 h-3.5" alt="home" />
                            <span className="text-[9px] text-slate-600 font-bold">Res.</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <img src="https://cdn-icons-png.flaticon.com/512/565/565350.png" className="w-3.5 h-3.5" alt="metro" />
                            <span className="text-[9px] text-slate-600 font-bold">Metro</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <img src="https://cdn-icons-png.flaticon.com/128/1178/1178850.png" className="w-3.5 h-3.5" alt="bus" />
                            <span className="text-[9px] text-slate-600 font-bold">Bus</span>
                        </div>
                        <div className="flex items-center gap-1 border-l border-slate-200 pl-3">
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm border border-emerald-600"></div>
                            <span className="text-[9px] text-slate-600 font-bold">High</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <div className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm border border-amber-600"></div>
                            <span className="text-[9px] text-slate-600 font-bold">Avg</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm border border-red-600"></div>
                            <span className="text-[9px] text-slate-600 font-bold">Low</span>
                        </div>
                        {rentListings.length > 0 && (
                            <div className="flex items-center gap-1 border-l border-slate-200 pl-3" title="Commercial Spaces for Rent">
                                <img src="https://cdn-icons-png.flaticon.com/512/2942/2942827.png" className="w-3.5 h-3.5" alt="rent" />
                                <span className="text-[9px] text-emerald-700 font-bold">Rentals ({rentListings.length})</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Multi-Layer Scanning HUD */}
            <div className="absolute top-24 right-4 lg:right-6 z-[1000] glass-panel px-3 py-2.5 rounded-xl shadow-lg border border-white/60 flex items-center gap-3 pointer-events-none transition-all duration-300 hidden md:flex">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900 text-white shadow-md">
                    <span className="font-black text-xs">{searchRadius < 1000 ? '500' : '1k'}</span>
                </div>
                <div className="flex-1 pr-2">
                    <div className="text-[10px] font-black text-slate-800 leading-tight">Multi-Layer Scan</div>
                    <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                        Found: {competitors} {domain.competitorLabel}, {demandGenerators} Gens
                    </div>
                </div>
            </div>
        </div>
    );
};
