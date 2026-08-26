---
name: bugfix
description: Bug fixing workflow — use when reproducing, diagnosing, and fixing a defect or unexpected behavior. Covers root-cause analysis before patching and regression testing after. Trigger for "fix this bug", "why does X fail", "unexpected behavior in Y".
---

# Bug Fix Workflow

## 1. Reproduce

Confirm you can reproduce the bug before touching code. If you can't reproduce it, say so and ask for more detail instead of guessing.

## 2. Diagnose

OBSERVE (logs, stack trace, actual behavior) → HYPOTHESIZE (candidate causes) → TEST (confirm or rule out) → ROOT CAUSE. Never patch a symptom before the root cause is clear. If it's still uncertain after reasonable effort, say so — don't fake confidence.

## 3. Plan the fix

Scope the smallest change that correctly addresses the root cause. Don't let it spread into unrelated areas.

## 4. Fix

Fix the implementation, not the test — unless the test itself is actually wrong. Never delete an assertion just because it fails.

## 5. Regression test

Re-run the relevant test suite plus a new test for this specific bug. Confirm the original failure no longer reproduces.

## 6. Review

Check: does the fix mask a different underlying issue, does it introduce side effects, is more test coverage needed here.

## 7. Report

```
## Root cause
## Fix
## Verified
## Prevention (if applicable)
```
