# 🚦 Distributed Rate Limiter

[![TypeScript](https://img.shields.io/badge/TypeScript-85.4%25-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-v10-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Redis](https://img.shields.io/badge/Redis-7--alpine-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A production-grade, Redis-backed distributed rate limiter built with **NestJS + Fastify**. Supports three industry-standard algorithms — **Fixed Window**, **Sliding Window**, and **Token Bucket** — enforced atomically via **Redis Lua scripts** with an algorithm-aware **circuit-breaker fallback** for Redis outages.

---

## ✨ Key Features

- **3 Rate-Limiting Algorithms**: Fixed window, sliding window, and token bucket, selectable via a single `@RateLimit()` decorator.
- **Atomic Redis Enforcement**: Each algorithm is implemented as a Lua script for race-condition-free, O(1) atomic operations.
- **Circuit Breaker + Fallback**: In-memory fallback during Redis outages. The fallback is *algorithm-aware*, matching your configured rate-limit strategy.
- **Observability**: Prometheus metrics and a pre-built Grafana dashboard for real-time monitoring.
- **High Availability (HA)**: Redis Sentinel setup (primary + 2 replicas + 3 sentinels) with 30-second auto-failover.
- **Load Testing**: Pre-configured k6 scripts validating burst and sustained traffic patterns.
- **One-Command Deployment**: Fully containerized with Docker Compose (single-node and HA modes).

---

## 🏗️ Architecture

```mermaid
flowchart TD
    Client(["👤 Client"]) -->|HTTP Request| API["🚀 NestJS API"]
    
    subgraph App ["Application Layer"]
        API --> Guard["🛡️ @RateLimit Guard"]
        Guard -->|Selects| Algo["⚙️ Rate Limit Strategy\n(Fixed / Sliding / Token)"]
        Algo --> CB{"🔌 Circuit Breaker"}
        
        CB -- "Redis Down" --> Fallback["💾 In-Memory Fallback\n(Algorithm Aware)"]
    end
    
    subgraph Infrastructure ["Data & HA Layer"]
        CB -- "Redis Up" --> Lua["📜 Redis Lua Scripts\n(Atomic Execution)"]
        Lua --> Primary[("🔴 Redis Primary")]
        Primary -.-> Replica1[("🔄 Redis Replica 1")]
        Primary -.-> Replica2[("🔄 Redis Replica 2")]
    end
    
    subgraph Observability ["Observability Stack"]
        Prometheus(["📈 Prometheus"]) -.->|"Scrapes /metrics"| API
        Grafana(["📊 Grafana"]) -.->|"Reads"| Prometheus
    end
```

---

## 🔬 Algorithm Comparison

| Algorithm | How It Works | Pros | Cons | Best For |
|---|---|---|---|---|
| **Fixed Window** | Counts requests in fixed time windows. | Simple, low memory footprint. | Bursts at window boundaries can briefly allow 2× the limit. | Simple API rate limiting. |
| **Sliding Window** | Tracks individual request timestamps in a sorted set. | Smooth, precise rate enforcement. | Higher memory usage (stores timestamps). | Strict rate enforcement. |
| **Token Bucket** | Tokens refill at a steady rate; each request consumes a token. | Allows controlled bursts while maintaining average rate. | Slightly more complex state. | APIs needing burst tolerance. |

All three are implemented as **atomic Lua scripts** executed directly on Redis, ensuring thread safety across distributed instances with zero race conditions.

---

## 🛡️ Circuit Breaker

The circuit breaker protects the application from cascading failures during Redis outages:

```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Open : Redis failure threshold reached
    Open --> HalfOpen : Timeout expires
    HalfOpen --> Closed : Redis responds successfully
    HalfOpen --> Open : Redis still down
```

**Key design decision**: The in-memory fallback is *algorithm-aware*. If your endpoint uses a token bucket strategy, the in-memory fallback will also use token bucket logic (not just a generic counter), ensuring a consistent API contract during outages.

---

## 📡 API Endpoints

| Route | Algorithm | Default Policy |
|---|---|---|
| `GET /fixed` | Fixed Window | `10 requests / 60 seconds` |
| `GET /sliding` | Sliding Window | `10 requests / 60 seconds` |
| `GET /token` | Token Bucket | `10 tokens / 60 seconds` |
| `GET /health` | — | Health check |
| `GET /metrics` | — | Prometheus scrape endpoint |

### Rate-Limit Response Headers
Every rate-limited response includes standard headers:
```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1717891200
Retry-After: 45
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 20+ & npm
- Docker & Docker Compose

### Option 1: Docker Compose (Recommended)

**Single-node setup** (App + Redis + Prometheus + Grafana):
```bash
docker compose up --build
```
- App: `http://localhost:3000`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001` (admin / admin)

**High-Availability setup** (Adds Redis Sentinel cluster):
```bash
docker compose -f docker-compose.ha.yml up --build -d
```
*Note: You can test failover by running `docker compose -f docker-compose.ha.yml stop redis-primary`.*

### Option 2: Run Directly

```bash
npm install
npm run start:dev
```

---

## 📊 Observability & Testing

### Grafana Dashboard
The bundled dashboard (`docker/grafana/`) visualizes:
- Request decisions per second (allowed vs rejected)
- Redis Lua script latency (p95) by algorithm
- Circuit breaker state transitions
- Fallback request rate

### Load Testing with k6
Validate burst behavior, HTTP headers, and sustained traffic patterns:
```bash
# Using Docker (No local installation needed)
docker run --rm --network host \
  -v "$PWD/load-test:/scripts" \
  grafana/k6 run /scripts/rate-limiter.js
```

#### Sample Results

Latest local run (single-node Docker Compose, 511 requests, 2488 checks):

| Metric | Result |
|---|---|
| **Checks passed** | 100% (2488 / 2488) |
| **HTTP failures** | 0.00% (0 / 511) |
| **Rate-limited (429)** | 86.88% (444 / 511) |
| **Fixed window p(95)** | 6.35 ms |
| **Sliding window p(95)** | 6.89 ms |
| **Token bucket p(95)** | 7.24 ms |
| **Overall p(95) latency** | 7.03 ms |

All latency thresholds (`p(95) < 200 ms`), the `http_req_failed < 5%` threshold, and the `http_429_rate > 5%` threshold passed.

---

## 🎯 Design Decisions

| Decision | Rationale |
|---|---|
| **Lua scripts over MULTI/EXEC** | Redis transactions don't support conditional logic. Lua runs atomically on the server. |
| **Fastify over Express** | ~2× higher throughput for the rate-limiter hot path. |
| **Sentinel over Cluster** | Sentinel provides HA for a single dataset without the complexity of hash-slot sharding. |
| **Algorithm-aware fallback** | Preserves the API contract even when Redis goes down. |

---

## 📄 License
This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---
<p align="center">
  Built by <a href="https://github.com/abinash-thakur">Abinash Thakur</a>
</p>
