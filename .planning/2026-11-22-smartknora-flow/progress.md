# Progress Log

## 2026-11-22
- Checked that no root AGENTS.md exists. No project declaration enabling autopilot/worktree was found; these extensions will not be used to execute this task and no worktree will be created.
- Reviewed git status/diff. Configuration-center changes are uncommitted and must remain. Existing plan records 78/78 focused regressions and 25/25 final model-page/init rerun; full validation was interrupted, and real UI/platform/SmartKnora checks were not performed. Preserving those changes.
- Requirement records show the remaining SmartKnora batches were previously pending review; this request now authorizes implementation.
- Delegated in parallel: P0-P5/context/tool-integration docs; evidence review for optional features. The evidence review recommends documenting, not implementing, all three optional expansions.
- The documentation-writing agent stopped without editing because of its patch-entry limitation; main session completed the disjoint prompt/reference scope. The audit agent returned concrete evidence and no files were modified by it.
- Snapshot command and restore tests already exist in the current baseline. Audited their contract and strengthened the existing restore test with original task identity/status, artifact SHA256, and source-worktree immutability assertions.
- Batch 1 changed devflow P0-P4, context-handoff/tool-integration, and the three skill responsibility summaries. `git diff --check` and final skill snapshot verification cover the complete source state.
- Batch 2 added fact validity/invalidation and failure/wait rules; clarified configuration ownership/effective paths/conflict/commit boundary; documented strict bounded-unit mode as opt-in. Existing full outputs remain default and narrow views remain additive.
- Updated the two evolution records with scope, evidence, and limitations. Optional unaccepted aggregation, no-worktree auto-close, and more platform adapters are not implemented for lack of concrete use-case evidence.

## Verification
- `node --test tests/worktree.test.cjs`: 31/31 passed, including isolated bundle/patch/local-file restore, SHA256 checks, source worktree unchanged, task remains claimed, and no acceptance/close event.
- `node --test tests/autopilot.test.cjs tests/autopilot-runner.test.cjs tests/model-config.test.cjs`: 80/80 passed, including narrow/full API compatibility, duplicate-start query, bounded retry history, wait timeout/claim retention, and model summary.
- `node --test tests/model-page.test.cjs tests/workflow-init.test.cjs`: 27/27 passed. (`workflow-init` alone was also run: 7/7 passed.)
- `node --check` on worktree, autopilot, runner and resume brief scripts: passed.
- `npm run skills:lock`: passed; `node scripts/skills-local.cjs verify`: passed on Node v24.21.0.
- `git diff --check`: passed. Git emitted existing CRLF-to-LF normalization warnings; no whitespace errors.
- `npm run skills:check`: expected false for the three changed installed copies under Codex/DSH; no sync performed.
- Full `npm test` / `npm run validate`: not run this turn. Prior active-plan evidence says the full validation stalled and was interrupted; do not claim full-suite pass.
- Environment: only this skill repository is present under `D:\Coding\Axns8888`; SmartKnora original project, live DSH/Orca runtime, and UI browser session unavailable. No real platform, UI, token comparison, or SmartKnora migration/restore drill is claimed.

## 2026-11-22 Generic project-guidance follow-up
- User clarified that devflow is a general-purpose tool and project-specific requirements belong in each target project's own directory. No SmartKnora-specific assumptions were used for this follow-up.
- Added `_plan/project/` initialization templates for project-owned skill usage, tool coordination, and supplemental constraints; linked them from project navigation and baseline references. Existing recursive template copy and write-safe preflight are reused; no new runtime/configuration behavior was added.
- `node --test tests/workflow-init.test.cjs`: 7/7 passed, including creation/link checks, rerun preservation, missing-file repair, dry-run, and conflict preflight.
- `node --check skills/axns-devflow/scripts/init-workflow.cjs` and `node --check tests/workflow-init.test.cjs`: passed. `git diff --check`: passed (Git reported existing CRLF normalization warnings).
- `npm run skills:lock` and `node scripts/skills-local.cjs verify`: passed. Full `npm test` / `npm run validate` not run; target project, platform, and UI were not available, so no real-platform validation is claimed.

## 2026-11-22 Current-repository acceptance
- Treated this skills repository as a real project per user clarification. Preflight confirmed root `_plan/` and `AGENTS.md` were absent, existing `_doc/` and root `model-routing.json` existed, and initialization would add 37 files while reusing the model table.
- Ran actual initialization at repository root: 37 new files created; existing repository docs/model table were retained. A repeat `--dry-run` reported 0 new files and 37 retained files.
- Filled `_plan/project/skill-usage.md` and `coordination.md` with verified repository-specific facts, explicitly recording that source presence does not enable autopilot/worktree. Filled the project baseline with repository purpose, commands, ownership, and `.planning/.active_plan` as the active-plan selector to avoid duplicating tasks in `_plan/process/`.
- Corrected root README devflow version index from `rc.5` to `rc.6` to match skill metadata and versioning policy.
- `npm run validate` verified `skills.lock.json`, then the full test runner emitted only the first 3 passing tests and made no further progress for several minutes; interrupted. Do not claim full suite pass. Re-ran `node --test tests/workflow-init.test.cjs`: 7/7 passed; repeat initialization dry-run showed all 37 files preserved; `git diff --check` passed with CRLF normalization warnings.



## 2026-11-22 Validation stall follow-up
- Root cause: the DSH worker validated project/runtime state before publishing its durable process record. A transient shared coordination-lock collision could exit the worker while the launch journal remained starting, so the finite controller kept polling until its cycle cap. Historical validation recorded this DSH case at 328,861.7 ms and failed to reach stage_cap. Callback transient retries were also only about 2 seconds.
- Fix: publish process.json before launch-file/config/project checks; retry only AXNS_COORDINATION_BUSY and AXNS_OBSERVATION_CHANGED for a bounded 20-second startup/callback window; persist startup errors as stopped; cap Node test-file concurrency at 4.
- Regression evidence: node --test tests/dsh-direct.test.cjs 6/6; node --test tests/dsh-controller.test.cjs 12/12 before the final stopped-state assertion adjustment; the changed-launch-files case then passed 1/1; callback lock regression passed 1/1.
- Final npm run validate on Node v24.21.0: skill snapshot verification passed; test suite 250 total, 249 passed, 1 skipped, 0 failed; test duration 523,849.7 ms (about 8m43s). The suite remains long because its integration tests create many temporary Git/worktree fixtures and child processes. No real DSH/Orca platform or UI was exercised.

## 2026-11-22 Usage-end acceptance feedback template
- Added a generic milestone-based user feedback form under `_doc/使用说明文档/里程碑验收与反馈.md`; the skill initializer copies it into target projects and the usage-doc index links to it. Task state remains in `_plan/process/<task-id>/`; feedback does not substitute technical review, merge, finish, or closure.
- Covered project/task identity, tested version/environment, milestone expected/actual results, explicit not-run states, reproducible issues, redacted evidence, and permission to convert feedback into a skill-evolution request.
- `node --test tests/workflow-init.test.cjs`: 7/7 passed, including generated-file/link and existing-file-preservation checks. `npm run skills:lock`: passed. `git diff --check`: passed with existing CRLF normalization notices.
- The template is ready for a real consuming project to fill. No user-side/production platform execution has occurred; the repository test validates initialization and links only.
