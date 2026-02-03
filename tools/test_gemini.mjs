#!/usr/bin/env node
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

function loadKey() {
  // Priority: GEMINI_API_KEY env, VITE_GEMINI_API_KEY env, .env.local VITE_GEMINI_API_KEY
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.VITE_GEMINI_API_KEY) return process.env.VITE_GEMINI_API_KEY;

  const envFile = '.env.local';
  if (fs.existsSync(envFile)) {
    const txt = fs.readFileSync(envFile, 'utf8');
    const m = txt.match(/VITE_GEMINI_API_KEY\s*=\s*(.+)/);
    if (m) return m[1].trim();
  }
  return null;
}

async function main() {
  const apiKey = loadKey();
  if (!apiKey) {
    console.error('No Gemini API key found. Set GEMINI_API_KEY or VITE_GEMINI_API_KEY in env or .env.local');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = 'Say hello and list 3 practical tips for choosing a gym near HSR Layout Bangalore.';

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { temperature: 0.2 }
    });

    console.log('--- Gemini RAW RESPONSE ---');
    console.log(JSON.stringify(response, null, 2));

    const text = response?.text || response?.outputText || response?.candidates?.[0]?.content?.[0]?.text;
    console.log('\n--- Extracted Text ---\n', text);
  } catch (err) {
    console.error('Gemini call failed:', err);
    if (err?.response) console.error('Response body:', err.response.data || err.response.body || err.response);
    process.exitCode = 2;
  }
}

main();
