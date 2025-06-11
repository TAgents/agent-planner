FROM node:jod-alpine

WORKDIR /usr/app

ARG ADDITIONAL_NPM_INSTALL_ARGS

RUN apk add --no-cache tini

COPY package*.json ./
COPY src/ ./src/

RUN npm ci $ADDITIONAL_NPM_INSTALL_ARGS

USER node

ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "src/index.js"]
