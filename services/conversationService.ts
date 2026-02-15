/**
 * Conversation Service
 * Manages chat history, context, and persistence for the conversational agent
 */

export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    metadata?: {
        location?: [number, number];
        wardName?: string;
        analysisType?: string;
        action?: DashboardAction;
    };
}

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

export interface ConversationContext {
    messages: Message[];
    currentLocation?: [number, number];
    selectedWard?: string;
    lastAnalysis?: any;
}

const STORAGE_KEY = 'geo-intel-conversation';
const MAX_HISTORY_LENGTH = 50; // Keep last 50 messages
const CONTEXT_WINDOW = 10; // Send last 10 messages to Gemini

/**
 * Load conversation history from localStorage
 */
export const loadConversationHistory = (): Message[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];

        const parsed = JSON.parse(stored);
        // Convert timestamp strings back to Date objects
        return parsed.map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp)
        }));
    } catch (error) {
        console.error('Failed to load conversation history:', error);
        return [];
    }
};

/**
 * Save conversation history to localStorage
 */
export const saveConversationHistory = (messages: Message[]): void => {
    try {
        // Only keep the most recent messages
        const trimmed = messages.slice(-MAX_HISTORY_LENGTH);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (error) {
        console.error('Failed to save conversation history:', error);
    }
};

/**
 * Add a message to conversation history
 */
export const addMessage = (
    messages: Message[],
    role: 'user' | 'assistant',
    content: string,
    metadata?: Message['metadata']
): Message[] => {
    const newMessage: Message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role,
        content,
        timestamp: new Date(),
        metadata
    };

    const updated = [...messages, newMessage];
    saveConversationHistory(updated);
    return updated;
};

/**
 * Clear conversation history
 */
export const clearConversationHistory = (): void => {
    localStorage.removeItem(STORAGE_KEY);
};

/**
 * Get recent messages for context (to send to Gemini)
 */
export const getRecentContext = (messages: Message[]): Message[] => {
    return messages.slice(-CONTEXT_WINDOW);
};

/**
 * Parse user intent from message
 * Returns intent type and extracted parameters
 */
export const parseUserIntent = (message: string): {
    intent: 'search' | 'analyze' | 'question' | 'navigate' | 'compare' | 'unknown';
    params: any;
} => {
    const lowerMessage = message.toLowerCase().trim();

    // Search intent patterns
    if (lowerMessage.match(/top \d+|best|highest|lowest|show me|find/i)) {
        return { intent: 'search', params: { query: message } };
    }

    // Analyze intent patterns
    if (lowerMessage.match(/analyze|analysis|evaluate|assess|check|look at/i)) {
        return { intent: 'analyze', params: { query: message } };
    }

    // Navigate intent patterns
    if (lowerMessage.match(/go to|navigate|zoom|show|map/i)) {
        return { intent: 'navigate', params: { query: message } };
    }

    // Compare intent patterns
    if (lowerMessage.match(/compare|versus|vs|difference|better/i)) {
        return { intent: 'compare', params: { query: message } };
    }

    // Question intent patterns (what, why, how, is, are, etc.)
    if (lowerMessage.match(/^(what|why|how|is|are|where|when|which|who|can|should|would)/i)) {
        return { intent: 'question', params: { query: message } };
    }

    return { intent: 'unknown', params: { query: message } };
};

/**
 * Build conversation summary for Gemini context
 */
export const buildConversationSummary = (
    messages: Message[],
    dashboardState: any
): string => {
    const recentMessages = getRecentContext(messages);

    let summary = '=== Conversation History ===\n';
    recentMessages.forEach(msg => {
        if (msg.role === 'user') {
            summary += `User: ${msg.content}\n`;
        } else if (msg.role === 'assistant') {
            summary += `Assistant: ${msg.content}\n`;
        }
    });

    summary += '\n=== Current Dashboard State ===\n';
    if (dashboardState.selectedWard) {
        summary += `Selected Ward: ${dashboardState.selectedWard}\n`;
    }
    if (dashboardState.selectedLocation) {
        summary += `Selected Location: [${dashboardState.selectedLocation[0].toFixed(4)}, ${dashboardState.selectedLocation[1].toFixed(4)}]\n`;
    }
    if (dashboardState.scores) {
        summary += `Site Viability Score: ${dashboardState.scores.total}/100\n`;
        summary += `- Demand: ${dashboardState.scores.demographicLoad}/100\n`;
        summary += `- Competition Gap: ${dashboardState.scores.competitorRatio}/100\n`;
        summary += `- Infrastructure: ${dashboardState.scores.infrastructure}/100\n`;
    }
    if (dashboardState.competitors !== undefined) {
        summary += `Competitors nearby: ${dashboardState.competitors}\n`;
    }
    if (dashboardState.demandGenerators !== undefined) {
        summary += `Demand generators: ${dashboardState.demandGenerators}\n`;
    }

    return summary;
};

/**
 * Extract location/ward mentions from text
 */
export const extractLocationMentions = (
    text: string,
    wardClusters: any[]
): string[] => {
    const mentions: string[] = [];

    wardClusters.forEach(ward => {
        const wardNameLower = ward.wardName.toLowerCase();
        const textLower = text.toLowerCase();

        if (textLower.includes(wardNameLower)) {
            mentions.push(ward.wardName);
        }
    });

    return mentions;
};
