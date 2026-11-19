FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

# Les fichiers client sont à la racine du dépôt : on les range dans /app/public
# (server.js attend ce dossier)
RUN mkdir -p public
COPY index.html style.css game.js settings.js account.js shared.js audio.js gfx.js models.js three.min.js ./public/

# Comptes joueurs : fichier /data/accounts.json.
# Sur Fly.io, monte un volume sur /data pour qu'ils survivent aux redéploiements (voir README).
RUN mkdir -p /data
ENV DATA_DIR=/data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
