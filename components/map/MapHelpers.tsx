/**
 * Map helper sub-components — extracted from App.tsx.
 * Zero logic change: HeatmapLayer, MapEvents, MapRevalidator, MapZoomController, WardLayer.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Circle, GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { LocationType } from '../../types';
import { DOMAIN_CONFIG, DomainId } from '../../domains';
import { DOMAIN_ICON_MAP } from './mapIcons';

// Bangalore city center
export const BANGALORE_CENTER = { lat: 12.9716, lng: 77.5946 };

// ─── HeatmapLayer ────────────────────────────────────────────────────────────

export const HeatmapLayer = ({ locations }: { locations: any[] }) => {
    const map = useMap();
    useEffect(() => {
        if (!map) return;
        if (!(L as any).heatLayer) return;

        const heatData = locations
            .filter(l => l.type === LocationType.GYM)
            .map(l => [l.lat, l.lng, 0.6]);

        const heatLayer = (L as any).heatLayer(heatData, {
            radius: 40,
            blur: 25,
            maxZoom: 17,
            gradient: { 0.4: '#3b82f6', 0.65: '#10b981', 1: '#ef4444' }
        }).addTo(map);

        return () => { if (map.hasLayer(heatLayer)) map.removeLayer(heatLayer); };
    }, [map, locations]);
    return null;
};

// ─── MapEvents ───────────────────────────────────────────────────────────────

export const MapEvents = ({ onMapClick }: { onMapClick: (e: any) => void }) => {
    useMapEvents({ click: onMapClick });
    return null;
};

// ─── MapRevalidator ──────────────────────────────────────────────────────────

export const MapRevalidator = () => {
    const map = useMap();
    useEffect(() => {
        const timer = setTimeout(() => { map.invalidateSize(); }, 100);
        return () => clearTimeout(timer);
    }, [map]);
    return null;
};

// ─── MapZoomController ───────────────────────────────────────────────────────

export const MapZoomController = ({
    center,
    zoom,
    navigateKey
}: {
    center: [number, number] | null;
    zoom: number;
    navigateKey: number;
}) => {
    const map = useMap();
    useEffect(() => {
        const target = center ?? [BANGALORE_CENTER.lat, BANGALORE_CENTER.lng] as [number, number];
        map.closePopup();
        map.stop();
        map.flyTo(target, zoom, { duration: 0.6, easeLinearity: 0.5 });
    }, [center, navigateKey, zoom, map]);
    return null;
};

// ─── WardLayer ───────────────────────────────────────────────────────────────

export const WardLayer = ({
    onWardClick,
    activeDomain,
    wardScores
}: {
    onWardClick: (lat: number, lng: number, wardName: string) => void;
    activeDomain: DomainId;
    wardScores: Record<string, any>;
}) => {
    const [wardsGeoJSON, setWardsGeoJSON] = useState<any>(null);
    const [wardData, setWardData] = useState<Record<string, any>>({});
    const geoJsonRef = useRef<any>(null);

    useEffect(() => {
        fetch('/wards.geojson')
            .then(res => res.json())
            .then(data => setWardsGeoJSON(data));

        fetch('/ward_data.csv')
            .then(res => res.text())
            .then(csv => {
                const lines = csv.split('\n');
                const data: Record<string, any> = {};
                lines.slice(1).forEach(line => {
                    const parts = line.split(',');
                    if (parts.length > 7) {
                        const wardId = parts[6];
                        data[wardId] = {
                            opportunityScore: parseFloat(parts[1]),
                            finalScore: parseFloat(parts[14]),
                            wardName: parts[7],
                            lat: parseFloat(parts[2]),
                            lng: parseFloat(parts[3]),
                            gymCount: parseInt(parts[9]),
                            cafeCount: parseInt(parts[10])
                        };
                    }
                });
                setWardData(data);
            });
    }, []);

    const getColor = (staticScore: number, liveScore?: number) => {
        if (liveScore !== undefined) {
            if (liveScore >= 0.70) return '#10b981';
            if (liveScore >= 0.45) return '#f59e0b';
            return '#ef4444';
        }
        return '#6366f1'; // App theme (Indigo)
    };

    useEffect(() => {
        if (geoJsonRef.current && Object.keys(wardData).length > 0) {
            geoJsonRef.current.eachLayer((layer: any) => {
                const wardId = layer.feature.properties.ward_id;
                const data = wardData[wardId];
                if (data) {
                    const live = wardScores[`ward-${wardId}`];
                    layer.setStyle({ fillColor: getColor(data.finalScore, live?.finalScore) });
                }
            });
        }
    }, [wardScores, wardData]);

    const onEachFeature = (feature: any, layer: any) => {
        const wardId = feature.properties.ward_id;
        const data = wardData[wardId];

        if (data) {
            layer.bindPopup(`
                <div class="p-2 min-w-[180px]">
                    <div class="font-black text-slate-900 text-sm mb-2">${data.wardName}</div>
                    <div class="space-y-1 text-xs">
                        <div class="flex justify-between">
                            <span class="text-slate-600 font-bold">Opportunity:</span>
                            <span class="font-black text-indigo-600">${(data.opportunityScore * 100).toFixed(1)}%</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-slate-600 font-bold">Final Score:</span>
                            <span class="font-black text-emerald-600">${(data.finalScore * 100).toFixed(1)}%</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-slate-600 font-bold">${DOMAIN_ICON_MAP[activeDomain]?.competitorLabel || 'Competitors'}:</span>
                            <span class="font-black">${data.gymCount}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-slate-600 font-bold">${DOMAIN_ICON_MAP[activeDomain]?.infraLabel || 'Synergy'}:</span>
                            <span class="font-black">${data.cafeCount}</span>
                        </div>
                    </div>
                </div>
            `);

            layer.on('click', () => { onWardClick(data.lat, data.lng, data.wardName); });
        }
    };

    if (!wardsGeoJSON || Object.keys(wardData).length === 0) return null;

    return (
        <GeoJSON
            ref={geoJsonRef}
            data={wardsGeoJSON}
            style={(feature) => {
                const wardId = feature?.properties?.ward_id;
                const data = wardData[wardId];
                const live = wardScores[`ward-${wardId}`];
                return {
                    fillColor: data ? getColor(data.finalScore, live?.finalScore) : '#ccc',
                    weight: 1,
                    opacity: 0.8,
                    color: '#333',
                    fillOpacity: 0.5
                };
            }}
            onEachFeature={onEachFeature}
        />
    );
};
