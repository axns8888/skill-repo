# SmartKnora skill improvements

## Goal
Continue improving devflow, autopilot, and worktree while preserving the existing uncommitted configuration-center work. Unify roles, reduce redundant interactions, clarify fact reuse and runtime views, and validate task snapshot preservation. Report real-platform validation only when evidence exists.

## Scope and boundaries
- Batch 1: unify coordinator, authoritative plan, integration branch, task worktree, and executor responsibilities; permit a finite task chain while context allows; preserve authorization, claims, commits, independent review, and delivery gates.
- Batch 2: define fact validity/invalidation; verify and improve narrow status/model/runtime views and failure/wait handling; preserve complete APIs and consumers; clarify config ownership, effective paths, conflict checks, and independent commit boundary.
- Separate batch: verify snapshot contents, original-task association, incomplete state, restore validation, and retirement conditions; never alter acceptance, merge, finish, or closure state.
- Implement optional unaccepted aggregation, no-worktree auto-close, or more platform adapters only if evidence supports a real use case; otherwise record the conclusion only.
- Do not enable extensions, create worktrees, sync installed copies, or modify the SmartKnora business repository.
- Preserve all pre-existing uncommitted user changes.

## Phases
- [x] Batch 1: roles, prompts, and duplicate-read reduction
- [x] Batch 2: narrow views, fact invalidation, failure/wait, config maintenance boundaries
- [x] Snapshot preservation audit/hardening and restore regression
- [x] Decide optional feature scope; original SmartKnora environment unavailable, so real validation recorded as not run
- [x] Update both requirement records, skill versions/lock, and final verification evidence
- [x] Add a generic, project-owned guidance directory to new/repair initialization without deriving rules from any specific client project

## Acceptance
- Contracts across the three skills agree without weakening authorization, claims, review, or delivery gates.
- Existing complete JSON APIs and consumers remain compatible; narrow views avoid unrelated full state.
- Snapshot preserves agreed content and original task identity/incomplete state, can be restore-verified in isolation, and does not change task technical state or clean up source workspaces.
- Each batch runs focused tests, script checks, `git diff --check`, and skill-lock verification. Real platform/UI/restore/token claims require direct evidence.
- Generic project guidance templates distinguish authored project policy from skill defaults and explicit enablement; initialization preserves existing project content.
