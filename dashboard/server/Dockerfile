FROM node:22-alpine
WORKDIR /app
COPY package.json index.js weather-map.js ha-map.js energy-map.js ./
USER node
EXPOSE 8080
CMD ["node", "index.js"]
