# 🧩 Phase 4 — Control Plane + Policy Engine

## 📌 Overview

Introduce dynamic policy management.

---

## 📡 APIs

### POST /policies

```json
{
  "endpoint": "/login",
  "limit": 5,
  "window": 60,
  "scope": "user"
}
```

---

## ⚙️ Features

* Dynamic policy updates
* In-memory caching
* No redeploy required

---

## 🎯 Goal

Decouple configuration from execution.
