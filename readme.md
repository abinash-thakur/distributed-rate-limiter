# 🚀 Distributed Rate Limiter

## 📌 Overview

A **globally distributed, multi-tenant rate limiting system** designed to handle **high-throughput traffic (1M+ RPS)** with **low latency (<1ms)** and **strong consistency guarantees using Redis + Lua scripts**.

---

## 🎯 Key Features

* Multiple algorithms (Token Bucket, Sliding Window)
* Distributed + horizontally scalable
* Multi-tenant hierarchical limits
* Control Plane + Data Plane architecture
* Real-time analytics pipeline
* Multi-region support
* Adaptive (dynamic) rate limiting
* Fault-tolerant with graceful degradation

---

## 🏗️ System Architecture

```
Client → API Gateway → Rate Limiter (Data Plane)
                         ↓
                    Redis Cluster
                         ↓
                      Kafka
                         ↓
                   Analytics Service
                         
Control Plane → Policy Service → Redis / Cache
```

---

## 🧱 Tech Stack

* Backend: NestJS (Node.js)
* Cache: Redis Cluster
* Messaging: Kafka / NATS
* Database: PostgreSQL / ClickHouse
* Infra: Docker + Kubernetes

---

## 📊 Performance Goals

* Latency: < 1ms decision time
* Throughput: 1M+ requests/sec
* Availability: 99.99%

---

## 🗺️ Roadmap

* Phase 1 → Core Rate Limiter
* Phase 2 → Distributed System
* Phase 3 → Multi-Tenant Limits
* Phase 4 → Control Plane
* Phase 5 → Observability
* Phase 6 → Multi-Region
* Phase 7 → Performance Optimization
* Phase 8 → Adaptive Rate Limiting
* Phase 9 → Resilience
* Phase 10 → Testing & Chaos Engineering

---

## 📄 Resume Impact

* Built distributed system handling high-scale traffic
* Designed control/data plane separation
* Implemented atomic rate limiting using Redis Lua
* Solved real-world problems: hot keys, consistency, failover

---
