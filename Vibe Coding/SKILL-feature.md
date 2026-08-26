---
name: feature
description: Feature development workflow — use for building new functionality. Covers understanding requirements, planning scope, implementing incrementally, validating, reviewing, and reporting. Trigger for "add a feature", "build X", "implement Y".
---

# Feature Development Workflow

## 1. Understand

Read CLAUDE.md, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, and relevant source/tests. Determine: user goal, existing behavior, desired behavior, affected components.

## 2. Plan

For non-trivial features, identify: implementation approach, files affected, data/API/UI changes, risks, test strategy. If architecture must change, check `docs/DECISIONS.md` first.

## 3. Implement

Build incrementally. Keep scope controlled, reuse existing patterns, avoid unrelated refactoring, avoid unnecessary dependencies.

## 4. Validate

Run unit/integration tests, type checks, lint, build, and manual validation where relevant — use the smallest validation that gives reasonable confidence.

## 5. Review

Self-review: correctness, security, edge cases, regression risk, changed files, unnecessary complexity.

## 6. Document

Only update docs when behavior, architecture, or decisions actually changed. If architecture changed, update `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.

## 7. Report

```
## Changed
## Verified
## Notes
```
