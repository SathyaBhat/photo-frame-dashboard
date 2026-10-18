FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js weather-map.js ha-map.js energy-map.js calendar-map.js calendar-service.js trello-map.js trello-service.js groceries-route.js ./
USER node
EXPOSE 8080
CMD ["node", "index.js"]
