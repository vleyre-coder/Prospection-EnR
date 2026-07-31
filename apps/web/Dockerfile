# Image du frontend, servi par nginx. Construire depuis la RACINE du depot :
#   docker build -f apps/web/Dockerfile -t enr-web .
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN npm ci --workspaces --include-workspace-root

COPY packages/core ./packages/core
COPY apps/web ./apps/web
RUN npm run build -w @enr/core && npm run build -w @enr/web

FROM nginx:1.27-alpine AS production
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=4s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
