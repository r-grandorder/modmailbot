FROM node:24-alpine

WORKDIR /usr/src/bot

# Install dependencies against the committed lockfile. Native modules (sqlite3, mysql2) compile
# from source on Alpine/musl, so the toolchain is added and removed within one RUN layer to keep
# the image small. patches/ must be present before npm ci so the postinstall step (patch-package)
# can apply the eris patch.
COPY package.json package-lock.json ./
COPY patches ./patches
RUN apk add --no-cache --virtual .build python3 build-base git \
    && npm ci \
    && apk del .build

# Copy the rest of the bot. node_modules and config are excluded via .dockerignore.
COPY . .

# config.ini is expected to be mounted at runtime (see the README / workflow notes).
CMD ["node", "./src/index.js"]
