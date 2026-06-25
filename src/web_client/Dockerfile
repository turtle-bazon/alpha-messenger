# Прод-образ веб-клиента: собираем статический бандл и отдаём его nginx.
FROM node:22-alpine AS build
WORKDIR /app
# Не тянуть браузеры Playwright при установке devDeps (нужны только для e2e).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# Адрес API вшивается в бандл на этапе сборки. Дефолт — localhost:3000 (локальная
# прод-сборка run/prod). Для публикуемого образа CI передаёт пустую строку →
# относительные URL (запросы на тот же origin, что и страница; см. config.ts).
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
