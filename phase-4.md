# 🧩 Phase 4 — Control Plane + Policy Engine

## 🎯 Goal

Decouple **policy management from enforcement**

---

## 🏗️ HLD

```
Control Plane → Policy Store → Data Plane (RateLimiter)
```

---

## 🔍 LLD

### Control Plane

* CRUD APIs for policies

### Data Plane

* Fetch + cache policies

---

## ⚙️ Features

* Dynamic updates (no redeploy)
* Policy versioning
* Cache layer

---

## 🚀 Deliverables

* Admin API
* Dynamic rule updates
