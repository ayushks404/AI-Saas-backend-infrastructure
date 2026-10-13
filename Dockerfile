# ==========================================
# STAGE 1: BUILDER (Compilation Environment)
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests first to leverage Docker layer caching
# Dependency installation will only re-run if package*.json changes
COPY package*.json ./

# Install ALL dependencies (including devDependencies required for compilation)
RUN npm ci

# Copy TypeScript configuration and source code
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript into JavaScript (output to dist/)
RUN npm run build

# ==========================================
# STAGE 2: PRODUCTION (Minimal Runtime)
# ==========================================
FROM node:20-alpine

WORKDIR /app

# Security: Create non-root system user and group
# Prevents container breakout vulnerabilities from gaining host root access
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy package manifests for production install
COPY package*.json ./

# Install ONLY production dependencies and purge npm cache to minimize image footprint
RUN npm ci --omit=dev && npm cache clean --force

# Copy ONLY the compiled artifacts from the builder stage
# Excludes TypeScript source, test files, and developer tooling
COPY --from=builder /app/dist ./dist/

# Create application directories and assign ownership to unprivileged user
RUN mkdir -p logs && chown -R appuser:appgroup /app

# Switch execution context to non-root user
USER appuser

# Document exposed application port
EXPOSE 3000

# Container entrypoint
CMD ["node", "dist/server.js"]
