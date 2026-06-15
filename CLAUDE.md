# FluxGate — API Gateway Transformation Plan

> Evolving `distributed-rate-limiter` into a production-grade, self-hosted open source API Gateway.

---

## Project Vision

**FluxGate** is a lightweight, self-hosted API gateway with best-in-class rate limiting built in.
Single `docker-compose up`. No external database beyond Redis. Drop-in replacement for teams who
find Kong/APISIX too heavy to operate.

**Unique advantages over existing gateways:**
- 3 rate limiting algorithms (fixed-window, sliding-window, token-bucket) with atomic Lua scripts
- Built-in circuit breaker with in-memory fallback — no plugin needed
- Redis Sentinel HA already wired — just configure and run
- Prometheus + Grafana out of the box

---

## Current State (What Already Exists)

| Component | File | Status |
|---|---|---|
| Rate limit guard | `src/rate-limit/rate-limit.guard.ts` | Done |
| Rate limit service (Lua) | `src/rate-limit/rate-limit.service.ts` | Done |
| Fixed-window algorithm | `lua/fixed-window.lua` | Done |
| Sliding-window algorithm | `lua/sliding-window.lua` | Done |
| Token-bucket algorithm | `lua/token-bucket.lua` | Done |
| Circuit breaker | `src/rate-limit/circuit-breaker.service.ts` | Done |
| In-memory fallback store | `src/rate-limit/memory-store.service.ts` | Done |
| Redis service (Sentinel HA) | `src/redis/redis.service.ts` | Done |
| Prometheus metrics | `src/metrics/metrics.service.ts` | Done |
| Docker Compose (standard) | `docker-compose.yml` | Done |
| Docker Compose (HA) | `docker-compose.ha.yml` | Done |
| Grafana dashboard | `docker/grafana/dashboard.json` | Done |

---

## Target Architecture

```
                     ┌──────────────────────────────────────────────┐
                     │                  FLUXGATE                    │
                     │                                              │
 Client Request      │  ┌──────────┐   ┌────────────────────────┐  │
 ───────────────────►│  │  Auth    │──►│   Route Matcher        │  │
                     │  │ Guard    │   │  (reads activeConfig)  │  │
                     │  └──────────┘   └──────────┬─────────────┘  │
                     │                            │                 │
                     │  ┌─────────────────────────▼─────────────┐  │
                     │  │         Rate Limit Guard               │  │
                     │  │  fixed-window / sliding / token-bucket │  │
                     │  │       Redis Lua + circuit breaker      │  │
                     │  └─────────────────────────┬─────────────┘  │
                     │                            │                 │
                     │  ┌─────────────────────────▼─────────────┐  │
                     │  │         Load Balancer                  │  │
                     │  │  round-robin / least-conn / random     │  │
                     │  └─────────────────────────┬─────────────┘  │
                     │                            │                 │
                     │  ┌─────────────────────────▼─────────────┐  │
                     │  │      HTTP Proxy (undici)               │  │
                     │  │  transform → forward → transform back  │  │
                     │  └────────────────────────────────────────┘  │
                     └──────────────────────────────────────────────┘
                                │              │             │
                          Service A      Service B     Service C
                       (users:3001)  (orders:3002) (payments:3003)
```

---

## Config Loading Architecture

```
WRITE paths:
  User edits routes.yaml ──► disk ──► fs.watch ──► memory (activeConfig)
  Admin API call         ──► Redis              ──► memory (activeConfig)

READ path:
  All gateway services ──► memory only (zero latency per request)

Persistence:
  disk  = base config (source of truth, git-trackable)
  Redis = runtime overrides (Admin API writes, survive restart)
  memory = live working copy (rebuilt from disk + Redis on startup)

Merge rule: Redis overrides win over routes.yaml on conflict.
```

### Config File Location

```
fluxgate/
├── docker-compose.yml
├── .env
└── config/
    └── routes.yaml        ← user edits this file
```

Docker volume mount: `./config/routes.yaml:/app/config/routes.yaml`

Gateway reads `CONFIG_PATH` env var (default: `./config/routes.yaml`).

### Redis Keys

```
gw:routes:overrides    HASH   runtime route overrides from Admin API
gw:key:<sha256>        STRING API key metadata (phase 3)
gw:rl:*                       rate limit counters (existing)
```

---

## Target Folder Structure

```
src/
├── main.ts
├── app.module.ts
│
├── config/                        ← NEW (Phase 1)
│   ├── config.module.ts
│   ├── config.service.ts          ← reads YAML + watches + merges Redis
│   └── config.schema.ts           ← Zod validation types
│
├── gateway/                       ← NEW (Phase 1)
│   ├── gateway.module.ts
│   ├── gateway.controller.ts      ← wildcard @All('*') catches all traffic
│   ├── gateway.service.ts         ← orchestrates: auth → rl → lb → proxy
│   └── proxy.service.ts           ← HTTP forwarding via undici
│
├── router/                        ← NEW (Phase 1)
│   ├── router.module.ts
│   └── router.service.ts          ← longest-prefix route matching
│
├── load-balancer/                 ← NEW (Phase 4)
│   ├── load-balancer.module.ts
│   └── load-balancer.service.ts   ← round-robin, least-conn, random, weighted
│
├── auth/                          ← NEW (Phase 3)
│   ├── auth.module.ts
│   ├── auth.guard.ts
│   ├── api-key.strategy.ts
│   └── jwt.strategy.ts
│
├── admin/                         ← NEW (Phase 2)
│   ├── admin.module.ts
│   ├── admin.controller.ts        ← CRUD routes, keys, stats
│   └── admin.guard.ts             ← protects /admin with X-Admin-Key header
│
├── plugins/                       ← NEW (Phase 7)
│   ├── plugin.interface.ts
│   └── plugin.registry.ts
│
├── rate-limit/                    ← EXISTS — modify guard only
├── redis/                         ← EXISTS — keep as-is
└── metrics/                       ← EXISTS — extend with proxy metrics
```

---

## routes.yaml Schema (user-facing config)

```yaml
gateway:
  port: 3000
  adminPort: 3001
  adminKey: "your-secret-key"      # protects /admin endpoints

routes:
  - id: users-service
    path: /api/users               # prefix match
    upstream: http://users-svc:3001
    stripPrefix: true              # /api/users/profile → /profile
    rateLimit:
      algorithm: sliding-window    # fixed-window | sliding-window | token-bucket
      limit: 100
      window: 60                   # seconds
    auth:
      type: api-key                # none | api-key | jwt

  - id: orders-service
    path: /api/orders
    upstreams:                     # multiple = load balanced
      - url: http://orders-1:3002
        weight: 2
      - url: http://orders-2:3002
        weight: 1
    loadBalancer: round-robin      # round-robin | least-connections | random | weighted | ip-hash
    healthCheck:
      path: /health
      interval: 10                 # seconds
      timeout: 2
      unhealthyThreshold: 3
    rateLimit:
      algorithm: token-bucket
      limit: 50
      window: 60

  - id: public-api
    path: /api/public
    upstream: http://public-svc:3003
    rateLimit:
      algorithm: fixed-window
      limit: 1000
      window: 3600
    auth:
      type: none
    transform:
      request:
        headers:
          add:
            X-Gateway: fluxgate
          remove:
            - X-Internal-Debug
      response:
        headers:
          remove:
            - X-Internal-Trace

  - id: reports-service
    path: /api/reports
    upstream: http://reports-svc:3004
    mode: async                    # returns 202 + jobId, queues via BullMQ
    queue:
      name: reports
      workers: 3
      retries: 3
      timeout: 300
```

---

## Phase-by-Phase Implementation Plan

---

### Phase 1 — Reverse Proxy + Route Config (Week 1–2)

**Goal:** FluxGate becomes a real API gateway. Users define routes, gateway proxies traffic.

#### New Files

| File | Purpose |
|---|---|
| `src/config/config.schema.ts` | Zod schema for routes.yaml validation |
| `src/config/config.service.ts` | Read YAML, watch for changes, merge Redis overrides |
| `src/config/config.module.ts` | NestJS module, export ConfigService as global |
| `src/router/router.service.ts` | Longest-prefix match: `/api/users/profile` → route config |
| `src/router/router.module.ts` | NestJS module |
| `src/gateway/proxy.service.ts` | Forward request to upstream via undici, pipe response back |
| `src/gateway/gateway.service.ts` | Orchestrate: match route → rate limit → proxy |
| `src/gateway/gateway.controller.ts` | `@All('*')` wildcard — catches every incoming request |
| `src/gateway/gateway.module.ts` | NestJS module |
| `config/routes.example.yaml` | Template users copy to `routes.yaml` |

#### Modified Files

| File | Change |
|---|---|
| `src/rate-limit/rate-limit.guard.ts` | Pull options from `RouterService.match(url)` instead of decorator |
| `src/app.module.ts` | Import ConfigModule, RouterModule, GatewayModule |
| `src/app.controller.ts` | Remove demo endpoints (`/fixed`, `/sliding`, `/token`) |
| `docker-compose.yml` | Add volume mount for `config/routes.yaml` |
| `package.json` | Add `undici`, `js-yaml`, `zod` dependencies |

#### Key Behaviors

- Gateway refuses to start if `routes.yaml` is missing or invalid (Zod throws)
- `fs.watch` on config file — hot reload in <1 second, no restart needed
- On invalid file change: log warning, keep old config running (never crash)
- `stripPrefix: true` strips the route path before forwarding
- Forward all headers from client to upstream, add `X-Forwarded-For` and `X-Gateway-Request-Id`

#### New Dependencies

```
undici      HTTP client for proxying (built into Node 18+)
js-yaml     Parse routes.yaml
zod         Validate config schema at startup
```

---

### Phase 2 — Admin REST API (Week 3)

**Goal:** Manage routes and view stats at runtime without file edits or restarts.

Runs on a **separate port** (`adminPort` in config, default 3001) so it can be
firewalled from public traffic.

#### New Files

| File | Purpose |
|---|---|
| `src/admin/admin.controller.ts` | All /admin endpoints |
| `src/admin/admin.guard.ts` | Validates `X-Admin-Key` header |
| `src/admin/admin.module.ts` | NestJS module, separate HTTP adapter on adminPort |

#### Endpoints

```
Routes
  GET    /admin/routes              list all active routes (merged config)
  POST   /admin/routes              add route (writes to Redis override)
  PUT    /admin/routes/:id          update route fields
  DELETE /admin/routes/:id          remove route override (yaml route stays)

Rate Limits
  GET    /admin/rate-limit/stats    request counts per route + algorithm
  DELETE /admin/rate-limit/:key     manually reset a client's counter

System
  GET    /admin/health              gateway status + upstream connectivity
  GET    /admin/config              show full active config (merged)
  POST   /admin/config/reload       force re-read routes.yaml from disk
```

#### Behavior

- `X-Admin-Key` header required on all `/admin` requests (value from `gateway.adminKey` in config)
- Admin API writes only go to Redis (`gw:routes:overrides` hash)
- ConfigService re-merges on every admin write → live immediately
- `DELETE /admin/routes/:id` removes Redis override only — base yaml route survives

---

### Phase 3 — Authentication (Week 4)

**Goal:** Protect upstream services. Validate API keys and JWTs before forwarding.

#### New Files

| File | Purpose |
|---|---|
| `src/auth/auth.guard.ts` | Reads route auth config, delegates to strategy |
| `src/auth/api-key.strategy.ts` | Validates `X-API-Key` header against Redis |
| `src/auth/jwt.strategy.ts` | Validates `Authorization: Bearer` token |
| `src/auth/auth.module.ts` | NestJS module |

#### API Key Flow

```
1. Client sends X-API-Key: flx_live_abc123
2. Gateway: sha256(key) → HGET Redis gw:key:<hash>
3. Redis returns { name, allowedRoutes, customRateLimit } or null
4. null → 401 Unauthorized
5. found → attach to request context, check allowedRoutes includes current route
6. customRateLimit overrides route default if present
7. continue to rate limit → proxy
```

Key format: `flx_live_<32-char-random>` (recognizable in logs, prefix shows environment)

#### JWT Flow

```
1. Client sends Authorization: Bearer <token>
2. Gateway fetches JWKS from jwksUri (cached, auto-refreshed every 1h)
3. Validates signature locally — no round trip to auth server
4. Validates iss, aud, exp claims
5. Attaches decoded payload to request context
6. continue to rate limit → proxy
```

#### Admin API Additions (for API key management)

```
POST   /admin/keys          generate new API key { name, allowedRoutes, rateLimit }
GET    /admin/keys          list all active keys (never returns raw key, only metadata)
DELETE /admin/keys/:keyId   revoke key immediately
```

#### Auth Plugin Interface (for extensibility)

```typescript
interface AuthPlugin {
  name: string;
  validate(req: FastifyRequest): Promise<{ valid: boolean; context?: Record<string, any> }>;
}
```

---

### Phase 4 — Load Balancing + Health Checks (Week 5)

**Goal:** Distribute traffic across multiple upstream instances. Auto-remove failed instances.

#### New Files

| File | Purpose |
|---|---|
| `src/load-balancer/load-balancer.service.ts` | Strategy implementations |
| `src/load-balancer/health-check.service.ts` | Periodic pings to upstream /health |
| `src/load-balancer/load-balancer.module.ts` | NestJS module |

#### Strategies

| Strategy | Algorithm | State |
|---|---|---|
| `round-robin` | Cycle through instances in order | Per-route counter |
| `least-connections` | Pick instance with fewest active requests | Per-instance counter |
| `random` | Random pick | Stateless |
| `weighted` | Probability proportional to weight | Weight config |
| `ip-hash` | `hash(clientIp) % instanceCount` | Stateless (deterministic) |

#### Health Check Behavior

```
Every `interval` seconds:
  ping upstream GET <healthCheck.path>
  timeout after <healthCheck.timeout> seconds

  response 2xx → mark healthy, add to rotation
  timeout/error → increment failure count
  failures >= unhealthyThreshold → mark down, remove from rotation

Marked-down instance:
  still pinged every interval
  3 consecutive successes → mark healthy, re-add to rotation
```

State stored in memory (not Redis) — each gateway instance tracks its own view.
(Acceptable: different instances may briefly disagree on upstream health.)

---

### Phase 5 — Request / Response Transformation (Week 6)

**Goal:** Modify headers and paths in transit without touching upstream services.

#### Transformations Supported

```yaml
transform:
  request:
    headers:
      add:
        X-Request-Id: "{{ uuid }}"     # dynamic: uuid, timestamp, clientIp
        X-Gateway: fluxgate
      remove:
        - X-Internal-Debug
    rewritePath: /v1/users             # rewrite path before forwarding

  response:
    headers:
      add:
        X-Powered-By: FluxGate
      remove:
        - X-Internal-Trace-Id
        - Server
```

#### Dynamic Values

| Token | Resolves to |
|---|---|
| `{{ uuid }}` | Random UUID v4 per request |
| `{{ timestamp }}` | Unix timestamp in ms |
| `{{ clientIp }}` | Request originating IP |
| `{{ routeId }}` | Matched route ID from config |

#### New Files

| File | Purpose |
|---|---|
| `src/gateway/transform.service.ts` | Apply request/response transforms |

---

### Phase 6 — Async Job Queue with BullMQ (Week 7)

**Goal:** Routes with `mode: async` return 202 immediately and process via queue.
No new infrastructure — BullMQ runs on existing Redis.

#### Async Request Flow

```
Client: POST /api/reports/generate { ... }
            │
            ▼
Gateway sees mode: async
            │
            ▼
Push job to BullMQ queue "reports"
            │
            ▼
Return HTTP 202 Accepted immediately:
  { "jobId": "abc-123", "statusUrl": "/api/jobs/abc-123" }

            │ (background)
            ▼
Worker pulls job from queue
Worker calls upstream: POST http://reports-svc:3004/generate
Worker stores result: Redis SET gw:job:abc-123 <result> EX 3600

Client polls: GET /api/jobs/abc-123
  → { "status": "processing" }   (while worker running)
  → { "status": "done", "result": { ... } }  (when complete)
```

#### New Files

| File | Purpose |
|---|---|
| `src/queue/queue.module.ts` | BullMQ setup on existing Redis connection |
| `src/queue/queue.service.ts` | Enqueue jobs, register workers |
| `src/queue/job.controller.ts` | `GET /api/jobs/:jobId` — poll for result |

#### New Dependency

```
bullmq    Job queue built on Redis (reuses existing Redis connection)
```

---

### Phase 7 — Web Dashboard UI (Week 8–9)

**Goal:** Visual management interface. Zero CLI knowledge required for users.

#### Pages

```
/dashboard
├── Overview      live traffic graph, req/sec, error rate, top routes
├── Routes        list, add, edit, delete routes with form UI
├── API Keys      generate, list, revoke keys
├── Rate Limits   who is being throttled, reset individual client limits
├── Upstreams     health status of all upstream instances (green/red)
└── Logs          last 500 requests — method, path, status, latency, upstream
```

#### Tech Choice

Plain HTML + Alpine.js + Tailwind CDN — no build step. Contributors can edit without
knowing React. Served statically by admin server from `src/admin/public/`.

#### New Files

| File | Purpose |
|---|---|
| `src/admin/public/index.html` | Dashboard shell |
| `src/admin/public/app.js` | Alpine.js app logic |
| `src/admin/dashboard.controller.ts` | Serves static files + SSE for live updates |

#### Live Updates

Server-Sent Events (SSE) stream from `GET /admin/events`:
- New request arrived (method, path, status, latency)
- Rate limit triggered (clientIp, route)
- Upstream health change (instance up/down)

Dashboard subscribes on load, updates graphs in real time.

---

### Phase 8 — Plugin System (Ongoing / Open Source)

**Goal:** Community can add features without touching core gateway code.

#### Plugin Interface

```typescript
interface GatewayPlugin {
  name: string;
  version: string;
  onRequest?(ctx: RequestContext): Promise<void | 'abort'>;
  onResponse?(ctx: ResponseContext): Promise<void>;
  onError?(ctx: ErrorContext): Promise<void>;
  onRateLimit?(ctx: RateLimitContext): Promise<void>;
}
```

#### Plugin Config

```yaml
plugins:
  - name: cors
    config:
      origins: ["https://myapp.com"]
      methods: [GET, POST, PUT, DELETE]

  - name: ip-whitelist
    config:
      allowed: ["10.0.0.0/8", "192.168.1.0/24"]
      action: block    # block | log-only

  - name: response-cache
    config:
      ttl: 60
      methods: [GET]
```

#### Built-in Plugins (ship with FluxGate)

| Plugin | Function |
|---|---|
| `cors` | CORS headers on responses |
| `ip-whitelist` | Block/allow by IP or CIDR range |
| `request-logger` | Structured JSON request logs |
| `response-cache` | Cache GET responses in Redis with TTL |

#### Community Plugin Contribution Surface

| Area | Difficulty | Good first issue |
|---|---|---|
| New load balancing strategy | Low | Yes |
| New auth plugin (OAuth2, mTLS, HMAC) | Medium | Yes |
| Dashboard UI component | Medium | Yes |
| New rate limit algorithm | Medium | Yes (Lua) |
| gRPC upstream support | High | No |
| Response caching plugin | Medium | No |

---

## High Traffic Handling Strategy

### Horizontal Scaling (primary)

Run multiple gateway instances. Redis Lua scripts ensure rate limits are
atomic and consistent across all instances — this is already built.

```
Nginx / HAProxy
      │
      ├── FluxGate instance 1
      ├── FluxGate instance 2
      └── FluxGate instance 3
                │
           Redis Cluster
         (shared rate limits,
          API keys, job queue)
```

### Async Queue for Spike Protection (Phase 6)

Routes with `mode: async` buffer traffic spikes into BullMQ.
Workers process at a controlled rate regardless of inbound spike size.

### When to Add Kafka

Kafka is appropriate only when:
- Traffic exceeds 100k events/sec
- Multiple independent consumers need same stream (analytics + processing + audit)
- Event replay / reprocessing is required

For open source self-hosted, Kafka is too heavy (needs 3+ brokers, 6GB RAM minimum).
Offer it as an optional enterprise plugin, not a default dependency.

---

## Deployment Models

| Model | Config location | How to edit |
|---|---|---|
| Docker Compose (most users) | `./config/routes.yaml` on host | Edit file directly |
| Kubernetes | `ConfigMap` mounted as volume | `kubectl edit configmap` |
| Bare metal | `/etc/fluxgate/routes.yaml` | Edit + `kill -HUP <pid>` |
| API-driven only | Redis only (no file) | Admin API / Dashboard |

---

## Build Order Summary

```
Phase 1  Reverse proxy + routes.yaml config      → it becomes a real gateway
Phase 2  Admin REST API                           → manageable at runtime
Phase 3  Auth (API key + JWT)                     → production-safe
Phase 4  Load balancing + health checks           → resilient to upstream failures
Phase 5  Request/response transformation          → flexible routing
Phase 6  Async job queue (BullMQ)                 → handles traffic spikes
Phase 7  Web dashboard UI                         → accessible to non-technical users
Phase 8  Plugin system                            → open source growth engine
```

---

## What NOT to Change

- `lua/*.lua` — these are the core value, do not rewrite
- `src/redis/redis.service.ts` — Sentinel HA is production-grade, keep as-is
- `src/rate-limit/circuit-breaker.service.ts` — keep as-is, reuse for upstream health
- `src/rate-limit/rate-limit.service.ts` — keep as-is
- `docker-compose.ha.yml` — extend, do not replace

The only modification to existing rate-limit code is in `rate-limit.guard.ts`:
change options source from `@RateLimit()` decorator → `RouterService.match(url)`.
