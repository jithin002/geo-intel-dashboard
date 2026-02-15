
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
  const genResp = await generateAdvanced(`You are a helpful location intelligence assistant. Answer concisely.\n\nUser question: ${query}\n\nContext: ${lat && lng ? `Location ${lat}, ${lng}` : 'No location provided'}\n\nNearby places: ${places && places.length ? places.slice(0, 8).map((p: any) => p.displayName || p.display_name || p.id).join('; ') : 'None'}`, {
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

/**
 * Dashboard Action Interface
 * Defines actions that can be triggered by conversational queries
 */
export interface DashboardAction {
  type: 'navigate' | 'analyze' | 'search' | 'highlight' | 'zoom';
  payload: {
    location?: [number, number];
    wardName?: string;
    query?: string;
    zoom?: number;
    poiType?: string;
  };
}

/**
 * Conversational Query Response
 */
export interface ConversationalResponse {
  response: string;
  action?: DashboardAction;
  usedGemini: boolean; // Track if Gemini was used (for debugging/optimization)
}

/**
 * Handle conversational queries with minimal Gemini usage
 * Uses rule-based analysis first, only calls Gemini for complex questions
 */
export const conversationalQuery = async (
  userMessage: string,
  conversationContext: {
    recentMessages?: Array<{ role: string; content: string }>;
    currentLocation?: [number, number];
    selectedWard?: string;
    scores?: ScoringMatrix;
    realPOIs?: any;
    wardClusters?: any[];
  }
): Promise<ConversationalResponse> => {
  const lowerMessage = userMessage.toLowerCase().trim();

  // ============================================
  // RULE-BASED RESPONSES (No Gemini needed!)
  // ============================================

  // 1. Greetings/Basic interactions
  if (lowerMessage.match(/^(hi|hello|hey|greetings)/i)) {
    return {
      response: "Hello! I'm your geo-intelligence assistant. I can help you:\n\n• Find optimal gym locations ('top 3 spots')\n• Analyze specific areas\n• Check competition levels\n• Answer questions about current locations\n\nWhat would you like to explore?",
      usedGemini: false
    };
  }

  // 2. Current location questions
  if (conversationContext.selectedWard && (
    lowerMessage.includes('here') ||
    lowerMessage.includes('this area') ||
    lowerMessage.includes('this location') ||
    lowerMessage.match(/^what|^how|^is this/)
  )) {
    const { scores, realPOIs, selectedWard } = conversationContext;

    if (scores && realPOIs) {
      let response = `📍 You're analyzing **${selectedWard}**\n\n`;
      response += `**Site Viability**: ${scores.total}/100\n`;
      response += `**Competition**: ${realPOIs.gyms?.length || 0} gyms nearby\n`;
      response += `**Demand Generators**: ${(realPOIs.corporates?.length || 0) + (realPOIs.cafes?.length || 0)}\n`;
      response += `**Corporate Offices**: ${realPOIs.corporates?.length || 0}\n`;
      response += `**Apartments**: ${realPOIs.apartments?.length || 0}\n\n`;

      // Add verdict
      if (scores.total > 70) {
        response += "✅ **Strong location** with good potential!";
      } else if (scores.total > 50) {
        response += "🟡 **Decent location** - further analysis recommended.";
      } else {
        response += "⚠️ **Challenging location** - consider alternatives.";
      }

      return {
        response,
        usedGemini: false
      };
    }
  }

  // 3. Competition-specific questions
  if (lowerMessage.includes('competition') || lowerMessage.includes('competitor') || lowerMessage.includes('gyms nearby')) {
    const { realPOIs, selectedWard } = conversationContext;

    if (realPOIs?.gyms) {
      const gymCount = realPOIs.gyms.length;
      const highRated = realPOIs.gyms.filter((g: any) => g.rating && g.rating >= 4.0).length;

      let response = `🏋️ **Competition Analysis**${selectedWard ? ` for ${selectedWard}` : ''}:\n\n`;
      response += `• **Total Gyms**: ${gymCount}\n`;
      response += `• **High-Rated (4+★)**: ${highRated}\n`;

      if (gymCount === 0) {
        response += `\n🎯 **EXCELLENT** - No competition detected! First-mover advantage.`;
      } else if (gymCount <= 3) {
        response += `\n✅ **LOW** competition - Good opportunity.`;
      } else if (gymCount <= 6) {
        response += `\n🟡 **MODERATE** competition - Differentiation needed.`;
      } else {
        response += `\n⚠️ **HIGH** competition - Niche strategy required.`;
      }

      return {
        response,
        action: gymCount > 0 ? {
          type: 'highlight',
          payload: { poiType: 'gyms' }
        } : undefined,
        usedGemini: false
      };
    }
  }

  // 4. Demand/demographic questions
  if (lowerMessage.includes('demand') || lowerMessage.includes('corporate') || lowerMessage.includes('offices')) {
    const { realPOIs, selectedWard } = conversationContext;

    if (realPOIs) {
      const corporates = realPOIs.corporates?.length || 0;
      const apartments = realPOIs.apartments?.length || 0;

      let response = `👥 **Demand Analysis**${selectedWard ? ` for ${selectedWard}` : ''}:\n\n`;
      response += `• **Corporate Offices**: ${corporates}\n`;
      response += `• **Residential Complexes**: ${apartments}\n`;
      response += `• **Total Demand Score**: ${corporates + (apartments * 0.5)}\n\n`;

      if (corporates > 10) {
        response += `✅ **HIGH** corporate presence - target morning/evening rush hours.`;
      } else if (corporates > 5) {
        response += `🟡 **MODERATE** corporate presence - good for working professionals.`;
      } else {
        response += `⚠️ **LOW** corporate presence - focus on residential market.`;
      }

      return {
        response,
        action: {
          type: 'highlight',
          payload: { poiType: 'corporates' }
        },
        usedGemini: false
      };
    }
  }

  // ============================================
  // COMPLEX QUERIES - Use Gemini
  // ============================================

  // Build context for Gemini
  let contextPrompt = `You are a geo-intelligence assistant helping users find optimal gym locations in Bangalore.\n\n`;

  // Add conversation history
  if (conversationContext.recentMessages && conversationContext.recentMessages.length > 0) {
    contextPrompt += `=== Recent Conversation ===\n`;
    conversationContext.recentMessages.slice(-5).forEach(msg => {
      contextPrompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
    });
    contextPrompt += `\n`;
  }

  // Add dashboard state
  if (conversationContext.selectedWard || conversationContext.currentLocation) {
    contextPrompt += `=== Current Context ===\n`;
    if (conversationContext.selectedWard) {
      contextPrompt += `Selected Ward: ${conversationContext.selectedWard}\n`;
    }
    if (conversationContext.scores) {
      contextPrompt += `Site Score: ${conversationContext.scores.total}/100\n`;
      contextPrompt += `  - Demand: ${conversationContext.scores.demographicLoad}/100\n`;
      contextPrompt += `  - Competition Gap: ${conversationContext.scores.competitorRatio}/100\n`;
    }
    if (conversationContext.realPOIs) {
      contextPrompt += `Nearby POIs:\n`;
      contextPrompt += `  - Gyms: ${conversationContext.realPOIs.gyms?.length || 0}\n`;
      contextPrompt += `  - Corporate Offices: ${conversationContext.realPOIs.corporates?.length || 0}\n`;
      contextPrompt += `  - Apartments: ${conversationContext.realPOIs.apartments?.length || 0}\n`;
    }
    contextPrompt += `\n`;
  }

  contextPrompt += `User Question: ${userMessage}\n\n`;
  contextPrompt += `Instructions:\n`;
  contextPrompt += `- Be concise and helpful\n`;
  contextPrompt += `- Reference the current location context if relevant\n`;
  contextPrompt += `- Provide actionable insights based on the data\n`;
  contextPrompt += `- Format response in clear sections with bullet points\n`;
  contextPrompt += `- If suggesting an action, mention it clearly\n`;

  try {
    const result = await generateAdvanced(contextPrompt, {
      temperature: 0.3,
      maxOutputTokens: 400,
      candidateCount: 1
    });

    return {
      response: result.text || 'I apologize, but I could not generate a response. Please try rephrasing your question.',
      usedGemini: true
    };
  } catch (error) {
    console.error('Conversational query failed:', error);
    return {
      response: 'Sorry, I encountered an error processing your request. Please try again or rephrase your question.',
      usedGemini: false
    };
  }
};
