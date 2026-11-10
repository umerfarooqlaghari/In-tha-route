# InThaRoute API
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first so this layer is cached between code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Run as the unprivileged user that ships with the image.
USER node

# Render injects PORT at runtime; 5000 is only the local default.
EXPOSE 5000

CMD ["node", "src/server.js"]
