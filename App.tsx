
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap, Circle, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import { HSR_CENTER, MOCK_LOCATIONS } from './constants';
import { LocationType, ScoringMatrix } from './types';
import { calculateSuitability } from './services/geoService';
import { getSiteGuidance, GroundingSource, answerFreeform, conversationalQuery } from './services/geminiService';
import './services/leaflet-heat'; // Local vendored version used
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip, LabelList } from 'recharts';
import { getLocationIntelligence, getDomainIntelligence, generateDataDrivenRecommendation, generateDomainRecommendation, PlaceResult, textSearch } from './services/placesAPIService';
import { executeSearch, getQueryDescription, parseSearchIntent } from './searchUtils';
import { DOMAIN_CONFIG, DomainId } from './domains';
import { calculateDomainScores } from './services/scoringEngine';
import { ChatInterface } from './components/ChatInterface';
import { addMessage, loadConversationHistory, clearConversationHistory, getRecentContext, extractLocationMentions, Message } from './services/conversationService';
import { processUserQuery } from './services/chatOrchestrationService';
import { TutorialOverlay } from './components/TutorialOverlay';

/**
 * GYM-LOCATE: Geo-Intel Command Center (v8)
 * Features: Multi-Layer POI Support (Corporate, Parks, Residential)
 */

// --- ICONS ---

/**
 * Creates a colored teardrop pin icon for competitor markers.
 * The pin head contains the domain icon; the pointed tail anchors to the map location.
 */
function createCompetitorPin(iconUrl: string, color: string): L.DivIcon {
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
        iconAnchor: [17, 42],   // tip of the pin tail
        popupAnchor: [0, -44],
    });
}

const gymIcon = createCompetitorPin('https://cdn-icons-png.flaticon.com/512/2964/2964514.png', '#6366f1');      // indigo
const restaurantIcon = createCompetitorPin('https://cdn-icons-png.flaticon.com/512/3448/3448609.png', '#f59e0b');     // amber
const bankIcon = createCompetitorPin('https://cdn-icons-png.flaticon.com/512/2830/2830284.png', '#3b82f6');      // blue
const retailIcon = createCompetitorPin('https://cdn-icons-png.flaticon.com/512/3081/3081648.png', '#8b5cf6');      // purple

const synergyIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.freepik.com/256/17695/17695120.png?semt=ais_white_label', // Lifestyle synergy
    iconSize: [16, 16],
});
const cafeIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/3054/3054889.png', // Coffee / Cafe
    iconSize: [15, 15],
});
const mallIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.freepik.com/512/7835/7835563.png', // Shopping bag / mall
    iconSize: [16, 16],
});
const commercialIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/7991/7991011.png', // Storefront / commercial
    iconSize: [16, 16],
});
const corporateIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/3061/3061341.png', // Office Building
    iconSize: [16, 16],
});
const parkIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/427/427503.png', // Tree/Park
    iconSize: [15, 15],
});
const residentialIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/619/619032.png', // House/Apartment
    iconSize: [14, 14],
});
const metroIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/565/565350.png', // Train
    iconSize: [15, 15],
});
const busIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/128/1178/1178850.png', // Bus
    iconSize: [14, 14],
});

// Domain → competitor icon mapping
const DOMAIN_ICON_MAP = {
    gym: { icon: gymIcon, rawUrl: 'https://cdn-icons-png.flaticon.com/512/2964/2964514.png', emoji: '🏋️', competitorLabel: 'Gyms', infraEmoji: '☕', infraLabel: 'Lifestyle', infraIcon: cafeIcon },
    restaurant: { icon: restaurantIcon, rawUrl: 'https://cdn-icons-png.flaticon.com/512/3448/3448609.png', emoji: '🍽️', competitorLabel: 'Restaurants', infraEmoji: '🛍️', infraLabel: 'Footfall', infraIcon: synergyIcon },
    bank: { icon: bankIcon, rawUrl: 'https://cdn-icons-png.flaticon.com/512/2830/2830284.png', emoji: '🏦', competitorLabel: 'Banks', infraEmoji: '🏬', infraLabel: 'Commercial', infraIcon: commercialIcon },
    retail: { icon: retailIcon, rawUrl: 'https://cdn-icons-png.flaticon.com/512/3081/3081648.png', emoji: '🛍️', competitorLabel: 'Stores', infraEmoji: '🍿', infraLabel: 'Synergy', infraIcon: synergyIcon },
};

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

// Component to control map zoom and center.
// navigateKey: increment to force a re-pan even when center/zoom are unchanged.
const MapZoomController = ({ center, zoom, navigateKey }: { center: [number, number] | null, zoom: number, navigateKey: number }) => {
    const map = useMap();
    useEffect(() => {
        const target = center ?? [BANGALORE_CENTER.lat, BANGALORE_CENTER.lng] as [number, number];

        // Close any active Popups so Leaflet doesn't auto-pan the map back to it
        map.closePopup();

        // Stop any in-progress pan/zoom animation first, then flyTo.
        // map.setView() with animate:true can silently fail when a prior animation is
        // still active (e.g. after a cluster click). flyTo() + stop() is always reliable.
        map.stop();
        map.flyTo(target, zoom, { duration: 0.6, easeLinearity: 0.5 });
    }, [center, navigateKey, zoom, map]);

    return null;
};

// Bangalore city center for initial view
const BANGALORE_CENTER = { lat: 12.9716, lng: 77.5946 };

// Ward layer component
const WardLayer = ({ onWardClick, activeDomain }: { onWardClick: (lat: number, lng: number, wardName: string) => void, activeDomain: DomainId }) => {
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

// Smart keyword shortcuts for the search bar autocomplete
const SEARCH_KEYWORDS = [
    // Analytical
    'top 3 spots', 'top 5 spots', 'top 10 spots',
    'low competition', 'high growth', 'untapped areas',
    'best overall', 'high opportunity', 'no gyms nearby',
    // Domain-aware cross-prompts
    'gyms in', 'fitness in', 'exercise spots in',
    'cafes in', 'restaurants in', 'food spots in',
    'banks near', 'finance options in',
    'retail in', 'shops in', 'supermarket near',
];

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
    // Used to force MapZoomController to re-pan even if center/zoom didn't change
    const [mapNavigateKey, setMapNavigateKey] = useState<number>(0);

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
    const [queryDescription, setQueryDescription] = useState<string>('');
    const [searchResults, setSearchResults] = useState<any[]>([]);

    // CHAT: Conversation state
    const [chatOpen, setChatOpen] = useState(false);
    const [conversationMessages, setConversationMessages] = useState<Message[]>([]);
    const [isAITyping, setIsAITyping] = useState(false);

    // VOICE + AUTOCOMPLETE: Search bar enhancements
    const [isSearchListening, setIsSearchListening] = useState(false);
    const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
    const [suggestionIndex, setSuggestionIndex] = useState(-1);
    const searchRecognitionRef = useRef<any>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const [activeDomain, setActiveDomain] = useState<DomainId>('gym');
    const [mobileView, setMobileView] = useState<'map' | 'analytics' | 'chat'>('map');
    const [sheetState, setSheetState] = useState<'peek' | 'half' | 'full'>('half');

    // CUSTOM PARAMETERS: user-defined scoring factors
    interface CustomParam {
        id: string;
        label: string;
        poiType: string;
        importance: number;   // 1–5 slider
        saturationLimit: number;
        score?: number;
        places?: any[];
        color?: string;
    }
    const CUSTOM_POI_OPTIONS = [
        { label: 'School / Education', value: 'school' },
        { label: 'Hospital / Clinic', value: 'hospital' },
        { label: 'Park / Outdoors', value: 'park' },
        { label: 'Temple', value: 'hindu_temple' },
        { label: 'Mosque', value: 'mosque' },
        { label: 'Church', value: 'church' },
        { label: 'University Campus', value: 'university' },
        { label: 'Supermarket', value: 'supermarket' },
        { label: 'Cinema / Theatre', value: 'movie_theater' },
        { label: 'Gym / Fitness', value: 'gym' },
        { label: 'Pharmacy', value: 'pharmacy' },
        { label: 'Restaurant', value: 'restaurant' },
        { label: 'Metro Station', value: 'subway_station' },
        { label: 'Parking Lot', value: 'parking' },
    ];
    // Dynamic colors for custom parameters to keep them distinct
    const CUSTOM_COLORS = ['#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#eab308'];
    const importanceWeightMap: Record<number, number> = { 1: 0.05, 2: 0.08, 3: 0.12, 4: 0.18, 5: 0.25 };
    const satLimitOptions = [3, 5, 8, 12, 20];

    const [customParams, setCustomParams] = useState<CustomParam[]>([]);
    const [customParamForm, setCustomParamForm] = useState({ label: '', poiType: 'school', importance: 3, saturationLimit: 8 });
    const [showCustomParamPanel, setShowCustomParamPanel] = useState(false);
    const [customPOIs, setCustomPOIs] = useState<Record<string, any[]>>({}); // id → places

    // REF: Sync custom params to a ref so performAnalysis can read them without trigging re-runs
    const customParamsRef = useRef<CustomParam[]>([]);
    useEffect(() => {
        customParamsRef.current = customParams;
    }, [customParams]);

    const addCustomParam = () => {
        if (customParams.length >= 3 || !customParamForm.label.trim()) return;

        // Find first unused color
        const usedColors = customParams.map(p => p.color);
        const availableColor = CUSTOM_COLORS.find(c => !usedColors.includes(c));
        // Fallback to random if all are somehow used
        const color = availableColor || CUSTOM_COLORS[Math.floor(Math.random() * CUSTOM_COLORS.length)];

        const newParam: CustomParam = {
            id: Math.random().toString(36).slice(2),
            label: customParamForm.label.trim(),
            poiType: customParamForm.poiType,
            importance: customParamForm.importance,
            saturationLimit: customParamForm.saturationLimit,
            color
        };
        setCustomParams(prev => [...prev, newParam]);
        setCustomParamForm({ label: '', poiType: 'school', importance: 3, saturationLimit: 8 });
    };

    const removeCustomParam = (id: string) => {
        setCustomParams(prev => prev.filter(p => p.id !== id));
        setCustomPOIs(prev => { const n = { ...prev }; delete n[id]; return n; });
    };


    // AUTOCOMPLETE: Compute suggestions whenever searchQuery changes
    const updateSearchSuggestions = useCallback((q: string) => {
        if (!q || q.length < 1) {
            setSearchSuggestions([]);
            setSuggestionIndex(-1);
            return;
        }
        const lower = q.toLowerCase();
        const wardMatches = wardClusters
            .filter((w: any) => w.wardName.toLowerCase().includes(lower))
            .slice(0, 5)
            .map((w: any) => w.wardName);
        const keywordMatches = SEARCH_KEYWORDS.filter(k => k.includes(lower));
        const combined = [...new Set([...wardMatches, ...keywordMatches])].slice(0, 6);
        setSearchSuggestions(combined);
        setSuggestionIndex(-1);
    }, [wardClusters]);

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
        setMapNavigateKey(k => k + 1);
    }, []);

    const handleWardClick = useCallback((lat: number, lng: number, wardName: string) => {
        setSelectedPos([lat, lng]);
        setSelectedWard(wardName);
        setSelectedCluster(null);
        setMapZoom(14); // Zoom in for analysis
        setMapNavigateKey(k => k + 1);
    }, []);

    // NEW: Intelligent query search (supports natural language + domain detection)
    const handlePlaceSearch = useCallback(async (query: string) => {
        if (!query) {
            setQueryDescription('');
            setSearchResults([]);
            return;
        }

        // ============================================
        // AI-FIRST SEARCH ROUTING
        // All searches (places, wards, questions) are now
        // routed through the AI chat orchestration service.
        // ============================================
        console.log("🗣️ Routing query to AI Chat:", query);
        setChatOpen(true);
        setSearchQuery('');       // Clear the input
        setSearchSuggestions([]); // Close autocomplete
        handleUserMessage(query); // Send to Agentic flow

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);


    // VOICE: Toggle search bar microphone (placed after handlePlaceSearch to avoid forward-reference)
    const toggleSearchListening = useCallback(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        if (isSearchListening) {
            searchRecognitionRef.current?.stop();
            setIsSearchListening(false);
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-IN';

        recognition.onstart = () => setIsSearchListening(true);

        recognition.onresult = (event: any) => {
            let interim = '';
            let final = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const t = event.results[i][0].transcript;
                if (event.results[i].isFinal) { final += t; }
                else { interim += t; }
            }
            if (final) {
                setSearchQuery(final.trim());
                handlePlaceSearch(final.trim());
            } else if (interim) {
                setSearchQuery(interim);
            }
        };

        recognition.onerror = () => setIsSearchListening(false);
        recognition.onend = () => setIsSearchListening(false);

        searchRecognitionRef.current = recognition;
        recognition.start();
    }, [isSearchListening, handlePlaceSearch]);

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
                        const opportunityScore = parseFloat(parts[1]) || 0;
                        const finalScore = parseFloat(parts[14]) || 0;
                        const lat = parseFloat(parts[2]) || 0;
                        const lng = parseFloat(parts[3]) || 0;
                        const gymCount = parseInt(parts[9]) || 0;
                        const cafeCount = parseInt(parts[10]) || 0;
                        const growthRate = parseFloat(parts[5]) || 0;

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

    const performAnalysis = useCallback(async (
        overrideDomain?: string,
        overrideCluster?: string | null,
        overrideLocation?: [number, number]
    ) => {
        // Use overrideLocation when provided (chat navigation) to avoid stale selectedPos closure.
        const analysisPos = overrideLocation || selectedPos;
        if (!analysisPos) return;
        setIsAnalyzing(true);
        setAiInsight('Fetching real POI data from Google Places...');

        // Use overrideDomain if supplied (e.g. from chat), otherwise use active UI domain
        const domainToUse = (overrideDomain || activeDomain) as keyof typeof DOMAIN_CONFIG;
        // overrideCluster lets callers pass null explicitly to avoid the stale state closure
        // that occurs when setSelectedCluster(null) hasn't propagated before performAnalysis runs.
        const effectiveCluster = overrideCluster !== undefined ? overrideCluster : selectedCluster;

        try {
            const domain = DOMAIN_CONFIG[domainToUse];
            let realScores: any = null;
            let currentTotalScore = 0;

            if (domainToUse === 'gym') {
                // ── GYM DOMAIN: Our advanced V2 scoring ─────────────────────
                const intel = await getLocationIntelligence(
                    analysisPos[0],
                    analysisPos[1],
                    searchRadius
                );

                setRealPOIs({
                    gyms: intel.gyms.places,
                    cafes: intel.cafesRestaurants.places,
                    corporates: intel.corporateOffices.places,
                    transit: intel.transitStations.places,
                    apartments: intel.apartments.places,
                    parks: []
                });

                realScores = calculateDomainScores(intel, domainToUse, searchRadius);
                currentTotalScore = realScores.total;

                console.log('📊 SCORING V2 (GYM):', realScores);
                setScores(realScores);

                if (effectiveCluster) {
                    const opportunityScore = realScores.total / 100;
                    const finalScore = opportunityScore;
                    const demographicLoad = realScores.demographicLoad;
                    const competitorDensity = intel.gyms.total;
                    let growthRate = 0;
                    if (intel.marketGap === 'UNTAPPED') growthRate = 0.15;
                    else if (intel.marketGap === 'OPPORTUNITY') growthRate = 0.10;
                    else if (intel.marketGap === 'COMPETITIVE') growthRate = 0.05;
                    else growthRate = 0.02;
                    if (demographicLoad > 70) growthRate += 0.03;
                    if (intel.corporateOffices.total > 10) growthRate += 0.02;
                    setWardScores(prev => ({ ...prev, [effectiveCluster]: { opportunityScore, finalScore, growthRate, demographicLoad, competitorDensity } }));
                }

                const recommendation = generateDataDrivenRecommendation(intel, realScores);
                setAiInsight(recommendation);

            } else {
                // ── RESTAURANT / BANK DOMAIN: Generic domain intelligence ────
                const intel = await getDomainIntelligence(
                    analysisPos[0],
                    analysisPos[1],
                    searchRadius,
                    domain.competitorTypes,
                    domain.infraTypes
                );

                // Show competitor markers on map (use gyms slot for domain competitors)
                setRealPOIs({
                    gyms: intel.competitors.places,        // competitor markers
                    cafes: intel.infraSynergy.places,      // infra/synergy markers
                    corporates: intel.corporateOffices.places,
                    transit: intel.transitStations.places,
                    apartments: intel.apartments.places,
                    parks: []
                });

                // Domain-specific scoring using dynamically loaded engine
                realScores = calculateDomainScores(intel, domainToUse, searchRadius);
                currentTotalScore = realScores.total;

                if (effectiveCluster) {
                    const opportunityScore = realScores.total / 100;
                    const finalScore = opportunityScore;
                    let growthRate = intel.marketGap === 'UNTAPPED' ? 0.15 :
                        intel.marketGap === 'OPPORTUNITY' ? 0.10 :
                            intel.marketGap === 'COMPETITIVE' ? 0.05 : 0.02;
                    if (realScores.demographicLoad > 70) growthRate += 0.03;
                    setWardScores(prev => ({ ...prev, [effectiveCluster]: { opportunityScore, finalScore, growthRate, demographicLoad: realScores.demographicLoad, competitorDensity: intel.competitors.total } }));
                }

                const recommendation = generateDomainRecommendation(intel, domainToUse);
                setAiInsight(recommendation);
            }

            // ── Custom Parameters: fetch + score each user-defined param ──────────
            const currentCustomParams = customParamsRef.current;
            if (currentCustomParams.length > 0) {
                const { nearbySearch: customNearby } = await import('./services/placesAPIService');
                const BASIC_MASK = 'places.id,places.location,places.displayName,places.types,places.businessStatus';
                const updatedParams = [...currentCustomParams];
                const newPOIs: Record<string, any[]> = {};
                let customWeightSum = 0;
                let customWeightedScoreSum = 0;

                await Promise.all(currentCustomParams.map(async (param, i) => {
                    try {
                        // Use primaryOnly: true to reduce false positives (secondary matches)
                        const rawPlaces = await customNearby(selectedPos[0], selectedPos[1], searchRadius, [param.poiType], true, BASIC_MASK);

                        // Filter for OPERATIONAL businesses only
                        const places = rawPlaces.filter(p => !p.businessStatus || p.businessStatus === 'OPERATIONAL');

                        newPOIs[param.id] = places;
                        const raw = Math.min(places.length, param.saturationLimit);
                        const pScore = Math.round((raw / param.saturationLimit) * 100);
                        updatedParams[i] = { ...param, score: pScore, places };

                        // ── Apply Importance Weight to Final Score ──
                        const weight = importanceWeightMap[param.importance] || 0.12;
                        customWeightSum += weight;
                        customWeightedScoreSum += (pScore * weight);

                    } catch {
                        updatedParams[i] = { ...param, score: 0, places: [] };
                    }
                }));

                // Re-balance the final Suitability Score
                if (customWeightSum > 0) {
                    // Apply custom weights. If users add a lot of 25% importance params, it can completely override the base score. (Max 100%)
                    const safeWeightSum = Math.min(customWeightSum, 1.0);
                    const baseWeight = 1 - safeWeightSum;
                    currentTotalScore = Math.round((currentTotalScore * baseWeight) + customWeightedScoreSum);
                }

                setCustomParams(updatedParams);
                setCustomPOIs(newPOIs);
            }

            if (realScores) {
                console.log(`📊 FINAL SCORING (${domain.label}):`, { ...realScores, total: currentTotalScore });
                setScores({ ...realScores, total: currentTotalScore });
            }

            setIsAnalyzing(false);
        } catch (error) {
            console.error('Places API analysis failed:', error);
            setAiInsight('⚠️ Places API unavailable. Add GOOGLE_MAPS_API_KEY to .env.local for real POI data. Using fallback mock data...');
            const fallbackScores = calculateSuitability(analysisPos[0], analysisPos[1], searchRadius / 1000);
            setScores(fallbackScores);
            setIsAnalyzing(false);
        }
    }, [selectedPos, activeDomain, searchRadius, selectedCluster]);

    // ✅ Debounced analysis — prevents burst requests on rapid clicks
    const analysisDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (selectedPos) {
            if (analysisDebounceRef.current) clearTimeout(analysisDebounceRef.current);
            analysisDebounceRef.current = setTimeout(() => {
                performAnalysis();
            }, 500);
        }
        return () => {
            if (analysisDebounceRef.current) clearTimeout(analysisDebounceRef.current);
        };
    }, [selectedPos, activeDomain, performAnalysis]);

    // Re-run analysis automatically when a custom parameter is added or removed
    useEffect(() => {
        if (selectedPos) {
            performAnalysis();
        }
    }, [customParams.length, performAnalysis]);

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

    // UPDATED: Use real POI data from Google Places API instead of mock data
    const competitors = realPOIs.gyms.length;
    const domain = DOMAIN_CONFIG[activeDomain];
    const demandGenerators = realPOIs.corporates.length + realPOIs.cafes.length;

    const chartData = useMemo(() => {
        if (!scores) return [];
        const d = DOMAIN_CONFIG[activeDomain].scoring;
        const pct = (w: number) => `(${Math.round(w * 100)}%)`;
        const base = [
            { name: `${d.demand.label} ${pct(d.demand.weight)}`, score: scores.demographicLoad, color: d.demand.color, desc: d.demand.desc },
            { name: `${d.connectivity.label} ${pct(d.connectivity.weight)}`, score: scores.connectivity, color: d.connectivity.color, desc: d.connectivity.desc },
            { name: `${d.gap.label} ${pct(d.gap.weight)}`, score: scores.competitorRatio, color: d.gap.color, desc: d.gap.desc },
            { name: `${d.infra.label} ${pct(d.infra.weight)}`, score: scores.infrastructure, color: d.infra.color, desc: d.infra.desc },
        ];
        // Append custom param bars
        const custom = customParams
            .filter(p => p.score !== undefined)
            .map(p => {
                const weightPct = Math.round((importanceWeightMap[p.importance] || 0.12) * 100);
                return {
                    name: `${p.label} (${weightPct}%)`,
                    score: p.score!,
                    color: p.color || '#a855f7',
                    desc: `${p.poiType}`
                };
            });
        return [...base, ...custom];
    }, [scores, activeDomain, customParams]);


    const getVerdict = () => {
        if (!scores) return { text: "SELECT AREA", color: "text-slate-400" };
        if (scores.total >= 70) return { text: "STRONG", color: "text-emerald-400" };
        if (scores.total >= 45) return { text: "AVERAGE", color: "text-yellow-400" };
        return { text: "RISKY", color: "text-red-400" };
    };

    // CHAT: Handle user messages with agentic orchestration
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
            // ============================================
            // AGENTIC FLOW: Use chat orchestration service
            // ============================================

            console.log('🚀 Starting agentic flow for:', message);

            // ── Domain Detection (free keyword match, no API call) ──────────
            const intent = parseSearchIntent(message);
            const detectedDomain = (intent.hasDomain && intent.domain) ? intent.domain : activeDomain;

            // Auto-switch domain in UI if chat detected a different one
            if (intent.hasDomain && intent.domain && intent.domain !== activeDomain) {
                console.log(`🔀 Chat switching domain: ${activeDomain} → ${intent.domain}`);
                setActiveDomain(intent.domain as DomainId);
            }

            // Build conversation context
            const recentContext = getRecentContext(updatedMessages).map(msg => ({
                role: msg.role,
                content: msg.content
            }));

            // Call orchestration service (Gemini + Places API coordination)
            // Fix 3: pass selectedCluster name as ward context so Gemini
            // knows which area is currently pinned even when no ward is selected.
            const clusterContext = selectedWard ||
                (selectedCluster
                    ? wardClusters.find((w: any) => w.id === selectedCluster)?.wardName
                    : undefined);
            const response = await processUserQuery(message, {
                recentMessages: recentContext,
                currentLocation: selectedPos || undefined,
                selectedWard: clusterContext,
                domain: detectedDomain,
                radius: searchRadius,
                scores: scores || undefined,
                realPOIs: realPOIs,
                wardClusters
            });

            console.log(`✅ Agentic response: Gemini=${response.usedGemini}, Places=${response.usedPlacesAPI}`);

            // ============================================
            // TRIGGER EXISTING FRAMEWORK FLOW
            // Execute map actions (zoom, navigate, analyze)
            // ============================================

            if (response.mapAction) {
                const action = response.mapAction;
                console.log('🗺️ Executing map action:', action.type);

                switch (action.type) {
                    case 'analyze':
                    case 'navigate':
                        if (action.payload.location) {
                            // Fix 3: always update pos + zoom, even if coords haven't changed,
                            // so the map visibly navigates and analysis always re-runs.
                            const newLoc = action.payload.location;
                            setSelectedPos(newLoc);
                            setSelectedCluster(null); // Unlock UI from any previously clicked map cluster
                            setMapZoom(action.payload.zoom || 14);
                            setMapNavigateKey(k => k + 1); // Force map to pan even if coords are same as cluster

                            // Always clear selectedWard so old ward label doesn't persist when
                            // the chatbot navigates to a place that has no wardName.
                            setSelectedWard(action.payload.wardName || null);

                            if (action.payload.triggerAnalysis) {
                                if (response.prefetchedIntel) {
                                    // ✅ Chat already fetched intel — apply directly, skip re-fetch
                                    console.log('♻️ Using prefetchedIntel — skipping performAnalysis()');
                                    const intel = response.prefetchedIntel;
                                    const isGymShape = 'gyms' in intel;

                                    setRealPOIs({
                                        gyms: intel.gyms?.places || intel.competitors?.places || [],
                                        cafes: intel.cafesRestaurants?.places || intel.infraSynergy?.places || [],
                                        corporates: intel.corporateOffices?.places || [],
                                        transit: intel.transitStations?.places || [],
                                        apartments: intel.apartments?.places || [],
                                        parks: []
                                    });

                                    const cachedScores = calculateDomainScores(intel, detectedDomain as DomainId, searchRadius);
                                    setScores(cachedScores);

                                    if (isGymShape) {
                                        setAiInsight(generateDataDrivenRecommendation(intel, cachedScores));
                                    } else {
                                        setAiInsight(generateDomainRecommendation(intel, detectedDomain));
                                    }

                                    // For non-gym domains, fire performAnalysis in background to get
                                    // the proper domain-specific scoring (no UI blocking)
                                    if (detectedDomain !== 'gym') {
                                        const chatLocation = newLoc;
                                        setTimeout(() => { performAnalysis(detectedDomain, null, chatLocation); }, 400);
                                    }
                                } else {
                                    // Fallback: trigger fresh analysis with the detected domain.
                                    // Pass null cluster + explicit location to avoid stale closures.
                                    const chatLocation = newLoc;
                                    console.log('🔍 Triggering performAnalysis() — no prefetchedIntel, domain:', detectedDomain);
                                    setTimeout(() => { performAnalysis(detectedDomain, null, chatLocation); }, 300);
                                }
                            }
                        }
                        break;

                    case 'zoom':
                        if (action.payload.zoom) setMapZoom(action.payload.zoom);
                        break;

                    case 'highlight':
                        console.log('Highlighting:', action.payload.poiType);
                        break;
                }
            }

            // Add AI response to conversation
            const finalMessages = addMessage(updatedMessages, 'assistant', response.text);
            setConversationMessages(finalMessages);

        } catch (error) {
            console.error('❌ Agentic chat error:', error);
            const errorMessages = addMessage(
                updatedMessages,
                'assistant',
                'Sorry, I encountered an error processing your request. Please try again.'
            );
            setConversationMessages(errorMessages);
        } finally {
            setIsAITyping(false);
        }
    }, [conversationMessages, selectedPos, selectedWard, selectedCluster, scores, realPOIs,
        wardClusters, searchRadius, activeDomain, performAnalysis]);

    // Clear chat history
    const handleClearChat = useCallback(() => {
        clearConversationHistory();
        setConversationMessages([]);
    }, []);

    const [showRightSidebar, setShowRightSidebar] = useState(true);

    return (
        <div className="relative h-[100dvh] w-[100vw] bg-slate-100 overflow-hidden font-sans">

            {/* 1. Full Screen Map Area */}
            <div className="absolute inset-0 z-0">
                <MapContainer center={[BANGALORE_CENTER.lat, BANGALORE_CENTER.lng]} zoom={mapZoom} className="z-10 h-full w-full">
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        maxZoom={19}
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />

                    {/* Ward Boundaries Layer */}
                    <WardLayer onWardClick={handleWardClick} activeDomain={activeDomain as DomainId} />

                    {/* {showHeatmap && <HeatmapLayer locations={MOCK_LOCATIONS} />} */}
                    <MapEvents onMapClick={handleMapClick} />
                    <MapRevalidator />
                    <MapZoomController center={selectedPos} zoom={mapZoom} navigateKey={mapNavigateKey} />

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

                    {selectedPos && (
                        <Marker position={selectedPos} icon={new L.DivIcon({
                            className: 'user-marker',
                            html: `<div class="relative flex items-center justify-center">
                                     <div class="absolute w-12 h-12 bg-indigo-600/10 rounded-full animate-pulse"></div>
                                     <div class="w-6 h-6 bg-indigo-600 border-[3px] border-white rounded-full shadow-2xl"></div>
                                   </div>`,
                            iconSize: [48, 48],
                            iconAnchor: [24, 24]
                        })} />
                    )}


                    {/* REAL POI Markers from Google Places API — domain-aware icon */}
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

                    {/* Apartment Markers */}
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



                    {/* Parks removed - no longer fetched or displayed */}


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

                    {/* Transit Markers — split metro vs bus */}
                    {selectedPos && realPOIs.transit.length > 0 && realPOIs.transit.map((station, idx) => {
                        const isMetro = station.types?.some((t: string) =>
                            t.includes('subway') || t.includes('light_rail')
                        );
                        const isBus = station.types?.some((t: string) => t.includes('bus'));
                        // Fallback: if types is empty, infer from name
                        const nameHint = station.displayName?.toLowerCase() || '';
                        const isBusByName = !isMetro && (nameHint.includes('bus') || nameHint.includes('stop') || nameHint.includes('stand'));
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
                                            onClick={() => handleClusterClick(cluster.id, cluster.lat, cluster.lng)}
                                            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-[10px] font-black py-2 px-3 rounded-lg hover:shadow-lg transition-all uppercase tracking-wider"
                                        >
                                            📊 Analyze This Area
                                        </button>
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })}

                    {/* ── Custom Parameter POI Markers (purple, radius-filtered) ── */}
                    {selectedPos && customParams.map((param) => {
                        const places = customPOIs[param.id] || [];
                        const [cLat, cLng] = selectedPos;
                        return places
                            .filter(p => {
                                if (!p.location?.lat || !p.location?.lng) return false;
                                // Haversine distance check — only show within radius
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
                </MapContainer>

                {/* Legend */}
                <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[40] pointer-events-none hidden md:block">
                    <div className="bg-white/90 backdrop-blur-md px-4 py-2.5 rounded-[1.25rem] shadow-xl border border-white/80 pointer-events-auto flex items-center gap-4">
                        <span className="text-[9px] font-black text-slate-800 uppercase tracking-widest border-r border-slate-200 pr-4">Legend</span>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1.5" title={`${domain.competitorLabel} (Competitors)`}>
                                <img src={DOMAIN_ICON_MAP[activeDomain].rawUrl} className="w-4 h-4" alt="competitor" />
                                <span className="text-[9px] text-slate-600 font-bold">{domain.competitorLabel}</span>
                            </div>
                            <div className="flex items-center gap-1.5" title={`${DOMAIN_ICON_MAP[activeDomain].infraLabel} (Synergy)`}>
                                <img src={(DOMAIN_ICON_MAP[activeDomain].infraIcon.options as any).iconUrl} className="w-4 h-4" alt="infra" />
                                <span className="text-[9px] text-slate-600 font-bold">{DOMAIN_ICON_MAP[activeDomain].infraLabel}</span>
                            </div>
                            <div className="flex items-center gap-1.5 border-l border-slate-200 pl-4 ml-1" title="Corporate Offices">
                                <img src="https://cdn-icons-png.flaticon.com/512/3061/3061341.png" className="w-4 h-4" alt="office" />
                                <span className="text-[9px] text-slate-600 font-bold">Office</span>
                            </div>
                            <div className="flex items-center gap-1.5" title="Residential Zones">
                                <img src="https://cdn-icons-png.flaticon.com/512/619/619032.png" className="w-4 h-4" alt="home" />
                                <span className="text-[9px] text-slate-600 font-bold">Residential</span>
                            </div>
                            <div className="flex items-center gap-1.5" title="Metro Stations">
                                <img src="https://cdn-icons-png.flaticon.com/512/565/565350.png" className="w-4 h-4" alt="metro" />
                                <span className="text-[9px] text-slate-600 font-bold">Metro</span>
                            </div>
                            <div className="flex items-center gap-1.5" title="Bus Stops">
                                <img src="https://cdn-icons-png.flaticon.com/128/1178/1178850.png" className="w-4 h-4" alt="bus" />
                                <span className="text-[9px] text-slate-600 font-bold">Bus</span>
                            </div>
                            <div className="flex items-center gap-1.5 border-l border-slate-200 pl-4 ml-1">
                                <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm border border-emerald-600"></div>
                                <span className="text-[9px] text-slate-600 font-bold">High Score</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-amber-500 shadow-sm border border-amber-600"></div>
                                <span className="text-[9px] text-slate-600 font-bold">Avg</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-red-500 shadow-sm border border-red-600"></div>
                                <span className="text-[9px] text-slate-600 font-bold">Low</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Multi-Layer Scanning Widget (Moved to Top Right HUD) */}
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

            {/* ========================================== */}
            {/* FLOATING UI ELEMENTS OVER THE MAP          */}
            {/* ========================================== */}

            {/* TOP BAR: Title & Search (Dynamic & Floating) */}
            {/* TOP BAR: Title & Search (Dynamic & Floating) */}
            <div className={`absolute top-4 z-30 w-[95vw] md:w-[600px] flex flex-col gap-2 pointer-events-none transition-all duration-500 ease-in-out ${showRightSidebar ? 'lg:left-[calc(50%+160px)] lg:-translate-x-1/2' : 'left-1/2 -translate-x-1/2'} left-1/2 -translate-x-1/2`}>
                {/* Search Bar Container */}
                <div className="backdrop-blur-xl bg-white/80 shadow-2xl border border-white/50 rounded-2xl p-3 flex flex-col pointer-events-auto transition-all">
                    <div className="flex items-center justify-between gap-3">
                        {/* Brand / Logo Area */}
                        <div className="flex-shrink-0 flex items-center gap-2">
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-white font-black shadow-lg">G</div>
                            <div className="hidden sm:block">
                                <h1 className="text-sm font-black text-slate-900 tracking-tight leading-none">Geo-Intel <span className="text-indigo-600" style={{ fontSize: '0.6rem' }}>beta</span></h1>
                            </div>
                        </div>

                        {/* Search Input */}
                        <div className="flex-1 relative">
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder={isSearchListening ? '🎙️ Listening…' : 'Try: "top 3 spots" or ward name'}
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    updateSearchSuggestions(e.target.value);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        setSuggestionIndex(i => Math.min(i + 1, searchSuggestions.length - 1));
                                    } else if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        setSuggestionIndex(i => Math.max(i - 1, -1));
                                    } else if (e.key === 'Enter') {
                                        e.preventDefault();
                                        const chosen = suggestionIndex >= 0 ? searchSuggestions[suggestionIndex] : searchQuery.trim();
                                        if (chosen) {
                                            setSearchQuery(chosen);
                                            setSearchSuggestions([]);
                                            setSuggestionIndex(-1);

                                            // Check if it's a question or normal search
                                            const isQuestion = /\?|^what\b|^where\b|^how\b|^is\b|^are\b|^who\b|^when\b|^which\b|^tell\b|^show\b/i.test(chosen.trim());

                                            if (isQuestion) {
                                                // Route to chat
                                                setChatOpen(true);
                                                setTimeout(() => {
                                                    handleUserMessage(chosen);
                                                }, 100);
                                            } else {
                                                // Normal location search
                                                handlePlaceSearch(chosen);
                                            }
                                        }
                                    } else if (e.key === 'Escape') {
                                        setSearchSuggestions([]);
                                        setSuggestionIndex(-1);
                                    }
                                }}
                                onBlur={() => setTimeout(() => { setSearchSuggestions([]); setSuggestionIndex(-1); }, 150)}
                                className={`w-full pl-4 pr-20 py-2 text-sm font-bold text-slate-700 bg-white/50 border rounded-xl focus:bg-white focus:outline-none transition-all placeholder:font-normal shadow-inner ${isSearchListening ? 'border-red-300 bg-red-50/50 placeholder:text-red-400' : 'border-slate-200 focus:border-indigo-500 placeholder:text-slate-400'}`}
                            />

                            {/* Mic + Search buttons */}
                            <div className="absolute right-1 top-1 bottom-1 flex gap-1">
                                {((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) && (
                                    <button
                                        onClick={toggleSearchListening}
                                        title={isSearchListening ? 'Stop listening' : 'Search by voice'}
                                        className={`px-2 text-xs rounded-lg transition-all flex items-center justify-center ${isSearchListening ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'}`}
                                        aria-label={isSearchListening ? 'Stop voice search' : 'Voice search'}
                                    >
                                        {isSearchListening ? (
                                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                                <rect x="6" y="6" width="12" height="12" rx="2" />
                                            </svg>
                                        ) : (
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                            </svg>
                                        )}
                                    </button>
                                )}
                                <button
                                    onClick={() => {
                                        const query = searchQuery.trim();
                                        if (query) {
                                            setSearchSuggestions([]);

                                            // Check if it's a question or normal search
                                            const isQuestion = /\?|^what\b|^where\b|^how\b|^is\b|^are\b|^who\b|^when\b|^which\b|^tell\b|^show\b/i.test(query);

                                            if (isQuestion) {
                                                // Route to chat
                                                setChatOpen(true);
                                                setTimeout(() => {
                                                    handleUserMessage(query);
                                                }, 100);
                                            } else {
                                                // Normal location search
                                                handlePlaceSearch(query);
                                            }
                                        }
                                    }}
                                    className="px-3 bg-indigo-600 text-white text-xs font-black rounded-lg hover:shadow-lg transition-all"
                                >
                                    🔍
                                </button>
                            </div>

                            {/* Autocomplete Dropdown */}
                            {searchSuggestions.length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden">
                                    {searchSuggestions.map((s, idx) => {
                                        const isWard = !SEARCH_KEYWORDS.includes(s);
                                        return (
                                            <div
                                                key={s}
                                                onMouseDown={() => {
                                                    setSearchQuery(s);
                                                    setSearchSuggestions([]);
                                                    setSuggestionIndex(-1);
                                                    handlePlaceSearch(s);
                                                }}
                                                className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold cursor-pointer transition-colors ${idx === suggestionIndex ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}
                                            >
                                                <span className="text-base">{isWard ? '📍' : '🔎'}</span>
                                                <span>{s}</span>
                                                {isWard && <span className="ml-auto text-[9px] text-slate-400 font-bold uppercase tracking-wide">Ward</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Search Results Dropdown */}
                {searchResults.length > 0 && (
                    <div className="backdrop-blur-xl bg-white/95 shadow-2xl border border-white/50 rounded-2xl p-3 pointer-events-auto animate-in slide-in-from-top-2 duration-300">
                        <div className="flex justify-between items-center mb-2 px-1 border-b border-slate-100 pb-2">
                            <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">{queryDescription}</span>
                        </div>
                        <div className="space-y-2 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
                            {/* Re-using exact same search result mapping logic */}
                            {searchResults.map((item, idx) => {
                                // If this looks like a Google Place result, render place card
                                if (item && (item.displayName || item.formattedAddress || item.location)) {
                                    const name = item.displayName?.text || item.displayName || item.display_name || item.id || `Place ${idx}`;
                                    const rating = item.rating;
                                    const address = item.formattedAddress || item.formatted_address || '';
                                    return (
                                        <div key={item.id || idx} className="group flex justify-between items-center p-3 bg-white border border-slate-100 rounded-xl hover:border-indigo-500 hover:shadow-lg transition-all cursor-pointer relative overflow-hidden">
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
                                                {rating ? <div className="text-[10px] font-black text-slate-700">{rating.toFixed(1)} ★</div> : <div className="text-[9px] text-slate-400">No rating</div>}
                                                <div className="flex gap-2">
                                                    <button onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (item.location && item.location.lat && item.location.lng) {
                                                            setSelectedPos([item.location.lat, item.location.lng]);
                                                            setMapZoom(14);
                                                        }
                                                    }} className="px-3 py-1 text-[10px] font-black bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-100">Center</button>
                                                    <button onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (item.location && item.location.lat && item.location.lng) {
                                                            setSelectedPos([item.location.lat, item.location.lng]);
                                                            setSelectedCluster(null);
                                                            setSelectedWard(null);
                                                            setMapZoom(14);
                                                        }
                                                    }} className="px-3 py-1 text-[10px] font-black bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100">Analyze</button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                                // Fallback map for internal clusters
                                const ward = item as any;
                                const scoreVal = ward.finalScore || ward.opportunityScore || 0;
                                const scorePercentage = (scoreVal * 100).toFixed(1);
                                let scoreColorClass = 'bg-slate-100 text-slate-600 border-slate-200';
                                if (scoreVal > 0.8) scoreColorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                                else if (scoreVal > 0.6) scoreColorClass = 'bg-indigo-50 text-indigo-700 border-indigo-200';
                                else if (scoreVal > 0.4) scoreColorClass = 'bg-amber-50 text-amber-700 border-amber-200';
                                else scoreColorClass = 'bg-red-50 text-red-700 border-red-200';
                                return (
                                    <div key={ward.id || idx} onClick={() => handleClusterClick(ward.id, ward.lat, ward.lng)} className="group flex justify-between items-center p-3 bg-white border border-slate-100 rounded-xl hover:border-indigo-500 hover:shadow-lg transition-all cursor-pointer relative overflow-hidden">
                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-transparent group-hover:bg-indigo-500 transition-colors"></div>
                                        <div className="pl-2">
                                            <div className="font-bold text-slate-800 text-xs group-hover:text-indigo-700 transition-colors">{ward.wardName}</div>
                                            <div className="text-[9px] text-slate-400 font-medium mt-0.5 flex items-center gap-1">
                                                <span>ID: {ward.wardId}</span>
                                                {ward.growthRate > 0 && <span className="text-emerald-600 font-bold bg-emerald-50 px-1 rounded">Growth: +{(ward.growthRate * 100).toFixed(0)}%</span>}
                                            </div>
                                        </div>
                                        <div className={`px-2 py-1.5 rounded-lg border text-[10px] font-black ${scoreColorClass} shadow-sm`}>{scorePercentage}%</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* LEFT SIDEBAR: Intelligence Panel / Bottom Sheet */}
            <div className={`absolute bottom-0 left-0 right-0 lg:left-0 lg:top-0 lg:bottom-0 w-full lg:w-[320px] max-w-full lg:max-w-[90vw] z-[150] lg:z-[40] transition-all duration-500 ease-in-out flex flex-col pointer-events-none ${
                // Mobile visibility / Height mapping
                mobileView === 'analytics'
                    ? (sheetState === 'full' ? 'h-[92dvh]' : sheetState === 'half' ? 'h-[45vh]' : 'h-[60px]')
                    : 'max-lg:translate-y-full max-lg:opacity-0'
                } ${
                // Desktop visibility
                showRightSidebar ? 'lg:translate-x-0' : 'lg:-translate-x-full'
                }`}>
                {/* Mobile Drag Handle */}
                <div className="lg:hidden w-full flex flex-col items-center pt-2 pb-1 bg-white/95 backdrop-blur-xl border-t border-x border-slate-200/60 rounded-t-[2rem] pointer-events-auto"
                    onClick={() => setSheetState(prev => prev === 'half' ? 'full' : prev === 'full' ? 'half' : 'half')}>
                    <div className="w-12 h-1.5 bg-slate-200 rounded-full mb-1"></div>
                </div>

                {/* Toggle Button for Right Sidebar (attached to the edge) - Desktop only */}
                <button
                    onClick={() => setShowRightSidebar(!showRightSidebar)}
                    className="absolute -right-10 top-1/2 -translate-y-1/2 bg-white/95 backdrop-blur pointer-events-auto p-1.5 rounded-r-xl shadow-[5px_0_15px_rgba(0,0,0,0.1)] border border-l-0 border-slate-200 text-slate-600 hover:text-indigo-600 transition-colors z-50 hidden lg:flex items-center justify-center"
                >
                    <svg className={`w-5 h-5 transition-transform ${showRightSidebar ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>

                {/* Sidebar Content Container */}
                <div className={`flex-1 bg-white/95 lg:backdrop-blur-2xl shadow-[0_-10px_30px_rgba(0,0,0,0.1)] lg:shadow-[10px_0_30px_rgba(0,0,0,0.1)] lg:rounded-r-[2rem] border-x lg:border-l-0 lg:border-r border-slate-200/60 p-5 overflow-y-auto custom-scrollbar pointer-events-auto flex flex-col gap-5 ${mobileView === 'analytics' ? 'pb-24 pt-4' : ''}`}>
                    <header className="flex items-center justify-between pb-3 border-b border-slate-200/50 pt-1">
                        <div className="flex-1">
                            <div className="flex items-center justify-between lg:block">
                                <h2 className="text-lg font-black text-slate-900 tracking-tight">Intelligence Panel</h2>
                                <div className="lg:hidden flex gap-2">
                                    <button onClick={() => setSheetState(sheetState === 'full' ? 'half' : 'full')} className="text-slate-400 p-1">
                                        {sheetState === 'full' ? '▼' : '▲'}
                                    </button>
                                </div>
                            </div>
                            {(selectedCluster || selectedWard) ? (
                                <div className="mt-1 inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-md">
                                    <span className="text-[10px] font-black text-indigo-700">📍 {selectedWard || wardClusters.find(c => c.id === selectedCluster)?.wardName}</span>
                                </div>
                            ) : (
                                <p className="text-[10px] font-bold text-slate-400 mt-1">Select an area to analyze</p>
                            )}
                        </div>
                        <TutorialOverlay />
                    </header>





                    {/* Domain Selector */}
                    <div>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Analysis Domain</div>
                        <div className="flex bg-slate-100 p-1 rounded-2xl gap-1">
                            {([{ id: 'gym', emoji: '🏋️', label: 'Gym' }, { id: 'restaurant', emoji: '🍽️', label: 'Restaurants' }, { id: 'bank', emoji: '🏦', label: 'Banks' }, { id: 'retail', emoji: '🛍️', label: 'Retail' }] as const).map(d => (
                                <button
                                    key={d.id}
                                    onClick={() => setActiveDomain(d.id)}
                                    className={`flex-1 flex items-center justify-center gap-1 py-2 text-[9px] font-black rounded-xl transition-all ${activeDomain === d.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                                        }`}
                                >
                                    <span>{d.emoji}</span>
                                    <span>{d.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Radius Selector */}
                    <div>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Catchment Radius</div>
                        <div className="flex bg-slate-100 p-1 rounded-2xl gap-1">
                            <button
                                onClick={() => setSearchRadius(500)}
                                className={`flex-1 py-2 text-[10px] font-black rounded-xl transition-all ${searchRadius === 500 ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                500m (Hyper-Local)
                            </button>
                            <button
                                onClick={() => setSearchRadius(1000)}
                                className={`flex-1 py-2 text-[10px] font-black rounded-xl transition-all ${searchRadius === 1000 ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                1.0km (Standard)
                            </button>
                        </div>
                    </div>

                    {/* Suitability Index Card */}
                    <div className="bg-[#0f172a] text-white p-5 lg:p-8 rounded-[1.5rem] lg:rounded-[2.5rem] shadow-2xl relative overflow-hidden border border-slate-800 shrink-0">
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-1">
                                <h2 className="text-[9px] lg:text-[11px] font-black text-indigo-400 uppercase tracking-widest">Site Viability</h2>
                                <span className={`text-[9px] lg:text-[11px] font-black uppercase tracking-widest ${getVerdict().color}`}>{getVerdict().text}</span>
                            </div>
                            <div className="flex items-baseline gap-2 lg:gap-3">
                                <span className="text-5xl lg:text-7xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-500">
                                    {scores ? scores.total : '--'}
                                </span>
                                <span className="text-slate-500 font-bold text-base lg:text-xl">/100</span>
                            </div>

                            {!scores && (
                                <div className="mt-4 text-center text-slate-400 text-sm font-medium italic">
                                    👆 Click any ward on the map to analyze
                                </div>
                            )}

                            {scores && (
                                <div className="mt-4 lg:mt-6 flex gap-2">
                                    <div className="flex-1 bg-white/5 border border-white/10 p-2 lg:p-3 rounded-xl lg:rounded-2xl">
                                        <div className="text-[8px] lg:text-[10px] text-slate-400 font-bold uppercase mb-1">Market Generators</div>
                                        <div className="text-sm lg:text-lg font-black text-white">{demandGenerators}</div>
                                    </div>
                                    <div className="flex-1 bg-white/5 border border-white/10 p-2 lg:p-3 rounded-xl lg:rounded-2xl">
                                        <div className="text-[8px] lg:text-[10px] text-slate-400 font-bold uppercase mb-1">Competitors</div>
                                        <div className="text-sm lg:text-lg font-black text-white">{competitors}</div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="absolute right-[-10%] top-[-10%] w-32 lg:w-48 h-32 lg:h-48 bg-indigo-600/10 rounded-full blur-3xl"></div>
                    </div>

                    {/* Metrics Chart */}
                    <div className="bg-slate-50/50 p-3 lg:p-4 rounded-2xl lg:rounded-3xl border border-slate-100 shadow-inner h-40 lg:h-48 shrink-0 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 30 }}>
                                <XAxis type="number" hide domain={[0, 100]} />
                                <YAxis dataKey="name" type="category" width={95} style={{ fontSize: '8px', fontWeight: '900', fill: '#64748b' }} />
                                <Tooltip cursor={{ fill: 'transparent' }} />
                                <Bar dataKey="score" radius={[0, 6, 6, 0]} barSize={16}>
                                    {chartData.map((entry, index) => <Cell key={`c-${index}`} fill={entry.color} />)}
                                    <LabelList
                                        dataKey="score"
                                        position="right"
                                        style={{ fontSize: '9px', fontWeight: '900', fill: '#64748b' }}
                                        formatter={(v: number) => `${v}`}
                                    />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Custom Parameters Panel */}
                    <div className="border border-purple-200 rounded-2xl overflow-hidden shrink-0">
                        <button
                            onClick={() => setShowCustomParamPanel(!showCustomParamPanel)}
                            className="w-full flex items-center justify-between px-4 py-3 bg-purple-50 hover:bg-purple-100 transition-all"
                        >
                            <span className="text-[10px] font-black text-purple-700 uppercase tracking-widest">⚡ Custom Parameters ({customParams.length}/3)</span>
                            <span className="text-purple-400 text-sm">{showCustomParamPanel ? '▲' : '▼'}</span>
                        </button>

                        {showCustomParamPanel && (
                            <div className="p-3 bg-white flex flex-col gap-3">
                                {customParams.map(p => (
                                    <div key={p.id} className="flex items-center justify-between rounded-xl px-3 py-2 border shadow-sm" style={{ borderColor: p.color || '#e2e8f0', backgroundColor: `${p.color || '#94a3b8'}10` }}>
                                        <div>
                                            <div className="text-[10px] font-black" style={{ color: p.color || '#334155' }}>{p.label}</div>
                                            <div className="text-[9px] text-slate-500 font-medium">Type: {p.poiType} · Saturation@{p.saturationLimit} · Wt: {p.importance}</div>
                                        </div>
                                        <button onClick={() => removeCustomParam(p.id)} className="text-slate-300 hover:text-red-500 text-xs font-bold ml-2 transition-colors">✕</button>
                                    </div>
                                ))}
                                {customParams.length < 3 && (
                                    <div className="flex flex-col gap-2 pt-1">
                                        <input type="text" placeholder="Label, e.g. Near Schools" value={customParamForm.label}
                                            onChange={e => setCustomParamForm(f => ({ ...f, label: e.target.value }))}
                                            className="w-full text-[10px] border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-purple-400" />
                                        <select value={customParamForm.poiType}
                                            onChange={e => setCustomParamForm(f => ({ ...f, poiType: e.target.value }))}
                                            className="w-full text-[10px] border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-purple-400">
                                            {CUSTOM_POI_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                        <div className="flex gap-2 items-center">
                                            <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">Importance</span>
                                            <input type="range" min={1} max={5} value={customParamForm.importance}
                                                onChange={e => setCustomParamForm(f => ({ ...f, importance: Number(e.target.value) }))}
                                                className="flex-1 accent-purple-500" />
                                            <span className="text-[9px] font-black text-purple-700 w-4">{customParamForm.importance}</span>
                                        </div>
                                        <div className="flex gap-2 items-center">
                                            <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">Saturation at</span>
                                            <select value={customParamForm.saturationLimit}
                                                onChange={e => setCustomParamForm(f => ({ ...f, saturationLimit: Number(e.target.value) }))}
                                                className="flex-1 text-[10px] border border-slate-200 rounded-xl px-2 py-1 focus:outline-none focus:border-purple-400">
                                                {satLimitOptions.map(v => <option key={v} value={v}>{v} POIs = 100%</option>)}
                                            </select>
                                        </div>
                                        <button onClick={addCustomParam} disabled={!customParamForm.label.trim()}
                                            className="w-full py-2 text-[10px] font-black rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 transition-all">
                                            + Add Parameter
                                        </button>
                                    </div>
                                )}
                                {customParams.length >= 3 && <p className="text-[9px] text-slate-400 text-center">Max 3 custom parameters reached</p>}
                            </div>
                        )}
                    </div>


                    {/* AI Strategy Insights */}
                    <div className="flex flex-col shrink-0 mb-4">
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
            </div>

            {/* RIGHT SIDEBAR / CHAT UI - Truly floating, doesn't affect layout */}
            <div className={`fixed right-4 top-24 bottom-4 w-[360px] max-w-[90vw] z-50 transition-transform duration-300 ease-out pointer-events-none ${chatOpen ? 'translate-x-0' : 'translate-x-[calc(100%+32px)]'}`}>
                <div className="w-full h-full pointer-events-auto flex flex-col">
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
            </div>

            {/* Floating Chat Toggle Button (always visible when chat is closed) */}
            {!chatOpen && (
                <button
                    onClick={() => setChatOpen(true)}
                    className="fixed right-4 bottom-4 z-40 bg-indigo-600 text-white p-4 rounded-full shadow-2xl hover:bg-indigo-700 hover:scale-110 transition-all border border-indigo-400 flex items-center justify-center group"
                    title="Open AI Chat"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                    <span className="absolute right-14 opacity-0 group-hover:opacity-100 bg-black/80 text-white text-[10px] font-bold px-2 py-1 rounded whitespace-nowrap transition-opacity pointer-events-none">Open AI Chat</span>
                </button>
            )}

            {/* MOBILE BOTTOM NAVIGATION */}
            <div className="lg:hidden fixed bottom-0 left-0 right-0 z-[200] bg-white/90 backdrop-blur-xl border-t border-slate-200 p-2 pb-6 flex items-center justify-around shadow-[0_-10px_30px_rgba(0,0,0,0.1)]">
                <button
                    onClick={() => setMobileView('map')}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${mobileView === 'map' ? 'text-indigo-600 bg-indigo-50 scale-105' : 'text-slate-400'}`}
                >
                    <span className="text-xl">🗺️</span>
                    <span className="text-[9px] font-black uppercase tracking-widest">Map</span>
                </button>
                <button
                    onClick={() => { setMobileView('analytics'); setSheetState('half'); }}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${mobileView === 'analytics' ? 'text-indigo-600 bg-indigo-50 scale-105' : 'text-slate-400'}`}
                >
                    <span className="text-xl">📊</span>
                    <span className="text-[9px] font-black uppercase tracking-widest">Intelligence</span>
                </button>
                <button
                    onClick={() => setMobileView('chat')}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${mobileView === 'chat' ? 'text-indigo-600 bg-indigo-50 scale-105' : 'text-slate-400'}`}
                >
                    <span className="text-xl">💬</span>
                    <span className="text-[9px] font-black uppercase tracking-widest">AI Chat</span>
                </button>
            </div>
        </div>
    );
};

export default App;

