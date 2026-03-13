# GCP Deployment Guide for Geo-Intel Dashboard

## ✅ Prerequisites

1. **Google Cloud Account** - [Create free account](https://cloud.google.com) (includes $300 free credits)
2. **GCP Project** - Create a new project in GCP Console
3. **gcloud CLI** - [Install gcloud](https://cloud.google.com/sdk/docs/install)
4. **Docker** - [Install Docker](https://www.docker.com/products/docker-desktop) (if testing locally)

---

## 🔧 Step 1: Set Up GCP Project

### 1.1 Create/Select a Project
```bash
# List existing projects
gcloud projects list

# Create new project
gcloud projects create geo-intel-dashboard --name="Geo Intel Dashboard"

# Set as active project
gcloud config set project geo-intel-dashboard
```

### 1.2 Enable Required APIs
```bash
# Enable Container Registry (for storing Docker images)
gcloud services enable containerregistry.googleapis.com

# Enable Cloud Run (for running containers)
gcloud services enable run.googleapis.com

# Enable Cloud Build (for automated builds)
gcloud services enable cloudbuild.googleapis.com

# Enable Artifact Registry (alternative to Container Registry)
gcloud services enable artifactregistry.googleapis.com
```

### 1.3 Set Up Authentication
```bash
gcloud auth login
gcloud config set project geo-intel-dashboard
```

---

## 🐳 Step 2: Build Docker Image Locally (Optional - for testing)

```bash
# Build the image
docker build -t geo-intel-dashboard:latest .

# Test locally
docker run -p 3000:3000 -e VITE_GEMINI_API_KEY=your_key geo-intel-dashboard:latest

# Visit http://localhost:3000
```

---

## ☁️ Step 3: Deploy to GCP Cloud Run (Easiest Option)

### 3.1 Deploy Directly from GitHub (Recommended)

```bash
# Enable the Cloud Build API
gcloud services enable cloudbuild.googleapis.com

# Deploy from source code
gcloud run deploy geo-intel-dashboard \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars VITE_GEMINI_API_KEY=your_key_here,VITE_API_KEY=your_key_here,VITE_GOOGLE_MAPS_API_KEY=your_key_here
```

### 3.2 OR: Deploy from Docker Image (Container Registry)

**Step 1: Build and push image to GCP Container Registry**
```bash
# Set project ID
PROJECT_ID=$(gcloud config get-value project)

# Build and tag image
docker build -t gcr.io/${PROJECT_ID}/geo-intel-dashboard:latest .

# Push to Container Registry
docker push gcr.io/${PROJECT_ID}/geo-intel-dashboard:latest
```

**Step 2: Deploy from Container Registry**
```bash
gcloud run deploy geo-intel-dashboard \
  --image gcr.io/${PROJECT_ID}/geo-intel-dashboard:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --set-env-vars VITE_GEMINI_API_KEY=your_key_here,VITE_API_KEY=your_key_here,VITE_GOOGLE_MAPS_API_KEY=your_key_here
```

---

## 🔐 Step 4: Manage Environment Variables Securely

### Option A: Secret Manager (More Secure) ⭐

```bash
# Store API keys in Secret Manager
gcloud secrets create gemini-api-key --data-file=- <<< "your_api_key_here"
gcloud secrets create google-maps-api-key --data-file=- <<< "your_api_key_here"

# Grant Cloud Run service access
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe ${PROJECT_ID} --format='value(projectNumber)')

gcloud secrets add-iam-policy-binding gemini-api-key \
  --member=serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com \
  --role roles/secretmanager.secretAccessor

# Deploy with secrets
gcloud run deploy geo-intel-dashboard \
  --image gcr.io/${PROJECT_ID}/geo-intel-dashboard:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars VITE_GEMINI_API_KEY=your_key \
  --update-secrets VITE_GEMINI_API_KEY=gemini-api-key:latest
```

### Option B: Cloud Run Environment Variables (Simple)

Set directly in the deployment command (shown above)

---

## 📊 Step 5: Verify Deployment

```bash
# Check if service is running
gcloud run services list

# Get service URL
gcloud run services describe geo-intel-dashboard --platform managed --region us-central1

# Check logs
gcloud run services logs read geo-intel-dashboard --platform managed --region us-central1 --limit 50

# Monitor metrics
gcloud monitoring time-series list --filter='resource.type=cloud_run_revision'
```

---

## 🚀 Step 6: Set Up CI/CD (Auto-deploy on push)

Create file: `.github/workflows/deploy.yml`

```yaml
name: Deploy to GCP Cloud Run

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Set up Cloud SDK
      uses: google-github-actions/setup-gcloud@v0
      with:
        project_id: ${{ secrets.GCP_PROJECT_ID }}
        service_account_key: ${{ secrets.GCP_SA_KEY }}
    
    - name: Deploy to Cloud Run
      run: |
        gcloud run deploy geo-intel-dashboard \
          --source . \
          --platform managed \
          --region us-central1 \
          --allow-unauthenticated \
          --set-env-vars VITE_GEMINI_API_KEY=${{ secrets.VITE_GEMINI_API_KEY }}
```

---

## 💰 Cost Estimation

**Cloud Run (Pay-as-you-go):**
- Free tier: 2M requests/month, 360K GB-seconds/month
- After: ~$0.24 per 1M requests + $0.00001667/GB-second

**For small-medium traffic:** Usually FREE or <$10/month

---

## 🐛 Troubleshooting

### Issue: "Port must be defined by PORT env variable"
**Solution:** Cloud Run expects app to listen on PORT env var
```bash
# Update your app to use process.env.PORT || 3000
# Already handled by 'serve' in Dockerfile
```

### Issue: "Permission denied" errors
**Solution:** Grant permissions
```bash
gcloud auth configure-docker
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member=serviceAccount:SA_EMAIL \
  --role=roles/viewer
```

### Issue: Image build fails
**Solution:** Check build logs
```bash
gcloud builds log $(gcloud builds list --limit 1 --format='value(id)')
```

---

## 📱 Final URL

After deployment, your app will be live at:
```
https://geo-intel-dashboard-RANDOM_ID.run.app
```

Visit this URL to access your app publicly! 🎉

---

## 🔄 Update Deployment

To deploy new changes:

```bash
# Just push to GitHub (if using CI/CD)
git push origin main

# OR manually redeploy
gcloud run deploy geo-intel-dashboard \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

---

## Advanced: App Engine (Standard/Flexible)

If you prefer App Engine instead of Cloud Run:

```bash
# Deploy using app.yaml
gcloud app deploy

# View logs
gcloud app logs read -n 100
```

---

**Need help? Run:** `gcloud run deploy --help`
