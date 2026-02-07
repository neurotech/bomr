FROM node:22-slim

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files and install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source files
COPY src ./src

# Create downloads directory
RUN mkdir -p /app/downloads

EXPOSE 7777

CMD ["pnpm", "serve"]
