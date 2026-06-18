FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy agent code
COPY . .

# Pre-transpile agent.ts → agent.js using esbuild (TS→JS, no bundling).
# This avoids ADK's runtime bundler probing for ../domains.js (which doesn't
# exist in the container) via the replace-dirname plugin.
RUN ./node_modules/.bin/esbuild agent.ts \
      --platform=node \
      --format=esm \
      --target=es2020 \
      --outfile=agent.js \
  && rm agent.ts

# Expose the Cloud Run injected port (default 8080)
EXPOSE 8080

# Run ADK web server. Bind to 0.0.0.0 for Cloud Run, using the injected $PORT.
CMD npx adk web -h 0.0.0.0 -p ${PORT:-8080}
