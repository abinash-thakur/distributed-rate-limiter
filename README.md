<![CDATA[# 🚦 Distributed Rate Limiter

[![TypeScript](https://img.shields.io/badge/TypeScript-85.4%25-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-v10-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Redis](https://img.shields.io/badge/Redis-7--alpine-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A production-grade, Redis-backed distributed rate limiter built with **NestJS + Fastify**. Supports three industry-standard algorithms — **Fixed Window**, **Sliding Window**, and **Token Bucket** — enforced atomically via **Redis Lua scripts** with a **circuit-breaker fallback** for Redis outages.

> **Why this project?** Rate limiting is a critical component of any distributed system at scale. I built this to deeply understand the trade-offs between different rate-limiting algorithms, atomic distributed state management, fault tolerance patterns, and production observability — skills essential for backend engineering at scale.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **3 Rate-Limiting Algorithms** | Fixed window, sliding window, and token bucket — selectable via a single `@RateLimit()` decorator |
| **Atomic Redis Enforcement** | Each algorithm implemented as a Lua script for race-condition-free, O(1) atomic operations |
| **Circuit Breaker + Fallback** | Algorithm-aware in-memory fallback during Redis outages with configurable thresholds |
| **Observability** | Prometheus metrics + pre-built Grafana dashboard for real-time monitoring |
| **High Availability** | Redis Sentinel setup with primary + 2 replicas + 3 sentinels and 30-second auto-failover |
| **Load Testing** | k6 scripts validating burst and sustained traffic patterns across all algorithms |
| **One-Command Deployment** | Fully containerized with Docker Compose (single-node and HA modes) |

---

## 🏗️ Architecture

```
                                    ┌─────────────────────────────┐
                                    │        Prometheus           │
                                    │    (Metrics Scraping)       │
                                    └─────────┬───────────────────┘
                                              │ scrape /metrics
                                              ▼
┌──────────┐    HTTP     ┌──────────────────────────────────────────────────┐
│          │ ──────────► │              NestJS + Fastify                    │
│  Client  │             │                                                  │
│          │ ◄────────── │  ┌──────────────────────────────────────────┐    │
└──────────┘  Response   │  │           @RateLimit() Guard              │    │
   with rate-limit       │  │                                          │    │
   headers               │  │  ┌─────────┐ ┌──────────┐ ┌───────────┐ │    │
                         │  │  │  Fixed   │ │ Sliding  │ │   Token   │ │    │
                         │  │  │  Window  │ │  Window  │ │   Bucket  │ │    │
                         │  │  └────┬─────┘ └────┬─────┘ └─────┬─────┘ │    │
                         │  └───────┼────────────┼─────────────┼───────┘    │
                         │          │            │             │            │
                         │          ▼            ▼             ▼            │
                         │  ┌──────────────────────────────────────────┐    │
                         │  │          Circuit Breaker                  │    │
                         │  │                                          │    │
                         │  │   CLOSED ──► OPEN ──► HALF-OPEN          │    │
                         │  │     │                     │              │    │
                         │  │     ▼                     ▼              │    │
                         │  │  Redis Lua           In-Memory           │    │
                         │  │  (Primary)          (Fallback)           │    │
                         │  └──────────────────────────────────────────┘    │
                         └──────────────────────────────────────────────────┘
                                              │
                                              ▼
                         ┌──────────────────────────────────────────────────┐
                         │              Redis (Sentinel HA)                 │
                         │                                                  │
                         │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
                         │  │ Primary  │  │ Replica  │  │ Replica  │       │
                         │  │          │◄─│    1     │◄─│    2     │       │
                         │  └──────────┘  └──────────┘  └──────────┘       │
                         │       ▲              ▲              ▲           │
                         │  ┌────┴────┐   ┌─────┴───┐   ┌─────┴───┐      │
                         │  │Sentinel │   │Sentinel │   │Sentinel │      │
                         │  │    1    │   │    2    │   │    3    │      │
                         │  └─────────┘   └─────────┘   └─────────┘      │
                         └──────────────────────────────────────────────────┘
```

---

## 🔬 Algorithm Comparison

| Algorithm | How It Works | Pros | Cons | Best For |
|---|---|---|---|---|
| **Fixed Window** | Counts requests in fixed time windows (e.g., 0:00–1:00, 1:00–2:00) | Simple, low memory (1 counter per key) | Burst at window boundaries can allow 2× the limit | Simple API rate limiting |
| **Sliding Window** | Tracks individual request timestamps in a sorted set | Smooth, no boundary burst issues | Higher memory usage (stores each timestamp) | Precise rate enforcement |
| **Token Bucket** | Tokens refill at a steady rate; each request consumes one token | Allows controlled bursts while maintaining average rate | Slightly more complex state | APIs needing burst tolerance |

All three are implemented as **atomic Lua scripts** executed on Redis, ensuring thread-safety across distributed instances with zero race conditions.

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

```
X-RateLimit-Limit: 10                  # Maximum requests allowed
X-RateLimit-Remaining: 7              # Requests remaining in current window
X-RateLimit-Reset: 1717891200         # Window reset time (epoch seconds)
Retry-After: 45                        # Seconds until next request is allowed (on 429)
```

---

## 🛡️ Circuit Breaker

The circuit breaker protects the application from Redis outages with three states:

```
  CLOSED                    OPEN                    HALF-OPEN
  (Normal)               (Fallback)              (Probing Redis)
    │                        │                        │
    │ Redis failure          │ Timeout expires         │ Redis responds
    │ threshold reached      │                        │ successfully
    ├───────────────────────►├───────────────────────►├──────► CLOSED
    │                        │                        │
    │                        │ In-memory fallback      │ Redis still down
    │                        │ matches configured      │
    │                        │ algorithm strategy      ├──────► OPEN
```

**Key design decision**: The in-memory fallback is *algorithm-aware* — if your endpoint uses token bucket, the fallback also uses token bucket logic (not a generic counter). This ensures consistent behavior during Redis outages.

---

## 📊 Observability

### Prometheus Metrics

| Metric | Type | Description |
|---|---|---|
| `rate_limit_requests_total` | Counter | Total requests by algorithm, endpoint, and result (allowed/rejected) |
| `rate_limit_redis_duration_seconds` | Histogram | Lua script execution time by algorithm |
| `rate_limit_circuit_breaker_state` | Gauge | Current circuit breaker state (0=closed, 1=open, 2=half-open) |
| `rate_limit_fallback_requests_total` | Counter | Requests served by the in-memory fallback |

### Grafana Dashboard

The bundled Grafana dashboard (`docker/grafana/`) visualizes:
- ✅ Request decisions per second — by algorithm and result (allowed vs rejected)
- ✅ Redis Lua script latency (p95) — by algorithm
- ✅ Circuit breaker state transitions over time
- ✅ Fallback request rate over the last 5 minutes

---

## 📁 Project Structure

```
.
├── src/
│   ├── app.controller.ts          # Route handlers with @RateLimit() decorator
│   ├── app.module.ts              # NestJS module wiring
│   ├── main.ts                    # Fastify bootstrap
│   ├── metrics/                   # Prometheus metrics service
│   ├── rate-limit/                # Rate limiter guard, strategies, circuit breaker
│   └── redis/                     # Redis client with Sentinel support
├── lua/
│   ├── fixed-window.lua           # Atomic fixed window counter
│   ├── sliding-window.lua         # Sorted set sliding window
│   └── token-bucket.lua           # Token bucket with refill calculation
├── load-test/
│   └── rate-limiter.js            # k6 load test (burst + sustained traffic)
├── test/                          # Unit + integration tests (Vitest)
├── docker/
│   ├── grafana/                   # Pre-configured Grafana dashboard
│   ├── prometheus.yml             # Prometheus scrape config
│   └── redis/                     # Redis Sentinel configuration
├── docker-compose.yml             # Single-node setup (app + Redis + Prometheus + Grafana)
├── docker-compose.ha.yml          # HA setup (Sentinel: primary + 2 replicas + 3 sentinels)
├── Dockerfile                     # Multi-stage production build
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js 20+](https://nodejs.org/) and npm
- [Docker](https://www.docker.com/) and Docker Compose
- Redis on `localhost:6379` (or use Docker)

### Option 1: Docker Compose (Recommended)

**Single-node setup** — Starts the app, Redis, Prometheus, and Grafana:

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| App | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (admin / admin) |

**High-Availability setup** — Adds Redis Sentinel with primary + 2 replicas + 3 sentinels:

```bash
docker compose -f docker-compose.ha.yml up --build -d
```

Useful HA commands:

```bash
# Check all services
docker compose -f docker-compose.ha.yml ps

# Health check
curl -i http://localhost:3000/health

# Simulate primary failure (triggers Sentinel failover)
docker compose -f docker-compose.ha.yml stop redis-primary

# Tear down
docker compose -f docker-compose.ha.yml down
```

> **Note**: The HA setup is a local single-machine demo of Redis Sentinel failover, not a multi-host production deployment.

### Option 2: Run Directly

```bash
# Install dependencies
npm install

# Start with hot-reload
npm run start:dev

# Or production build
npm run build
node dist/main.js
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Application port |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis password (optional) |
| `REDIS_SENTINELS` | — | Comma-separated sentinel addresses (enables Sentinel mode) |
| `REDIS_SENTINEL_NAME` | `mymaster` | Sentinel master name |
| `NODE_ENV` | `development` | Environment |

---

## 🧪 Testing

### Automated Tests

```bash
# Run all tests (requires Redis)
npm test

# Watch mode
npm run test:watch
```

The test suite includes Redis-backed integration tests for all three Lua strategies, so Redis must be available before running the full suite.

### Load Testing with k6

The k6 script validates:
- 🔹 Burst behavior for `/fixed`, `/sliding`, and `/token` endpoints
- 🔹 Rate-limit headers and `Retry-After` correctness
- 🔹 Sustained mixed traffic across all three algorithms

```bash
# With k6 installed locally
k6 run load-test/rate-limiter.js

# Or via Docker (no installation needed)
docker run --rm --network host \
  -v "$PWD/load-test:/scripts" \
  grafana/k6 run /scripts/rate-limiter.js
```

Open Grafana at `http://localhost:3001` and use the **Distributed Rate Limiter** dashboard while the load test is running to see metrics in real time.

---

## 🎯 Design Decisions

| Decision | Rationale |
|---|---|
| **Lua scripts over Redis transactions** | `MULTI/EXEC` doesn't support conditional logic; Lua runs atomically on the Redis server with full scripting capability |
| **Fastify over Express** | ~2× higher throughput for the rate-limiter hot path due to schema-based serialization |
| **Algorithm-aware fallback** | Generic counters would change behavior during outages; matching the configured strategy preserves API contract |
| **Sentinel over Cluster** | Sentinel provides HA for a single dataset (rate-limit counters) without the complexity of hash-slot sharding |
| **Vitest over Jest** | Faster execution with native ESM support and better TypeScript integration |

---

## 📝 Technical Notes

- Fixed window and sliding window `X-RateLimit-Reset` values are normalized to epoch seconds across all algorithms for consistent client handling.
- Token bucket uses `limit / window` as its refill rate — e.g., `limit=10` and `window=60` means a 10-token bucket refilling over 60 seconds.
- The in-memory fallback is designed for **short Redis outages** (seconds to minutes), not as a permanent substitute for distributed enforcement.
- All Lua scripts use `tonumber()` for type safety and `redis.call()` (not `redis.pcall()`) to propagate errors to the application layer.

---

## 🛠️ Tech Stack

| Category | Technology |
|---|---|
| **Runtime** | Node.js 20, TypeScript |
| **Framework** | NestJS 10, Fastify |
| **Database** | Redis 7 (Alpine) |
| **Scripting** | Lua (Redis atomic scripts) |
| **Monitoring** | Prometheus, Grafana |
| **Testing** | Vitest (unit + integration), k6 (load) |
| **Infrastructure** | Docker, Docker Compose, Redis Sentinel |

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/abinash-thakur">Abinash Thakur</a>
</p>
]]>
