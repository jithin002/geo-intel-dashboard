/**
 * HeaderBar — Top floating search bar + user menu + search results dropdown.
 * Extracted from App.tsx — zero logic change.
 */

import React from 'react';

interface GoogleUser {
    name: string;
    given_name?: string;
    email: string;
    picture: string;
}

const SEARCH_KEYWORDS = [
    'top 3 locations', 'best areas', 'high opportunity', 'low competition',
    'near metro', 'high footfall', 'residential zone', 'tech park area'
];

interface HeaderBarProps {
    user: GoogleUser;
    logout: () => void;
    showUserMenu: boolean;
    setShowUserMenu: (v: boolean) => void;
    // Search input
    searchQuery: string;
    setSearchQuery: (v: string) => void;
    searchSuggestions: string[];
    setSuggestionIndex: (v: number) => void;
    suggestionIndex: number;
    isSearchListening: boolean;
    updateSearchSuggestions: (q: string) => void;
    handlePlaceSearch: (query: string) => void;
    handleUserMessage: (message: string) => Promise<void>;
    toggleSearchListening: () => void;
    setSearchSuggestions: (v: string[]) => void;
    setChatOpen: (v: boolean) => void;
    // Search results dropdown
    searchResults: any[];
    queryDescription: string;
    onClusterClick: (clusterId: string, lat: number, lng: number) => void;
    setSelectedPos: (pos: [number, number]) => void;
    setMapZoom: (z: number) => void;
    setSelectedCluster: (c: string | null) => void;
    setSelectedWard: (w: string | null) => void;
    // Layout
    showRightSidebar: boolean;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
    user, logout, showUserMenu, setShowUserMenu,
    searchQuery, setSearchQuery, searchSuggestions, setSuggestionIndex, suggestionIndex,
    isSearchListening, updateSearchSuggestions, handlePlaceSearch, handleUserMessage,
    toggleSearchListening, setSearchSuggestions, setChatOpen,
    searchResults, queryDescription, onClusterClick,
    setSelectedPos, setMapZoom, setSelectedCluster, setSelectedWard,
    showRightSidebar,
}) => {
    const searchInputRef = React.useRef<HTMLInputElement>(null);

    const isQuestion = (text: string) =>
        /\?|^what\b|^where\b|^how\b|^is\b|^are\b|^who\b|^when\b|^which\b|^tell\b|^show\b/i.test(text.trim());

    const handleSubmit = (query: string) => {
        if (!query) return;
        setSearchSuggestions([]);
        if (isQuestion(query)) {
            setChatOpen(true);
            setTimeout(() => { handleUserMessage(query); }, 100);
        } else {
            handlePlaceSearch(query);
        }
    };

    return (
        <div className={`absolute top-4 z-30 w-[calc(100vw-24px)] md:w-[600px] flex flex-col gap-2 pointer-events-none transition-all duration-500 ease-in-out left-1/2 -translate-x-1/2 ${showRightSidebar ? 'lg:left-[calc(50%+160px)]' : ''}`}>

            {/* Search Bar */}
            <div className="backdrop-blur-xl bg-white/80 shadow-2xl border border-white/50 rounded-2xl p-3 flex flex-col pointer-events-auto transition-all">
                <div className="flex items-center justify-between gap-3">

                    {/* Brand */}
                    <div className="flex-shrink-0 flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-white font-black shadow-lg">G</div>
                        <div className="hidden sm:block">
                            <h1 className="text-sm font-black text-slate-900 tracking-tight leading-none">Geo-Intel <span className="text-indigo-600" style={{ fontSize: '0.6rem' }}>beta</span></h1>
                        </div>
                    </div>

                    {/* User Avatar + Sign Out */}
                    <div className="relative flex-shrink-0 ml-auto" style={{ zIndex: 60 }}>
                        <button
                            id="user-avatar-btn"
                            onClick={() => setShowUserMenu(!showUserMenu)}
                            title={user.name}
                            className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full bg-white/70 border border-slate-200 hover:border-indigo-400 hover:shadow-md transition-all"
                        >
                            <img
                                src={user.picture}
                                alt={user.name}
                                className="w-7 h-7 rounded-full object-cover border-2 border-indigo-400"
                                referrerPolicy="no-referrer"
                            />
                            <span className="hidden sm:block text-[11px] font-bold text-slate-700 max-w-[90px] truncate">{user.given_name}</span>
                            <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        {showUserMenu && (
                            <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in slide-in-from-top-2 duration-200">
                                <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-slate-100">
                                    <div className="text-xs font-black text-slate-800 truncate">{user.name}</div>
                                    <div className="text-[10px] text-slate-500 truncate mt-0.5">{user.email}</div>
                                </div>
                                <button
                                    id="sign-out-btn"
                                    onClick={() => { logout(); setShowUserMenu(false); }}
                                    className="w-full text-left px-4 py-3 text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                    </svg>
                                    Sign out
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Search Input */}
                    <div className="flex-1 relative">
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder={isSearchListening ? '🎙️ Listening…' : 'Try: "top 3 spots" or ward name'}
                            value={searchQuery}
                            onChange={e => {
                                setSearchQuery(e.target.value);
                                updateSearchSuggestions(e.target.value);
                            }}
                            onKeyDown={e => {
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setSuggestionIndex(Math.min(suggestionIndex + 1, searchSuggestions.length - 1));
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setSuggestionIndex(Math.max(suggestionIndex - 1, -1));
                                } else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const chosen = suggestionIndex >= 0 ? searchSuggestions[suggestionIndex] : searchQuery.trim();
                                    if (chosen) {
                                        setSearchQuery(chosen);
                                        setSearchSuggestions([]);
                                        setSuggestionIndex(-1);
                                        handleSubmit(chosen);
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
                                onClick={() => { const q = searchQuery.trim(); if (q) handleSubmit(q); }}
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
                        {searchResults.map((item, idx) => {
                            if (item && (item.displayName || item.formattedAddress || item.location)) {
                                const name = item.displayName?.text || item.displayName || item.display_name || item.id || `Place ${idx}`;
                                const rating = item.rating;
                                const address = item.formattedAddress || item.formatted_address || '';
                                return (
                                    <div key={item.id || idx} className="group flex justify-between items-center p-3 bg-white border border-slate-100 rounded-xl hover:border-indigo-500 hover:shadow-lg transition-all cursor-pointer relative overflow-hidden">
                                        <div className="pl-2" onClick={() => {
                                            if (item.location?.lat && item.location?.lng) {
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
                                                <button onClick={e => {
                                                    e.stopPropagation();
                                                    if (item.location?.lat && item.location?.lng) { setSelectedPos([item.location.lat, item.location.lng]); setMapZoom(14); }
                                                }} className="px-3 py-1 text-[10px] font-black bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-100">Center</button>
                                                <button onClick={e => {
                                                    e.stopPropagation();
                                                    if (item.location?.lat && item.location?.lng) { setSelectedPos([item.location.lat, item.location.lng]); setSelectedCluster(null); setSelectedWard(null); setMapZoom(14); }
                                                }} className="px-3 py-1 text-[10px] font-black bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100">Analyze</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }
                            // Ward cluster fallback
                            const ward = item as any;
                            const scoreVal = ward.finalScore || ward.opportunityScore || 0;
                            const scorePercentage = (scoreVal * 100).toFixed(1);
                            let scoreColorClass = 'bg-slate-100 text-slate-600 border-slate-200';
                            if (scoreVal > 0.8) scoreColorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                            else if (scoreVal > 0.6) scoreColorClass = 'bg-indigo-50 text-indigo-700 border-indigo-200';
                            else if (scoreVal > 0.4) scoreColorClass = 'bg-amber-50 text-amber-700 border-amber-200';
                            else scoreColorClass = 'bg-red-50 text-red-700 border-red-200';
                            return (
                                <div key={ward.id || idx} onClick={() => onClusterClick(ward.id, ward.lat, ward.lng)} className="group flex justify-between items-center p-3 bg-white border border-slate-100 rounded-xl hover:border-indigo-500 hover:shadow-lg transition-all cursor-pointer relative overflow-hidden">
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
    );
};
