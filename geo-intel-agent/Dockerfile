FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy agent code
COPY . .

# Expose the Cloud Run injected port (default 8080)
EXPOSE 8080

# Run ADK web server. It natively respects the $PORT env var.
CMD ["npx", "adk", "web"]
