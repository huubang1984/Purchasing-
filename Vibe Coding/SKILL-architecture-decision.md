---
name: architecture-decision
description: Architecture decision workflow — use for significant architectural choices (new system design, major dependency, infra change, scalability approach). Produces a recorded decision with alternatives and trade-offs. Trigger for "how should we architect X", "should we use A or B for Y".
---

# Architecture Decision Workflow

## 1. Problem

Clearly define: the current problem, constraints, desired outcome.

## 2. Current state

Inspect existing architecture, dependencies, data flow, infrastructure, operational constraints.

## 3. Options

Develop at least 2 viable approaches when reasonable. Evaluate each on: complexity, cost, performance, reliability, security, maintainability, scalability, migration effort.

## 4. Recommendation

Pick the simplest architecture that satisfies the requirements. Explain why, the trade-offs, and the risks.

## 5. Decision

If accepted: update `docs/ARCHITECTURE.md`, record it in `docs/DECISIONS.md`.

## 6. Implementation

Break the implementation into small stages. Validate after each meaningful stage.

## 7. Review

Confirm the implementation actually matches the recorded architectural decision.
