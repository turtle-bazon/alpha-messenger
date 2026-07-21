FROM node:22-alpine AS server-build
ARG GIT_HASH=dev
ENV GIT_HASH=${GIT_HASH}
WORKDIR /app
COPY src/server/package.json src/server/package-lock.json* ./
RUN npm install
COPY src/server/tsconfig.json ./
COPY src/server/src ./src
RUN npm run build

FROM node:22-alpine AS client-build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY src/web_client/package.json src/web_client/package-lock.json* ./
RUN npm ci
COPY src/web_client .
ARG BUILD_HASH=dev
ENV BUILD_HASH=$BUILD_HASH
RUN npm run build

FROM node:22-alpine
ARG GIT_HASH=dev
ENV GIT_HASH=${GIT_HASH}
WORKDIR /app
COPY src/server/package.json src/server/package-lock.json* ./
RUN npm install --omit=dev
COPY --from=server-build /app/dist ./dist
COPY src/server/migrations ./migrations
# Файлы веб-клиента для Android-обновлений (/mobile-client/manifest.json, /mobile-client/assets/...).
COPY --from=client-build /app/dist /app/mobile-client
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
