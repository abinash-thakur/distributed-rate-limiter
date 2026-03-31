# 🧠 Phase 3 — Multi-Tenant Rate Limiting

## 📌 Overview

Support hierarchical limits (user, org, global).

---

## ⚙️ Key Naming

```
rate_limit:user:123
rate_limit:org:456
rate_limit:global
```

---

## ⚙️ Logic

ALLOW only if all limits pass.

---

## 📄 Policy Example

```json
{
  "user_limit": 100,
  "org_limit": 10000,
  "global_limit": 1000000
}
```

---

## 🎯 Goal

Prevent resource abuse across tenants.
