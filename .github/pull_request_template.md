## PR Context (for humans + agents)

```yaml
pr_context:
  version: 1
  change_type: feat # feat|fix|docs|refactor|test|chore
  scope: "" # short scope, e.g. listing-gtm/proof-page
  linked_issue: "" # optional issue/ticket URL or ID
  release_blocking: false
  risk_level: low # low|medium|high
  breaking_change: false
  db_migration: false
  requires_follow_up: false
  owner: "" # DRI for this PR
  approver: "" # final signoff owner
  publisher: "" # who deploys/ships
```

## Summary
- What changed?
- Why now?

## Change Set
- Main files/areas touched:
- User-visible behavior changes:
- Non-goals (what this PR does not do):

## Test Plan
- Commands run:
- Results:
- Manual checks (if any):

## Risk and Rollback
- Main risks:
- Rollback or mitigation plan:

## Handoff Notes
- Open follow-ups:
- Decisions needed:
- Deployment/publish steps:

## Checklist
- [ ] Scope is focused and reviewable.
- [ ] Docs updated (if behavior changed).
- [ ] Tests added/updated where appropriate.
- [ ] No secrets or sensitive data included.
- [ ] Owner/Approver/Publisher set in `pr_context`.
