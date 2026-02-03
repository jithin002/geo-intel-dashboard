
import { GoogleGenAI } from "@google/genai";
import { ScoringMatrix } from "../types";

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface AnalysisResponse {
  text: string;
  sources: GroundingSource[];
}

export const getSiteGuidance = async (lat: number, lng: number, scores: ScoringMatrix): Promise<AnalysisResponse> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY || '';
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `
    Perform a high-precision Site Feasibility Study for a Gym at: Lat ${lat}, Lng ${lng} (HSR Layout, Bangalore).
    
    Data Inputs:
    - Demand Score (Corporate + Residential): ${scores.demographicLoad}/100
    - Lifestyle Synergy (Parks/Cafes): ${scores.infrastructure}/100
    - Market Void (Competition Gap): ${100 - scores.competitorRatio}/100
    
    Task:
    1. **Demand Driver Analysis**: Identify if the site is closer to "Tech Corridors" (27th Main/ORR) or "Residential Pockets" (Sector 2/3). How does this affect peak hours?
    2. **Synergy Check**: Are there nearby Parks (Agara) or Health Cafes? If yes, treat this as a "High-Yield" zone.
    3. **Competition**: If saturated with big-box gyms (Cult/Snap), recommend a niche (e.g., Pilates, Boxing, 24/7 access).
    
    Output: Executive summary with a clear "Catchment Verdict".
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude: lat,
              longitude: lng
            }
          }
        }
      },
    });

    const text = response.text || "Analysis complete.";
    const sources: GroundingSource[] = [];
    
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    chunks.forEach((chunk: any) => {
      if (chunk.maps) {
        sources.push({
          title: chunk.maps.title || "Location Source",
          uri: chunk.maps.uri
        });
      }
    });

    return { text, sources };
  } catch (error) {
    console.error("Gemini Market Scan Error:", error);
    return { 
      text: "Real-time market scan failed. Falling back to local heuristic analysis.", 
      sources: [] 
    };
  }
};

/**
 * Answer a freeform customer question using Gemini.
 * If `places` is provided, include a short summary of nearby POIs to ground the answer.
 */
export const answerFreeform = async (query: string, lat?: number, lng?: number, places: any[] = []): Promise<string> => {
  // Use the advanced generator below (keeps behavior consistent)
  const genResp = await generateAdvanced(`You are a helpful location intelligence assistant. Answer concisely.\n\nUser question: ${query}\n\nContext: ${lat && lng ? `Location ${lat}, ${lng}` : 'No location provided'}\n\nNearby places: ${places && places.length ? places.slice(0,8).map((p:any)=>p.displayName||p.display_name||p.id).join('; ') : 'None'}`, {
    candidateCount: 1,
    temperature: 0.2
  });

  return genResp.text || 'No answer available.';
};

/**
 * Advanced wrapper around Google Generative Language (Gemini) API.
 * Options: model, temperature, maxOutputTokens, candidateCount, useMaps, mapsLatLng
 */
export const generateAdvanced = async (prompt: string, options?: {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  candidateCount?: number;
  useMaps?: boolean;
  mapsLatLng?: { latitude: number; longitude: number };
}) => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY || '';
  const ai = new GoogleGenAI({ apiKey });

  const cfg: any = {
    temperature: options?.temperature ?? 0.2,
    candidateCount: options?.candidateCount ?? 1,
    maxOutputTokens: options?.maxOutputTokens ?? 512
  };

  if (options?.useMaps) {
    cfg.tools = [{ googleMaps: {} }];
    if (options.mapsLatLng) {
      cfg.toolConfig = { retrievalConfig: { latLng: options.mapsLatLng } };
    }
  }

  try {
    const response = await ai.models.generateContent({
      model: options?.model || 'gemini-2.5-flash',
      contents: prompt,
      config: cfg
    });

    const text = (response && (response.text || response.outputText)) || (response?.candidates?.[0]?.content?.[0]?.text) || '';

    // Extract grounding sources if present
    const sources: GroundingSource[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    chunks.forEach((chunk: any) => {
      if (chunk.maps) {
        sources.push({ title: chunk.maps.title || 'Location Source', uri: chunk.maps.uri });
      }
    });

    return { text, sources, raw: response } as { text: string; sources: GroundingSource[]; raw: any };
  } catch (err) {
    console.error('generateAdvanced error:', err);
    return { text: '', sources: [], raw: null };
  }
};
