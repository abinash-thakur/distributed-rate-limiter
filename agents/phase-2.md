# 🧱 Phase 1 — Core Rate Limiter

## 📌 Overview

Basic rate limiter using Redis with fixed window counter.

---

## ⚡ Setup

### Prerequisites

* Node.js ≥ 18
* Redis ≥ 6

---

## 🔐 Environment

```
REDIS_HOST=localhost
REDIS_PORT=6379
DEFAULT_LIMIT=100
DEFAULT_WINDOW=60
```

---

## 📡 API

### POST /rate-limit/check

```json
{
  "key": "user_123",
  "limit": 100,
  "window": 60
}
```

---

## ⚙️ Implementation

* Redis `INCR`
* TTL = window

---

## ❌ Limitations

* Race conditions
* Not safe for distributed systems

---

## 🎯 Goal

Validate basic rate limiting logic.
