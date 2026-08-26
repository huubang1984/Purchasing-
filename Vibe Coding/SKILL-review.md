---
name: review
description: Code review workflow — use when reviewing existing or newly modified code as senior developer, QA engineer, security engineer, and tech lead. Trigger for "review this code", "review my changes", "check this PR".
---

# Code Review Workflow

Review from 4 angles: Senior Developer, QA Engineer, Security Engineer, Tech Lead.

## 1. Correctness

Does it satisfy the requirements? Are edge cases handled? Are error states handled?

## 2. Regression

Existing behavior, API compatibility, database behavior, UI behavior, integration behavior.

## 3. Security

Authentication, authorization, input validation, secrets, injection, sensitive data, file handling.

## 4. Performance

N+1 queries, unnecessary API calls, excessive memory use, blocking operations, large payloads, inefficient algorithms. Don't optimize without evidence when it would add complexity.

## 5. Maintainability

Duplication, coupling, naming, complexity, abstractions, testability.

## 6. Scope

Unrelated changes, accidental refactoring, dependency changes, generated files.

## 7. Verdict

Classify findings: CRITICAL / HIGH / MEDIUM / LOW / INFO. For each: the problem, why it matters, the recommended fix. Don't report style preferences as critical issues.
