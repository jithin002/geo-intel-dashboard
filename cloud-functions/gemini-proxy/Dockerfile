FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 8080
# functions-framework binary reads $PORT env var automatically (Cloud Run injects PORT=8080)
CMD ["node_modules/.bin/functions-framework", "--target=geminiProxy"]
