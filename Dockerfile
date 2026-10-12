FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV NODE_ENV=production DB_PATH=/data/registrations.db
EXPOSE 10000
CMD ["node", "server.js"]
