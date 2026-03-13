#!/bin/bash
# Quick deployment script for GCP Cloud Run
# Run this from your project root: bash deploy-gcp.sh

set -e

echo "🚀 Starting GCP Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get GCP Project ID
PROJECT_ID=$(gcloud config get-value project)
if [ -z "$PROJECT_ID" ]; then
  echo -e "${RED}❌ Error: GCP project not set${NC}"
  echo "Run: gcloud config set project PROJECT_ID"
  exit 1
fi

echo -e "${GREEN}✓ Using project: $PROJECT_ID${NC}"

# Step 1: Enable required APIs
echo -e "\n${YELLOW}📡 Enabling GCP APIs...${NC}"
gcloud services enable \
  containerregistry.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com

# Step 2: Build Docker image
echo -e "\n${YELLOW}🐳 Building Docker image...${NC}"
docker build -t gcr.io/${PROJECT_ID}/geo-intel-dashboard:latest .

# Step 3: Push to Container Registry
echo -e "\n${YELLOW}📤 Pushing image to Container Registry...${NC}"
docker push gcr.io/${PROJECT_ID}/geo-intel-dashboard:latest

# Step 4: Deploy to Cloud Run
echo -e "\n${YELLOW}☁️  Deploying to Cloud Run...${NC}"
gcloud run deploy geo-intel-dashboard \
  --image gcr.io/${PROJECT_ID}/geo-intel-dashboard:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --set-env-vars VITE_GEMINI_API_KEY=${VITE_GEMINI_API_KEY},VITE_API_KEY=${VITE_API_KEY},VITE_GOOGLE_MAPS_API_KEY=${VITE_GOOGLE_MAPS_API_KEY}

# Step 5: Get service URL
echo -e "\n${YELLOW}🔗 Getting service URL...${NC}"
SERVICE_URL=$(gcloud run services describe geo-intel-dashboard \
  --platform managed \
  --region us-central1 \
  --format='value(status.url)')

echo -e "\n${GREEN}✅ Deployment successful!${NC}"
echo -e "${GREEN}🌐 Your app is live at: ${SERVICE_URL}${NC}"
echo -e "\n${YELLOW}📊 View logs:${NC}"
echo "gcloud run services logs read geo-intel-dashboard --platform managed --region us-central1 --limit 50"
