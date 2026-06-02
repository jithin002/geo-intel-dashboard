/**
 * IntelligencePanel — Left sidebar extracted from App.tsx.
 * Zero logic change. Contains: domain selector, radius, scores chart,
 * custom parameters, AI insights, rent intelligence, sources.
 */

import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip, LabelList } from 'recharts';
import { ScoringMatrix } from '../../types';
import { DomainId } from '../../domains';
import { RentInsights } from '../../services/rentIntelligenceService';
import { GroundingSource } from '../../services/geminiService';
import { TutorialOverlay } from '../TutorialOverlay';

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

interface IntelligencePanelProps {
    // Sidebar visibility
    showRightSidebar: boolean;
    setShowRightSidebar: (v: boolean) => void;
    mobileView: 'map' | 'analytics' | 'chat';
    sheetState: 'peek' | 'half' | 'full';
    setSheetState: (v: 'peek' | 'half' | 'full') => void;
    // Location context
    selectedCluster: string | null;
    selectedWard: string | null;
    wardClusters: any[];
    // Domain
    activeDomain: DomainId;
    setActiveDomain: (d: DomainId) => void;
    // Radius
    searchRadius: number;
    setSearchRadius: (r: number) => void;
    // Scores
    scores: ScoringMatrix | null;
    isAnalyzing: boolean;
    aiInsight: string;
    sources: GroundingSource[];
    chartData: any[];
    competitors: number;
    demandGenerators: number;
    // Custom params
    customParams: CustomParam[];
    customParamForm: { label: string; poiType: string; importance: number; saturationLimit: number };
    setCustomParamForm: (f: any) => void;
    showCustomParamPanel: boolean;
    setShowCustomParamPanel: (v: boolean) => void;
    addCustomParam: () => void;
    removeCustomParam: (id: string) => void;
    // Rent
    selectedPos: [number, number] | null;
    rentInsights: RentInsights | null;
    rentLoading: boolean;
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
const satLimitOptions = [3, 5, 8, 12, 20];

export const IntelligencePanel: React.FC<IntelligencePanelProps> = ({
    showRightSidebar, setShowRightSidebar,
    mobileView, sheetState, setSheetState,
    selectedCluster, selectedWard, wardClusters,
    activeDomain, setActiveDomain,
    searchRadius, setSearchRadius,
    scores, isAnalyzing, aiInsight, sources, chartData, competitors, demandGenerators,
    customParams, customParamForm, setCustomParamForm, showCustomParamPanel, setShowCustomParamPanel,
    addCustomParam, removeCustomParam,
    selectedPos, rentInsights, rentLoading,
}) => {
    const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

    const getVerdict = () => {
        if (!scores) return { text: 'SELECT AREA', color: 'text-slate-400' };
        if (scores.total >= 70) return { text: 'STRONG', color: 'text-emerald-400' };
        if (scores.total >= 45) return { text: 'AVERAGE', color: 'text-yellow-400' };
        return { text: 'RISKY', color: 'text-red-400' };
    };

    return (
        <div className={`absolute bottom-0 left-0 right-0 lg:left-0 lg:top-0 lg:bottom-0 w-full lg:w-[320px] max-w-full lg:max-w-[90vw] z-[150] lg:z-[40] transition-all duration-500 ease-in-out flex flex-col pointer-events-none ${
            mobileView === 'analytics'
                ? (sheetState === 'full' ? 'h-[92dvh]' : sheetState === 'half' ? 'h-[45vh]' : 'h-[60px]')
                : 'max-lg:translate-y-full max-lg:opacity-0'
            } ${showRightSidebar ? 'lg:translate-x-0' : 'lg:-translate-x-full'}`}>

            {/* Mobile Drag Handle */}
            <div
                className="lg:hidden w-full flex flex-col items-center pt-2 pb-1 bg-white/95 backdrop-blur-xl border-t border-x border-slate-200/60 rounded-t-[2rem] pointer-events-auto"
                onClick={() => setSheetState(sheetState === 'half' ? 'full' : sheetState === 'full' ? 'half' : 'half')}
            >
                <div className="w-12 h-1.5 bg-slate-200 rounded-full mb-1"></div>
            </div>

            {/* Desktop toggle tab */}
            <button
                onClick={() => setShowRightSidebar(!showRightSidebar)}
                className="absolute -right-10 top-1/2 -translate-y-1/2 bg-white/95 backdrop-blur pointer-events-auto p-1.5 rounded-r-xl shadow-[5px_0_15px_rgba(0,0,0,0.1)] border border-l-0 border-slate-200 text-slate-600 hover:text-indigo-600 transition-colors z-50 hidden lg:flex items-center justify-center"
            >
                <svg className={`w-5 h-5 transition-transform ${showRightSidebar ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                </svg>
            </button>

            {/* Sidebar Content */}
            <div className={`flex-1 bg-white/95 lg:backdrop-blur-2xl shadow-[0_-10px_30px_rgba(0,0,0,0.1)] lg:shadow-[10px_0_30px_rgba(0,0,0,0.1)] lg:rounded-r-[2rem] border-x lg:border-l-0 lg:border-r border-slate-200/60 p-5 overflow-y-auto custom-scrollbar pointer-events-auto flex flex-col gap-5 ${mobileView === 'analytics' ? 'pb-24 pt-4' : ''}`}>

                {/* Header */}
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
                                className={`flex-1 flex items-center justify-center gap-1 py-2 text-[9px] font-black rounded-xl transition-all ${activeDomain === d.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                <span>{d.emoji}</span>
                                <span>{d.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Radius Selector */}
                <div>
                    <div className="flex justify-between items-center mb-2 px-1">
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Catchment Radius</div>
                        <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-[9px] font-bold text-indigo-500 hover:text-indigo-700 uppercase flex items-center gap-1 transition-colors">
                            {showAdvanced ? 'Hide Advanced' : 'Advanced ⚙️'}
                        </button>
                    </div>
                    <div className="flex bg-slate-100 p-1 rounded-2xl gap-1">
                        <button onClick={() => setSearchRadius(500)} className={`flex-1 py-2 text-[10px] font-black rounded-xl transition-all ${searchRadius === 500 ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                            500m (Hyper-Local)
                        </button>
                        <button onClick={() => setSearchRadius(1000)} className={`flex-1 py-2 text-[10px] font-black rounded-xl transition-all ${searchRadius === 1000 ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                            1.0km (Standard)
                        </button>
                    </div>
                </div>

                {/* Advanced: Custom Parameters Toggle */}
                {showAdvanced && (
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden shrink-0 animate-in slide-in-from-top-2">
                        <div className="p-3 bg-white flex flex-col gap-3">
                            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Custom Weights</div>
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
                                        onChange={e => setCustomParamForm((f: any) => ({ ...f, label: e.target.value }))}
                                        className="w-full text-[10px] border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400" />
                                    <select value={customParamForm.poiType}
                                        onChange={e => setCustomParamForm((f: any) => ({ ...f, poiType: e.target.value }))}
                                        className="w-full text-[10px] border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400">
                                        {CUSTOM_POI_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                    <div className="flex gap-2 items-center">
                                        <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">Importance</span>
                                        <input type="range" min={1} max={5} value={customParamForm.importance}
                                            onChange={e => setCustomParamForm((f: any) => ({ ...f, importance: Number(e.target.value) }))}
                                            className="flex-1 accent-indigo-500" />
                                        <span className="text-[9px] font-black text-indigo-700 w-4">{customParamForm.importance}</span>
                                    </div>
                                    <div className="flex gap-2 items-center">
                                        <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">Saturation at</span>
                                        <select value={customParamForm.saturationLimit}
                                            onChange={e => setCustomParamForm((f: any) => ({ ...f, saturationLimit: Number(e.target.value) }))}
                                            className="flex-1 text-[10px] border border-slate-200 rounded-xl px-2 py-1 focus:outline-none focus:border-indigo-400">
                                            {satLimitOptions.map(v => <option key={v} value={v}>{v} POIs = 100%</option>)}
                                        </select>
                                    </div>
                                    <button onClick={addCustomParam} disabled={!customParamForm.label.trim()}
                                        className="w-full py-2 text-[10px] font-black rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-all">
                                        + Add Parameter
                                    </button>
                                </div>
                            )}
                            {customParams.length >= 3 && <p className="text-[9px] text-slate-400 text-center">Max 3 custom parameters reached</p>}
                        </div>
                    </div>
                )}

                {/* Suitability Score Card */}
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

                {/* Rent Intelligence (Moved higher & denser) */}
                <div className="border border-emerald-200 rounded-2xl overflow-hidden shrink-0 shadow-sm">
                    <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-emerald-50 to-teal-50">
                        <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">🏠 Rent Context</span>
                        {rentLoading && <span className="text-[9px] text-emerald-500 animate-pulse font-bold">Querying...</span>}
                        {!rentLoading && rentInsights && rentInsights.sample_size > 0 && (
                            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">{rentInsights.sample_size} listings</span>
                        )}
                    </div>
                    <div className="p-3 bg-white flex flex-col gap-3">
                        {!selectedPos && (
                            <div className="flex items-center justify-center gap-2 p-2 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                                <span className="text-base">📍</span>
                                <span className="text-[10px] text-slate-500 font-bold">Drop a pin to view rent estimates</span>
                            </div>
                        )}
                        {selectedPos && rentLoading && (
                            <div className="flex flex-col gap-2">
                                <div className="h-4 bg-slate-100 rounded animate-pulse w-1/3"></div>
                                <div className="h-10 bg-slate-100 rounded animate-pulse w-full"></div>
                                <div className="h-10 bg-slate-100 rounded animate-pulse w-full"></div>
                            </div>
                        )}
                        {selectedPos && !rentLoading && (!rentInsights || rentInsights.sample_size === 0) && (
                            <div className="flex items-center justify-center gap-2 p-2 bg-amber-50 rounded-xl border border-dashed border-amber-200">
                                <span className="text-base">⚠️</span>
                                <span className="text-[10px] text-amber-700 font-bold">No listings found in this radius.</span>
                            </div>
                        )}
                        {selectedPos && !rentLoading && rentInsights && rentInsights.sample_size > 0 && (
                            <>
                                {/* Avg Rate — prominent display */}
                                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-3 border border-emerald-100 text-center">
                                    <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Avg. Market Rate</div>
                                    <div className="text-3xl font-black text-emerald-600 leading-none">
                                        ₹{Math.round(rentInsights.avg_rent)}
                                    </div>
                                    <div className="text-[9px] text-slate-400 font-medium mt-0.5">per sqft / month</div>
                                </div>

                                {/* Min / Max / Badge row */}
                                <div className="flex items-center justify-between px-1">
                                    <div className="flex gap-3 text-[9px] font-bold">
                                        <span className="text-emerald-600">Min ₹{Math.round(rentInsights.min_rent)}</span>
                                        <span className="text-slate-300">|</span>
                                        <span className="text-red-500">Max ₹{Math.round(rentInsights.max_rent)}</span>
                                    </div>
                                    <div className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${
                                        rentInsights.avg_rent < 100 ? 'bg-emerald-100 text-emerald-700' :
                                        rentInsights.avg_rent > 200 ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                                    }`}>
                                        {rentInsights.avg_rent < 100 ? 'Affordable' : rentInsights.avg_rent > 200 ? 'Premium' : 'Moderate'}
                                    </div>
                                </div>
                                <p className="text-[8px] text-slate-300 text-center">{rentInsights.sample_size} listings · 5km radius</p>
                            </>
                        )}
                    </div>
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
                        {aiInsight || 'Interactive Site Selection Enabled. Tap any point on the map to begin geospatial grounding and opportunity analysis.'}
                    </div>
                </div>



                {/* Verified Sources */}
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
    );
};
