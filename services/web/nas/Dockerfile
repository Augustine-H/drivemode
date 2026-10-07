FROM node:24-bookworm-slim
WORKDIR /web
COPY app /web/app
COPY start.mjs /web/start.mjs
USER node
CMD ["node", "start.mjs"]
