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

## Configuration UI

After installation, open:

`Plugins -> dsh-agent-team-prompt-override -> agent-team-prompt-override -> Configure`

The page contains a multiline editor for the replacement paragraph plus **Reset default** and **Save** buttons.

Saving writes the `replacement` field into the current profile configuration and takes effect on the next system-prompt assembly. No DSH restart is required after changing the prompt.

The UI changes only the first paragraph of the official `team:policy`; the remaining official Agent Teams coordination rules stay intact.

### Disable the legacy Subagent tools

The same Configure page has a **禁用普通 Subagent 工具** checkbox for:

```text
tool-subagent-control
tool-subagent-list-agents
tool-subagent
tool-subagent-fork
```

This now follows the same persistence model as `dsh-prompt-persona`: the checkbox is an ordinary volatile Config field owned by this plugin. Saving it goes through the Plugins config form / Settings service, which persists the value into the current profile's `cordis.patch.yml`:

```yaml
- id: agent-team-prompt-override
  name: dsh-agent-team-prompt-override
  config:
    disableLegacySubagentTools: true
```

The Host half reads that live Config value and updates the model-facing Agent preset standing `PresetTree` rows returned by `livePresetMounts()`.

The shipped `standard`, `ptc`, `cordis`, and related presets each contain a nested `delegation` group with their own `tool-subagent-*` rows. Those standing preset trees are the authoritative tool plane for Web sessions, so the plugin no longer mutates redundant profile/root rows.

The plugin keeps each touched entry's inherited `disabled` state in a `WeakMap`. Turning the checkbox off, disabling the plugin, or hot-replacing it restores the currently live entries to that prior state without retaining retired preset generations. Tool-change bursts are coalesced into one running sync plus at most one follow-up scan.


## Custom replacement via YAML

You can still edit the same field manually in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`.

Example:

```yaml
- id: agent-team-prompt-override
  name: dsh-agent-team-prompt-override
  config:
    replacement: >-
      Agent Teams is available in this session. Use teammates proactively whenever independent parallel work would improve the result.
    disableLegacySubagentTools: true
```

## Compatibility behavior

The plugin first matches the exact current official first paragraph. If upstream changes that sentence but the section still starts with `Agent Teams is available`, it replaces only the first paragraph and logs one compatibility warning.

If the section no longer has a recognizable opener, it logs one warning and leaves the official prompt untouched rather than guessing.


## 中文配置说明

安装后进入：

`插件 -> dsh-agent-team-prompt-override -> agent-team-prompt-override -> 配置`

在多行文本框里直接填写你希望替换进去的 Agent Teams 第一段提示词，然后点 **保存**。保存后下一次 system prompt 组装立即生效，不需要重启 DSH。

**恢复默认** 只把编辑框恢复为本插件默认文案，仍需要点击 **保存** 才会写入配置。

另外配置页新增 **禁用普通 Subagent 工具**。这个选项现在和 `dsh-prompt-persona` 一样，作为本插件自己的 volatile Config 保存到当前 profile 的 `cordis.patch.yml`：

```yaml
- id: agent-team-prompt-override
  name: dsh-agent-team-prompt-override
  config:
    disableLegacySubagentTools: true
```

Host 半身只处理 Web Agent preset 的 standing `PresetTree`。这才是会话真正使用的工具层：`standard`、`ptc`、`cordis` 等 preset 都在自己的嵌套 `delegation` group 里声明了四个 `tool-subagent-*`。不再扫描和修改冗余的 profile/root row。

每个被修改 entry 的原始 `disabled` 状态放在 `WeakMap` 里；取消勾选、插件卸载或热替换时，只恢复当前仍存活的 preset entry，因此 retired generation 不会被强引用保留。连续 `tools/change` 事件也会合并，避免一次切换排出多轮无意义扫描。
