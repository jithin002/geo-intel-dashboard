import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ScoringMatrix } from './types';
import { calculateSuitability } from './services/geoService';
import { GroundingSource } from './services/geminiService';
import {
    getLocationIntelligence,
    getDomainIntelligence,
    generateDataDrivenRecommendation,
    generateDomainRecommendation,
    PlaceResult
} from './services/placesAPIService';
import { parseSearchIntent } from './searchUtils';
import { DOMAIN_CONFIG, DomainId } from './domains';
import { calculateDomainScoresAsync } from './services/scoringEngine';
import { ChatInterface } from './components/ChatInterface';
import {
    addMessage,
    loadConversationHistory,
    clearConversationHistory,
    getRecentContext,
    Message
} from './services/conversationService';
import { processUserQueryADK as processUserQuery, resetADKSession } from './services/adkChatService';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './components/LoginPage';
import { getRentInsights, getRentListings, RentInsights, RentListing } from './services/rentIntelligenceService';

// Extracted UI Components
import { DashboardMap } from './components/map/DashboardMap';
import { HeaderBar } from './components/ui/HeaderBar';
import { IntelligencePanel } from './components/ui/IntelligencePanel';

// Constants
const SEARCH_KEYWORDS = [
    'top 3 spots', 'top 5 spots', 'top 10 spots',
    'low competition', 'high growth', 'untapped areas',
    'best overall', 'high opportunity', 'no gyms nearby',
    'gyms in', 'fitness in', 'exercise spots in',
    'cafes in', 'restaurants in', 'food spots in',
    'banks near', 'finance options in',
    'retail in', 'shops in', 'supermarket near',
];

const CUSTOM_COLORS = ['#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#eab308'];
const importanceWeightMap: Record<number, number> = { 1: 0.05, 2: 0.08, 3: 0.12, 4: 0.18, 5: 0.25 };

interface CustomParam {
    id: string;
    label: string;
    poiType: string;
    importance: number;
    saturationLimit: number;
    score?: number;
    places?: any[];
    color?: string;
}

// ── Auth-aware shell wraps the real App ────────────────────────────────────
export const AppShell: React.FC = () => {
    const { user, loading: authLoading, logout } = useAuth();
    const [showUserMenu, setShowUserMenu] = React.useState(false);

    if (authLoading) {
        return (
            <div style={{
                minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg, #0f0c29, #1a1040, #1e1260)',
                color: '#a78bfa', fontFamily: 'Inter, system-ui, sans-serif', gap: '12px', fontSize: '15px', fontWeight: 700,
            }}>
                <div style={{ width: 24, height: 24, border: '3px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                Loading...
            </div>
        );
    }

    if (!user) return <LoginPage />;

    return <App user={user} logout={logout} showUserMenu={showUserMenu} setShowUserMenu={setShowUserMenu} />;
};

export default AppShell;

// ── Dashboard app ────────────────────────────────────────────────────────
const App: React.FC<{
    user: import('./context/AuthContext').GoogleUser;
    logout: () => void;
    showUserMenu: boolean;
    setShowUserMenu: React.Dispatch<React.SetStateAction<boolean>>;
}> = ({ user, logout, showUserMenu, setShowUserMenu }) => {
    const [selectedPos, setSelectedPos] = useState<[number, number] | null>(null);
    const [searchRadius, setSearchRadius] = useState<number>(1000);
    const [scores, setScores] = useState<ScoringMatrix | null>(null);
    const [aiInsight, setAiInsight] = useState<string>('');
    const [sources, setSources] = useState<GroundingSource[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
    const [selectedWard, setSelectedWard] = useState<string | null>(null);
    const [mapZoom, setMapZoom] = useState<number>(11);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [mapNavigateKey, setMapNavigateKey] = useState<number>(0);

    const [wardClusters, setWardClusters] = useState<any[]>([]);
    const [wardScores, setWardScores] = useState<Record<string, {
        opportunityScore: number;
        finalScore: number;
        growthRate: number;
        demographicLoad: number;
        competitorDensity: number;
    }>>({});

    const [queryDescription, setQueryDescription] = useState<string>('');
    const [searchResults, setSearchResults] = useState<any[]>([]);

    const [chatOpen, setChatOpen] = useState(false);
    const [conversationMessages, setConversationMessages] = useState<Message[]>([]);
    const [isAITyping, setIsAITyping] = useState(false);

    const [isSearchListening, setIsSearchListening] = useState(false);
    const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
    const [suggestionIndex, setSuggestionIndex] = useState(-1);
    const searchRecognitionRef = useRef<any>(null);

    const [activeDomain, setActiveDomain] = useState<DomainId>('gym');
    const [mobileView, setMobileView] = useState<'map' | 'analytics' | 'chat'>('map');
    const [sheetState, setSheetState] = useState<'peek' | 'half' | 'full'>('half');

    const [rentInsights, setRentInsights] = useState<RentInsights | null>(null);
    const [rentLoading, setRentLoading] = useState(false);
    const [rentListings, setRentListings] = useState<RentListing[]>([]);

    const [customParams, setCustomParams] = useState<CustomParam[]>([]);
    const [customParamForm, setCustomParamForm] = useState({ label: '', poiType: 'school', importance: 3, saturationLimit: 8 });
    const [showCustomParamPanel, setShowCustomParamPanel] = useState(false);
    const [customPOIs, setCustomPOIs] = useState<Record<string, any[]>>({});

    const customParamsRef = useRef<CustomParam[]>([]);
    useEffect(() => {
        customParamsRef.current = customParams;
    }, [customParams]);

    const addCustomParam = () => {
        if (customParams.length >= 3 || !customParamForm.label.trim()) return;

        const usedColors = customParams.map(p => p.color);
        const availableColor = CUSTOM_COLORS.find(c => !usedColors.includes(c));
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

    const [realPOIs, setRealPOIs] = useState<{
        gyms: PlaceResult[];
        cafes: PlaceResult[];
        parks: PlaceResult[];
        corporates: PlaceResult[];
        transit: PlaceResult[];
        apartments: PlaceResult[];
    }>({ gyms: [], cafes: [], parks: [], corporates: [], transit: [], apartments: [] });

    const handleMapClick = useCallback((e: any) => {
        const { lat, lng } = e.latlng;
        setSelectedPos([lat, lng]);
        setSelectedCluster(null);
        setSelectedWard(null);
    }, []);

    const handleClusterClick = useCallback((clusterId: string, lat: number, lng: number) => {
        setSelectedPos([lat, lng]);
        setSelectedCluster(clusterId);
        setSelectedWard(null);
        setMapZoom(15);
        setMapNavigateKey(k => k + 1);
    }, []);

    const handleWardClick = useCallback((lat: number, lng: number, wardName: string) => {
        setSelectedPos([lat, lng]);
        setSelectedWard(wardName);
        setSelectedCluster(null);
        setMapZoom(14);
        setMapNavigateKey(k => k + 1);
    }, []);

    const handlePlaceSearch = useCallback(async (query: string) => {
        if (!query) {
            setQueryDescription('');
            setSearchResults([]);
            return;
        }
        console.log("🗣️ Routing query to AI Chat:", query);
        setChatOpen(true);
        setSearchQuery('');
        setSearchSuggestions([]);
        handleUserMessage(query);
    }, []);

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

    useEffect(() => {
        fetch('/ward_data.csv')
            .then(res => res.text())
            .then(csv => {
                const lines = csv.split('\n');
                const clusters = lines.slice(1).filter(line => line.trim()).map((line) => {
                    const parts = line.split(',');
                    if (parts.length > 7) {
                        return {
                            id: `ward-${parts[6]}`,
                            wardId: parts[6],
                            wardName: parts[7].replace(/^"|"$/g, ''),
                            lat: parseFloat(parts[2]) || 0,
                            lng: parseFloat(parts[3]) || 0,
                            opportunityScore: parseFloat(parts[1]) || 0,
                            finalScore: parseFloat(parts[14]) || 0,
                            gymCount: parseInt(parts[9]) || 0,
                            cafeCount: parseInt(parts[10]) || 0,
                            growthRate: parseFloat(parts[5]) || 0,
                            color: '#6366f1'
                        };
                    }
                    return null;
                }).filter(Boolean);
                setWardClusters(clusters);
            })
            .catch(err => console.error('Failed to load ward data:', err));

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
        const analysisPos = overrideLocation || selectedPos;
        if (!analysisPos) return;
        setIsAnalyzing(true);
        setAiInsight('Fetching real POI data from Google Places...');

        const domainToUse = (overrideDomain || activeDomain) as keyof typeof DOMAIN_CONFIG;
        const effectiveCluster = overrideCluster !== undefined ? overrideCluster : selectedCluster;

        try {
            const response = await fetch('/api/analyze-location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat: analysisPos[0], lng: analysisPos[1], radius: searchRadius, domainId: domainToUse })
            });
            const data = await response.json();
            const intel = data.intel;
            const realScores = data.scores;
            let currentTotalScore = realScores.total;

            setRealPOIs({
                gyms: intel.competitors.places,
                cafes: intel.infraSynergy.places,
                corporates: intel.corporateOffices.places,
                transit: intel.transitStations.places,
                apartments: intel.apartments.places,
                parks: []
            });

            setScores(realScores);

            if (effectiveCluster) {
                const opportunityScore = realScores.total / 100;
                const finalScore = opportunityScore;
                let growthRate = 0.05;
                if (realScores.demographicLoad > 70) growthRate += 0.03;
                setWardScores(prev => ({ ...prev, [effectiveCluster]: { opportunityScore, finalScore, growthRate, demographicLoad: realScores.demographicLoad, competitorDensity: intel.competitors.total } }));
            }

            // For AI Insight, we can use a simpler recommendation generator or keep the old one
            setAiInsight(`Analysis complete for ${domainToUse}. Score: ${realScores.total}/100.`);

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
                        const rawPlaces = await customNearby(analysisPos[0], analysisPos[1], searchRadius, [param.poiType], true, BASIC_MASK);
                        const places = rawPlaces.filter(p => !p.businessStatus || p.businessStatus === 'OPERATIONAL');

                        newPOIs[param.id] = places;
                        const raw = Math.min(places.length, param.saturationLimit);
                        const pScore = Math.round((raw / param.saturationLimit) * 100);
                        updatedParams[i] = { ...param, score: pScore, places };

                        const weight = importanceWeightMap[param.importance] || 0.12;
                        customWeightSum += weight;
                        customWeightedScoreSum += (pScore * weight);
                    } catch {
                        updatedParams[i] = { ...param, score: 0, places: [] };
                    }
                }));

                if (customWeightSum > 0) {
                    const safeWeightSum = Math.min(customWeightSum, 1.0);
                    const baseWeight = 1 - safeWeightSum;
                    currentTotalScore = Math.round((currentTotalScore * baseWeight) + customWeightedScoreSum);
                }

                setCustomParams(updatedParams);
                setCustomPOIs(newPOIs);
            }

            if (realScores) {
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

    useEffect(() => {
        if (!selectedPos) {
            setRentInsights(null);
            setRentListings([]);
            return;
        }
        const radius = Math.max(searchRadius * 3, 5000);
        setRentLoading(true);
        // Fetch aggregated stats and individual listing pins in parallel
        Promise.all([
            getRentInsights(selectedPos[0], selectedPos[1], radius, activeDomain),
            getRentListings(selectedPos[0], selectedPos[1], radius, activeDomain),
        ]).then(([insights, listings]) => {
            setRentInsights(insights);
            setRentListings(listings);
            setRentLoading(false);
        }).catch(() => { setRentLoading(false); });
    }, [selectedPos, activeDomain, searchRadius]);

    useEffect(() => {
        if (selectedPos) {
            performAnalysis();
        }
    }, [customParams.length, performAnalysis]);

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

    const handleUserMessage = useCallback(async (message: string) => {
        const updatedMessages = addMessage(
            conversationMessages,
            'user',
            message,
            { location: selectedPos || undefined, wardName: selectedWard || undefined }
        );
        setConversationMessages(updatedMessages);
        setIsAITyping(true);

        try {
            const intent = parseSearchIntent(message);
            const detectedDomain = (intent.hasDomain && intent.domain) ? intent.domain : activeDomain;

            if (intent.hasDomain && intent.domain && intent.domain !== activeDomain) {
                setActiveDomain(intent.domain as DomainId);
            }

            const recentContext = getRecentContext(updatedMessages).map(msg => ({
                role: msg.role,
                content: msg.content
            }));

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

            if (response.mapAction) {
                const action = response.mapAction;
                switch (action.type) {
                    case 'analyze':
                    case 'navigate':
                        if (action.payload.location) {
                            const newLoc = action.payload.location;
                            setSelectedPos(newLoc);
                            setSelectedCluster(null);
                            setMapZoom(action.payload.zoom || 14);
                            setMapNavigateKey(k => k + 1);
                            setSelectedWard(action.payload.wardName || null);

                            // Switch domain if the AI detected a different one from the message
                            const targetDomain = (action.payload.domain || detectedDomain) as DomainId;
                            if (targetDomain && targetDomain !== activeDomain) {
                                setActiveDomain(targetDomain);
                            }
                            const analysisDomain = targetDomain || detectedDomain;

                            if (action.payload.triggerAnalysis) {
                                if (response.prefetchedIntel) {
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

                                    // Async worker call
                                    const cachedScores = await calculateDomainScoresAsync(intel, analysisDomain as DomainId, searchRadius);
                                    setScores(cachedScores);

                                    if (isGymShape) {
                                        setAiInsight(generateDataDrivenRecommendation(intel, cachedScores));
                                    } else {
                                        setAiInsight(generateDomainRecommendation(intel, analysisDomain));
                                    }

                                    if (analysisDomain !== 'gym') {
                                        const chatLocation = newLoc;
                                        setTimeout(() => { performAnalysis(analysisDomain, null, chatLocation); }, 400);
                                    }
                                } else {
                                    const chatLocation = newLoc;
                                    setTimeout(() => { performAnalysis(analysisDomain, null, chatLocation); }, 300);
                                }
                            }
                        }
                        break;
                    case 'zoom':
                        if (action.payload.zoom) setMapZoom(action.payload.zoom);
                        break;
                }
            }


            const finalMessages = addMessage(updatedMessages, 'assistant', response.text);
            setConversationMessages(finalMessages);

        } catch (error) {
            console.error('❌ Agentic chat error:', error);
            const errorMessages = addMessage(updatedMessages, 'assistant', 'Sorry, I encountered an error processing your request. Please try again.');
            setConversationMessages(errorMessages);
        } finally {
            setIsAITyping(false);
        }
    }, [conversationMessages, selectedPos, selectedWard, selectedCluster, scores, realPOIs,
        wardClusters, searchRadius, activeDomain, performAnalysis]);

    const handleClearChat = useCallback(() => {
        clearConversationHistory();
        setConversationMessages([]);
        resetADKSession(); // start a fresh ADK conversation
    }, []);

    const [showRightSidebar, setShowRightSidebar] = useState(true);

    return (
        <div className="relative h-[100dvh] w-[100vw] bg-slate-100 overflow-hidden font-sans">
            <DashboardMap
                selectedPos={selectedPos}
                searchRadius={searchRadius}
                competitors={competitors}
                activeDomain={activeDomain}
                realPOIs={realPOIs}
                wardClusters={wardClusters}
                selectedCluster={selectedCluster}
                wardScores={wardScores}
                customParams={customParams}
                customPOIs={customPOIs}
                mapZoom={mapZoom}
                mapNavigateKey={mapNavigateKey}
                domain={domain}
                demandGenerators={demandGenerators}
                onMapClick={handleMapClick}
                onClusterClick={handleClusterClick}
                onWardClick={handleWardClick}
                rentListings={rentListings}
            />

            <HeaderBar
                user={user}
                logout={logout}
                showUserMenu={showUserMenu}
                setShowUserMenu={setShowUserMenu}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                searchSuggestions={searchSuggestions}
                setSuggestionIndex={setSuggestionIndex}
                suggestionIndex={suggestionIndex}
                isSearchListening={isSearchListening}
                updateSearchSuggestions={updateSearchSuggestions}
                handlePlaceSearch={handlePlaceSearch}
                handleUserMessage={handleUserMessage}
                toggleSearchListening={toggleSearchListening}
                setSearchSuggestions={setSearchSuggestions}
                setChatOpen={setChatOpen}
                searchResults={searchResults}
                queryDescription={queryDescription}
                onClusterClick={handleClusterClick}
                setSelectedPos={setSelectedPos}
                setMapZoom={setMapZoom}
                setSelectedCluster={setSelectedCluster}
                setSelectedWard={setSelectedWard}
                showRightSidebar={showRightSidebar}
            />

            <IntelligencePanel
                showRightSidebar={showRightSidebar}
                setShowRightSidebar={setShowRightSidebar}
                mobileView={mobileView}
                sheetState={sheetState}
                setSheetState={setSheetState}
                selectedCluster={selectedCluster}
                selectedWard={selectedWard}
                wardClusters={wardClusters}
                activeDomain={activeDomain}
                setActiveDomain={setActiveDomain}
                searchRadius={searchRadius}
                setSearchRadius={setSearchRadius}
                scores={scores}
                isAnalyzing={isAnalyzing}
                aiInsight={aiInsight}
                sources={sources}
                chartData={chartData}
                competitors={competitors}
                demandGenerators={demandGenerators}
                customParams={customParams}
                customParamForm={customParamForm}
                setCustomParamForm={setCustomParamForm}
                showCustomParamPanel={showCustomParamPanel}
                setShowCustomParamPanel={setShowCustomParamPanel}
                addCustomParam={addCustomParam}
                removeCustomParam={removeCustomParam}
                selectedPos={selectedPos}
                rentInsights={rentInsights}
                rentLoading={rentLoading}
            />

            {/* Right Chat Sidebar — desktop only */}
            <div className={`hidden lg:block fixed right-4 top-24 bottom-4 w-[360px] max-w-[90vw] z-50 transition-transform duration-300 ease-out pointer-events-none ${chatOpen ? 'translate-x-0' : 'translate-x-[calc(100%+32px)]'}`}>
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

            {/* Mobile Full-Screen Chat Panel — shown when mobileView === 'chat' */}
            <div className={`lg:hidden fixed inset-0 z-[180] bg-white transition-transform duration-300 ease-in-out ${mobileView === 'chat' ? 'translate-y-0' : 'translate-y-full'}`}>
                <div className="flex flex-col h-full pb-20">
                    <ChatInterface
                        messages={conversationMessages}
                        onSendMessage={handleUserMessage}
                        onClearChat={handleClearChat}
                        isAITyping={isAITyping}
                        isOpen={true}
                        onToggle={() => setMobileView('map')}
                        selectedWard={selectedWard || undefined}
                    />
                </div>
            </div>

            {/* Chat FAB — desktop only */}
            {!chatOpen && (
                <button
                    onClick={() => setChatOpen(true)}
                    className="hidden lg:flex fixed right-4 bottom-4 z-40 bg-indigo-600 text-white p-4 rounded-full shadow-2xl hover:bg-indigo-700 hover:scale-110 transition-all border border-indigo-400 items-center justify-center group"
                    title="Open AI Chat"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                    <span className="absolute right-14 opacity-0 group-hover:opacity-100 bg-black/80 text-white text-[10px] font-bold px-2 py-1 rounded whitespace-nowrap transition-opacity pointer-events-none">Open AI Chat</span>
                </button>
            )}

            {/* MOBILE BOTTOM NAVIGATION */}
            <div className="lg:hidden fixed bottom-0 left-0 right-0 z-[200] bg-white/95 backdrop-blur-xl border-t border-slate-200 flex items-center justify-around shadow-[0_-4px_20px_rgba(0,0,0,0.08)]" style={{paddingBottom: 'env(safe-area-inset-bottom, 8px)', paddingTop: '8px'}}>
                <button
                    onClick={() => { setMobileView('map'); setChatOpen(false); }}
                    className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-all ${mobileView === 'map' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}
                >
                    <span className="text-xl">🗺️</span>
                    <span className="text-[9px] font-black uppercase tracking-widest">Map</span>
                </button>
                <button
                    onClick={() => { setMobileView('analytics'); setSheetState('half'); setChatOpen(false); }}
                    className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-all ${mobileView === 'analytics' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}
                >
                    <span className="text-xl">📊</span>
                    <span className="text-[9px] font-black uppercase tracking-widest">Intel</span>
                </button>
                <button
                    onClick={() => { setMobileView('chat'); }}
                    className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-all relative ${mobileView === 'chat' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}
                >
                    <span className="text-xl">💬</span>
                    <span className="text-[9px] font-black uppercase tracking-widest">AI Chat</span>
                    {conversationMessages.length > 0 && mobileView !== 'chat' && (
                        <span className="absolute top-1 right-4 w-2 h-2 bg-indigo-500 rounded-full"></span>
                    )}
                </button>
            </div>
        </div>
    );
};
