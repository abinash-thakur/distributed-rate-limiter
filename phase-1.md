# 🧱 Phase 1 — Core Rate Limiter

## 🎯 Goal

Build a **basic but correct rate limiter** using Redis.

---

## 🏗️ HLD

```
Client → RateLimiter Service → Redis
```

---

## 🔍 LLD

### Flow

1. Receive request
2. Generate unique key (user/IP)
3. Increment counter in Redis
4. Compare with limit
5. Return ALLOW or BLOCK

---

## 🧮 Algorithm

* Fixed Window Counter (initial)
* Optional: Token Bucket

---

## 🗄️ Data Model

```
key: user:123
value: count
ttl: 60 seconds
```

---

## ⚙️ API

```
POST /check
{
  "key": "user_123",
  "limit": 100,
  "window": 60
}
```

---

## 🚀 Deliverables

* Working limiter
* Redis integration
* Basic correctness

---

## ⚠️ Limitations

* Not distributed safe
* Race conditions possible
