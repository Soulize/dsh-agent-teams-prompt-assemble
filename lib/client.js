window.__ModuleLoader__.load({
  id: "dsh-agent-team-prompt-override",
  factory(require) {
    const React = require("react");

    const DEFAULT_REPLACEMENT =
      "Agent Teams is available in this session. You may create teammates proactively when parallelization, specialization, or independent verification would materially improve the task. Do not wait for the user to explicitly request teammates. Avoid creating teammates for trivial, tightly coupled, or purely sequential work.";

    const LEGACY_SUBAGENT_TOOL_IDS = Object.freeze([
      "tool-subagent-control",
      "tool-subagent-list-agents",
      "tool-subagent",
      "tool-subagent-fork",
    ]);

    const DISABLE_ORDER = Object.freeze([
      "tool-subagent-list-agents",
      "tool-subagent-fork",
      "tool-subagent",
      "tool-subagent-control",
    ]);

    const ENABLE_ORDER = Object.freeze([
      "tool-subagent-control",
      "tool-subagent-list-agents",
      "tool-subagent",
      "tool-subagent-fork",
    ]);

    function answerError(answer, fallback) {
      return answer?.error?.message || fallback;
    }

    async function readLegacyToolState(pluginManager) {
      const answer = await pluginManager.listPlugins();
      if (!answer?.ok) {
        throw new Error(answerError(answer, "无法读取 Cordis 插件状态。"));
      }

      const rows = new Map();
      for (const row of answer.value) {
        if (LEGACY_SUBAGENT_TOOL_IDS.includes(row.patchId)) rows.set(row.patchId, row);
      }

      const missing = LEGACY_SUBAGENT_TOOL_IDS.filter((id) => !rows.has(id));
      if (missing.length > 0) {
        throw new Error("当前 profile 中找不到这些 Cordis 行：" + missing.join(", "));
      }

      const readonly = LEGACY_SUBAGENT_TOOL_IDS
        .map((id) => rows.get(id))
        .filter((row) => row?.readOnlyReason);
      if (readonly.length > 0) {
        throw new Error(
          "这些 Cordis 行当前不可由 profile patch 修改：" +
          readonly.map((row) => row.patchId + " (" + row.readOnlyReason + ")").join(", ")
        );
      }

      const enabled = LEGACY_SUBAGENT_TOOL_IDS.map((id) => rows.get(id)?.enabled === true);
      return {
        disabled: enabled.every((value) => !value),
        mixed: enabled.some(Boolean) && enabled.some((value) => !value),
      };
    }

    async function setLegacyToolsDisabled(pluginManager, disabled) {
      const order = disabled ? DISABLE_ORDER : ENABLE_ORDER;
      const wantEnabled = !disabled;

      // PluginManager persists each change as a top-level id override in the
      // profile's cordis.patch.yml. Re-read before every write because each
      // HMR recomposition can replace Loader entry identities.
      for (const patchId of order) {
        const listed = await pluginManager.listPlugins();
        if (!listed?.ok) {
          throw new Error(answerError(listed, "无法刷新 Cordis 插件状态。"));
        }
        const row = listed.value.find((item) => item.patchId === patchId);
        if (!row) throw new Error("找不到 Cordis 行：" + patchId);
        if (row.readOnlyReason) {
          throw new Error(patchId + " 当前不可修改：" + row.readOnlyReason);
        }
        if (row.enabled === wantEnabled) continue;

        const changed = await pluginManager.setPluginEnabled(row.entryId, wantEnabled);
        if (!changed?.ok) {
          throw new Error(answerError(changed, "修改 " + patchId + " 失败。"));
        }
        if (changed.value?.application === "failed") {
          const detail = changed.value?.error?.diagnostic || changed.value?.error?.code || "unknown";
          throw new Error("修改 " + patchId + " 失败：" + detail);
        }
      }

      const finalState = await readLegacyToolState(pluginManager);
      if (disabled && !finalState.disabled) {
        throw new Error("disabled 覆盖已写入，但至少一个 Subagent 工具仍被更高优先级配置启用。");
      }
      if (!disabled && (finalState.disabled || finalState.mixed)) {
        throw new Error("enabled 覆盖已写入，但至少一个 Subagent 工具仍未启用。");
      }
      return finalState;
    }

    const css = [
      ".dshatpo-wrap{display:flex;flex-direction:column;gap:16px;max-width:900px}",
      ".dshatpo-summary{color:#6e6e73;font-size:13px}",
      "@media(prefers-color-scheme:dark){.dshatpo-summary{color:#a1a1a6}}",
      ".dshatpo-label{font-size:14px;font-weight:600;color:inherit}",
      ".dshatpo-textarea{width:100%;min-height:220px;resize:vertical;box-sizing:border-box;border:1px solid rgba(0,0,0,.12);border-radius:12px;padding:12px 14px;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:rgba(0,0,0,.025);color:inherit;outline:none}",
      ".dshatpo-textarea:focus{border-color:#0071e3;box-shadow:0 0 0 3px rgba(0,113,227,.18)}",
      "@media(prefers-color-scheme:dark){.dshatpo-textarea{border-color:rgba(255,255,255,.12);background:rgba(255,255,255,.04)}.dshatpo-textarea:focus{border-color:#0a84ff;box-shadow:0 0 0 3px rgba(10,132,255,.2)}}",
      ".dshatpo-hint{margin:0;color:#6e6e73;font-size:13px;line-height:1.5}",
      "@media(prefers-color-scheme:dark){.dshatpo-hint{color:#a1a1a6}}",
      ".dshatpo-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
      ".dshatpo-btn{height:34px;padding:0 14px;border-radius:9px;border:1px solid rgba(0,0,0,.12);background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}",
      "@media(prefers-color-scheme:dark){.dshatpo-btn{border-color:rgba(255,255,255,.16)}}",
      ".dshatpo-btn:disabled{opacity:.5;cursor:default}",
      ".dshatpo-save{border:0;background:#0071e3;color:#fff;font-weight:600}",
      "@media(prefers-color-scheme:dark){.dshatpo-save{background:#0a84ff}}",
      ".dshatpo-status{font-size:13px;color:#248a3d}",
      ".dshatpo-error{font-size:13px;color:#d70015}",
      "@media(prefers-color-scheme:dark){.dshatpo-status{color:#30d158}.dshatpo-error{color:#ff453a}}",
      ".dshatpo-original{padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.035);font-size:12px;line-height:1.5;color:#6e6e73}",
      "@media(prefers-color-scheme:dark){.dshatpo-original{background:rgba(255,255,255,.045);color:#a1a1a6}}",
      ".dshatpo-toggle{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid rgba(0,0,0,.10);border-radius:12px}",
      "@media(prefers-color-scheme:dark){.dshatpo-toggle{border-color:rgba(255,255,255,.12)}}",
      ".dshatpo-toggle input{margin-top:3px}",
      ".dshatpo-toggle-copy{display:flex;flex-direction:column;gap:4px}",
      ".dshatpo-toolids{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#6e6e73}",
      "@media(prefers-color-scheme:dark){.dshatpo-toolids{color:#a1a1a6}}"
    ].join("");

    const tagId = "dsh-agent-team-prompt-override/settings.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-agent-team-prompt-override";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    function PromptOverrideForm({ form, pluginManager }) {
      const state = form?.state;
      const accepted =
        typeof state?.value?.replacement === "string" && state.value.replacement.trim().length > 0
          ? state.value.replacement
          : DEFAULT_REPLACEMENT;

      const [draft, setDraft] = React.useState(accepted);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState("");
      const [error, setError] = React.useState("");
      const [toolsStatus, setToolsStatus] = React.useState("loading");
      const [toolsError, setToolsError] = React.useState("");
      const [disableLegacyTools, setDisableLegacyTools] = React.useState(false);
      const [acceptedDisableLegacyTools, setAcceptedDisableLegacyTools] = React.useState(false);
      const [toolsMixed, setToolsMixed] = React.useState(false);

      const refreshLegacyTools = React.useCallback(async () => {
        if (!pluginManager) {
          setToolsStatus("error");
          setToolsError("PluginManager Remote 不可用。");
          return;
        }
        setToolsStatus("loading");
        setToolsError("");
        try {
          const current = await readLegacyToolState(pluginManager);
          setDisableLegacyTools(current.disabled);
          setAcceptedDisableLegacyTools(current.disabled);
          setToolsMixed(current.mixed);
          setToolsStatus("ready");
        } catch (e) {
          setToolsStatus("error");
          setToolsError(e instanceof Error ? e.message : String(e));
        }
      }, [pluginManager]);

      React.useEffect(() => {
        setDraft(accepted);
        setMessage("");
        setError("");
      }, [state?.revision, accepted]);

      React.useEffect(() => {
        void refreshLegacyTools();
      }, [refreshLegacyTools]);

      const ready = Boolean(form) && state?.status === "ready" && state?.writable !== false;
      const promptDirty = draft !== accepted;
      const toolsDirty = toolsStatus === "ready" && disableLegacyTools !== acceptedDisableLegacyTools;
      const dirty = promptDirty || toolsDirty;

      const save = async () => {
        const value = draft.trim();
        if (!value) {
          setError("替换提示词不能为空。");
          return;
        }
        if (!form || !ready) return;
        if (toolsDirty && toolsStatus !== "ready") {
          setError("Subagent 工具状态尚未就绪。");
          return;
        }

        setSaving(true);
        setMessage("");
        setError("");
        let promptSaved = false;
        try {
          // Save this row's config first. PluginManager changes recompose the
          // profile and can advance revisions, so doing the form mutation after
          // them would risk submitting a stale revision.
          if (promptDirty) {
            const ok = await form.mutate(
              [{ op: "set", path: ["replacement"], value }],
              state?.revision
            );
            if (!ok) {
              setError("保存提示词被 Host 拒绝，请刷新后重试。");
              return;
            }
            promptSaved = true;
            setDraft(value);
          }

          if (toolsDirty) {
            const finalState = await setLegacyToolsDisabled(pluginManager, disableLegacyTools);
            setAcceptedDisableLegacyTools(finalState.disabled);
            setDisableLegacyTools(finalState.disabled);
            setToolsMixed(finalState.mixed);
          }

          setMessage(
            toolsDirty
              ? (disableLegacyTools
                  ? "已保存；四个普通 Subagent 工具已通过 profile cordis.patch.yml 设为 disabled: true。"
                  : "已保存；四个普通 Subagent 工具已通过 profile cordis.patch.yml 重新启用。")
              : "已保存。下一次 system prompt 组装立即生效，无需重启。"
          );
          if (toolsDirty) await refreshLegacyTools();
        } catch (e) {
          const prefix = promptSaved ? "提示词已保存，但工具开关修改失败：" : "保存失败：";
          setError(prefix + (e instanceof Error ? e.message : String(e)));
          await refreshLegacyTools();
        } finally {
          setSaving(false);
        }
      };

      const reset = () => {
        setDraft(DEFAULT_REPLACEMENT);
        setMessage("");
        setError("");
      };

      if (!form || state?.status === "unavailable") {
        return React.createElement(
          "div",
          { className: "dshatpo-wrap" },
          React.createElement("p", { className: "dshatpo-error" }, "当前 profile 的配置不可写，无法显示编辑器。")
        );
      }

      return React.createElement(
        "div",
        { className: "dshatpo-wrap" },
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "dshatpo-label" }, "替换后的 Agent Teams 第一段提示词"),
          React.createElement(
            "p",
            { className: "dshatpo-hint" },
            "这里只替换官方 team:policy 的第一段。共享文件系统、任务、send_message、wait_agent 等后续官方规则全部保留。"
          )
        ),
        React.createElement(
          "div",
          { className: "dshatpo-original" },
          "官方原句：Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates."
        ),
        React.createElement("textarea", {
          className: "dshatpo-textarea",
          value: draft,
          disabled: saving || state?.status !== "ready",
          spellCheck: false,
          onChange: (event) => {
            setDraft(event.target.value);
            setMessage("");
            setError("");
          },
          "aria-label": "Agent Teams replacement prompt",
        }),
        React.createElement(
          "label",
          { className: "dshatpo-toggle" },
          React.createElement("input", {
            type: "checkbox",
            checked: disableLegacyTools,
            disabled: saving || toolsStatus !== "ready",
            onChange: (event) => {
              setDisableLegacyTools(event.target.checked);
              setMessage("");
              setError("");
            },
            "aria-label": "禁用普通 Subagent 工具",
          }),
          React.createElement(
            "span",
            { className: "dshatpo-toggle-copy" },
            React.createElement("span", { className: "dshatpo-label" }, "禁用普通 Subagent 工具"),
            React.createElement(
              "span",
              { className: "dshatpo-hint" },
              "勾选后通过官方 PluginManager 写入 profile 的 cordis.patch.yml，将下列四个 Cordis 行统一设为 disabled: true；取消勾选则统一设为 disabled: false。"
            ),
            React.createElement(
              "span",
              { className: "dshatpo-toolids" },
              LEGACY_SUBAGENT_TOOL_IDS.join("\n")
            ),
            toolsMixed
              ? React.createElement("span", { className: "dshatpo-error" }, "当前四个工具的启用状态不一致；保存后会按本选项统一。")
              : null,
            toolsStatus === "loading"
              ? React.createElement("span", { className: "dshatpo-summary" }, "正在读取 Cordis 工具状态…")
              : null,
            toolsStatus === "error"
              ? React.createElement("span", { className: "dshatpo-error" }, toolsError)
              : null
          )
        ),
        React.createElement(
          "div",
          { className: "dshatpo-actions" },
          React.createElement(
            "button",
            {
              type: "button",
              className: "dshatpo-btn",
              disabled: saving || draft === DEFAULT_REPLACEMENT,
              onClick: reset,
            },
            "恢复默认"
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dshatpo-btn dshatpo-save",
              disabled: saving || !ready || !dirty || !draft.trim(),
              onClick: save,
            },
            saving ? "保存中…" : "保存"
          ),
          message ? React.createElement("span", { className: "dshatpo-status" }, message) : null,
          error ? React.createElement("span", { className: "dshatpo-error" }, error) : null
        )
      );
    }

    const inject = ["slots", "remote", "remote.pluginManager"];

    function apply(ctx) {
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register(
          {
            name: "plugins.row.config",
            key: "dsh-agent-team-prompt-override#agent-team-prompt-override",
          },
          ({ view, form }) =>
            view === "summary"
              ? React.createElement("span", { className: "dshatpo-summary" }, "修改 Agent Teams 创建队友策略，并可禁用普通 Subagent 工具")
              : React.createElement(PromptOverrideForm, { form, pluginManager: ctx.remote.pluginManager })
        )
      );
    }

    return { inject, apply };
  },
});
