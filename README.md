# � Geo-Intel Dashboard

Real-time location intelligence and strategic site analysis dashboard powered by Google Places API, Gemini AI, and domain-specific scoring models.

![Dashboard](https://img.shields.io/badge/Status-Active-success)
![Tech](https://img.shields.io/badge/Tech-React%20%7C%20TypeScript%20%7C%20Vite-blue)

## 🎯 Features

- **Multi-Domain Intelligence**: Specialized analysis for Gyms, Restaurants, Retail, and Banks. Each domain customizes the POI types fetched (e.g., footfall vs. synergy) and adjusts the scoring matrix.
- **Interactive Map & Ward Analysis**: Explore Bangalore wards with dynamic color-coding. Click any cluster or ward to trigger comprehensive market analysis.
- **AI-Powered Chat & Strategy**: Integrated with Google Gemini to answer natural language queries (e.g., "Where is the best place to open a gym?") and generate site-specific strategic recommendations.
- **Voice & Smart Search**: Voice-enabled search bar with autocomplete shortcuts ("top 3 spots", "low competition", "restaurants in...") for seamless navigation.
- **Optimized POI Data**: Fetches real-time competitors, corporate offices, cafes, transit, and residential data via Google Places API (New) with built-in caching to minimize costs.
- **Smart Scoring System**: 
  - Dynamic weighting based on the selected domain (Demographics, Competitor Gap, Infrastructure, Connectivity).
  - Outputs actionable verdicts like "GOLD MINE", "STRONG", "AVERAGE", or "RISKY."

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Google Maps API key with **Places API (New)** enabled
- Google Gemini API key (for chat and AI strategies)

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/gym-locate-geo-intel-dashboard.git
cd gym-locate-geo-intel-dashboard

# Install dependencies
npm install

# Create environment file
copy .env.example .env.local

# Add your API keys to .env.local
# VITE_GOOGLE_MAPS_API_KEY=your_maps_key
# VITE_GEMINI_API_KEY=your_gemini_key

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser!

## 🔑 API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project and enable **Places API (New)**
3. Create an API Key and restrict it to your domain/localhost.
4. Get a Gemini API key from Google AI Studio.
5. Add keys to `.env.local`

## 📊 How It Works

### POI Analysis & Strategy
When a location is selected, the system:
1. **Detects Domain**: Configures search parameters based on active context (Gym, Retail, Restaurant, Bank).
2. **Fetches Local Data**: Pulls nearby competitors, demand generators (offices/apartments), and infrastructure.
3. **Calculates Score**: Applies the domain's weighting matrix to evaluate opportunity and saturation.
4. **Generates AI Strategy**: Gemini synthesizes the physical API data into a readable market strategy.

### Sample Output
```text
SITE VIABILITY: 87/100 (GOLD MINE)

MARKET GENERATORS: 124 (High Footfall)
COMPETITORS: 3

Market Gap: UNTAPPED OPPORTUNITY
Competition: LOW
```

## 🛠️ Tech Stack

- **Frontend**: React 19 + TypeScript
- **Build Tool**: Vite
- **Maps**: Leaflet + React-Leaflet (with vendored Heatmap support)
- **Charts**: Recharts
- **APIs**: 
  - Google Places API (New)
  - Google Gemini API (`@google/genai`)
  - Web Speech API (Voice mapping)

## 📁 Project Structure

```text
geo-intel-dashboard/
├── src/
│   ├── App.tsx                           # Main application orchestrator
│   ├── domains.ts                        # Domain configurations (Gym, Retail, etc.)
│   ├── components/                       # ChatInterface, etc.
│   └── services/
│       ├── placesAPIService.ts           # Google Places integration & caching
│       ├── geminiService.ts              # Gemini AI logic & recommendations
│       ├── chatOrchestrationService.ts   # AI Agent routing (map vs qa)
│       └── scoringEngine.ts              # Domain-specific scoring math
├── .env.local                            # API keys
└── package.json                          # Dependencies
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 🐛 Troubleshooting

### Score shows 48 for all wards or markers are missing
- Places API (New) is not enabled in Google Cloud.
- Missing `VITE_GOOGLE_MAPS_API_KEY` in your `.env.local`.

### AI features / Chat is unresponsive
- Missing `VITE_GEMINI_API_KEY` in `.env.local`.

### Voice search isn't working
- Ensure you have granted microphone permissions in your browser.

## 📄 License

MIT License - feel free to use for your projects!
