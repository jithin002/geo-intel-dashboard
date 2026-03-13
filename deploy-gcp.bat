@echo off
REM Quick deployment script for GCP Cloud Run (Windows)
REM Run this from your project root: deploy-gcp.bat

echo.
echo 🚀 Starting GCP Deployment...
echo.

REM Get GCP Project ID
for /f %%i in ('gcloud config get-value project') do set PROJECT_ID=%%i

if "%PROJECT_ID%"=="" (
  echo ❌ Error: GCP project not set
  echo Run: gcloud config set project PROJECT_ID
  exit /b 1
)

echo ✓ Using project: %PROJECT_ID%

REM Step 1: Enable required APIs
echo.
echo 📡 Enabling GCP APIs...
call gcloud services enable ^
  containerregistry.googleapis.com ^
  run.googleapis.com ^
  cloudbuild.googleapis.com

REM Step 2: Build Docker image
echo.
echo 🐳 Building Docker image...
call docker build -t gcr.io/%PROJECT_ID%/geo-intel-dashboard:latest .

if errorlevel 1 (
  echo ❌ Docker build failed
  exit /b 1
)

REM Step 3: Push to Container Registry
echo.
echo 📤 Pushing image to Container Registry...
call docker push gcr.io/%PROJECT_ID%/geo-intel-dashboard:latest

if errorlevel 1 (
  echo ❌ Docker push failed
  exit /b 1
)

REM Step 4: Deploy to Cloud Run
echo.
echo ☁️  Deploying to Cloud Run...
call gcloud run deploy geo-intel-dashboard ^
  --image gcr.io/%PROJECT_ID%/geo-intel-dashboard:latest ^
  --platform managed ^
  --region us-central1 ^
  --allow-unauthenticated ^
  --memory 512Mi ^
  --cpu 1 ^
  --set-env-vars VITE_GEMINI_API_KEY=%VITE_GEMINI_API_KEY%,VITE_API_KEY=%VITE_API_KEY%,VITE_GOOGLE_MAPS_API_KEY=%VITE_GOOGLE_MAPS_API_KEY%

if errorlevel 1 (
  echo ❌ Cloud Run deployment failed
  exit /b 1
)

REM Step 5: Get service URL
echo.
echo 🔗 Getting service URL...
for /f %%i in ('gcloud run services describe geo-intel-dashboard --platform managed --region us-central1 --format="value(status.url)"') do set SERVICE_URL=%%i

echo.
echo ✅ Deployment successful!
echo 🌐 Your app is live at: %SERVICE_URL%
echo.
echo 📊 View logs:
echo gcloud run services logs read geo-intel-dashboard --platform managed --region us-central1 --limit 50
echo.
pause
