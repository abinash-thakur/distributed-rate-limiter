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
flowchart TB
    Client((Client)) --> API[NestJS + Fastify API]
    API --> Guard[@RateLimit Guard]
    
    subgraph Strategies [Rate Limiting Algorithms]
        Guard --> FW[Fixed Window]
        Guard --> SW[Sliding Window]
        Guard --> TB[Token Bucket]
    end
    
    FW --> CB{Circuit Breaker}
    SW --> CB
    TB --> CB
    
    CB -- OPEN / HALF-OPEN --> Fallback[In-Memory Fallback]
    CB -- CLOSED --> RedisLua(Redis Lua Scripts)
    
    RedisLua --> RedisHA[(Redis Sentinel HA)]
    
    Prometheus([Prometheus]) -.-> |Scrape /metrics| API
    Grafana([Grafana]) -.-> Prometheus