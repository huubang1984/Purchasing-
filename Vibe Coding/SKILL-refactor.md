---
name: refactor
description: Safe refactoring workflow — use when improving existing code without intentionally changing behavior (reduce duplication, improve readability/testability/coupling/performance). Trigger for "refactor X", "clean up Y", "simplify Z" where behavior must stay the same.
---

# Safe Refactoring Workflow

## 1. Define current behavior

Understand what the system actually does before changing it.

## 2. Define the refactoring objective

Examples: reduce duplication, improve readability, improve testability, reduce coupling, improve performance.

## 3. Protect behavior

Identify tests covering the affected behavior. If tests are missing and the risk is significant, add characterization tests before refactoring.

## 4. Refactor in small steps

Small change → test → small change → test. Don't combine a large refactor with unrelated feature work.

## 5. Verify

Confirm: existing behavior preserved, tests pass, no unnecessary files changed, performance hasn't regressed.

## 6. Stop rule

Stop once the stated objective is achieved. Don't keep cleaning the rest of the codebase.

## 7. Report

```
## Before
## After
## Why
## Validation
```
