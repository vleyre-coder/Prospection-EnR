# Image de l'API, interface incluse. Construire depuis la RACINE du depot :
#   docker build -f apps/api/Dockerfile -t enr-api .
#
# L'interface est embarquee et servie par l'API : l'image est ainsi autosuffisante, et un
# hebergeur ne demandant qu'un service (Render, Railway, Fly, un VPS) suffit a deployer
# l'application entiere sous une seule URL. La pile docker-compose place malgre tout nginx
# devant, pour la compression et le cache d'en-tetes.
FROM node:22-alpine AS build
WORKDIR /app

# Les manifestes d'abord : la couche d'installation est ainsi mise en cache tant que les
# dependances ne changent pas.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/scoring/package.json packages/scoring/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspaces --include-workspace-root --omit=dev=false

COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/web ./apps/web
RUN npm run build -w @enr/core \
 && npm run build -w @enr/scoring \
 && npm run build -w @enr/api \
 && npm run build -w @enr/web

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Les migrations sont embarquees : le conteneur sait initialiser sa propre base.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/scoring/package.json ./packages/scoring/
COPY --from=build /app/packages/scoring/dist ./packages/scoring/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
# Interface : `repertoireInterface()` cherche `dist/public` a cote des routes compilees.
COPY --from=build /app/apps/web/dist ./apps/api/dist/public
COPY db ./db

# Repertoire des rasters ingeres (gisement de vent), monte en volume par compose.
# Cree ici avec le bon proprietaire : le conteneur ne tourne pas en root.
RUN mkdir -p /app/donnees && chown -R node:node /app/donnees

USER node
EXPOSE 3000

# Verification de sante : l'orchestrateur doit savoir si l'API repond ET si la base suit.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/sante').then(r=>r.json()).then(d=>process.exit(d.baseDeDonnees==='ok'?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/api
CMD ["node", "dist/serveur.js"]
