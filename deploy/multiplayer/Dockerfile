FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist-server/space-sim-server.cjs ./server.cjs
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 6464
CMD ["node", "server.cjs", "--data", "/data", "--host", "0.0.0.0"]
