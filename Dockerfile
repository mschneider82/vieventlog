# Multi-stage Dockerfile for ViEventLog (Container/Server Build)
# Uses nokeyring build variant for minimal dependencies

FROM golang:1.25-bookworm AS builder

WORKDIR /build

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build with nokeyring tag (no CGO, no keyring dependencies)
RUN CGO_ENABLED=0 go build -tags nokeyring -ldflags="-s -w" -o vieventlog .

# Runtime stage - minimal image
FROM debian:bookworm-slim

# Install ca-certificates for HTTPS API calls
RUN apt-get update && \
    apt-get install -y ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash vieventlog

# Create config directory
RUN mkdir -p /config && chown vieventlog:vieventlog /config

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/vieventlog /app/vieventlog

# Set ownership
RUN chown vieventlog:vieventlog /app/vieventlog

# Switch to non-root user
USER vieventlog

# Expose default port
EXPOSE 5000

# Volume for config file storage (when using CREDENTIAL_STORAGE=file)
VOLUME ["/config"]

# Environment variables (can be overridden)
ENV BIND_ADDRESS=0.0.0.0:5000
ENV VICARE_CONFIG_DIR=/config

# Run the application
CMD ["/app/vieventlog"]
