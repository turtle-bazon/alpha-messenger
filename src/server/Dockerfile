FROM node:22-alpine AS build
ARG GIT_HASH=dev
ENV GIT_HASH=${GIT_HASH}
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ARG GIT_HASH=dev
ENV GIT_HASH=${GIT_HASH}
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
