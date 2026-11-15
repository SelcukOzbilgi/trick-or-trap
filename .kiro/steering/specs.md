---
inclusion: always
---

# How to write specs in this repo

Each feature has its own directory under `.kiro/specs/<feature-name>/` containing exactly three files: `requirements.md`, `design.md`, and `tasks.md` — the files Kiro spec mode produces. One spec per feature. Each spec must list what is explicitly out of scope.

`design.md` must cover: the architecture and module boundaries for the feature, the key data types and interfaces, how errors are handled and surfaced, and the test strategy (what is unit-tested, what requires a fixture or a mock, and what is out of scope for automated testing).

## requirements.md

Requirements use numbered headings. Each requirement has a user story and a set of numbered acceptance criteria written in EARS form.

### Format

```
# Requirements: <Feature Name>

## Out of scope
- <item>
- <item>

## 1. <Requirement title>

**User story:** As a <role>, I want <goal>, so that <benefit>.

**Acceptance criteria:**

1.1. WHEN <event or condition> THE SYSTEM SHALL <observable behaviour>.
1.2. WHEN <event or condition> THE SYSTEM SHALL <observable behaviour>.

## 2. <Requirement title>
...
```

### EARS rules

- Every criterion starts with `WHEN … THE SYSTEM SHALL …`.
- One behaviour per criterion. Split compound behaviours into separate numbered criteria.
- State what the system does, not how it does it internally.
- Criteria must be testable: a reviewer can read the criterion and write a passing or failing test from it without asking for clarification.

## tasks.md

Tasks use a checklist format. Each task has a title, sub-items, and a requirements reference on its last line.

### Format

```
# Tasks: <Feature Name>

- [ ] 1. <Task title>
  - [ ] 1.1 <Sub-task>
  - [ ] 1.2 <Sub-task>
  _Requirements: 1.1, 1.2_

- [ ] 2. <Task title>
  - [ ] 2.1 <Sub-task>
  _Requirements: 2.1_
```

### Task rules

- Task numbers are `N.` at the top level and `N.M` (no trailing dot) for sub-items.
- Every task ends with `_Requirements: X.Y, X.Z_` on its own line, referencing the acceptance criteria it satisfies.
- Sub-items are concrete implementation steps small enough to complete and verify in one sitting.
- Tasks are ordered so each one can be built and tested before the next begins.
- Do not include tasks that are out of scope for the spec.
