# Illustrated map backgrounds merged into local main

## Context and decision

The user explicitly requested merging the illustrated-map implementation into main. Committed only this feature's source, tests, skills, documentation and two related journal entries from `codex/illustrated-map-overlays` as `83b96e3` (`Add illustrated map backgrounds with live overlays`). Two unrelated pre-existing local setup journal entries remain untracked and unchanged.

## Completed changes and verification

Switched to `main` and fast-forwarded it from `6d298ab` to `83b96e3` without conflicts. Confirmed identical trees between main and the feature branch, and checked the staged diff for whitespace errors before committing. No behavior changed during this merge, so the previously completed 63-test suite, typecheck, isolated journal integration, package build and live host-generation verification remain applicable; they were not rerun for this fast-forward.

## Limitations and next steps

This is a local merge; nothing was pushed and no existing campaign installation was updated. Automatic skill selection in a fresh campaign chat remains untested, as recorded in the implementation entry. The feature branch is retained. This integration note is committed separately on main.
