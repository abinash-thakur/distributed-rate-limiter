# ⚡ Phase 2 — Distributed + Atomic

## 🎯 Goal

Make the system **safe under concurrency and scalable**

---

## 🏗️ HLD

```
Load Balancer → Multiple RateLimiter Nodes → Redis Cluster
```

---

## 🔍 LLD

### Key Upgrade

Use **Redis Lua scripts** for atomic operations.

---

### Lua Logic

```
if current_count < limit then
  increment
  return ALLOW
else
  return BLOCK
end
```

---

## ⚙️ Improvements

* Stateless services
* Horizontal scaling
* Atomic updates

---

## 🚨 Problems Solved

* Race conditions
* Inconsistent counters

---

## 🚀 Deliverables

* Multi-instance deployment
* Concurrency-safe limiter
