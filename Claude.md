
# CLAUDE.md

# Autonomous Execution Instructions for Claude Sonnet 4.6

## Project: Decentralized Edge Intelligence using Flower + Gossip Learning : BloomFL

---

# 1. Role Definition

You are Claude Sonnet 4.6 acting as a **senior distributed systems engineer, ML engineer, and edge systems architect**.

Your task is to autonomously design, implement, integrate, test, and deploy a fully decentralized edge intelligence system using:

* Flower (FLWR)
* Gossip-based decentralized aggregation
* Energy-aware adaptive learning
* Secure P2P communication
* No central server

This system must match the architecture described in the project documentation, including:

* Local sensing
* Local training
* Peer-to-peer parameter exchange
* Hybrid federated gossip aggregation
* Energy-aware adaptation
* Continuous learning loop 

You must produce **production-grade, executable code**.

---

# 2. Non-Negotiable Requirements

You MUST follow these rules:

DO:

* Write complete working code
* Use Python 3.11+
* Use Flower (flwr >= 1.8)
* Use PyTorch for ML models
* Use TCP sockets or gRPC for P2P
* Use AES-256-GCM encryption
* Use modular architecture
* Write reusable components
* Write clean, readable, maintainable code
* Test each module before integration
* Ensure full decentralization

DO NOT:

* Use pseudocode
* Leave placeholders
* Use mock implementations
* Depend on a central Flower server
* Break modularity
* Skip integration testing

---

# 3. Execution Strategy

You MUST execute implementation in this exact order:

Phase 1: Repository Initialization
Phase 2: Flower Client Implementation
Phase 3: ML Model Implementation
Phase 4: Gossip Communication Layer
Phase 5: Peer Discovery
Phase 6: Gossip Aggregation Engine
Phase 7: Networking Transport Layer
Phase 8: Security Layer
Phase 9: Energy Monitoring
Phase 10: Thermal Monitoring
Phase 11: Adaptation Manager
Phase 12: Node Controller
Phase 13: Full System Integration
Phase 14: Multi-node Simulation
Phase 15: Evaluation Framework
Phase 16: Docker Deployment

You MUST complete each phase fully before moving forward.

---

# 4. System Architecture

Each node must contain:

```text
Edge Node
│
├── Flower Client
├── PyTorch Model
├── Gossip Engine
├── Peer Discovery
├── Secure Transport Layer
├── Energy Monitor
├── Thermal Monitor
├── Adaptation Manager
└── Node Controller
```

Each node acts as:

* Flower client
* Gossip peer
* Aggregator
* Learner

No central server exists.

---

# 5. Flower Integration Requirements

You MUST use Flower ONLY as:

* Training abstraction
* Parameter interface
* Model lifecycle manager

You MUST NOT use:

fl.server.start_server()

Aggregation must be done via gossip.

Flower client must implement:

```python
get_parameters()
fit()
evaluate()
set_parameters()
```

---

# 6. Gossip Aggregation Requirements

You MUST implement decentralized aggregation.

Each node must:

* Select random peer
* Exchange parameters
* Merge parameters
* Update local model

Aggregation algorithm must support:

* Weighted averaging
* Momentum merging
* Partial parameter merging

---

# 7. Networking Requirements

You MUST implement:

Transport layer supporting:

* TCP sockets (required)
* gRPC (optional enhancement)

Must support:

* Peer connection
* Parameter exchange
* Failure handling
* Timeout handling

---

# 8. Security Requirements

You MUST implement:

AES-256-GCM encryption for:

* Parameter exchange
* Peer communication

Key management must include:

* Key generation
* Key storage
* Secure exchange

No plaintext parameter transmission allowed.

---

# 9. Energy and Thermal Adaptation Requirements

You MUST implement:

Energy monitoring using:

* psutil
* system sensors

Thermal monitoring using:

* Linux thermal interface
* CPU temperature sensors

Adaptation manager must dynamically adjust:

* Training frequency
* Gossip frequency
* Compute intensity

Example adaptation logic:

If temperature high → reduce training
If battery low → reduce gossip
If energy sufficient → increase training

---

# 10. Node Lifecycle Requirements

Each node must execute continuous learning loop:

```python
while True:

    monitor energy

    monitor temperature

    train model locally using Flower client

    select gossip peer

    exchange parameters

    aggregate parameters

    update model

    adapt learning parameters

    sleep
```

This loop must run indefinitely.

---

# 11. Simulation Requirements

You MUST implement multi-node simulation supporting:

* 10–100 nodes
* Independent node processes
* Real network communication
* Failure simulation
* Network delay simulation

Simulation must validate convergence.

---

# 12. Evaluation Requirements

You MUST measure:

* Model accuracy
* Convergence speed
* Network overhead
* Energy efficiency
* Fault tolerance

You MUST implement benchmarking scripts.

---

# 13. Deployment Requirements

You MUST implement Docker deployment.

Each container represents one node.

Deployment must support:

docker-compose scaling

Example:

```bash
docker-compose up --scale node=10
```

---

# 14. Code Quality Requirements

All code must be:

Production-grade
Modular
Fully functional
Tested
Maintainable

Use:

* Type hints
* Clear naming
* Proper structure

---

# 15. Autonomous Execution Rules

You MUST:

* Implement fully working modules
* Integrate modules progressively
* Test modules continuously
* Fix bugs immediately
* Ensure full system functionality

You MUST NOT:

* Ask unnecessary questions
* Stop midway
* Produce incomplete code

Make reasonable engineering decisions autonomously.

---

# 16. Final Deliverable Requirements

You MUST produce:

Fully working decentralized Flower-based federated gossip learning system including:

* Flower client implementation
* Gossip aggregation engine
* Secure networking layer
* Energy-aware adaptation
* Multi-node simulation
* Evaluation framework
* Docker deployment

System must run successfully.

---

# 17. Definition of Completion

The project is complete when:

* Multiple nodes run independently
* Nodes exchange parameters via gossip
* Model converges
* No central server exists
* Energy adaptation works
* Secure communication works
* System runs in Docker

---

# 18. Execution Priority

Priority order:

Correctness > Stability > Security > Scalability > Performance

---


