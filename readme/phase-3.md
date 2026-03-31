# 🧠 Phase 3 — Multi-Tenant & Hierarchical Limits

## 🎯 Goal

Support **real-world rate limiting scenarios**

---

## 🏗️ HLD

```
Request → RateLimiter → Multi-Level Evaluation
```

---

## 🔍 LLD

### Supported Limits

* User
* Organization
* API key
* Global

---

### Policy Example

```json
{
  "user": 100,
  "org": 10000,
  "global": 1000000
}
```

---

### Decision Logic

```
ALLOW only if ALL limits pass
```

---

## 🚀 Deliverables

* Policy evaluation engine
* Multi-key rate limiting

---

## 💡 Use Case

Prevents one user from exhausting org quota
