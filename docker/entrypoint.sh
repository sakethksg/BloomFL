#!/usr/bin/env bash
# entrypoint.sh — Auto-assigns a unique port per container using the
# BLOOMFL_NODE_INDEX environment variable (set by docker-compose or the
# orchestrator) and starts the BloomFL node.
#
# With network_mode: host, each replica needs a distinct listen port.
# Ports are assigned sequentially from 50050:
#   node 0 → 50050, node 1 → 50051, node 2 → 50052, …

set -euo pipefail

# Use BLOOMFL_NODE_INDEX if set; fall back to 0 (single-node case)
BLOOMFL_NODE_INDEX="${BLOOMFL_NODE_INDEX:-0}"
AUTO_PORT=$(( 50050 + BLOOMFL_NODE_INDEX ))
export BLOOMFL_LISTEN_PORT="${BLOOMFL_LISTEN_PORT:-$AUTO_PORT}"

echo "[entrypoint] NodeIndex=${BLOOMFL_NODE_INDEX} Port=${BLOOMFL_LISTEN_PORT}"

# If BLOOMFL_PEER_ADDRS is not set, let mDNS discovery do its work.
exec python -m bloomfl "$@"
