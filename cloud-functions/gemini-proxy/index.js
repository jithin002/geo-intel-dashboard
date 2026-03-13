const functions = require('@google-cloud/functions-framework');
const { GoogleGenAI } = require('@google/genai');

functions.http('geminiProxy', async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const { messages, contents, config, systemPrompt } = req.body;

    // Get API key from environment (stored securely in Cloud Run)
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Initialize Gemini with the actual modern `@google/genai` sdk the frontend uses
    const ai = new GoogleGenAI({ apiKey });

    // Ensure we handle both the simple text prompt format and the complex agentic format
    if (messages) {
      // Handle the simple text format we added in chatOrchestrationService
      const promptText = Array.isArray(messages) ? messages[messages.length - 1]?.content : messages;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: promptText || '',
        config: {
            temperature: 0.3, 
            maxOutputTokens: 2048
        }
      });
      res.json({ success: true, text: response.text || '' });

    } else if (contents) {
      // Handle direct forwarding of raw `generateContent` props (used by geminiService.ts)
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config: config || {}
      });
      // Send back exactly what the frontend wrapper expects
      res.json(response);

    } else {
      res.status(400).json({ error: 'Must provide either messages or contents' });
    }

  } catch (error) {
    console.error('Gemini API Error:', error);
    res.status(500).json({ 
      error: 'Failed to process request',
      details: error.message 
    });
  }
});
