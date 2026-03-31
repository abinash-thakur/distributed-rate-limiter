# 📊 Phase 5 — Observability & Analytics

## 🎯 Goal

Make system **observable**

---

## 🏗️ HLD

```
RateLimiter → Kafka → Analytics → Dashboard
```

---

## 🔍 LLD

### Events

```json
{
  "user": "123",
  "status": "BLOCKED"
}
```

---

## 📈 Metrics

* Allowed vs Blocked
* Latency
* RPS

---

## 🚀 Deliverables

* Metrics pipeline
* Dashboard
