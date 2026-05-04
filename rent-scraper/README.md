# Rent Intelligence Scraper

Local Python pipeline to collect Bengaluru commercial property listings,
clean the data, and prepare it for BigQuery upload.

## Folder Structure

```
rent-scraper/
├── scraper.py        ← Step 1: Collects raw listings from MagicBricks
├── cleaner.py        ← Step 2: Cleans and normalises the CSV
├── uploader.py       ← Step 3: Pushes clean data to BigQuery (coming next)
├── data/
│   ├── raw_listings.csv     (auto-created by scraper)
│   └── cleaned_listings.csv (auto-created by cleaner)
└── README.md
```

## Setup

```bash
# 1. Navigate into the folder
cd rent-scraper

# 2. Create a virtual environment
python -m venv venv
venv\Scripts\activate        # Windows

# 3. Install dependencies
pip install playwright pandas
playwright install chromium
```

## Usage

### Step 1 — Scrape
```bash
python scraper.py
```
- Runs a headless Chromium browser against MagicBricks Bengaluru commercial listings
- Iterates through up to 10 pages
- Saves raw data to `data/raw_listings.csv`

### Step 2 — Clean
```bash
python cleaner.py
```
- Parses Indian currency and area formats
- Computes `price_per_sqft`
- Classifies listings by domain (Retail, Office, Restaurant, Bank, Gym)
- Removes outliers
- Saves cleaned data to `data/cleaned_listings.csv`
- Prints a locality-wise summary table to the terminal

### Step 3 — Upload (Coming Next)
```bash
python uploader.py
```
- Pushes the cleaned DataFrame to BigQuery

## Notes
- Do **not** run the scraper too aggressively. The default delay is 1.5–3.5 seconds per page.
- If MagicBricks blocks the scraper, try reducing `MAX_PAGES` or adding longer delays.
