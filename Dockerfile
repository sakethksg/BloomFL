# ── BloomFL Node Docker Image ──────────────────────────────────────────────────
#
# Build:
#   docker build -t bloomfl:latest .
#
# Run single node (with static peer list via env):
#   docker run -e BLOOMFL_PEER_ADDRS="192.168.1.10:50051" bloomfl:latest
#
# Scale with docker-compose:
#   docker-compose up --build --scale node=10

FROM python:3.11-slim

# System deps: build tools for grpcio wheels, netcat for health-check
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        netcat-openbsd \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project source
COPY proto/       proto/
COPY scripts/     scripts/
COPY src/         src/
COPY pyproject.toml .

# Install project in editable mode
RUN pip install --no-cache-dir -e .

# Generate gRPC stubs from proto
RUN bash scripts/generate_proto.sh

# Copy entrypoint helper
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Non-root user for security
RUN useradd -m -u 1001 bloomfl && \
    chown -R bloomfl:bloomfl /app && \
    chown bloomfl:bloomfl /entrypoint.sh
USER bloomfl

# Directories used at runtime
RUN mkdir -p /home/bloomfl/.bloomfl/keys \
             /home/bloomfl/.bloomfl/metrics \
             /home/bloomfl/.bloomfl/data

# Environment defaults (can be overridden at run time)
ENV BLOOMFL_TRANSPORT=tcp \
    BLOOMFL_LISTEN_PORT=50051 \
    BLOOMFL_GOSSIP_INTERVAL_SECONDS=15 \
    BLOOMFL_TRAIN_EPOCHS_PER_ROUND=1 \
    BLOOMFL_ADAPTATION_ENABLED=true \
    BLOOMFL_KEY_STORAGE_DIR=/home/bloomfl/.bloomfl/keys \
    BLOOMFL_METRICS_DIR=/home/bloomfl/.bloomfl/metrics \
    BLOOMFL_DATA_DIR=/home/bloomfl/.bloomfl/data

EXPOSE 50051

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD nc -z localhost ${BLOOMFL_LISTEN_PORT:-50051} || exit 1

ENTRYPOINT ["/entrypoint.sh"]
