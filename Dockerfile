# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy all source files
COPY . .

# ── Build-time vars — OAuth Client ID is public, safe to hardcode as default
ARG VITE_GOOGLE_CLIENT_ID=1044649363322-f69qn7em417sa27od5edf78l4brbm6ai.apps.googleusercontent.com
ARG VITE_GEMINI_PROXY_URL

ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_GEMINI_PROXY_URL=$VITE_GEMINI_PROXY_URL

# NOTE: GOOGLE_MAPS_API_KEY is injected at RUNTIME via Cloud Run --set-env-vars
# It is NOT baked into the image. The Express server reads it from process.env.

# Build the production bundle
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20-slim

ENV NODE_ENV=production

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy server code
COPY server.cjs ./

# Copy only the compiled static files
COPY --from=builder /app/dist ./dist

# Cloud Run injects PORT (default 8080). Our Express server reads process.env.PORT.
EXPOSE 8080

# Health check on port 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080',(r)=>{if(r.statusCode>=500)throw new Error(r.statusCode)})"

# Start the Express server
CMD ["node", "server.cjs"]
