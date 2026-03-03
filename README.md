# 🏋️ Gym Location Intelligence Dashboard

Real-time gym location intelligence dashboard powered by Google Places API and strategic site analysis.

![Dashboard](https://img.shields.io/badge/Status-Active-success)
![Tech](https://img.shields.io/badge/Tech-React%20%7C%20TypeScript%20%7C%20Vite-blue)

## 🎯 Features

- **Interactive Map**: Click any ward in Bangalore to analyze location potential
- **Real-time POI Data**: Fetches gyms, offices, cafes, and transit from Google Places API
- **Smart Scoring System**: 
  - Demographic (30%): Corporate offices + residential density
  - Competitor (30%): Market gap analysis
  - Infrastructure (25%): Cafes/lifestyle indicators
  - Connectivity (15%): Metro + bus transit access
- **Data-Driven Recommendations**: Strategic insights without AI dependency
- **Live Map Markers**: Visual POI overlay with ratings and details

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ installed
- Google Maps API key with Places API (New) enabled

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/gym-locate-geo-intel-dashboard.git
cd gym-locate-geo-intel-dashboard

# Install dependencies
npm install

# Create environment file
copy .env.example .env.local

# Add your Google Maps API key to .env.local
# GOOGLE_MAPS_API_KEY=your_key_here

# Start development server
npm run dev
```

Open http://localhost:3000 in your browser!

## 🔑 API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable **Places API (New)** (NOT the old Places API)
4. Create API credentials (API Key)
5. Add key to `.env.local`

**Cost**: FREE with $200/month Google Cloud credit!

## 📊 How It Works

### Scoring Formula
```
Total Score = (Demographic × 30%) + (Competitor × 30%) + (Infrastructure × 25%) + (Connectivity × 15%)
```

### POI Analysis
- **Gyms**: Competition level and market saturation
- **Office Buildings**: Demand generators (morning/evening traffic)
- **Cafes/Restaurants**: Lifestyle synergy indicators
- **Transit Stations**: Accessibility (metro + bus)
- **Residential Areas**: Potential customer base

### Sample Output
```
SITE VIABILITY: 87/100 (GOLD MINE)

MARKET GENERATORS: 12
COMPETITORS: 8

Market Gap: OPPORTUNITY
Competition: MEDIUM
```

## 🛠️ Tech Stack

- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite
- **Maps**: Leaflet + React-Leaflet
- **Styling**: CSS (custom design system)
- **APIs**: 
  - Google Places API (New)
  - Google Maps JavaScript API

## 📁 Project Structure

```
gym-locate_-geo-intel-dashboard/
├── src/
│   ├── App.tsx                 # Main application
│   ├── App.css                 # Styles
│   ├── clusterData.ts          # Bangalore ward data
│   └── services/
│       └── placesAPIService.ts # Google Places integration
├── .env.local                  # Your API keys (git-ignored)
├── .env.example                # Template for .env.local
└── vite.config.ts              # Vite configuration
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📝 Environment Variables

Create a `.env.local` file with:

```bash
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

**Security**: Never commit `.env.local` to version control!

## 🐛 Troubleshooting

### Score shows 48 for all wards
- Places API (New) not enabled in Google Cloud
- API key invalid or restricted
- See `TROUBLESHOOTING.md` for detailed fixes

### Map not loading
- Check API key in `.env.local`
- Restart dev server after changing `.env.local`
- Hard refresh browser (Ctrl+Shift+R)

### No POI markers appearing
- Click a ward first to trigger analysis
- Check browser console for API errors
- Verify Places API (New) is enabled (not old Places API)

## 📄 License

MIT License - feel free to use for your projects!

## 👨‍💻 Author

Built with ❤️ for data-driven gym location analysis

## 🙏 Acknowledgments

- Bangalore ward boundary data
- Google Places API for real-time POI data
- React-Leaflet for interactive maps
