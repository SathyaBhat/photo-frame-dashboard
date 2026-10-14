FROM node:22-alpine AS build

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The frame loads the dashboard under /frame/ behind Traefik.
RUN npx vite build --base /frame/

FROM nginx:alpine

COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
