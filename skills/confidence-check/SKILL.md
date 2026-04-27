---
name: confidence-check
description: Pre-implementation confidence assessment (≥90% required). Use before starting any implementation to verify readiness with duplicate check, architecture compliance, official docs verification, OSS references, and root cause identification.
---

# Confidence Check

Run this BEFORE implementing to prevent wrong-direction work. Requires ≥90% confidence to proceed.

## When to Use

- Before writing or modifying any implementation code
- Before applying a fix to verify root cause
- When user asks to "check confidence" or "assess readiness"

## Assessment (5 checks)

| Check | Weight | How |
|---|---|---|
| No duplicate implementations | 25% | Grep/Glob for similar code |
| Architecture compliance | 25% | Read CLAUDE.md / AGENTS.md |
| Official docs verified | 20% | Context7 or WebFetch |
| OSS reference found | 15% | WebSearch / GitHub |
| Root cause identified | 15% | Analyze errors and logs |

## Thresholds

- **≥90%**: Proceed with implementation
- **70–89%**: Continue investigation, do not implement yet
- **<70%**: Stop and request more context

## Output

Print the checklist with pass/fail markers, the total score, and the recommended action.
