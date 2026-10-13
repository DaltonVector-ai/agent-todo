FROM oven/bun:1.4-slim
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages
COPY migrations ./migrations
RUN bun install --frozen-lockfile
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "run", "packages/cli/src/index.ts", "server"]
