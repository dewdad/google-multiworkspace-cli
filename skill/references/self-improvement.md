# Self-Improvement Protocol

This skill is designed to evolve through agent usage. When agents encounter issues, discover better patterns, or optimize workflows, they record feedback that future invocations can learn from.

## Feedback Directory

```
$SKILL_DIR/.feedback/
├── issues.jsonl      # Problems encountered (append-only)
├── changes.jsonl     # Skill modifications made by agents (append-only)
└── patterns.jsonl    # Discovered usage patterns (append-only)
```

## Recording Issues

When a command fails unexpectedly or produces suboptimal results:

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","type":"issue","command":"<what was run>","error":"<what happened>","context":"<what the user was trying to do>","resolution":"<how it was fixed or null>"}' >> "$SKILL_DIR/.feedback/issues.jsonl"
```

## Recording Changes

When an agent modifies any skill file (SKILL.md, references, scripts):

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","type":"change","file":"<path>","description":"<what changed and why>","trigger":"<issue that caused this>"}' >> "$SKILL_DIR/.feedback/changes.jsonl"
```

## Recording Patterns

When an agent discovers a useful multi-step workflow:

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","type":"pattern","name":"<short name>","steps":["step1","step2"],"context":"<when to use this pattern>"}' >> "$SKILL_DIR/.feedback/patterns.jsonl"
```

## Self-Healing Rules

Agents MAY modify skill files when:
1. A command reference is incorrect (API changed, wrong params)
2. A troubleshooting entry is missing for a newly-discovered error
3. A script has a bug that was diagnosed and fixed
4. A pattern is so common it should be in SKILL.md

Agents MUST NOT:
1. Remove existing working functionality
2. Change the skill's core architecture without user approval
3. Modify the frontmatter (name, description) without explicit request
4. Delete feedback logs

## Improvement Triggers

After accumulating 3+ issues of the same type:
1. The agent SHOULD propose a fix to the relevant reference or script
2. If the fix is low-risk (documentation update), apply directly
3. If the fix changes behavior (script logic), propose to the user first

## Version Tracking

Changes accumulate in `.feedback/changes.jsonl`. Periodically (or on user request), these should be reviewed and the skill's `metadata.version` bumped in SKILL.md frontmatter.

## Sharing Improvements

If this skill is installed via `skillshare install --track`, improvements can be contributed upstream via:
1. Agent creates a summary of changes from `.feedback/changes.jsonl`
2. User reviews and approves
3. Changes are committed to the skill's git repository
