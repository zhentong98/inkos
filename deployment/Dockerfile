FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @actalk/inkos-core build && pnpm --filter @actalk/inkos-studio build && pnpm --filter @actalk/inkos build
RUN pnpm --filter @actalk/inkos deploy --prod --legacy /out
RUN cd deployment && npm ci --omit=dev && npm test

FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/zhentong98/inkos" org.opencontainers.image.revision=$SOURCE_REVISION
ENV NODE_ENV=production INKOS_STUDIO_PORT=4567 INKOS_PROJECT_ROOT=/data HOME=/data/.home
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /src/deployment /opt/inkos-deployment
USER node
ENTRYPOINT ["/bin/sh", "/opt/inkos-deployment/entrypoint.sh"]
