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

The Host half reads that live Config value and updates both places where those ids can exist:

- the profile/root Loader rows;
- every live Agent preset standing `PresetTree` returned by `livePresetMounts()`.

This second plane is required in Web profiles. The shipped `standard`, `ptc`, `cordis`, and related presets each contain a nested `delegation` group with their own `tool-subagent-*` rows. Disabling only the top-level profile rows does **not** remove those model-facing preset tools.

The plugin records each target entry's inherited `disabled` state before changing it. When the checkbox is turned off, or the plugin is disposed, those entries are restored to that prior state rather than forcing `disabled: false` over another bundle/preset decision. New preset generations are re-scanned on tool-registration changes and profile reloads.


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

Host 半身读取该值后，会同时处理两层同名 entry：

- profile/root Loader 里的四个 `tool-subagent-*`；
- Web Agent preset 的 standing `PresetTree` 里的四个 `tool-subagent-*`。

后者才是 Web 会话真正使用的那一层：`standard`、`ptc`、`cordis` 等 preset 都在自己的嵌套 `delegation` group 里重新声明了这些工具。只禁用 profile 顶层 row 并不会让当前 preset 的模型工具消失。

取消勾选或插件卸载时，会恢复每个 entry 在插件介入前的继承状态，不强行写成 `disabled: false`。preset 新 revision / HMR 后也会重新扫描。
