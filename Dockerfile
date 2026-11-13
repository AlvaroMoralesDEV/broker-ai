# Imagen de la aplicación: compila la web y ejecuta el servidor con Node (TypeScript nativo).
FROM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY shared ./shared
COPY data/rates.json ./data/rates.json
RUN npx vite build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY data/rates.json ./data/rates.json
COPY --from=web /app/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server/index.ts"]
