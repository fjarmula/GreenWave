# README Getting Started Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a concise root README onboarding flow that recreates the local development environment and exposes all required run, quality, and data-generation commands.

**Architecture:** Create the missing root `README.md` as the entry point. Derive commands solely from locked dependency manifests, hook configuration, CI, and backend ETL scripts; link to existing focused documentation rather than duplicating it.

**Tech Stack:** Python 3.12, uv, FastAPI, GeoPandas, Node.js 22, npm, Next.js 16, pre-commit.

**Spec:** User request in this conversation.

## Global Constraints

- Use bash blocks and exact repository commands.
- State that raw and processed spatial datasets are gitignored and required to start the backend.
- Do not add dependencies, change runtime configuration, or commit.
- Keep the content direct and concise.

## Review Focus

- A fresh clone must install both backend and frontend dependencies from lockfiles.
- Hook installation must register both pre-commit and pre-push stages.
- Data commands must preserve the manifest validation and T4 → T5 ordering.
- Backend commands must not imply that startup works without processed data.
- Contract regeneration must include both backend OpenAPI and frontend generated types.

---

### Task 1: Root onboarding document

**Files:**
- Create: `README.md`
- Verify: `README.md`

**Interfaces:**
- Consumes: `backend/pyproject.toml`, `backend/.python-version`, `frontend/package.json`, `frontend/.nvmrc`, `.pre-commit-config.yaml`, `backend/scripts/*.py`, and `.github/workflows/ci.yml`.
- Produces: root setup instructions for a new local developer.

- [ ] **Step 1: Create `README.md` with a Getting Started section**

Include prerequisite versions, clone/setup commands, hook installation, raw-data and ETL instructions, simultaneous backend/frontend server commands, test/lint commands, and contract regeneration.

- [ ] **Step 2: Verify every documented command against its owning configuration**

Run: `git diff --check && git diff -- README.md`

Expected: a focused README-only onboarding diff with no whitespace errors.
