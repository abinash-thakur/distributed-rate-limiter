# Distributed Rate Limiter

Redis-backed HTTP rate limiting for NestJS + Fastify, with three algorithms implemented as Lua scripts and a circuit-breaker fallback for Redis outages.

## Highlights

- Fixed window, sliding window, and token bucket strategies behind a single `@RateLimit()` decorator.
- Atomic Redis enforcement via Lua scripts.
- Circuit breaker with algorithm-aware in-memory fallback, so fallback behavior matches the configured strategy.
- Prometheus metrics and Grafana dashboard wiring.
- k6 load testing for burst and sustained traffic validation.
- Docker Compose setups for both a single Redis node and a Sentinel-based HA demo.

## Endpoints

| Route | Algorithm | Default policy |
| --- | --- | --- |
| `/fixed` | Fixed window | `10 requests / 60 seconds` |
| `/sliding` | Sliding window | `10 requests / 60 seconds` |
| `/token` | Token bucket | `10 tokens / 60 seconds` |
| `/health` | None | Health check |
| `/metrics` | None | Prometheus scrape endpoint |

Rate-limited responses include:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset` as epoch seconds
- `Retry-After` as seconds until another request may succeed

## Project Structure

```text
.
├── src/
│   ├── app.controller.ts
│   ├── app.module.ts
│   ├── main.ts
│   ├── metrics/
│   ├── rate-limit/
│   └── redis/
├── lua/
│   ├── fixed-window.lua
│   ├── sliding-window.lua
│   └── token-bucket.lua
├── load-test/
│   └── rate-limiter.js
├── test/
├── docker/
│   ├── grafana/
│   ├── prometheus.yml
│   └── redis/
├── docker-compose.yml
├── docker-compose.ha.yml
├── Dockerfile
└── package.json
```

## Local Development

### Prerequisites

- Node.js 20
- npm
- Redis on `localhost:6379`, or Docker

### Run with Docker Compose

```bash
docker compose up --build
```

This starts the app, Redis, Prometheus, and Grafana.

- App: `http://localhost:3000`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001` (`admin` / `admin`)

### Run the Redis Sentinel HA demo

Use the HA Compose file when you want to run the app against a Redis primary/replica topology managed by three Sentinel nodes:

```bash
docker compose -f docker-compose.ha.yml up --build -d
```

This starts:

- App on `http://localhost:3000`
- Redis primary
- Two Redis replicas
- Three Sentinel nodes
- Prometheus on `http://localhost:9090`
- Grafana on `http://localhost:3001`

Useful commands:

```bash
docker compose -f docker-compose.ha.yml ps
curl -i http://localhost:3000/health
docker compose -f docker-compose.ha.yml stop
docker compose -f docker-compose.ha.yml down
```

This HA setup is a local single-machine demo of Redis Sentinel failover, not a multi-host production deployment.

### Run the app directly

```bash
npm install
npm run start:dev
```

For a single non-watch process:

```bash
npm start
```

If you want the compiled output in `dist/` first:

```bash
npm run build
node dist/main.js
```

If you only need Redis locally for tests or app startup:

```bash
docker compose up -d redis
```

## Environment Variables

```env
PORT=3000

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

REDIS_SENTINELS=
REDIS_SENTINEL_NAME=mymaster
```

When `REDIS_SENTINELS` is set, the app uses Redis Sentinel instead of the single-node host/port configuration.

## Testing

### Automated tests

```bash
npm test
```

The suite includes Redis-backed integration tests for the Lua strategies, so Redis must be available before running the full test suite.

Watch mode is also available:

```bash
npm run test:watch
```

### Load testing

The repository includes a k6 script that validates:

- Burst behavior for `/fixed`, `/sliding`, and `/token`
- Rate-limit headers and `Retry-After`
- Sustained mixed traffic across all three algorithms

Run it with a locally installed k6:

```bash
k6 run load-test/rate-limiter.js
```

Or run it via Docker without installing k6:

```bash
docker run --rm --network host -v "$PWD/load-test:/scripts" grafana/k6 run /scripts/rate-limiter.js
```

If the stack is running through Docker Compose, open Grafana at `http://localhost:3001` and use the `Distributed Rate Limiter` dashboard while the load test is running.

## Metrics

The app exports Prometheus metrics at `/metrics`, including:

- `rate_limit_requests_total`
- `rate_limit_redis_duration_seconds`
- `rate_limit_circuit_breaker_state`
- `rate_limit_fallback_requests_total`

The bundled Grafana dashboard visualizes:

- Request decisions per second by algorithm and result
- Redis duration p95 by algorithm
- Circuit breaker state
- Fallback requests over the last 5 minutes

## Notes

- Fixed window and sliding window reset values are normalized to epoch seconds across all algorithms.
- Token bucket uses `limit / window` as its refill rate, so `limit=10` and `window=60` means a 10-token bucket refilling over 60 seconds.
- The in-memory fallback is intended for short Redis outages, not as a permanent substitute for distributed enforcement.
