# 🧠 Codex Instructions for Distributed Rate Limiter

## 🎯 Goal

Build a **production-grade distributed rate limiter** step-by-step.

---

## 🏗️ Tech Stack

* Backend: NestJS (TypeScript)
* Cache: Redis
* Messaging: Kafka (later phases)
* Architecture: Modular, scalable

---

## 📁 Code Standards

* Use clean architecture (modules, services, controllers)
* Use dependency injection (NestJS standard)
* Write reusable services
* Add comments for complex logic
* Use TypeScript types everywhere

---

## 📦 Folder Structure

src/
├── modules/
├── common/
├── infrastructure/
├── config/

---

## ⚙️ Rules

* Do NOT write everything in one file
* Keep code production-ready
* Add error handling
* Add validation (DTOs)

---

## ✅ Definition of Done

* Code compiles
* API works
* Redis integrated (if required)
* Minimal test coverage
