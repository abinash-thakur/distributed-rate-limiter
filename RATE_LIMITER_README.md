# Redis Rate Limiter — NestJS + Fastify + Redis

A production-grade, multi-algorithm HTTP rate limiter built with NestJS (Fastify adapter), Redis, and Lua scripts. Designed to demonstrate distributed systems concepts for senior engineering interviews.

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Framework | NestJS + Fastify adapter | Fastify halves per-request overhead vs Express — matters since every request passes through the Guard |
| Redis client | ioredis | Native Sentinel support for Phase 2 HA |
| Lua scripts | Redis built-in interpreter | Atomic check-and-increment — eliminates race conditions |
| Testing | Vitest | Same API as Jest, 5x faster, native ESM |
| Load testing | k6 | JavaScript scripting, native p50/p95/p99 output |
| Metrics | prom-client + Prometheus + Grafana | Production observability standard |
| Containerisation | Docker Compose | Single `docker-compose up` runs everything |

---

## Project Structure

```
rate-limiter/
├── src/
│   ├── rate-limit/
│   │   ├── rate-limit.module.ts
│   │   ├── rate-limit.guard.ts          ← core Guard, runs on every request
│   │   ├── rate-limit.decorator.ts      ← @RateLimit() decorator
│   │   ├── rate-limit.service.ts        ← loads Lua scripts, executes them
│   │   └── strategies/
│   │       ├── fixed-window.strategy.ts
│   │       ├── sliding-window.strategy.ts
│   │       └── token-bucket.strategy.ts
│   ├── redis/
│   │   ├── redis.module.ts
│   │   └── redis.service.ts             ← ioredis singleton, Sentinel-ready
│   ├── metrics/
│   │   ├── metrics.module.ts
│   │   └── metrics.service.ts           ← prom-client counters and histograms
│   ├── app.controller.ts                ← demo routes, one per algorithm
│   ├── app.module.ts
│   └── main.ts                          ← Fastify adapter bootstrap
├── lua/
│   ├── fixed-window.lua
│   ├── sliding-window.lua
│   └── token-bucket.lua
├── test/
│   ├── fixed-window.spec.ts
│   ├── sliding-window.spec.ts
│   └── token-bucket.spec.ts
├── k6/
│   └── load-test.ts                     ← k6 benchmark script
├── docker/
│   ├── redis/
│   │   ├── sentinel.conf
│   │   └── redis.conf
│   └── grafana/
│       └── dashboard.json
├── docker-compose.yml                   ← Phase 1: app + redis
├── docker-compose.ha.yml                ← Phase 2: app + sentinel + replicas
├── .env.example
├── .nvmrc                               ← Node 20 LTS
└── README.md
```

---

## Environment Variables

```env
# Redis — Phase 1 (single instance)
REDIS_HOST=localhost
REDIS_PORT=6379

# Redis — Phase 2 (Sentinel, comma-separated)
REDIS_SENTINELS=sentinel-1:26379,sentinel-2:26379,sentinel-3:26379
REDIS_SENTINEL_NAME=mymaster

# App
PORT=3000
NODE_ENV=development
```

---

---

# Phase 1 — Core Rate Limiter

**Goal:** Three working rate limiting algorithms behind a NestJS Guard and custom decorator. By end of this phase, `curl` any route 100 times fast and the 101st returns a `429` with correct headers.

**Duration:** 2–3 days

---

## Step 1 — Scaffold

```bash
npm i -g @nestjs/cli
nest new rate-limiter --package-manager npm
cd rate-limiter

# Switch to Fastify adapter
npm install @nestjs/platform-fastify

# Redis client
npm install ioredis

# Utilities
npm install dotenv uuid

# Dev tools
npm install -D vitest @vitest/coverage-v8 nodemon
```

Create `.nvmrc`:
```
20
```

---

## Step 2 — Bootstrap with Fastify (`src/main.ts`)

```typescript
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
```

---

## Step 3 — Redis Module (`src/redis/`)

### `redis.module.ts`

```typescript
import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
```

### `redis.service.ts`

This service creates a single ioredis client. The config is written to be Sentinel-ready — in Phase 2 you swap the constructor argument only.

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  client: Redis;

  onModuleInit() {
    // Phase 1: single instance
    // Phase 2: replace with Sentinel config (see Phase 2 section)
    this.client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379'),
      lazyConnect: true,
    });

    this.client.on('error', (err) => this.logger.error('Redis error', err));
    this.client.on('connect', () => this.logger.log('Redis connected'));
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
```

---

## Step 4 — @RateLimit() Decorator (`src/rate-limit/rate-limit.decorator.ts`)

```typescript
import { SetMetadata } from '@nestjs/common';

export type RateLimitAlgorithm = 'fixed-window' | 'sliding-window' | 'token-bucket';

export interface RateLimitOptions {
  algorithm: RateLimitAlgorithm;
  limit: number;      // max requests
  window: number;     // time window in seconds
}

export const RATE_LIMIT_KEY = 'rate_limit';
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);
```

---

## Step 5 — Lua Scripts (`lua/`)

Each Lua script is atomic — Redis runs it as a single indivisible operation. No other command from any client can execute between the lines of the script. This eliminates race conditions entirely.

All scripts accept the same arguments:
- `KEYS[1]` — the Redis key for this client + route
- `ARGV[1]` — the request limit
- `ARGV[2]` — the window size in seconds (or refill rate for token bucket)

All scripts return the same shape: `{ allowed: 0|1, remaining: number, resetAt: number }`

### `lua/fixed-window.lua`

Counter per time window. Cheapest — O(1) memory per client. Weakness: a client can make 2× the limit by hitting the boundary between two windows.

```lua
local key     = KEYS[1]
local limit   = tonumber(ARGV[1])
local window  = tonumber(ARGV[2])
local now     = tonumber(ARGV[3])

local count   = tonumber(redis.call('GET', key) or '0')

if count >= limit then
  local ttl = redis.call('TTL', key)
  return { 0, 0, now + ttl }
end

local new_count = redis.call('INCR', key)
if new_count == 1 then
  redis.call('EXPIRE', key, window)
end

local ttl = redis.call('TTL', key)
return { 1, limit - new_count, now + ttl }
```

### `lua/sliding-window.lua`

Sorted set of timestamps. Accurate — no boundary burst. O(n) memory per client where n = number of requests in the window. Best accuracy.

```lua
local key    = KEYS[1]
local limit  = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now    = tonumber(ARGV[3])

local window_start = now - (window * 1000)

-- Remove timestamps outside the current window
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

local count = tonumber(redis.call('ZCARD', key))

if count >= limit then
  local oldest = tonumber(redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')[2] or now)
  local reset_at = math.floor((oldest + window * 1000) / 1000)
  return { 0, 0, reset_at }
end

-- Add current timestamp as a unique member
redis.call('ZADD', key, now, now .. '-' .. math.random(1, 99999))
redis.call('PEXPIRE', key, window * 1000)

return { 1, limit - count - 1, math.floor((now + window * 1000) / 1000) }
```

### `lua/token-bucket.lua`

Tokens refill at a steady rate. Allows short bursts up to the bucket capacity while enforcing an average rate. Best for API fairness — a client who waited gets credit.

```lua
local key          = KEYS[1]
local capacity     = tonumber(ARGV[1])   -- max tokens (= limit)
local refill_rate  = tonumber(ARGV[2])   -- tokens per second
local now          = tonumber(ARGV[3])   -- current time in ms

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens      = tonumber(data[1] or capacity)
local last_refill = tonumber(data[2] or now)

-- Refill tokens based on elapsed time
local elapsed_seconds = (now - last_refill) / 1000
local refill_amount   = elapsed_seconds * refill_rate
tokens = math.min(capacity, tokens + refill_amount)

if tokens < 1 then
  local wait_seconds = (1 - tokens) / refill_rate
  return { 0, 0, math.floor(now / 1000 + wait_seconds) }
end

tokens = tokens - 1
redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 1)

return { 1, math.floor(tokens), math.floor(now / 1000 + (capacity - tokens) / refill_rate) }
```

---

## Step 6 — Rate Limit Service (`src/rate-limit/rate-limit.service.ts`)

Loads Lua scripts from disk at startup and executes them via ioredis `eval`.

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { RateLimitAlgorithm } from './rate-limit.decorator';
import * as fs from 'fs';
import * as path from 'path';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

@Injectable()
export class RateLimitService implements OnModuleInit {
  private scripts: Record<RateLimitAlgorithm, string> = {} as any;

  constructor(private readonly redis: RedisService) {}

  onModuleInit() {
    const luaDir = path.join(process.cwd(), 'lua');
    this.scripts['fixed-window']   = fs.readFileSync(path.join(luaDir, 'fixed-window.lua'), 'utf8');
    this.scripts['sliding-window'] = fs.readFileSync(path.join(luaDir, 'sliding-window.lua'), 'utf8');
    this.scripts['token-bucket']   = fs.readFileSync(path.join(luaDir, 'token-bucket.lua'), 'utf8');
  }

  async check(
    algorithm: RateLimitAlgorithm,
    key: string,
    limit: number,
    window: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const script = this.scripts[algorithm];

    const result = await this.redis.client.eval(
      script,
      1,           // number of keys
      key,         // KEYS[1]
      limit,       // ARGV[1]
      window,      // ARGV[2]
      now,         // ARGV[3]
    ) as [number, number, number];

    return {
      allowed:   result[0] === 1,
      remaining: result[1],
      resetAt:   result[2],
    };
  }
}
```

---

## Step 7 — Rate Limit Guard (`src/rate-limit/rate-limit.guard.ts`)

The Guard runs before every controller method decorated with `@RateLimit()`. It builds the Redis key from the client IP and the route path, calls the Lua script, and either passes the request or returns a `429`.

```typescript
import {
  CanActivate, ExecutionContext, Injectable,
  HttpException, HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest, FastifyReply } from 'fastify';
import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No decorator = no rate limiting
    if (!options) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const res = context.switchToHttp().getResponse<FastifyReply>();

    // Phase 1: key by IP + route
    // Phase 2+: swap this one line to extract API key or JWT user ID
    const clientId = req.ip;
    const route    = (req as any).routerPath ?? req.url;
    const key      = `rl:${options.algorithm}:${clientId}:${route}`;

    const result = await this.rateLimitService.check(
      options.algorithm,
      key,
      options.limit,
      options.window,
    );

    // Always set rate limit headers (production standard)
    res.header('X-RateLimit-Limit',     options.limit);
    res.header('X-RateLimit-Remaining', result.remaining);
    res.header('X-RateLimit-Reset',     result.resetAt);

    if (!result.allowed) {
      res.header('Retry-After', result.resetAt - Math.floor(Date.now() / 1000));
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Too many requests',
          retryAfter: result.resetAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
```

---

## Step 8 — Rate Limit Module (`src/rate-limit/rate-limit.module.ts`)

```typescript
import { Module } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';

@Module({
  providers: [RateLimitService, RateLimitGuard],
  exports: [RateLimitService, RateLimitGuard],
})
export class RateLimitModule {}
```

---

## Step 9 — Demo Controller (`src/app.controller.ts`)

Three routes — one per algorithm — so you can demo each behaviour independently.

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { RateLimit } from './rate-limit/rate-limit.decorator';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';

@Controller()
@UseGuards(RateLimitGuard)
export class AppController {

  @Get('/fixed')
  @RateLimit({ algorithm: 'fixed-window', limit: 10, window: 60 })
  fixed() {
    return { algorithm: 'fixed-window', message: 'Request allowed' };
  }

  @Get('/sliding')
  @RateLimit({ algorithm: 'sliding-window', limit: 10, window: 60 })
  sliding() {
    return { algorithm: 'sliding-window', message: 'Request allowed' };
  }

  @Get('/token')
  @RateLimit({ algorithm: 'token-bucket', limit: 10, window: 60 })
  token() {
    return { algorithm: 'token-bucket', message: 'Request allowed' };
  }

  @Get('/health')
  health() {
    return { status: 'ok' };
  }
}
```

---

## Step 10 — App Module (`src/app.module.ts`)

```typescript
import { Module } from '@nestjs/common';
import { RedisModule } from './redis/redis.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { AppController } from './app.controller';

@Module({
  imports: [RedisModule, RateLimitModule],
  controllers: [AppController],
})
export class AppModule {}
```

---

## Step 11 — Tests (`test/`)

Three test cases per algorithm: allow under limit, deny at limit, and verify window reset behaviour.

### `test/fixed-window.spec.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimitService } from '../src/rate-limit/rate-limit.service';
import { RedisService } from '../src/redis/redis.service';

describe('Fixed window algorithm', () => {
  let service: RateLimitService;
  let redis: RedisService;

  beforeEach(async () => {
    redis = new RedisService();
    await redis.onModuleInit();
    service = new RateLimitService(redis);
    service.onModuleInit();
    await redis.client.flushdb();
  });

  afterEach(async () => {
    await redis.onModuleDestroy();
  });

  it('allows requests under the limit', async () => {
    const result = await service.check('fixed-window', 'test:fw:1', 5, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('denies request exactly at the limit', async () => {
    const key = 'test:fw:2';
    for (let i = 0; i < 5; i++) {
      await service.check('fixed-window', key, 5, 60);
    }
    const result = await service.check('fixed-window', key, 5, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets after the window expires', async () => {
    const key = 'test:fw:3';
    for (let i = 0; i < 5; i++) {
      await service.check('fixed-window', key, 5, 1);
    }
    await redis.client.del(key); // simulate window expiry
    const result = await service.check('fixed-window', key, 5, 1);
    expect(result.allowed).toBe(true);
  });
});
```

Write equivalent `sliding-window.spec.ts` and `token-bucket.spec.ts` with the same three cases.

---

## Step 12 — Docker Compose Phase 1 (`docker-compose.yml`)

```yaml
version: '3.9'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - NODE_ENV=production
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --save "" --appendonly no
```

---

## Phase 1 Done — Verification Checklist

Run these commands to confirm Phase 1 is complete:

```bash
# Start everything
docker-compose up -d

# Hit fixed window 11 times — 11th should be 429
for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/fixed; done

# Check headers on a successful response
curl -v http://localhost:3000/sliding 2>&1 | grep -i x-ratelimit

# Run unit tests
npx vitest run
```

Expected output: first 10 requests return `200`, 11th returns `429`. Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` present on every response.

---

---

# Phase 2 — High Availability with Redis Sentinel

**Goal:** Kill the Redis primary container mid-load and show the API recovering automatically within ~30 seconds, with zero code changes in your business logic.

**Duration:** 2 days

---

## What Changes from Phase 1

Only one file changes: `redis.service.ts`. The Guard, Lua scripts, decorator, and all algorithms are untouched.

### Updated `redis.service.ts` — Sentinel config

```typescript
onModuleInit() {
  const useSentinel = process.env.REDIS_SENTINELS;

  if (useSentinel) {
    // Phase 2: Sentinel mode
    const sentinels = useSentinel.split(',').map((s) => {
      const [host, port] = s.split(':');
      return { host, port: parseInt(port) };
    });

    this.client = new Redis({
      sentinels,
      name: process.env.REDIS_SENTINEL_NAME ?? 'mymaster',
    });
  } else {
    // Phase 1: single instance fallback
    this.client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379'),
    });
  }

  this.client.on('error', (err) => this.logger.error('Redis error', err));
  this.client.on('connect', () => this.logger.log('Redis connected'));
}
```

---

## Sentinel Configuration (`docker/redis/sentinel.conf`)

```conf
sentinel monitor mymaster 172.28.0.10 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 10000
sentinel parallel-syncs mymaster 1
```

---

## Docker Compose HA (`docker-compose.ha.yml`)

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_SENTINELS=172.28.0.21:26379,172.28.0.22:26379,172.28.0.23:26379
      - REDIS_SENTINEL_NAME=mymaster
      - NODE_ENV=production
    restart: unless-stopped
    depends_on:
      - sentinel-1
      - sentinel-2
      - sentinel-3
    networks:
      ha_net:
        ipv4_address: 172.28.0.30

  redis-primary:
    image: redis:7-alpine
    hostname: redis-primary
    command: redis-server
    restart: unless-stopped
    networks:
      ha_net:
        ipv4_address: 172.28.0.10

  redis-replica-1:
    image: redis:7-alpine
    hostname: redis-replica-1
    command: redis-server --replicaof 172.28.0.10 6379
    restart: unless-stopped
    depends_on:
      - redis-primary
    networks:
      ha_net:
        ipv4_address: 172.28.0.11

  redis-replica-2:
    image: redis:7-alpine
    hostname: redis-replica-2
    command: redis-server --replicaof 172.28.0.10 6379
    restart: unless-stopped
    depends_on:
      - redis-primary
    networks:
      ha_net:
        ipv4_address: 172.28.0.12

  sentinel-1:
    image: redis:7-alpine
    command:
      - sh
      - -c
      - cp /etc/redis/sentinel-base.conf /tmp/sentinel.conf && exec redis-sentinel /tmp/sentinel.conf
    volumes:
      - ./docker/redis/sentinel.conf:/etc/redis/sentinel-base.conf:ro
    ports:
      - "26379:26379"
    restart: unless-stopped
    depends_on:
      - redis-primary
    networks:
      ha_net:
        ipv4_address: 172.28.0.21

  sentinel-2:
    image: redis:7-alpine
    command:
      - sh
      - -c
      - cp /etc/redis/sentinel-base.conf /tmp/sentinel.conf && exec redis-sentinel /tmp/sentinel.conf
    volumes:
      - ./docker/redis/sentinel.conf:/etc/redis/sentinel-base.conf:ro
    restart: unless-stopped
    depends_on:
      - redis-primary
    networks:
      ha_net:
        ipv4_address: 172.28.0.22

  sentinel-3:
    image: redis:7-alpine
    command:
      - sh
      - -c
      - cp /etc/redis/sentinel-base.conf /tmp/sentinel.conf && exec redis-sentinel /tmp/sentinel.conf
    volumes:
      - ./docker/redis/sentinel.conf:/etc/redis/sentinel-base.conf:ro
    restart: unless-stopped
    depends_on:
      - redis-primary
    networks:
      ha_net:
        ipv4_address: 172.28.0.23

networks:
  ha_net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/24
```

---

## Why This Compose File Differs Slightly from the Minimal Example

The original hostname-based Sentinel setup is a good starting point, but in this repo the fully working local demo uses:

- fixed internal IPs for Redis and Sentinel containers
- a writable runtime Sentinel config inside each container
- a read-only mounted template config copied into `/tmp` at startup

This avoids two common local Docker issues:

- Sentinels failing to persist topology updates when the config file is bind-mounted directly
- Sentinels failing over unreliably when the monitored master hostname cannot be resolved after the original container is stopped

Business logic is still unchanged. The only application code change remains the Sentinel-aware Redis client configuration in `redis.service.ts`.

---

## Phase 2 Done — Verification Checklist

```bash
# Start HA setup
docker compose -f docker-compose.ha.yml down -v --remove-orphans
docker compose -f docker-compose.ha.yml up --build -d

# Confirm the current master before testing
docker compose -f docker-compose.ha.yml exec sentinel-1 redis-cli -p 26379 SENTINEL master mymaster

# Run continuous load in background
while true; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/sliding; sleep 0.25; done

# Kill the primary — this is your demo moment
docker compose -f docker-compose.ha.yml stop redis-primary

# Watch the app and Sentinel logs during failover
docker compose -f docker-compose.ha.yml logs -f app
docker compose -f docker-compose.ha.yml logs -f sentinel-1

# Verify a new master was elected
docker compose -f docker-compose.ha.yml exec sentinel-1 redis-cli -p 26379 SENTINEL master mymaster

# Start the old primary again so it rejoins as a replica
docker compose -f docker-compose.ha.yml start redis-primary
docker compose -f docker-compose.ha.yml exec sentinel-1 redis-cli -p 26379 SENTINEL replicas mymaster
```

Expected:

- the app stays running throughout the test
- Sentinel promotes one replica to master
- the app logs show a brief Redis connection error, then reconnect
- requests resume without restarting the app
- when `redis-primary` is started again, it rejoins as a replica instead of taking master back immediately

---

---

# Phase 3 — Resilience with Circuit Breaker

**Goal:** When all Redis nodes are unreachable, the app falls back to per-node in-memory counting instead of crashing or allowing unlimited traffic. Circuit resets automatically when Redis recovers.

**Duration:** 1–2 days

---

## Circuit Breaker States

```
CLOSED  ──(Redis fails N times)──▶  OPEN  ──(timeout elapsed)──▶  HALF-OPEN
  ▲                                                                     │
  └──────────────────(Redis succeeds)──────────────────────────────────┘
```

- CLOSED: normal operation, all requests go to Redis
- OPEN: Redis is down, all requests use in-memory fallback, no Redis calls attempted
- HALF-OPEN: one probe request sent to Redis to test recovery

---

## `src/rate-limit/circuit-breaker.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private state: State = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;

  private readonly FAILURE_THRESHOLD = 5;
  private readonly RECOVERY_TIMEOUT  = 30_000; // 30 seconds

  isOpen(): boolean {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed > this.RECOVERY_TIMEOUT) {
        this.state = 'HALF_OPEN';
        this.logger.log('Circuit breaker: HALF_OPEN — probing Redis');
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.failureCount = 0;
    if (this.state !== 'CLOSED') {
      this.state = 'CLOSED';
      this.logger.log('Circuit breaker: CLOSED — Redis recovered');
    }
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.FAILURE_THRESHOLD) {
      this.state = 'OPEN';
      this.logger.warn('Circuit breaker: OPEN — switching to in-memory fallback');
    }
  }

  getState(): State {
    return this.state;
  }
}
```

---

## In-Memory Fallback (`src/rate-limit/memory-store.service.ts`)

Token bucket running entirely in Node.js memory. Each app node tracks its own counts — not shared across nodes, but prevents unlimited traffic when Redis is completely unavailable.

```typescript
import { Injectable } from '@nestjs/common';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

@Injectable()
export class MemoryStoreService {
  private store = new Map<string, Bucket>();

  check(key: string, capacity: number, refillRate: number): boolean {
    const now = Date.now();
    const bucket = this.store.get(key) ?? { tokens: capacity, lastRefill: now };

    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens  = Math.min(capacity, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      this.store.set(key, bucket);
      return false;
    }

    bucket.tokens -= 1;
    this.store.set(key, bucket);
    return true;
  }

  // Cleanup stale keys periodically to prevent memory leak
  cleanup(olderThanMs = 300_000) {
    const cutoff = Date.now() - olderThanMs;
    for (const [key, bucket] of this.store.entries()) {
      if (bucket.lastRefill < cutoff) this.store.delete(key);
    }
  }
}
```

---

## Redis Client Behavior Needed for Phase 3

For the circuit breaker to work reliably, Redis calls must fail fast when the full Redis layer is unavailable. If the client keeps retrying internally for too long, the Guard never gets a failure back quickly enough to trip the breaker.

In this repo, the Redis client is configured to fail fast with options like:

```typescript
{
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  autoResendUnfulfilledCommands: false,
  connectTimeout: 1000,
  lazyConnect: true,
}
```

With Sentinel enabled, short `retryStrategy` and `sentinelRetryStrategy` delays are also used so the app can enter fallback mode quickly during a full outage.

---

## Updated Guard with Circuit Breaker

Add these imports and inject both new services into `RateLimitGuard`. Wrap the Redis call:

```typescript
// Inside canActivate(), replace the direct service.check() call with:

let result: RateLimitResult;

if (this.circuitBreaker.isOpen()) {
  // Redis is down — use in-memory fallback
  const allowed = this.memoryStore.check(key, options.limit, options.limit / options.window);
  result = { allowed, remaining: allowed ? 1 : 0, resetAt: Math.floor(Date.now() / 1000) + options.window };
} else {
  try {
    result = await this.rateLimitService.check(options.algorithm, key, options.limit, options.window);
    this.circuitBreaker.recordSuccess();
  } catch (err) {
    this.circuitBreaker.recordFailure();
    // Fail open on first errors, before circuit trips
    const allowed = this.memoryStore.check(key, options.limit, options.limit / options.window);
    result = { allowed, remaining: 0, resetAt: Math.floor(Date.now() / 1000) + options.window };
  }
}
```

---

## Phase 3 Done — Verification Checklist

```bash
# Start the HA setup cleanly
docker compose -f docker-compose.ha.yml down -v --remove-orphans
docker compose -f docker-compose.ha.yml up --build -d

# Watch the app logs
docker compose -f docker-compose.ha.yml logs -f app

# Keep traffic running
while true; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/token; sleep 0.25; done

# Stop the entire Redis layer
docker compose -f docker-compose.ha.yml stop redis-primary redis-replica-1 redis-replica-2 sentinel-1 sentinel-2 sentinel-3

# Bring the full Redis layer back
docker compose -f docker-compose.ha.yml start redis-primary redis-replica-1 redis-replica-2 sentinel-1 sentinel-2 sentinel-3
```

Expected:

- while all Redis and Sentinel nodes are down, the API still returns only `200` or `429`
- the app does not crash and does not return `500`
- app logs show Redis connection errors first
- after repeated failures, logs show `Circuit breaker: OPEN - switching to in-memory fallback`
- after Redis comes back and the recovery timeout passes, logs show:
  - `Circuit breaker: HALF_OPEN - probing Redis`
  - `Circuit breaker: CLOSED - Redis recovered`

This phase is complete when the app continues rate limiting locally during a full outage and automatically returns to Redis-backed rate limiting after recovery.

---

---

# Phase 4 — Observability

**Goal:** A live Grafana dashboard showing allow/deny rates, Redis latency percentiles, and circuit breaker state. This is the demo that gets interviewers to lean forward.

**Duration:** 1–2 days

---

## Metrics to Track

| Metric | Type | Labels |
|---|---|---|
| `rate_limit_requests_total` | Counter | algorithm, result (allowed/denied) |
| `rate_limit_redis_duration_ms` | Histogram | algorithm |
| `rate_limit_circuit_breaker_state` | Gauge | state (0=closed, 1=open, 2=half_open) |
| `rate_limit_fallback_requests_total` | Counter | — |

---

## `src/metrics/metrics.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Gauge, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly requestsTotal = new Counter({
    name: 'rate_limit_requests_total',
    help: 'Total rate limit decisions',
    labelNames: ['algorithm', 'result'],
    registers: [this.registry],
  });

  readonly redisDuration = new Histogram({
    name: 'rate_limit_redis_duration_ms',
    help: 'Redis Lua script execution time in ms',
    labelNames: ['algorithm'],
    buckets: [1, 2, 5, 10, 25, 50, 100],
    registers: [this.registry],
  });

  readonly circuitState = new Gauge({
    name: 'rate_limit_circuit_breaker_state',
    help: 'Circuit breaker state: 0=closed 1=open 2=half_open',
    registers: [this.registry],
  });

  readonly fallbackTotal = new Counter({
    name: 'rate_limit_fallback_requests_total',
    help: 'Requests handled by in-memory fallback',
    registers: [this.registry],
  });
}
```

---

## Metrics Endpoint (`src/app.controller.ts` addition)

```typescript
@Get('/metrics')
async metrics(@Res() res: FastifyReply) {
  const metrics = await this.metricsService.registry.metrics();
  res.header('Content-Type', this.metricsService.registry.contentType);
  res.send(metrics);
}
```

---

## Docker Compose Addition for Phase 4

Add to `docker-compose.yml`:

```yaml
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./docker/prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - ./docker/grafana/dashboard.json:/var/lib/grafana/dashboards/rate-limiter.json
```

### `docker/prometheus.yml`

```yaml
global:
  scrape_interval: 5s

scrape_configs:
  - job_name: rate-limiter
    static_configs:
      - targets: ['app:3000']
    metrics_path: /metrics
```

---

## Phase 4 Done — Verification Checklist

```bash
docker-compose up -d

# Generate mixed load
for i in $(seq 1 200); do curl -s http://localhost:3000/sliding; done

# Open Grafana
open http://localhost:3001  # admin / admin

# Open Prometheus
open http://localhost:9090
```

Expected: Grafana shows live counters for allowed/denied requests, Redis latency histogram, and circuit breaker state gauge.

---

---

# Phase 5 — Benchmarking

**Goal:** Concrete p50/p95/p99 latency numbers for each algorithm under load. These numbers are your resume bullets and your interview answers.

**Duration:** 1 day

---

## k6 Load Test (`k6/load-test.ts`)

```typescript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const fixedLatency   = new Trend('fixed_window_latency');
const slidingLatency = new Trend('sliding_window_latency');
const tokenLatency   = new Trend('token_bucket_latency');
const deniedCount    = new Counter('requests_denied');

export const options = {
  scenarios: {
    fixed_window: {
      executor: 'constant-vus',
      vus: 100,
      duration: '30s',
      exec: 'testFixed',
    },
    sliding_window: {
      executor: 'constant-vus',
      vus: 100,
      duration: '30s',
      exec: 'testSliding',
    },
    token_bucket: {
      executor: 'constant-vus',
      vus: 100,
      duration: '30s',
      exec: 'testToken',
    },
  },
  thresholds: {
    fixed_window_latency:   ['p(99)<10'],   // p99 under 10ms
    sliding_window_latency: ['p(99)<15'],
    token_bucket_latency:   ['p(99)<10'],
  },
};

export function testFixed() {
  const start = Date.now();
  const res = http.get('http://localhost:3000/fixed');
  fixedLatency.add(Date.now() - start);
  if (res.status === 429) deniedCount.add(1);
  check(res, { 'status is 200 or 429': (r) => r.status === 200 || r.status === 429 });
  sleep(0.01);
}

export function testSliding() {
  const start = Date.now();
  const res = http.get('http://localhost:3000/sliding');
  slidingLatency.add(Date.now() - start);
  if (res.status === 429) deniedCount.add(1);
  check(res, { 'status is 200 or 429': (r) => r.status === 200 || r.status === 429 });
  sleep(0.01);
}

export function testToken() {
  const start = Date.now();
  const res = http.get('http://localhost:3000/token');
  tokenLatency.add(Date.now() - start);
  if (res.status === 429) deniedCount.add(1);
  check(res, { 'status is 200 or 429': (r) => r.status === 200 || r.status === 429 });
  sleep(0.01);
}
```

---

## Running Benchmarks

```bash
# Install k6: https://k6.io/docs/getting-started/installation/
k6 run k6/load-test.ts
```

Record the p50/p95/p99 output for each algorithm. These numbers go directly into your README table and your resume.

Expected results (approximate, vary by hardware):

| Algorithm | p50 | p95 | p99 | Memory per client |
|---|---|---|---|---|
| Fixed window | ~1ms | ~2ms | ~3ms | O(1) — 1 STRING |
| Sliding window | ~2ms | ~4ms | ~6ms | O(n) — 1 ZSET |
| Token bucket | ~1ms | ~2ms | ~3ms | O(1) — 1 HASH |

---

## Phase 5 Done — Verification Checklist

```bash
k6 run k6/load-test.ts

# All three thresholds should pass (green):
# ✓ fixed_window_latency p(99) < 10ms
# ✓ sliding_window_latency p(99) < 15ms
# ✓ token_bucket_latency p(99) < 10ms
```

---

---

# Phase 6 — Polish

**Goal:** Anyone can clone the repo, run `docker-compose up`, and understand the entire system in 5 minutes. Your git history tells the story of each phase.

**Duration:** 1 day

---

## Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lua ./lua
COPY package*.json ./
EXPOSE 3000
CMD ["node", "dist/main"]
```

---

## `.env.example`

```env
# Phase 1 — single Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Phase 2 — Sentinel (uncomment to enable)
# REDIS_SENTINELS=sentinel-1:26379,sentinel-2:26379,sentinel-3:26379
# REDIS_SENTINEL_NAME=mymaster

PORT=3000
NODE_ENV=development
```

---

## Git Commit Convention

Each phase should have a clear commit so your history is readable:

```bash
git commit -m "phase-1: fixed window + sliding window + token bucket algorithms working"
git commit -m "phase-2: Redis Sentinel HA, automatic failover in ~30s"
git commit -m "phase-3: circuit breaker + in-memory fallback when Redis unreachable"
git commit -m "phase-4: Prometheus metrics + Grafana dashboard"
git commit -m "phase-5: k6 benchmarks, p99 < 10ms for fixed window and token bucket"
git commit -m "phase-6: Docker Compose, Dockerfile, README complete"
```

---

## Algorithm Trade-offs (for README and interviews)

| | Fixed window | Sliding window log | Token bucket |
|---|---|---|---|
| Memory | O(1) | O(n) per client | O(1) |
| Accuracy | Lower — boundary burst | Highest — no boundary burst | Medium |
| Burst handling | None | None | Yes — up to capacity |
| Redis ops per request | 2 (INCR + EXPIRE) | 3 (ZADD + ZREMRANGE + ZCARD) | 2 (HMGET + HMSET) |
| Best for | Simple public APIs | Financial, audit-critical APIs | General-purpose API fairness |

---

## Resume Bullet Points

Use these once Phase 6 is complete:

- Built a production-grade multi-algorithm HTTP rate limiter (fixed window, sliding window log, token bucket) using NestJS + Fastify, Redis Lua scripts, and ioredis
- Achieved p99 latency under 5ms at 300 concurrent virtual users using k6 load testing
- Implemented Redis Sentinel high availability with automatic primary failover in ~30 seconds and zero application code changes
- Added circuit breaker pattern with in-memory token bucket fallback, ensuring the service degrades gracefully when Redis is fully unavailable
- Instrumented with Prometheus and Grafana — live dashboards showing allow/deny rates, Redis latency percentiles, and circuit breaker state
- Containerised with Docker Compose — full HA setup (app + Redis primary + 2 replicas + 3 Sentinels + Prometheus + Grafana) launches with a single command
