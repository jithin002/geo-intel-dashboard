# 🗺️ Geo-Intel Dashboard

Real-time location intelligence and strategic site analysis dashboard powered by Google Places API, Gemini AI (via Google Agent Development Kit), and domain-specific scoring models.

![Dashboard](https://img.shields.io/badge/Status-Active-success)
![Tech](https://img.shields.io/badge/Tech-React%20%7C%20TypeScript%20%7C%20Vite-blue)
![ADK](https://img.shields.io/badge/Chat-Google%20ADK-orange)

## 🎯 Features

- **Multi-Domain Intelligence**: Specialized analysis for Gyms, Restaurants, Cafes, Retail, Banks, and Co-working spaces. Each domain customizes the POI types fetched and adjusts the scoring matrix.
- **Interactive Map & Ward Analysis**: Explore Bangalore wards with dynamic color-coding. Click any cluster or ward to trigger comprehensive market analysis.
- **AI-Powered Chat (ADK)**: Chat is backed by the [Google Agent Development Kit](https://google.github.io/adk-docs/) with three native function tools — `analyze_location`, `compare_locations`, and `search_nearby` — replacing the previous fragile JSON-parsing loop with stable native function calling.
- **Voice & Smart Search**: Voice-enabled search bar with autocomplete shortcuts for seamless navigation.
- **Optimized POI Data**: Real-time competitors, corporate offices, transit, and residential data via Google Places API (New) with built-in two-tier caching.
- **Commercial Rent Intelligence**: BigQuery-backed rental market data overlaid on the map for selected areas.
- **Smart Scoring System**: Dynamic weighting by domain (Demographics, Competitor Gap, Infrastructure, Connectivity). Outputs verdicts like "GOLD MINE", "STRONG", "AVERAGE", "RISKY".

---

## 🚀 Running Locally

This project requires **three processes** running simultaneously.

### Prerequisites
- Node.js 18+
- Google Places API key (with **Places API (New)** enabled)
- Google Gemini API key (from [Google AI Studio](https://aistudio.google.com))
- BigQuery service account JSON (for rent intelligence — optional)

### 1. Install dependencies

```bash
# Main React app
npm install

# ADK agent sub-project
cd geo-intel-agent
npm install
cd ..
```

### 2. Configure environment variables

**`/.env.local`** (root — for the React app and Places API proxy):
```env
VITE_GOOGLE_MAPS_API_KEY=your_places_api_key
VITE_GEMINI_API_KEY=your_gemini_key
```

**`/geo-intel-agent/.env`** (for the ADK agent):
```env
GOOGLE_GENAI_API_KEY=your_gemini_key
GOOGLE_PLACES_API_KEY=your_places_api_key
```

### 3. Start all three processes

Open three terminal windows and run one command in each:

**Terminal 1 — ADK Agent** (port 8000):
```bash
cd geo-intel-agent
npx adk web
```

**Terminal 2 — API Server** (port 3001):
```bash
node server.cjs
```

**Terminal 3 — React App** (port 3000):
```bash
npm run dev
```

Then open **http://localhost:3000** in your browser.

> **Start order matters:** ADK first, then server.cjs, then the React app.

### Quick sanity check

Once all three are running, paste this in your browser console:
```js
fetch('http://localhost:3001/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'gym in koramangala' })
}).then(r => r.json()).then(console.log)
```
You should see `{ text: "...", sessionId: "...", toolData: { coordinates: ... } }`.

---

## 🔑 API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable **Places API (New)** and **Geocoding API**
3. Create an API key and restrict it to your domain/localhost
4. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com)
5. Add keys to `.env.local` (React app) and `geo-intel-agent/.env` (ADK agent)

---

## 📊 How It Works

### Chat Architecture (ADK)

```
User types in chat
       ↓
App.tsx → adkChatService.ts
       ↓
POST http://localhost:3001/api/chat   (server.cjs)
       ↓
POST http://localhost:8000/run_sse    (ADK agent)
       ↓
gemini-2.5-flash + Google Places API
       ↓
{ text, sessionId, toolData: { coordinates, scores } }
       ↓
Map navigates + Intelligence Panel updates
```

The ADK agent has three tools:
| Tool | Triggered when |
|---|---|
| `analyze_location` | "Is HSR Layout good for a gym?" |
| `compare_locations` | "Koramangala vs Whitefield for a cafe?" |
| `search_nearby` | "Show me gyms near MG Road" |

Conversation context is maintained across turns via ADK session IDs — clearing the chat starts a fresh session.

### POI Analysis & Scoring
When a location is selected on the map:
1. **Fetches Local Data**: Pulls nearby competitors, demand generators (offices/apartments), and infrastructure.
2. **Calculates Score**: Applies domain-specific weighting (Demographics, Competitor Gap, Infrastructure, Connectivity).
3. **Displays Result**: Intelligence Panel updates with score breakdown, chart, and AI insight.

### Two-Tier Caching
To minimize Places API billing, results are cached in:
1. **In-Memory Map**: Fast, per-session cache (prevents redundant calls when toggling wards/domains)
2. **Session Storage**: Survives page reloads within the same browser session

Cache keys are based on `lat + lng (3 decimal places) + radius + domain`.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Maps | Leaflet + React-Leaflet |
| Charts | Recharts |
| AI Chat | Google ADK (`@google/adk`) + Gemini 2.5 Flash |
| API Proxy | Express.js (`server.cjs`) |
| Location Data | Google Places API (New) |
| Rent Data | BigQuery + Cloud Functions |
| Voice | Web Speech API |

---

## 📁 Project Structure

```text
geo-intel-dashboard/
├── App.tsx                              # Main orchestrator
├── server.cjs                           # Express API server (port 3001)
│                                        #   /api/rent-insights  → BigQuery
│                                        #   /api/rent-listings  → BigQuery
│                                        #   /api/chat           → ADK agent proxy
├── geo-intel-agent/                     # Standalone ADK agent (port 8000)
│   ├── agent.ts                         # LlmAgent + 3 FunctionTools
│   ├── .env                             # GOOGLE_GENAI_API_KEY, GOOGLE_PLACES_API_KEY
│   └── package.json
├── components/
│   ├── map/DashboardMap.tsx             # Leaflet map + overlays
│   ├── ui/IntelligencePanel.tsx         # Scores, charts, rent data
│   └── ChatInterface.tsx               # Chat bubble UI
├── services/
│   ├── adkChatService.ts               # Chat → /api/chat → ADK (active)
│   ├── chatOrchestrationService.ts     # Legacy orchestrator (to be removed)
│   ├── placesAPIService.ts             # Google Places + two-tier cache
│   ├── scoringEngine.ts               # Domain scoring (runs in Web Worker)
│   └── rentIntelligenceService.ts     # Rent data client
├── .env.local                          # VITE_ keys (gitignored)
└── public/ward_data.csv               # Bangalore ward cluster data
```

---

## 🐛 Troubleshooting

### Chat responds but map doesn't navigate / Intelligence Panel stays blank
- Make sure all **3 processes** are running (ADK on 8000, server.cjs on 3001, React on 3000).
- Check browser console for `[ADK] Proxy error` — usually means the ADK server (port 8000) is down.

### Score shows 48 for all wards or markers are missing
- Places API (New) is not enabled in Google Cloud.
- Missing `VITE_GOOGLE_MAPS_API_KEY` in `.env.local`.

### Chat is unresponsive or crashes
- The old chat used direct Gemini calls which caused JSON-parse crashes. The new ADK chat should be stable. If you see errors, check that `geo-intel-agent/.env` has a valid `GOOGLE_GENAI_API_KEY`.

### Voice search isn't working
- Grant microphone permissions in your browser.

### Rent Intelligence shows no data
- BigQuery service account JSON is missing or the geocoding pipeline hasn't been run. See `rent-scraper/` for the data pipeline.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'feat: add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

MIT License — feel free to use for your projects!
