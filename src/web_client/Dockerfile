# Прод-образ веб-клиента: собираем статический бандл и отдаём его nginx.
FROM node:22-alpine AS build
WORKDIR /app
# Не тянуть браузеры Playwright при установке devDeps (нужны только для e2e).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
