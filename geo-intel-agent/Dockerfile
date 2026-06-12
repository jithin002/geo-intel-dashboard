FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy agent code
COPY . .

# Expose the Cloud Run injected port (default 8080)
EXPOSE 8080

# Run ADK web server. Bind to 0.0.0.0 for Cloud Run, using the injected $PORT.
CMD npx adk web -h 0.0.0.0 -p ${PORT:-8080}
