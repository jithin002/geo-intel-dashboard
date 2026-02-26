
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap, Circle, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import { HSR_CENTER, MOCK_LOCATIONS } from './constants';
import { LocationType, ScoringMatrix } from './types';
import { calculateSuitability } from './services/geoService';
import { getSiteGuidance, GroundingSource, answerFreeform, conversationalQuery } from './services/geminiService';
import './services/leaflet-heat'; // Local vendored version used
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from 'recharts';
import { getLocationIntelligence, generateDataDrivenRecommendation, PlaceResult, textSearch } from './services/placesAPIService';
import { executeSearch, getQueryDescription } from './searchUtils';
import { DOMAIN_CONFIG, DOMAINS_LIST, DomainId } from './domains';
import { getDomainIntelligence, generateDomainRecommendation, DomainLocationIntelligence } from './services/placesAPIService';
import { ChatInterface } from './components/ChatInterface';
import { addMessage, loadConversationHistory, clearConversationHistory, getRecentContext, extractLocationMentions, Message } from './services/conversationService';

/**
 * GYM-LOCATE: Geo-Intel Command Center (v8)
 * Features: Multi-Layer POI Support (Corporate, Parks, Residential)
 */

// --- ICONS ---
const gymIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/2964/2964514.png',
    iconSize: [26, 26],
    className: 'drop-shadow-md'
});
const synergyIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/924/924514.png', // Coffee cup
    iconSize: [22, 22],
});
const corporateIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/3061/3061341.png', // Office Building
    iconSize: [24, 24],
});
const parkIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/427/427503.png', // Tree/Park
    iconSize: [22, 22],
});
const residentialIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/619/619032.png', // House/Apartment
    iconSize: [20, 20],
});
const metroIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/565/565350.png', // Train
    iconSize: [20, 20],
});
const restaurantIcon = new L.DivIcon({
    html: '<div style="background:#f59e0b;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 3px 8px rgba(0,0,0,0.35);border:2.5px solid #fff;">🍽️</div>',
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
});
const bankIcon = new L.DivIcon({
    html: '<div style="background:#2563eb;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 3px 8px rgba(0,0,0,0.35);border:2.5px solid #fff;">🏦</div>',
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
});
const getIconForType = (type: LocationType) => {
    switch (type) {
        case LocationType.GYM: return gymIcon;
        case LocationType.CORPORATE: return corporateIcon;
        case LocationType.PARK: return parkIcon;
        case LocationType.HIGH_RISE: return residentialIcon;
        case LocationType.METRO: return metroIcon;
        default: return synergyIcon;
    }
};

const HeatmapLayer = ({ locations }: { locations: any[] }) => {
    const map = useMap();
    useEffect(() => {
        if (!map) return;
        // Check if heatLayer is available on the imported L instance
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

const MapEvents = ({ onMapClick }: { onMapClick: (e: any) => void }) => {
    useMapEvents({ click: onMapClick });
    return null;
};

const MapRevalidator = () => {
    const map = useMap();
    useEffect(() => {
        const timer = setTimeout(() => {
            map.invalidateSize();
        }, 100);
        return () => clearTimeout(timer);
    }, [map]);
    return null;
};

// Component to control map zoom and center
const MapZoomController = ({ center, zoom }: { center: [number, number] | null, zoom: number }) => {
    const map = useMap();
    useEffect(() => {
        if (center) {
            map.setView(center, zoom, { animate: true, duration: 0.8 });
        } else {
            // Reset to Bangalore center if no selection
            map.setView([BANGALORE_CENTER.lat, BANGALORE_CENTER.lng], zoom, { animate: true, duration: 0.5 });
        }
    }, [center, zoom, map]);
    return null;
};

// Bangalore city center for initial view
const BANGALORE_CENTER = { lat: 12.9716, lng: 77.5946 };

// Ward layer component
const WardLayer = ({ onWardClick }: { onWardClick: (lat: number, lng: number, wardName: string) => void }) => {
    const [wardsGeoJSON, setWardsGeoJSON] = useState<any>(null);
    const [wardData, setWardData] = useState<Record<string, any>>({});

    useEffect(() => {
        // Load GeoJSON
        fetch('/wards.geojson')
            .then(res => res.json())
            .then(data => setWardsGeoJSON(data));

        // Load CSV data
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

    const getColor = (score: number) => {
        if (score > 0.25) return '#10b981'; // High - emerald
        if (score > 0.18) return '#f59e0b'; // Medium - amber
        return '#ef4444'; // Low - red
    };

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
                            <span class="text-slate-600 font-bold">Gyms:</span>
                            <span class="font-black">${data.gymCount}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-slate-600 font-bold">Cafes:</span>
                            <span class="font-black">${data.cafeCount}</span>
                        </div>
                    </div>
                </div>
            `);

            layer.on('click', () => {
                onWardClick(data.lat, data.lng, data.wardName);
            });
        }
    };

    if (!wardsGeoJSON || Object.keys(wardData).length === 0) return null;

    return (
        <GeoJSON
            data={wardsGeoJSON}
            style={(feature) => {
                const wardId = feature?.properties?.ward_id;
                const data = wardData[wardId];
                return {
                    fillColor: data ? getColor(data.finalScore) : '#ccc',
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

const App: React.FC = () => {
    const [selectedPos, setSelectedPos] = useState<[number, number] | null>(null);
    const [searchRadius, setSearchRadius] = useState<number>(1000);
    const [scores, setScores] = useState<ScoringMatrix | null>(null);
    const [aiInsight, setAiInsight] = useState<string>('');
    const [sources, setSources] = useState<GroundingSource[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [showHeatmap, setShowHeatmap] = useState(true);
    const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
    const [selectedWard, setSelectedWard] = useState<string | null>(null);
    const [mapZoom, setMapZoom] = useState<number>(11); // Start zoomed out
    const [searchQuery, setSearchQuery] = useState<string>(''); // Place search query
    const [isListening, setIsListening] = useState(false); // Voice search state

    // NEW: Dynamic ward clusters loaded from CSV
    const [wardClusters, setWardClusters] = useState<any[]>([]);

    // NEW: Calculated scores per ward (based on Places API data)
    const [wardScores, setWardScores] = useState<Record<string, {
        opportunityScore: number;
        finalScore: number;
        growthRate: number;
        demographicLoad: number;
        competitorDensity: number;
    }>>({});

    // NEW: Search query results
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [queryDescription, setQueryDescription] = useState<string>('');

    // CHAT: Conversation state
    const [chatOpen, setChatOpen] = useState(false);
    const [conversationMessages, setConversationMessages] = useState<Message[]>([]);
    const [isAITyping, setIsAITyping] = useState(false);

    // Track last analyzed position to prevent redundant API calls
    const lastAnalyzedPosRef = useRef<string>('');

    // Render helper: display search results list
    const SearchResultsPanel = () => {
        if (!searchResults || searchResults.length === 0) return null;
        return (
            <div className="absolute top-16 right-4 z-50 w-80 max-h-64 overflow-auto bg-white/90 rounded shadow p-2 text-xs">
                <div className="font-bold mb-2">Search Results</div>
                {searchResults.map((r: any, idx: number) => (
                    <div key={idx} className="p-2 hover:bg-slate-100 rounded cursor-pointer" onClick={() => {
                        if (r.location && r.location.lat && r.location.lng) {
                            setSelectedPos([r.location.lat, r.location.lng]);
                            setSelectedCluster(null);
                            setSelectedWard(null);
                            setMapZoom(16);
                        }
                    }}>
                        <div className="font-semibold">{r.displayName || r.display_name || r.id}</div>
                        <div className="text-slate-600">{r.formattedAddress || ''}</div>
                    </div>
                ))}
            </div>
        );
    };

    // NEW: Real POI data from Places API
    const [realPOIs, setRealPOIs] = useState<{
        gyms: PlaceResult[];
        cafes: PlaceResult[];
        parks: PlaceResult[];
        corporates: PlaceResult[];
        transit: PlaceResult[];
        apartments: PlaceResult[]; // NEW: Apartments/residential complexes
    }>({ gyms: [], cafes: [], parks: [], corporates: [], transit: [], apartments: [] });

    // Active analysis domain (single-select)
    const [activeDomain, setActiveDomain] = useState<DomainId>('gym');
    const [domainIntel, setDomainIntel] = useState<DomainLocationIntelligence | null>(null);

    const handleMapClick = useCallback((e: any) => {
        const { lat, lng } = e.latlng;
        setSelectedPos([lat, lng]);
        setSelectedCluster(null); // Clear cluster selection when clicking map
        setSelectedWard(null);
    }, []);

    const handleClusterClick = useCallback((clusterId: string, lat: number, lng: number) => {
        setSelectedPos([lat, lng]);
        setSelectedCluster(clusterId);
        setSelectedWard(null);
        setMapZoom(15); // Zoom in for analysis
    }, []);

    const handleWardClick = useCallback((lat: number, lng: number, wardName: string) => {
        setSelectedPos([lat, lng]);
        setSelectedWard(wardName);
        setSelectedCluster(null);
        setMapZoom(15); // Zoom in for analysis
    }, []);

    // NEW: Intelligent query search (supports natural language)
    const handlePlaceSearch = useCallback(async (query: string) => {
        if (!query) {
            setSearchResults([]);
            setQueryDescription('');
            return;
        }

        // Detect if the user input is a freeform question (natural language QA)
        const isQuestion = /\?|^what\b|^where\b|^how\b|^is\b|^are\b|^who\b|^when\b|^which\b/i.test(query.trim());
        if (isQuestion) {
            try {
                setIsAnalyzing(true);
                setAiInsight('Answering question...');

                // Try to gather some context from Places first
                const places = await textSearch(query);

                // If selected position exists, pass it too
                const [lat, lng] = selectedPos || [undefined, undefined];
                const answer = await answerFreeform(query, lat as any, lng as any, places || []);

                setAiInsight(answer);
                setIsAnalyzing(false);
                return;
            } catch (err) {
                console.error('AI question handling failed:', err);
                setAiInsight('Failed to answer question.');
                setIsAnalyzing(false);
                return;
            }
        }

        try {
            // 1. Try internal ward/cluster search first
            const results = executeSearch(query, wardClusters, wardScores);

            if (results.length > 0) {
                const description = getQueryDescription(query);
                console.log(`🔍 Query: "${query}"`);
                console.log(`📊 Found ${results.length} results`);
                console.log(`ℹ️ ${description}`);

                setSearchResults(results);
                setQueryDescription(description);

                // If single result, zoom to it automatically
                if (results.length === 1) {
                    const ward = results[0];
                    setSelectedPos([ward.lat, ward.lng]);
                    setSelectedCluster(ward.id);
                    setSelectedWard(null);
                    setMapZoom(15);
                }
                return;
            }

            // 2. Fallback: External Place Search (Nominatim) -> then Google Places textSearch
            setQueryDescription(`Searching map for "${query}"...`);
            console.log(`🌍 Searching external map for: ${query}`);

            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query + ", Bangalore")}`);
            const data = await response.json();

            if (data && data.length > 0) {
                const place = data[0];
                const lat = parseFloat(place.lat);
                const lng = parseFloat(place.lon);

                console.log(`📍 Found external place: ${place.display_name}`);

                // Clear internal results
                setSearchResults([]);

                // Set location and trigger analysis
                setSelectedPos([lat, lng]);
                setSelectedCluster(null);
                setSelectedWard(null);
                setMapZoom(15);
                setQueryDescription(`Found: ${place.display_name.split(',')[0]}`);
            } else {
                // If Nominatim fails, try Google Places Text Search for richer data
                console.log('🔎 Nominatim returned no results; trying Google Places Text Search');
                const places = await textSearch(query);

                if (places && places.length > 0) {
                    setSearchResults(places);
                    setQueryDescription(`Found ${places.length} place(s) from Google Places for "${query}"`);
                    // Center map on first result
                    const first = places[0];
                    if (first.location && first.location.lat && first.location.lng) {
                        setSelectedPos([first.location.lat, first.location.lng]);
                        setMapZoom(15);
                    }
                } else {
                    setQueryDescription(`No results found for "${query}"`);
                    alert(`Location "${query}" not found.`);
                }
            }

        } catch (error) {
            console.error('❌ Search error:', error);
            setQueryDescription('Search failed. Please try again.');
        }
    }, [wardClusters, wardScores]);

    // VOICE SEARCH: Handle speech recognition
    const handleVoiceSearch = useCallback(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            alert('Voice search is not supported in this browser.');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => setIsListening(true);
        recognition.onerror = () => setIsListening(false);
        recognition.onend = () => setIsListening(false);

        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            setSearchQuery(transcript);
            handlePlaceSearch(transcript);
        };

        recognition.start();
    }, [handlePlaceSearch]);

    // Load ward clusters from CSV on mount
    useEffect(() => {
        fetch('/ward_data.csv')
            .then(res => res.text())
            .then(csv => {
                const lines = csv.split('\n');
                const clusters = lines.slice(1).filter(line => line.trim()).map((line, index) => {
                    const parts = line.split(',');
                    if (parts.length > 7) {
                        const wardId = parts[6];
                        const wardName = parts[7].replace(/^"|"$/g, ''); // Remove quotes
                        const opportunityScore = parseFloat(parts[1]);
                        const finalScore = parseFloat(parts[14]);
                        const lat = parseFloat(parts[2]);
                        const lng = parseFloat(parts[3]);
                        const gymCount = parseInt(parts[9]);
                        const cafeCount = parseInt(parts[10]);
                        const growthRate = parseFloat(parts[5]);

                        // Determine color based on final score
                        let color = '#ef4444'; // Red - low
                        if (finalScore > 0.25) color = '#10b981'; // Green - high
                        else if (finalScore > 0.18) color = '#f59e0b'; // Amber - medium

                        return {
                            id: `ward-${wardId}`,
                            wardId,
                            wardName,
                            lat,
                            lng,
                            opportunityScore,
                            finalScore,
                            gymCount,
                            cafeCount,
                            growthRate,
                            color
                        };
                    }
                    return null;
                }).filter(Boolean);

                console.log(`📍 Loaded ${clusters.length} ward clusters from CSV`);
                setWardClusters(clusters);
            })
            .catch(err => console.error('Failed to load ward data:', err));

        // Load conversation history
        const savedMessages = loadConversationHistory();
        setConversationMessages(savedMessages);
    }, []);

    useEffect(() => {
        if (selectedPos) {
            setScores(calculateSuitability(selectedPos[0], selectedPos[1], searchRadius / 1000));
        }
    }, [selectedPos, searchRadius]);

    const performAnalysis = useCallback(async () => {
        if (!selectedPos) return;
        setIsAnalyzing(true);
        setAiInsight('Fetching real POI data from Google Places...');

        try {
            if (activeDomain === 'gym') {
                // ── GYM: existing analysis path (unchanged) ──────────────────────
                const intel = await getLocationIntelligence(selectedPos[0], selectedPos[1], searchRadius);
                setRealPOIs({
                    gyms: intel.gyms.places,
                    cafes: intel.cafesRestaurants.places,
                    corporates: intel.corporateOffices.places,
                    transit: intel.transitStations.places,
                    apartments: intel.apartments.places,
                    parks: []
                });
                setDomainIntel(null);

                const realScores = {
                    demographicLoad: Math.min(100,
                        15 + (intel.corporateOffices.total * 6) +
                        (intel.apartments.total * 4) + (intel.cafesRestaurants.total * 2)
                    ),
                    connectivity: Math.min(100, 10 + (intel.transitStations.total * 15)),
                    competitorRatio: intel.marketGap === 'UNTAPPED' ? 100 :
                        intel.marketGap === 'OPPORTUNITY' ? 75 :
                        intel.marketGap === 'COMPETITIVE' ? 50 : 25,
                    infrastructure: Math.min(100, 10 + (intel.cafesRestaurants.total * 5)),
                    total: 0
                };
                realScores.total = Math.round(
                    realScores.demographicLoad * 0.30 + realScores.connectivity * 0.15 +
                    realScores.competitorRatio * 0.30 + realScores.infrastructure * 0.25
                );
                console.log(`📊 GYM SCORE: ${realScores.total}/100`);
                setScores(realScores);

                if (selectedCluster) {
                    const opp = realScores.total / 100;
                    let gr = intel.marketGap === 'UNTAPPED' ? 0.15 : intel.marketGap === 'OPPORTUNITY' ? 0.10 :
                        intel.marketGap === 'COMPETITIVE' ? 0.05 : 0.02;
                    if (realScores.demographicLoad > 70) gr += 0.03;
                    if (intel.corporateOffices.total > 10) gr += 0.02;
                    setWardScores(prev => ({ ...prev, [selectedCluster]: {
                        opportunityScore: opp, finalScore: opp, growthRate: gr,
                        demographicLoad: realScores.demographicLoad, competitorDensity: intel.gyms.total
                    }}));
                }
                setAiInsight(generateDataDrivenRecommendation(intel));

            } else {
                // ── RESTAURANT / BANK: domain-aware path ─────────────────────────
                const cfg = DOMAIN_CONFIG[activeDomain];
                const intel = await getDomainIntelligence(
                    selectedPos[0], selectedPos[1], searchRadius,
                    cfg.competitorTypes, cfg.infraTypes
                );
                setDomainIntel(intel);
                // Clear gym-specific POIs so their markers disappear
                setRealPOIs({ gyms: [], cafes: [], parks: [], corporates: [], transit: [], apartments: [] });

                const { scoring } = cfg;
                let demand = 0, connectivity = 0, gap = 0, infra = 0;

                if (activeDomain === 'restaurant') {
                    const compCount  = intel.competitors.total;
                    const avgRating  = intel.competitors.averageRating;
                    const offices    = intel.corporateOffices.total;
                    const apartments = intel.apartments.total;
                    const transit    = intel.transitStations.total;
                    const infraCount = intel.infraSynergy.total;

                    // ── PRINCIPLE: each raw signal feeds exactly ONE parameter ──
                    // Offices + Apartments → Footfall (they eat regularly)
                    // InfraSynergy        → Dest Pull (magnets that bring visitors)
                    // Transit             → Access (gated by demand — useless alone)
                    // Competitors + above → Gap (opportunity relative to demand)

                    // ── FOOTFALL (40%) ──────────────────────────────────────────
                    // Only people who are consistently in the area: offices & apartments.
                    // Infra (malls/colleges) adds a smaller contribution for captive visitors.
                    demand = Math.min(100,
                        offices    * 12 +   // reliable lunch crowd
                        apartments * 8  +   // reliable dinner crowd
                        infraCount * 4      // mall-goers / hotel guests / students
                        // transit NOT here — it's the Access parameter
                    );

                    // ── ACCESS (15%) ────────────────────────────────────────────
                    // Transit is only valuable when PEOPLE are already present.
                    // Gate: if demand=0 (no one around), transit contributes < 15%.
                    // demandGate 0→0.15, 40→1.0 — scales with actual footfall.
                    const demandGate = demand > 0 ? Math.min(1.0, demand / 40) : 0;
                    connectivity = Math.round(Math.min(100, transit * 15) * (0.15 + demandGate * 0.85));

                    // ── DINING GAP (20%) ────────────────────────────────────────
                    // Gap = demand × uncaptured share.
                    // → Forest (demand=0): gap = 0, regardless of 0 competitors.
                    // → Busy area, low competition: gap is high.
                    // → Busy area, many strong competitors: gap is low.
                    const capacity    = Math.max(2, (offices + apartments) * 3 + infraCount * 1.5);
                    const saturation  = Math.min(1, compCount / capacity);
                    const qualityMult = compCount > 0 && avgRating > 0 ? avgRating / 5 : 0.5;
                    const effectiveSat = saturation * (0.4 + qualityMult * 0.6);
                    gap = Math.round(demand * (1 - effectiveSat));

                    // ── DEST PULL (25%) ─────────────────────────────────────────
                    // Malls / cinemas / universities / hotels — pure magnet score.
                    // No infra = 0. Each magnet contributes independently.
                    infra = Math.min(100, infraCount * 14);

                    console.log(`🍽️ inputs  → offices:${offices} apts:${apartments} transit:${transit} infra:${infraCount} comps:${compCount} avgRating:${avgRating} capacity:${capacity.toFixed(1)}`);
                    console.log(`🍽️ scores  → footfall:${demand} access:${connectivity} gap:${gap} destPull:${infra} | total≈${Math.round(demand*0.4+connectivity*0.15+gap*0.2+infra*0.25)}`);
                } else { // bank
                    // Pop (40%): corporates (employee banking) + residents (retail banking)
                    demand       = Math.min(100, 15 + (intel.corporateOffices.total * 8) + (intel.apartments.total * 5));
                    // Access (25%): transit + commercial density drives branch footfall
                    connectivity = Math.min(100, 10 + (intel.transitStations.total * 12) + (intel.infraSynergy.total * 3));
                    // Bank Gap (20%): competition count + quality adjustment
                    const bankBaseGap = intel.marketGap === 'UNTAPPED' ? 100 : intel.marketGap === 'OPPORTUNITY' ? 75 : intel.marketGap === 'COMPETITIVE' ? 50 : 25;
                    const bankHighRatedRatio = intel.competitors.highRated / Math.max(intel.competitors.total, 1);
                    const bankAvgRating = intel.competitors.averageRating;
                    // Well-rated bank branches = established trust → harder to displace → penalty up to -10
                    const bankQualityPenalty = Math.round(bankHighRatedRatio * 10);
                    // Low-rated banks = customer dissatisfaction = your opening → bonus up to +8
                    const bankQualityBonus = (bankAvgRating > 0 && bankAvgRating < 3.5) ? 8 : 0;
                    gap = Math.min(100, Math.max(15, bankBaseGap + bankQualityBonus - bankQualityPenalty));
                    // Commercial (15%): retail density drives ATM/branch need
                    infra        = Math.min(100, 10 + (intel.infraSynergy.total * 5));
                }
                const total = Math.round(
                    demand * scoring.demand.weight + connectivity * scoring.connectivity.weight +
                    gap * scoring.gap.weight + infra * scoring.infra.weight
                );
                console.log(`📊 ${cfg.label.toUpperCase()} SCORE: ${total}/100`);
                setScores({ demographicLoad: demand, connectivity, competitorRatio: gap, infrastructure: infra, total });

                if (selectedCluster) {
                    const opp = total / 100;
                    let gr = intel.marketGap === 'UNTAPPED' ? 0.15 : intel.marketGap === 'OPPORTUNITY' ? 0.10 :
                        intel.marketGap === 'COMPETITIVE' ? 0.05 : 0.02;
                    if (demand > 70) gr += 0.03;
                    if (intel.corporateOffices.total > 10) gr += 0.02;
                    setWardScores(prev => ({ ...prev, [selectedCluster]: {
                        opportunityScore: opp, finalScore: opp, growthRate: gr,
                        demographicLoad: demand, competitorDensity: intel.competitors.total
                    }}));
                }
                setAiInsight(generateDomainRecommendation(intel, cfg.competitorLabel));
            }

            setIsAnalyzing(false);
        } catch (error) {
            console.error('Places API analysis failed:', error);
            setAiInsight('⚠️ Places API unavailable. Add GOOGLE_MAPS_API_KEY to .env.local for real POI data. Using fallback mock data...');
            const fallbackScores = calculateSuitability(selectedPos[0], selectedPos[1], searchRadius / 1000);
            setScores(fallbackScores);
            setIsAnalyzing(false);
        }
    }, [selectedPos, searchRadius, activeDomain, selectedCluster]);

    // AUTOMATIC ANALYSIS with safeguard (debounce + distance-check)
    useEffect(() => {
        if (!selectedPos) return;
        
        // Simple key to determine if we've already analyzed this exact spot/radius
        // Rounding to 4 decimals (~10m) to catch small map adjustments
        const posKey = `${selectedPos[0].toFixed(4)},${selectedPos[1].toFixed(4)},${searchRadius},${activeDomain}`;
        
        if (lastAnalyzedPosRef.current === posKey) {
            console.log('⚡ Skipping redundant analysis (Already cached for this spot)');
            return;
        }

        const timer = setTimeout(() => {
            console.log('🤖 Triggering automatic analysis for:', posKey);
            lastAnalyzedPosRef.current = posKey;
            performAnalysis();
        }, 1000); // 1-second debounce to prevent spamming during map movement

        return () => clearTimeout(timer);
    }, [selectedPos, searchRadius, activeDomain, performAnalysis]);

    const catchmentOverlap = useMemo(() => {
        if (!selectedPos) return [];
        const R = 6371;
        const radiusInKm = searchRadius / 1000;
        return MOCK_LOCATIONS.filter(loc => {
            const dLat = (loc.lat - selectedPos[0]) * Math.PI / 180;
            const dLon = (loc.lng - selectedPos[1]) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(selectedPos[0] * Math.PI / 180) * Math.cos(loc.lat * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return dist <= radiusInKm;
        });
    }, [selectedPos, searchRadius]);

    // Domain-aware POI counts
    const domainConfig = DOMAIN_CONFIG[activeDomain];
    const competitors = activeDomain === 'gym'
        ? realPOIs.gyms.length
        : (domainIntel?.competitors.total || 0);
    const demandGenerators = activeDomain === 'gym'
        ? realPOIs.corporates.length + realPOIs.cafes.length
        : (domainIntel ? domainIntel.corporateOffices.total + domainIntel.apartments.total : 0);

    const chartData = useMemo(() => {
        if (!scores) return [];
        const { scoring } = DOMAIN_CONFIG[activeDomain];
        return [
            { name: scoring.demand.label,       score: scores.demographicLoad,  color: scoring.demand.color,       desc: scoring.demand.desc },
            { name: scoring.connectivity.label, score: scores.connectivity,     color: scoring.connectivity.color, desc: scoring.connectivity.desc },
            { name: scoring.gap.label,          score: scores.competitorRatio,  color: scoring.gap.color,          desc: scoring.gap.desc },
            { name: scoring.infra.label,        score: scores.infrastructure,   color: scoring.infra.color,        desc: scoring.infra.desc },
        ];
    }, [scores, activeDomain]);

    const getVerdict = () => {
        if (!scores) return { text: "SELECT AREA", color: "text-slate-400" };
        if (scores.total > 80) return { text: "GOLD MINE", color: "text-emerald-400" };
        if (scores.total > 60) return { text: "STRONG", color: "text-indigo-400" };
        if (scores.total > 40) return { text: "AVERAGE", color: "text-yellow-400" };
        return { text: "RISKY", color: "text-red-400" };
    };

    // CHAT: Handle user messages
    const handleUserMessage = useCallback(async (message: string) => {
        // Add user message to conversation
        const updatedMessages = addMessage(
            conversationMessages,
            'user',
            message,
            {
                location: selectedPos || undefined,
                wardName: selectedWard || undefined
            }
        );
        setConversationMessages(updatedMessages);
        setIsAITyping(true);

        try {
            // Check if message contains ward mentions
            const mentions = extractLocationMentions(message, wardClusters);

            // If user mentions a ward, navigate to it
            if (mentions.length > 0) {
                const mentionedWard = wardClusters.find(
                    w => w.wardName.toLowerCase() === mentions[0].toLowerCase()
                );
                if (mentionedWard) {
                    console.log(`📍 Navigating to mentioned ward: ${mentionedWard.wardName}`);
                    setSelectedPos([mentionedWard.lat, mentionedWard.lng]);
                    setSelectedCluster(mentionedWard.id);
                    setSelectedWard(mentionedWard.wardName);
                    setMapZoom(15);

                    // Trigger analysis after short delay to allow state to update
                    setTimeout(() => {
                        performAnalysis();
                    }, 300);
                }
            }

            // Check if this is a search query (top X, high growth, etc.)
            const isSearchQuery = message.toLowerCase().match(/top \d+|high growth|untapped|low competition|opportunity/);
            if (isSearchQuery) {
                const results = executeSearch(message, wardClusters, wardScores);
                if (results.length > 0) {
                    setSearchResults(results);
                    const description = getQueryDescription(message);
                    setQueryDescription(description);

                    // Auto-zoom to first result if specific query
                    if (results.length === 1) {
                        const ward = results[0];
                        setSelectedPos([ward.lat, ward.lng]);
                        setSelectedCluster(ward.id);
                        setSelectedWard(ward.wardName);
                        setMapZoom(15);

                        // Trigger analysis after state update
                        setTimeout(() => {
                            performAnalysis();
                        }, 300);
                    }

                    // AI response for search
                    let aiResponse = `I found ${results.length} area(s) matching your query.\n\n`;
                    results.slice(0, 5).forEach((r, idx) => {
                        const score = ((r.finalScore || r.opportunityScore || 0) * 100).toFixed(0);
                        aiResponse += `${idx + 1}. **${r.wardName}** - Score: ${score}%\n`;
                    });
                    aiResponse += `\nClick on any area in the results panel to analyze it in detail.`;

                    const finalMessages = addMessage(updatedMessages, 'assistant', aiResponse);
                    setConversationMessages(finalMessages);
                    setIsAITyping(false);
                    return;
                }
            }

            // Build context for conversational query
            const recentContext = getRecentContext(updatedMessages).map(msg => ({
                role: msg.role,
                content: msg.content
            }));

            // Call conversational query
            const response = await conversationalQuery(message, {
                recentMessages: recentContext,
                currentLocation: selectedPos || undefined,
                selectedWard: selectedWard || undefined,
                scores: scores || undefined,
                realPOIs: realPOIs,
                wardClusters
            });

            console.log(`💬 Conversational response (Gemini: ${response.usedGemini})`);

            // Execute dashboard action if present
            if (response.action) {
                switch (response.action.type) {
                    case 'navigate':
                        if (response.action.payload.location) {
                            setSelectedPos(response.action.payload.location);
                            setMapZoom(response.action.payload.zoom || 15);
                            // Trigger analysis after navigation
                            setTimeout(() => {
                                performAnalysis();
                            }, 300);
                        }
                        break;
                    case 'search':
                        if (response.action.payload.query) {
                            await handlePlaceSearch(response.action.payload.query);
                        }
                        break;
                    case 'analyze':
                        // Trigger analysis
                        await performAnalysis();
                        break;
                    case 'zoom':
                        if (response.action.payload.zoom) {
                            setMapZoom(response.action.payload.zoom);
                        }
                        break;
                }
            }

            // Add AI response to conversation
            const finalMessages = addMessage(updatedMessages, 'assistant', response.response);
            setConversationMessages(finalMessages);
        } catch (error) {
            console.error('Chat error:', error);
            const errorMessages = addMessage(
                updatedMessages,
                'assistant',
                'Sorry, I encountered an error. Please try again.'
            );
            setConversationMessages(errorMessages);
        } finally {
            setIsAITyping(false);
        }
    }, [conversationMessages, selectedPos, selectedWard, scores, realPOIs, wardClusters, wardScores]);

    // Clear chat history
    const handleClearChat = useCallback(() => {
        clearConversationHistory();
        setConversationMessages([]);
    }, []);

    return (
        <div className="flex flex-col lg:flex-row h-[100dvh] w-full bg-slate-100 overflow-hidden font-sans">

            {/* 1. Map Interaction Area */}
            <div className="order-1 lg:order-2 flex-1 relative h-[45vh] lg:h-full w-full">

                {/* Floating Search Bar */}
                <div className="absolute top-1.5 left-1/2 -translate-x-1/2 z-[1100] w-[95%] max-w-lg">
                    <div className="flex items-center gap-2 bg-white/95 backdrop-blur-md shadow-2xl border border-white/80 rounded-2xl px-3 py-1.5">
                        <span className="text-slate-400 text-sm pl-1">🔍</span>
                        <input
                            type="text"
                            placeholder='Search ward, area or ask a question...'
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyPress={(e) => {
                                if (e.key === 'Enter') handlePlaceSearch(searchQuery.trim());
                            }}
                            className="flex-1 bg-transparent text-[11px] font-bold text-slate-700 focus:outline-none placeholder:text-slate-400 placeholder:font-normal py-1"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => { setSearchQuery(''); setSearchResults([]); setQueryDescription(''); }}
                                className="text-slate-300 hover:text-slate-500 transition-colors text-sm leading-none px-1"
                            >✕</button>
                        )}
                        <button
                            onClick={handleVoiceSearch}
                            className={`p-1.5 rounded-full transition-all ${
                                isListening 
                                ? 'bg-red-50 text-red-600 animate-pulse ring-2 ring-red-300' 
                                : 'text-slate-400 hover:bg-slate-100 hover:text-indigo-600'
                            }`}
                            title="Voice Search"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                        </button>
                        <button
                            onClick={() => handlePlaceSearch(searchQuery.trim())}
                            className="px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-[9px] font-black rounded-xl hover:shadow-lg transition-all uppercase tracking-wider whitespace-nowrap"
                        >
                            Search
                        </button>
                    </div>
                    {/* Inline results dropdown */}
                    {queryDescription && (
                        <div className="mt-0.5 px-3 py-0.5 text-[9px] font-bold text-indigo-700 bg-indigo-50/90 backdrop-blur-sm border border-indigo-100 rounded-lg shadow-sm">{queryDescription}</div>
                    )}
                </div>

                {/* Domain filter removed (reverted) */}
                <MapContainer center={[BANGALORE_CENTER.lat, BANGALORE_CENTER.lng]} zoom={mapZoom} className="z-10 h-full w-full">
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        maxZoom={19}
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />

                    {/* Ward Boundaries Layer */}
                    <WardLayer onWardClick={handleWardClick} />

                    {/* {showHeatmap && <HeatmapLayer locations={MOCK_LOCATIONS} />} */}
                    <MapEvents onMapClick={handleMapClick} />
                    <MapRevalidator />
                    <MapZoomController center={selectedPos} zoom={mapZoom} />

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

                    {selectedPos && (() => {
                        // Derive growth rate the same way performAnalysis does for wardScores
                        const estGrowthRate = scores
                            ? (scores.competitorRatio > 75 ? 15 : scores.competitorRatio > 55 ? 10 : scores.competitorRatio > 30 ? 5 : 2)
                              + (scores.demographicLoad > 70 ? 3 : 0)
                              + (activeDomain === 'gym' ? (realPOIs.corporates.length > 10 ? 2 : 0) : (domainIntel && domainIntel.corporateOffices.total > 10 ? 2 : 0))
                            : 0;
                        const locationName = selectedWard || wardClusters.find(c => c.id === selectedCluster)?.wardName || 'Custom Point';
                        const locationSub  = selectedCluster
                            ? `Ward ID: ${wardClusters.find(c => c.id === selectedCluster)?.wardId}`
                            : selectedWard
                            ? `Ward: ${selectedWard}`
                            : `${selectedPos[0].toFixed(4)}, ${selectedPos[1].toFixed(4)}`;

                        return (
                            <Marker
                                key={`sel-${selectedPos[0].toFixed(5)}-${selectedPos[1].toFixed(5)}`}
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
                                eventHandlers={{
                                    add: (e) => { setTimeout(() => (e.target as any).openPopup(), 1000); }
                                }}
                            >
                                <Popup maxWidth={260} autoPan={true} autoPanPadding={[50, 120]}>
                                    <div className="p-2 min-w-[190px]">
                                        {/* Title — same style as cluster */}
                                        <div className="font-black text-slate-900 text-sm mb-0.5">
                                            {domainConfig.emoji} {locationName}
                                        </div>
                                        <div className="text-[9px] text-slate-500 mb-2">{locationSub}</div>

                                        {/* Status badge */}
                                        {scores && !isAnalyzing && (
                                            <div className="mb-1.5 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-md">
                                                <span className="text-[8px] font-black text-emerald-700 uppercase">✓ Live Calculated</span>
                                            </div>
                                        )}
                                        {isAnalyzing && (
                                            <div className="mb-1.5 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded-md">
                                                <span className="text-[8px] font-black text-blue-700 uppercase">⏳ Calculating...</span>
                                            </div>
                                        )}
                                        {!scores && !isAnalyzing && (
                                            <div className="mb-1.5 px-2 py-0.5 bg-amber-50 border border-amber-200 rounded-md">
                                                <span className="text-[8px] font-black text-amber-700 uppercase">📊 Static Data</span>
                                            </div>
                                        )}

                                        {/* Rows — exactly match cluster popup */}
                                        <div className="space-y-1 mb-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[8px] font-bold text-slate-600 uppercase">Opp. Score</span>
                                                <span className="text-[10px] font-black text-indigo-600">
                                                    {scores ? `${scores.total.toFixed(1)}%` : '--'}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-[8px] font-bold text-slate-600 uppercase">Final Score</span>
                                                <span className="text-[10px] font-black text-emerald-600">
                                                    {scores ? `${scores.total.toFixed(1)}%` : '--'}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-[8px] font-bold text-slate-600 uppercase">Growth Rate</span>
                                                <span className="text-[10px] font-black text-emerald-600">
                                                    {scores ? `+${estGrowthRate.toFixed(1)}%` : '--'}
                                                </span>
                                            </div>

                                            {/* GYM domain */}
                                            {activeDomain === 'gym' && (
                                                <>
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Gyms</span>
                                                        <span className="text-[10px] font-black text-slate-700">{realPOIs.gyms.length}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Lifestyle</span>
                                                        <span className="text-[10px] font-black text-slate-700">{realPOIs.cafes.length}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Corporate</span>
                                                        <span className="text-[10px] font-black text-blue-600">{realPOIs.corporates.length}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Apartments</span>
                                                        <span className="text-[10px] font-black text-purple-600">{realPOIs.apartments.length}</span>
                                                    </div>
                                                </>
                                            )}

                                            {/* RESTAURANT domain */}
                                            {activeDomain === 'restaurant' && domainIntel && (
                                                <>
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Restaurants</span>
                                                        <span className="text-[10px] font-black text-slate-700">{domainIntel.competitors.total}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Corporate</span>
                                                        <span className="text-[10px] font-black text-blue-600">{domainIntel.corporateOffices.total}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Apartments</span>
                                                        <span className="text-[10px] font-black text-purple-600">{domainIntel.apartments.total}</span>
                                                    </div>
                                                </>
                                            )}

                                            {/* BANK domain */}
                                            {activeDomain === 'bank' && domainIntel && (
                                                <>
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Banks</span>
                                                        <span className="text-[10px] font-black text-slate-700">{domainIntel.competitors.total}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Corporate</span>
                                                        <span className="text-[10px] font-black text-blue-600">{domainIntel.corporateOffices.total}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Apartments</span>
                                                        <span className="text-[10px] font-black text-purple-600">{domainIntel.apartments.total}</span>
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        <button
                                            onClick={performAnalysis}
                                            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-[9px] font-black py-1.5 px-3 rounded-lg hover:shadow-lg transition-all uppercase tracking-wider"
                                        >
                                            📊 Analyze Area
                                        </button>
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })()}


                    {/* REAL POI Markers from Google Places API */}
                    {selectedPos && realPOIs.gyms.length > 0 && realPOIs.gyms.map((gym, idx) => (
                        <Marker key={`gym-${idx}`} position={[gym.location.lat, gym.location.lng]} icon={gymIcon}>
                            <Popup autoPanPadding={[50, 120]}>
                                <div className="p-2 min-w-[180px]">
                                    <div className="font-black text-slate-800 text-sm mb-1">🏋️ {gym.displayName}</div>
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
                    ))}

                    {selectedPos && realPOIs.corporates.length > 0 && realPOIs.corporates.map((corp, idx) => (
                        <Marker key={`corp-${idx}`} position={[corp.location.lat, corp.location.lng]} icon={corporateIcon}>
                            <Popup autoPanPadding={[50, 120]}>
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

                    {/* Apartment Markers */}
                    {selectedPos && realPOIs.apartments && realPOIs.apartments.length > 0 && realPOIs.apartments.map((apt, idx) => (
                        <Marker key={`apt-${idx}`} position={[apt.location.lat, apt.location.lng]} icon={residentialIcon}>
                            <Popup autoPanPadding={[50, 120]}>
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



                    {/* Parks removed - no longer fetched or displayed */}

                    {/* Domain competitor markers (restaurant / bank) */}
                    {activeDomain !== 'gym' && selectedPos && domainIntel && (
                        <>
                            {domainIntel.competitors.places.map((place, idx) => (
                                <Marker key={`dc-${idx}`} position={[place.location.lat, place.location.lng]}
                                    icon={activeDomain === 'restaurant' ? new L.DivIcon({
                                        html: '<div style="background:#f59e0b;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:2px solid #fff;">☕</div>',
                                        className: '',
                                        iconSize: [30, 30],
                                        iconAnchor: [15, 15],
                                    }) : bankIcon}>
                                    <Popup autoPanPadding={[50, 120]}>
                                        <div className="p-2 min-w-[180px]">
                                            <div className="font-black text-slate-800 text-sm mb-1">
                                                {activeDomain === 'restaurant' ? '🍽️' : '🏦'} {place.displayName}
                                            </div>
                                            {place.rating && (
                                                <div className="flex items-center gap-1 mb-1">
                                                    <span className="text-yellow-500 text-xs">★</span>
                                                    <span className="text-xs font-bold">{place.rating.toFixed(1)}</span>
                                                    {place.userRatingCount && <span className="text-[9px] text-slate-400">({place.userRatingCount})</span>}
                                                </div>
                                            )}
                                            <span className="text-[9px] font-bold text-white px-2 py-0.5 rounded-full uppercase"
                                                style={{ background: domainConfig.color }}>COMPETITOR</span>
                                            {place.formattedAddress && <div className="mt-2 text-[9px] text-slate-500 italic border-t pt-1">{place.formattedAddress}</div>}
                                        </div>
                                    </Popup>
                                </Marker>
                            ))}
                            {domainIntel.corporateOffices.places.map((corp, idx) => (
                                <Marker key={`dco-${idx}`} position={[corp.location.lat, corp.location.lng]} icon={corporateIcon}>
                                    <Popup autoPanPadding={[50, 120]}>
                                        <div className="p-2 min-w-[160px]">
                                            <div className="font-black text-slate-800 text-sm mb-1">🏢 {corp.displayName}</div>
                                            <span className="text-[9px] font-bold text-white px-2 py-0.5 rounded-full uppercase bg-blue-500">DEMAND DRIVER</span>
                                        </div>
                                    </Popup>
                                </Marker>
                            ))}
                            {domainIntel.transitStations.places.map((station, idx) => (
                                <Marker key={`dts-${idx}`} position={[station.location.lat, station.location.lng]} icon={metroIcon}>
                                    <Popup autoPanPadding={[50, 120]}>
                                        <div className="p-2 min-w-[160px]">
                                            <div className="font-black text-slate-800 text-sm mb-1">🚇 {station.displayName}</div>
                                            <span className="text-[9px] font-bold text-white px-2 py-0.5 rounded-full uppercase bg-purple-500">TRANSIT</span>
                                        </div>
                                    </Popup>
                                </Marker>
                            ))}
                        </>
                    )}


                    {selectedPos && realPOIs.cafes.length > 0 && realPOIs.cafes.map((cafe, idx) => (
                        <Marker key={`cafe-${idx}`} position={[cafe.location.lat, cafe.location.lng]} icon={synergyIcon}>
                            <Popup autoPanPadding={[50, 120]}>
                                <div className="p-2 min-w-[160px]">
                                    <div className="font-black text-slate-800 text-sm mb-1">☕ {cafe.displayName}</div>
                                    {cafe.rating && (
                                        <div className="flex items-center gap-1 mb-1">
                                            <span className="text-yellow-500 text-xs">★</span>
                                            <span className="text-xs font-bold">{cafe.rating.toFixed(1)}</span>
                                            {cafe.userRatingCount && (
                                                <span className="text-[9px] text-slate-400">({cafe.userRatingCount} reviews)</span>
                                            )}
                                        </div>
                                    )}
                                    <span className="text-[9px] font-bold text-white px-2 py-0.5 rounded-full uppercase tracking-widest bg-amber-500">LIFESTYLE</span>
                                    {cafe.formattedAddress && <div className="mt-2 text-[9px] text-slate-500 italic border-t pt-1">{cafe.formattedAddress}</div>}
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    {selectedPos && realPOIs.transit.length > 0 && realPOIs.transit.map((station, idx) => (
                        <Marker key={`transit-${idx}`} position={[station.location.lat, station.location.lng]} icon={metroIcon}>
                            <Popup autoPanPadding={[50, 120]}>
                                <div className="p-2 min-w-[160px]">
                                    <div className="font-black text-slate-800 text-sm mb-1">🚇 {station.displayName}</div>
                                    <span className="text-[9px] font-bold text-white px-2 py-0.5 rounded-full uppercase tracking-widest bg-purple-500">TRANSIT</span>
                                    {station.formattedAddress && <div className="mt-2 text-[9px] text-slate-500 italic border-t pt-1">{station.formattedAddress}</div>}
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    {/* Ward Cluster Markers - Dynamically Loaded from CSV */}
                    {wardClusters.map(cluster => {
                        // Check if this cluster has been analyzed (has real POI data)
                        const isAnalyzed = selectedCluster === cluster.id && realPOIs.gyms.length > 0;
                        const displayGyms = isAnalyzed ? realPOIs.gyms.length : cluster.gymCount;
                        const displayCafes = isAnalyzed ? realPOIs.cafes.length : cluster.cafeCount;
                        const displayCorporates = isAnalyzed ? realPOIs.corporates.length : 0;
                        const displayApartments = isAnalyzed ? realPOIs.apartments.length : 0;

                        return (
                            <Marker
                                key={cluster.id}
                                position={[cluster.lat, cluster.lng]}
                                icon={new L.DivIcon({
                                    className: 'cluster-marker',
                                    html: `<div class="relative flex items-center justify-center cursor-pointer group">
                                         <div class="absolute w-20 h-20 rounded-full animate-pulse" style="background: ${cluster.color}20;"></div>
                                         <div class="w-12 h-12 rounded-full border-4 border-white shadow-2xl flex items-center justify-center font-black text-white text-base transition-transform group-hover:scale-110" style="background: ${cluster.color};">
                                           🎯
                                         </div>
                                         <!-- Clickable indicator -->
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
                                eventHandlers={{
                                    click: () => handleClusterClick(cluster.id, cluster.lat, cluster.lng)
                                }}
                            >
                                <Popup autoPan={true} autoPanPadding={[50, 120]}>
                                    <div className="p-2 min-w-[180px]">
                                        <div className="font-black text-slate-900 text-sm mb-0.5">🎯 {cluster.wardName}</div>
                                        <div className="text-[9px] text-slate-500 mb-2">Ward ID: {cluster.wardId}</div>

                                        {isAnalyzed && wardScores[cluster.id] && (
                                            <div className="mb-1.5 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-md">
                                                <span className="text-[8px] font-black text-emerald-700 uppercase">✓ Live Calculated</span>
                                            </div>
                                        )}
                                        {isAnalyzed && !wardScores[cluster.id] && (
                                            <div className="mb-1.5 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded-md">
                                                <span className="text-[8px] font-black text-blue-700 uppercase">⏳ Calculating...</span>
                                            </div>
                                        )}
                                        {!isAnalyzed && (
                                            <div className="mb-1.5 px-2 py-0.5 bg-amber-50 border border-amber-200 rounded-md">
                                                <span className="text-[8px] font-black text-amber-700 uppercase">📊 Static Data</span>
                                            </div>
                                        )}

                                        <div className="space-y-1 mb-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[8px] font-bold text-slate-600 uppercase">Opportunity Score</span>
                                                <span className="text-[10px] font-black text-indigo-600">
                                                    {wardScores[cluster.id]
                                                        ? (wardScores[cluster.id].opportunityScore * 100).toFixed(1)
                                                        : (cluster.opportunityScore * 100).toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-[8px] font-bold text-slate-600 uppercase">Final Score</span>
                                                <span className="text-[10px] font-black text-emerald-600">
                                                    {wardScores[cluster.id]
                                                        ? (wardScores[cluster.id].finalScore * 100).toFixed(1)
                                                        : (cluster.finalScore * 100).toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-[8px] font-bold text-slate-600 uppercase">Growth Rate</span>
                                                <span className="text-[10px] font-black text-emerald-600">
                                                    +{wardScores[cluster.id]
                                                        ? (wardScores[cluster.id].growthRate * 100).toFixed(1)
                                                        : (cluster.growthRate * 100).toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-[8px] font-bold text-slate-600 uppercase">Existing Gyms</span>
                                                <span className="text-[10px] font-black text-slate-700">{displayGyms}</span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-[8px] font-bold text-slate-600 uppercase">Cafes/Lifestyle</span>
                                                <span className="text-[10px] font-black text-slate-700">{displayCafes}</span>
                                            </div>
                                            {isAnalyzed && (
                                                <>
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Corp. Offices</span>
                                                        <span className="text-[10px] font-black text-blue-600">{displayCorporates}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Apartments</span>
                                                        <span className="text-[10px] font-black text-purple-600">{displayApartments}</span>
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        <button
                                            onClick={() => handleClusterClick(cluster.id, cluster.lat, cluster.lng)}
                                            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-[9px] font-black py-1.5 px-3 rounded-lg hover:shadow-lg transition-all uppercase tracking-wider"
                                        >
                                            📊 Analyze Area
                                        </button>
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })}
                </MapContainer>

                <div className="absolute bottom-4 left-4 right-4 lg:right-auto lg:bottom-5 lg:left-5 z-[1000] glass-panel px-3 py-2 lg:px-6 lg:py-3.5 rounded-xl lg:rounded-[2rem] shadow-xl border border-white/80 flex items-center gap-3 lg:gap-4">
                    <div className="flex items-center justify-center w-7 h-7 lg:w-9 lg:h-9 rounded-lg lg:rounded-xl bg-slate-900 text-white shadow-lg">
                        <span className="font-black text-[10px] lg:text-xs">{searchRadius < 1000 ? '500' : '1k'}</span>
                    </div>
                    <div className="flex-1">
                        <div className="text-[10px] lg:text-xs font-black text-slate-900 leading-tight">{domainConfig.emoji} {domainConfig.label} Analysis</div>
                        <div className="text-[7px] lg:text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Found: {competitors} {domainConfig.competitorLabel}, {demandGenerators} Generators</div>
                    </div>
                </div>
            </div>

            {/* 2. Sidebar Control Panel */}
            <div className="order-2 lg:order-1 w-full lg:w-[380px] h-full bg-white shadow-2xl flex flex-col z-20 p-4 md:p-5 overflow-y-auto custom-scrollbar border-t lg:border-t-0 lg:border-r border-slate-200">
                <header className="mb-4 flex items-center justify-between">
                    <div>
                        <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-1">
                            Geo-Intel <span className="bg-indigo-600 text-white px-2 py-0.5 rounded-lg text-xs lg:text-sm">V8 PRO</span>
                        </h1>
                        {(selectedCluster || selectedWard) && (
                            <div className="mt-1.5 inline-flex items-center gap-1 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 px-2.5 py-1 rounded-full">
                                <span className="text-[9px] font-black text-indigo-700">
                                    📍 {selectedWard || wardClusters.find(c => c.id === selectedCluster)?.wardName}
                                </span>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => setShowHeatmap(!showHeatmap)}
                        className={`p-2.5 rounded-xl transition-all border ${showHeatmap ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-400 border-slate-200'}`}
                    >
                        <svg className="w-5 h-5 lg:w-6 lg:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
                    </button>
                </header>

                <div className="space-y-4">
                    {/* Domain Selector */}
                    <div>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Analysis Domain</div>
                        <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                            {DOMAINS_LIST.map(d => (
                                <button
                                    key={d.id}
                                    onClick={() => setActiveDomain(d.id)}
                                    className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] font-black rounded-lg transition-all ${
                                        activeDomain === d.id ? 'bg-white shadow-sm' : 'text-slate-400 hover:text-slate-600'
                                    }`}
                                    style={activeDomain === d.id ? { color: d.color } : {}}
                                >
                                    <span>{d.emoji}</span>
                                    <span className="truncate">{d.label.split(' / ')[0]}</span>
                                </button>
                            ))}
                        </div>
                    </div>



                    {/* Search Results Display */}
                    {searchResults.length > 0 && (
                        <div className="animate-in slide-in-from-top-2 duration-300 mb-4">
                            <div className="flex justify-between items-center mb-2 px-1 border-b border-slate-100 pb-2">
                                <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">{queryDescription}</span>
                                <button
                                    onClick={() => { setSearchResults([]); setSearchQuery(''); }}
                                    className="text-[9px] text-slate-400 hover:text-red-500 font-bold transition-colors"
                                >
                                    CLEAR
                                </button>
                            </div>
                            <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
                                {searchResults.map((item, idx) => {
                                    // If this looks like a Google Place result, render place card
                                    if (item && (item.displayName || item.formattedAddress || item.location)) {
                                        const name = item.displayName?.text || item.displayName || item.display_name || item.id || `Place ${idx}`;
                                        const rating = item.rating;
                                        const address = item.formattedAddress || item.formatted_address || '';

                                        return (
                                            <div
                                                key={item.id || idx}
                                                className="group flex justify-between items-center p-3 bg-white border border-slate-100 rounded-xl hover:border-indigo-500 hover:shadow-lg transition-all cursor-pointer relative overflow-hidden"
                                            >
                                                <div className="pl-2" onClick={() => {
                                                    if (item.location && item.location.lat && item.location.lng) {
                                                        setSelectedPos([item.location.lat, item.location.lng]);
                                                        setMapZoom(16);
                                                    }
                                                }}>
                                                    <div className="font-bold text-slate-800 text-xs group-hover:text-indigo-700 transition-colors">{name}</div>
                                                    {address && <div className="text-[9px] text-slate-400 font-medium mt-0.5">{address}</div>}
                                                </div>
                                                <div className="flex flex-col items-end gap-2">
                                                    {rating ? (
                                                        <div className="text-[10px] font-black text-slate-700">{rating.toFixed(1)} ★</div>
                                                    ) : (
                                                        <div className="text-[9px] text-slate-400">No rating</div>
                                                    )}
                                                    <div className="flex gap-2">
                                                        <button onClick={() => {
                                                            if (item.location && item.location.lat && item.location.lng) {
                                                                setSelectedPos([item.location.lat, item.location.lng]);
                                                                setMapZoom(16);
                                                            }
                                                        }} className="px-3 py-1 text-[10px] font-black bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-100">Center</button>
                                                        <button onClick={() => {
                                                            // Trigger full analysis by setting selectedPos and keeping cluster null
                                                            if (item.location && item.location.lat && item.location.lng) {
                                                                setSelectedPos([item.location.lat, item.location.lng]);
                                                                setSelectedCluster(null);
                                                                setSelectedWard(null);
                                                                setMapZoom(16);
                                                            }
                                                        }} className="px-3 py-1 text-[10px] font-black bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100">Analyze</button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }

                                    // Fallback: treat as ward/cluster-like result
                                    const ward = item as any;
                                    const scoreVal = ward.finalScore || ward.opportunityScore || 0;
                                    const scorePercentage = (scoreVal * 100).toFixed(1);
                                    let scoreColorClass = 'bg-slate-100 text-slate-600 border-slate-200';
                                    if (scoreVal > 0.8) scoreColorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                                    else if (scoreVal > 0.6) scoreColorClass = 'bg-indigo-50 text-indigo-700 border-indigo-200';
                                    else if (scoreVal > 0.4) scoreColorClass = 'bg-amber-50 text-amber-700 border-amber-200';
                                    else scoreColorClass = 'bg-red-50 text-red-700 border-red-200';

                                    return (
                                        <div
                                            key={ward.id || idx}
                                            onClick={() => handleClusterClick(ward.id, ward.lat, ward.lng)}
                                            className="group flex justify-between items-center p-3 bg-white border border-slate-100 rounded-xl hover:border-indigo-500 hover:shadow-lg transition-all cursor-pointer relative overflow-hidden"
                                        >
                                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-transparent group-hover:bg-indigo-500 transition-colors"></div>
                                            <div className="pl-2">
                                                <div className="font-bold text-slate-800 text-xs group-hover:text-indigo-700 transition-colors">{ward.wardName}</div>
                                                <div className="text-[9px] text-slate-400 font-medium mt-0.5 flex items-center gap-1">
                                                    <span>ID: {ward.wardId}</span>
                                                    {ward.growthRate > 0 && (
                                                        <span className="text-emerald-600 font-bold bg-emerald-50 px-1 rounded">
                                                            Growth: +{(ward.growthRate * 100).toFixed(0)}%
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className={`px-2 py-1.5 rounded-lg border text-[10px] font-black ${scoreColorClass} shadow-sm`}>
                                                {scorePercentage}%
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Radius Selector */}
                    <div>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Catchment Radius</div>
                        <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                            <button
                                onClick={() => setSearchRadius(500)}
                                className={`flex-1 py-1.5 text-[9px] font-black rounded-lg transition-all ${searchRadius === 500 ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                500m
                            </button>
                            <button
                                onClick={() => setSearchRadius(1000)}
                                className={`flex-1 py-1.5 text-[9px] font-black rounded-lg transition-all ${searchRadius === 1000 ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                1.0km
                            </button>
                        </div>
                    </div>

                    {/* Suitability Index Card */}
                    <div className="bg-[#0f172a] text-white p-4 lg:p-5 rounded-2xl shadow-xl relative overflow-hidden border border-slate-800">
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-0.5">
                                <h2 className="text-[9px] lg:text-[10px] font-black text-indigo-400 uppercase tracking-widest">Site Viability</h2>
                                <span className={`text-[9px] lg:text-[10px] font-black uppercase tracking-widest ${getVerdict().color}`}>{getVerdict().text}</span>
                            </div>
                            <div className="flex items-baseline gap-2">
                                <span className="text-4xl lg:text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-500">
                                    {scores ? scores.total : '--'}
                                </span>
                                <span className="text-slate-500 font-bold text-xs lg:text-sm">/100</span>
                            </div>

                            {scores && (
                                <div className="mt-2.5 lg:mt-3 flex gap-2">
                                    <div className="flex-1 bg-white/5 border border-white/10 p-1.5 lg:p-2 rounded-xl">
                                        <div className="text-[7px] lg:text-[9px] text-slate-400 font-bold uppercase mb-0.5">Generators</div>
                                        <div className="text-xs lg:text-base font-black text-white">{demandGenerators}</div>
                                    </div>
                                    <div className="flex-1 bg-white/5 border border-white/10 p-1.5 lg:p-2 rounded-xl">
                                        <div className="text-[7px] lg:text-[9px] text-slate-400 font-bold uppercase mb-0.5">Competitors</div>
                                        <div className="text-xs lg:text-base font-black text-white">{competitors}</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Metrics Chart */}
                    <div className="bg-slate-50/50 p-2.5 lg:p-3.5 rounded-xl border border-slate-100 shadow-inner h-34 lg:h-40">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} layout="vertical" margin={{ left: -12, right: 12 }}>
                                <XAxis type="number" hide domain={[0, 100]} />
                                <YAxis dataKey="name" type="category" width={70} style={{ fontSize: '8.5px', fontWeight: '900', fill: '#64748b' }} />
                                <Tooltip cursor={{ fill: 'transparent' }} />
                                <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={13}>
                                    {chartData.map((entry, index) => <Cell key={`c-${index}`} fill={entry.color} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* AI Strategy Insights */}
                    <div className="flex flex-col">
                        <div className="flex items-center justify-between mb-3 lg:mb-4 px-1">
                            <h3 className="text-[10px] lg:text-xs font-black text-slate-400 uppercase tracking-widest">Geo-Grounded Strategy</h3>
                            {isAnalyzing && (
                                <div className="flex items-center gap-1.5 animate-pulse text-indigo-600">
                                    <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
                                    <span className="text-[8px] lg:text-[10px] font-black uppercase tracking-tight">Syncing POIs</span>
                                </div>
                            )}
                        </div>
                        <div className="bg-white border border-slate-200 rounded-2xl lg:rounded-[2rem] p-4 lg:p-6 min-h-[160px] text-[11px] lg:text-sm leading-relaxed text-slate-700 whitespace-pre-wrap font-medium shadow-sm max-h-[220px] lg:max-h-[250px] overflow-y-auto custom-scrollbar transition-all">
                            {aiInsight || "Interactive Site Selection Enabled. Tap any point on the map to begin geospatial grounding and opportunity analysis."}
                        </div>
                    </div>

                    {/* Sources */}
                    {sources.length > 0 && (
                        <div className="animate-in slide-in-from-bottom-4 duration-700 pb-2">
                            <h4 className="text-[9px] lg:text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest px-1">Verified Locations</h4>
                            <div className="flex flex-nowrap lg:flex-wrap gap-2 overflow-x-auto lg:overflow-x-visible pb-1 custom-scrollbar">
                                {sources.slice(0, 5).map((s, idx) => (
                                    <a key={idx} href={s.uri} target="_blank" rel="noreferrer" className="whitespace-nowrap text-[9px] font-bold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-indigo-600 hover:text-indigo-600 transition-all">
                                        {s.title}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="mt-auto pt-6 flex items-center justify-between">
                    <div className="text-[8px] lg:text-[9px] text-slate-300 font-black uppercase tracking-widest">
                        Grounded: Gemini 2.5 + Live Scrape
                    </div>
                </div>
            </div>

            {/* Chat Interface */}
            <ChatInterface
                messages={conversationMessages}
                onSendMessage={handleUserMessage}
                onClearChat={handleClearChat}
                isAITyping={isAITyping}
                isOpen={chatOpen}
                onToggle={() => setChatOpen(!chatOpen)}
                selectedWard={selectedWard || undefined}
            />
        </div>
    );
};

export default App;
