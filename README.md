# dsh-agent-team-prompt-override

Small DeepSeek Harness plugin that changes the official Agent Teams prompt gate without modifying the Agent Teams package itself.

The official policy currently begins with:

> Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.

This plugin changes only that first paragraph to:

> Agent Teams is available in this session. You may create teammates proactively when parallelization, specialization, or independent verification would materially improve the task. Do not wait for the user to explicitly request teammates. Avoid creating teammates for trivial, tightly coupled, or purely sequential work.

Everything after the first paragraph of the official `team:policy` section is preserved.

## Why it uses system-prompt/assemble

The official Agent Teams plugin registers `team:policy` inside each Agent's `agent.ctx`. Registering another section with the same name in the same scope would throw a duplicate-section error.

This plugin instead waits for the authoritative `system-prompt/assemble` waterfall, finds the already assembled `team:policy` section, and rewrites only its first paragraph.

If Agent Teams is not enabled for the current agent/session, the plugin does nothing.

## Install

```sh
dsh plugin --profile web add "github:Soulize/dsh-agent-teams-prompt-assemble#main"
```

If an older Git resolution is already installed, pin a concrete commit SHA to force that exact build.

Restart DSH after installation.

## Custom replacement

The plugin exposes one config field, `replacement`. If you want different wording, set it on the `agent-team-prompt-override` row in the profile patch.

Example:

```yaml
- id: agent-team-prompt-override
  name: dsh-agent-team-prompt-override
  config:
    replacement: >-
      Agent Teams is available in this session. Use teammates proactively whenever independent parallel work would improve the result.
```

## Compatibility behavior

The plugin first matches the exact current official first paragraph. If upstream changes that sentence but the section still starts with `Agent Teams is available`, it replaces only the first paragraph and logs one compatibility warning.

If the section no longer has a recognizable opener, it logs one warning and leaves the official prompt untouched rather than guessing.
