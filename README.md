# BloomFL

**Decentralized Edge Intelligence using Flower + Gossip Learning**

BloomFL is a production-ready framework for decentralized federated learning on edge devices. It combines the Flower federated learning framework with gossip-based peer-to-peer model aggregation, enabling fully distributed machine learning without central servers.

## 🌟 Key Features

- **Fully Decentralized**: No central server required — nodes discover peers via mDNS and exchange model updates through gossip protocols
- **Edge-Optimized**: Adaptive training schedules based on battery level, thermal state, and system resources
- **Secure by Design**: ECDH key exchange with AES-256-GCM encryption for all peer communications
- **Production-Ready**: Docker deployment, FastAPI dashboard, real-time WebSocket monitoring
- **Flexible Transport**: Supports both TCP and gRPC transports for peer communication
- **Multiple Aggregation Strategies**: Weighted averaging, momentum-based, and partial merge strategies
- **Real-Time Inference**: Built-in YOLO person detection for edge deployment scenarios

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    BloomFL Node                              │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   mDNS       │  │   Gossip     │  │  Adaptation  │      │
│  │  Discovery   │  │   Engine     │  │   Manager    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Flower     │  │   Transport  │  │  Monitoring  │      │
│  │   Client     │  │  (TCP/gRPC)  │  │ (Energy/Thm) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  YOLO Model  │  │    Key       │  │   Metrics    │      │
│  │  (Person)    │  │  Manager     │  │   Logger     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

1. **Node Controller** (`src/bloomfl/node/controller.py`): Orchestrates the entire learning loop
2. **Gossip Engine** (`src/bloomfl/gossip/engine.py`): Manages peer-to-peer model exchange with ECDH encryption
3. **mDNS Discovery** (`src/bloomfl/discovery/mdns.py`): Automatic peer discovery via Zeroconf
4. **Adaptation Manager** (`src/bloomfl/adaptation/manager.py`): Dynamic training schedules based on device state
5. **Transport Layer** (`src/bloomfl/transport/`): Abstract transport interface with TCP and gRPC implementations
6. **Security Layer** (`src/bloomfl/security/`): ECDH key exchange, AES-256-GCM encryption, identity keys
7. **Monitoring** (`src/bloomfl/monitoring/`): Battery, thermal, and energy state monitoring

## 🚀 Quick Start

### Prerequisites

- Python 3.11+
- Docker (optional, for containerized deployment)
- Node.js 18+ (for frontend dashboard)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd BloomFL

# Install Python dependencies
pip install -e .

# Or with development tools
pip install -e ".[dev]"
```

### Running a Single Node

```bash
# Start a node with default settings
bloomfl-node

# Or with custom configuration
bloomfl-node --node-id my-node-001 --port 50051 --transport tcp --log-level INFO
```

### Multi-Node Simulation

```bash
# Run a 5-node simulation for 30 rounds
python -m simulation.runner --num-nodes 5 --rounds 30

# Or use the benchmark CLI
bloomfl-sim --num-nodes 10 --rounds 50 --transport tcp
```

### Docker Deployment

```bash
# Build and run a single node
docker-compose up --build

# Scale to 10 nodes
docker-compose up --build --scale node=10

# With custom environment
BLOOMFL_TRANSPORT=grpc BLOOMFL_GOSSIP_INTERVAL_SECONDS=30 docker-compose up --scale node=5
```

## 📊 Dashboard & API

BloomFL includes a FastAPI-based dashboard for real-time monitoring.

### Starting the API

```bash
# Via Docker Compose (includes both node and API)
docker-compose up

# Or manually
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

### API Endpoints

- `GET /api/nodes` — List all active nodes
- `GET /api/nodes/{node_id}` — Get latest state for a specific node
- `GET /api/nodes/{node_id}/history` — Get historical metrics for a node
- `GET /api/metrics` — Aggregate metrics across all nodes
- `GET /api/config` — View current configuration
- `WebSocket /ws/nodes` — Real-time node updates
- `WebSocket /ws/simulation` — Real-time simulation metrics

### Frontend Dashboard

```bash
cd frontend
npm install
npm run dev
```

The dashboard provides:
- Real-time node status visualization
- Training metrics charts
- Network topology view
- Configuration management

## ⚙️ Configuration

All configuration is managed via environment variables with the `BLOOMFL_` prefix:

### Node Identity

```bash
BLOOMFL_NODE_ID=node-001              # Auto-generated if empty
BLOOMFL_LISTEN_HOST=0.0.0.0
BLOOMFL_LISTEN_PORT=50051
```

### Network & Discovery

```bash
BLOOMFL_TRANSPORT=tcp                 # tcp or grpc
BLOOMFL_MDNS_SERVICE_TYPE=_bloomfl._tcp.local.
BLOOMFL_PEER_ADDRS=["192.168.1.10:50051","192.168.1.11:50051"]  # Static peers
```

### Training

```bash
BLOOMFL_TRAIN_EPOCHS_PER_ROUND=1
BLOOMFL_BATCH_SIZE=64
BLOOMFL_LEARNING_RATE=0.01
BLOOMFL_DATA_DIR=./data
```

### Gossip Protocol

```bash
BLOOMFL_GOSSIP_INTERVAL_SECONDS=10
BLOOMFL_GOSSIP_FAN_OUT=1              # Peers contacted per round
BLOOMFL_GOSSIP_TIMEOUT_SECONDS=15
BLOOMFL_AGGREGATION_STRATEGY=weighted_avg  # weighted_avg, momentum, partial
```

### Adaptation (Edge Optimization)

```bash
BLOOMFL_ADAPTATION_ENABLED=true
BLOOMFL_THERMAL_HIGH_THRESHOLD=80.0        # °C
BLOOMFL_THERMAL_CRITICAL_THRESHOLD=90.0    # °C
BLOOMFL_BATTERY_LOW_THRESHOLD=20.0         # %
BLOOMFL_BATTERY_CRITICAL_THRESHOLD=10.0   # %
```

### Security

```bash
BLOOMFL_GRPC_USE_TLS=false
BLOOMFL_KEY_STORAGE_DIR=./keys
```

### Storage

```bash
BLOOMFL_METRICS_DIR=./metrics
BLOOMFL_DATA_DIR=./data
```

## 🔒 Security Architecture

BloomFL implements end-to-end encryption for all peer communications:

1. **Identity Keys**: Each node has a persistent P-256 identity key pair
2. **Ephemeral Keys**: Fresh ECDH key pairs generated for each gossip round
3. **Encryption**: AES-256-GCM with HKDF-derived keys
4. **Integrity**: SHA-256 hash verification for all payloads

### Key Exchange Protocol

```
Initiator                          Responder
   |                                   |
   |--- ECDH ephemeral pub key ------>|
   |    (encrypted with PSK or        |
   |     responder's identity key)    |
   |                                   |
   |<-- ECDH ephemeral pub key -------|
   |    (encrypted with derived key)  |
   |                                   |
   Both derive shared secret via ECDH
   |                                   |
   |--- Encrypted model weights ------>|
   |<-- Encrypted model weights -------|
```

## 📈 Monitoring & Metrics

Each node logs metrics to JSONL files:

```json
{
  "node_id": "node-001",
  "timestamp": 1234567890.123,
  "round": 5,
  "train_loss": 0.42,
  "train_accuracy": 0.89,
  "val_accuracy": 0.85,
  "energy_state": "HIGH",
  "thermal_state": "NORMAL",
  "battery_percent": 95.2,
  "temperature_celsius": 65.0,
  "gossip_peers": 3,
  "bytes_exchanged": 1048576
}
```

### Metrics Collection

```python
from evaluation.metrics import MetricsCollector

collector = MetricsCollector(metrics_dir="./metrics")
collector.print_report()
summary = collector.summary_report()
```

## 🧪 Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=bloomfl --cov-report=html

# Run specific test categories
pytest -m unit          # Unit tests only
pytest -m integration   # Integration tests (requires network)
pytest -m "not slow"    # Skip slow tests
```

### Test Structure

- `tests/test_config.py` — Configuration validation
- `tests/test_discovery.py` — mDNS discovery
- `tests/test_gossip.py` — Gossip protocol
- `tests/test_transport.py` — Transport layer
- `tests/test_security.py` — Encryption and key management
- `tests/test_integration.py` — End-to-end scenarios

## 🔬 Simulation & Benchmarking

### Local Simulation

```python
from simulation.runner import SimulationRunner

runner = SimulationRunner(
    num_nodes=10,
    rounds=50,
    transport="tcp",
    mean_delay_ms=50.0,      # Simulated network latency
    std_delay_ms=20.0,
    failure_prob=0.05,       # Message drop probability
)

result = runner.run()
print(f"Converged: {result.converged}")
print(f"Wall time: {result.wall_time_seconds:.1f}s")
```

### Benchmark CLI

```bash
# Full benchmark with convergence check
bloomfl-sim \
  --num-nodes 10 \
  --rounds 50 \
  --transport grpc \
  --mean-delay-ms 50 \
  --failure-prob 0.05 \
  --convergence-threshold 0.05 \
  --output-dir ./results
```

## 🎯 Use Cases

1. **Edge AI Deployment**: Train person detection models across distributed cameras
2. **IoT Federated Learning**: Decentralized learning on battery-powered devices
3. **Privacy-Preserving ML**: Keep data on-device, share only model updates
4. **Research Platform**: Experiment with gossip protocols and aggregation strategies

## 🛠️ Development

### Project Structure

```
BloomFL/
├── src/bloomfl/          # Core library
│   ├── adaptation/       # Adaptive training schedules
│   ├── discovery/        # mDNS peer discovery
│   ├── flower_client/    # Flower integration
│   ├── gossip/           # Gossip protocol engine
│   ├── inference/        # YOLO inference
│   ├── models/           # YOLO person model
│   ├── monitoring/       # Energy/thermal monitoring
│   ├── node/             # Node controller
│   ├── security/         # Encryption & keys
│   └── transport/        # TCP/gRPC transports
├── api/                  # FastAPI dashboard
├── frontend/             # Next.js dashboard
├── simulation/           # Multi-node simulation
├── evaluation/          # Benchmarking & metrics
├── tests/               # Test suite
└── docker/              # Docker configuration
```

### Adding New Models

```python
from bloomfl.models import BaseModel

class MyModel(BaseModel):
    def forward(self, x):
        # Your model architecture
        pass

# Use in node controller
model = MyModel().to(device)
```

### Adding New Aggregation Strategies

```python
from bloomfl.gossip.aggregation import aggregate

def my_aggregation(weights_list, samples_list):
    # Custom aggregation logic
    return aggregated_weights

# Register in config
BLOOMFL_AGGREGATION_STRATEGY=my_custom
```

## 📦 Dependencies

### Core
- Python 3.11+
- PyTorch 2.2+
- Flower (flwr) 1.21+
- gRPC 1.62+
- Zeroconf 0.132+

### Optional
- Ultralytics (for YOLO models)
- Memray (for memory profiling)

### Development
- pytest, pytest-cov
- ruff, mypy

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- Follow PEP 8
- Use type hints for all public APIs
- Write docstrings for all modules, classes, and functions
- Run `ruff check .` and `mypy .` before submitting

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- [Flower](https://flower.dev/) - Federated learning framework
- [Ultralytics](https://ultralytics.com/) - YOLO implementation
- [Zeroconf](https://github.com/python-zeroconf/python-zeroconf) - mDNS discovery

## 📞 Support

- GitHub Issues: For bug reports and feature requests
- Documentation: See `docs/` directory (coming soon)
- Examples: See `examples/` directory (coming soon)

---

**Built with ❤️ for decentralized edge intelligence**
