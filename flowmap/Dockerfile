FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
