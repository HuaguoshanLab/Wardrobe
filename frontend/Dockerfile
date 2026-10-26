FROM node:24.19.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tools/openapi/package.json ./tools/openapi/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.28.2-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
