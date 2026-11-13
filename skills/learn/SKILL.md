---
description: Teaches a programming concept in plain English using real code from the current project as the example. Use when the user wants to understand an idea such as async/await, caching, dependency injection or race conditions.
argument-hint: "<concept>"
---

# /jpe:learn

Concept: `$ARGUMENTS`

## Prepare

1. Find the concept's glossary wording by running a briefing on a project file that uses it, or look in the project for a real example (search with Grep for the pattern). Prefer an example from THIS project over an invented one.
2. If the briefing's glossary has an entry, use its plain wording as the starting point and keep the technical term in parentheses.

## Teach, in this order

1. **The idea in one everyday sentence**, with an analogy that is accurate (say where the analogy stops being accurate).
2. **Why it exists**: the problem people had before.
3. **A small example from this project**: show the real lines (file and line number) and walk through them.
4. **What goes wrong without it, or when it is misused**: one common mistake.
5. **Check understanding**: finish with one question the user can answer to test themselves.

Keep it short unless the user asks for depth. Do not change files. If the concept is broad (for example "databases"), say which part you picked and offer the next step.
