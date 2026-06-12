# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy all source files
COPY . .

# ── Build-time vars — proxy URLs and OAuth Client ID only (NO raw API keys)
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_PLACES_PROXY_URL
ARG VITE_GEMINI_PROXY_URL

ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_PLACES_PROXY_URL=$VITE_PLACES_PROXY_URL
ENV VITE_GEMINI_PROXY_URL=$VITE_GEMINI_PROXY_URL

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

# Cloud Run injects PORT (default 8080). serve respects it via -l $PORT.
EXPOSE 8080

# Health check on port 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080',(r)=>{if(r.statusCode!==200)throw new Error(r.statusCode)})"

# Start the Express server
CMD ["node", "server.cjs"]
