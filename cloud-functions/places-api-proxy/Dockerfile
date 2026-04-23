FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
# Functions Framework auto-detects PORT env var injected by Cloud Run
CMD ["node", "--max-old-space-size=256", "node_modules/@google-cloud/functions-framework/build/src/index.js", "--target=placesApiProxy", "--port=8080"]
