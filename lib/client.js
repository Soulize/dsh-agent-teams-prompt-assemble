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

    function PromptOverrideForm({ form }) {
      const state = form?.state;
      const acceptedReplacement =
        typeof state?.value?.replacement === "string" && state.value.replacement.trim().length > 0
          ? state.value.replacement
          : DEFAULT_REPLACEMENT;
      const acceptedDisableLegacyTools = state?.value?.disableLegacySubagentTools === true;

      const [draft, setDraft] = React.useState({
        replacement: acceptedReplacement,
        disableLegacySubagentTools: acceptedDisableLegacyTools,
      });
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState("");
      const [error, setError] = React.useState("");

      React.useEffect(() => {
        setDraft({
          replacement: acceptedReplacement,
          disableLegacySubagentTools: acceptedDisableLegacyTools,
        });
        setMessage("");
        setError("");
      }, [state?.revision, acceptedReplacement, acceptedDisableLegacyTools]);

      const ready = Boolean(form) && state?.status === "ready" && state?.writable !== false;
      const dirty =
        draft.replacement !== acceptedReplacement
        || draft.disableLegacySubagentTools !== acceptedDisableLegacyTools;

      const save = async () => {
        const replacement = draft.replacement.trim();
        if (!replacement) {
          setError("替换提示词不能为空。");
          return;
        }
        if (!form || !ready) return;

        const toolPolicyChanged =
          draft.disableLegacySubagentTools !== acceptedDisableLegacyTools;
        const ops = [];
        if (replacement !== acceptedReplacement) {
          ops.push({ op: "set", path: ["replacement"], value: replacement });
        }
        if (toolPolicyChanged) {
          ops.push({
            op: "set",
            path: ["disableLegacySubagentTools"],
            value: draft.disableLegacySubagentTools,
          });
        }
        if (ops.length === 0) return;

        setSaving(true);
        setMessage("");
        setError("");
        try {
          const ok = await form.mutate(ops, state?.revision);
          if (!ok) {
            setError("保存被 Host 拒绝，请刷新后重试。");
            return;
          }
          setDraft((current) => ({ ...current, replacement }));
          setMessage(
            toolPolicyChanged
              ? (draft.disableLegacySubagentTools
                  ? "已保存。Host 将四个普通 Subagent Cordis entry 设为 disabled。"
                  : "已保存。Host 将四个普通 Subagent entry 恢复到插件介入前的继承状态。")
              : "已保存。下一次 system prompt 组装立即生效。"
          );
        } catch (e) {
          setError("保存失败：" + (e instanceof Error ? e.message : String(e)));
        } finally {
          setSaving(false);
        }
      };

      const reset = () => {
        setDraft((current) => ({ ...current, replacement: DEFAULT_REPLACEMENT }));
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
          value: draft.replacement,
          disabled: saving || state?.status !== "ready",
          spellCheck: false,
          onChange: (event) => {
            setDraft((current) => ({ ...current, replacement: event.target.value }));
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
            checked: draft.disableLegacySubagentTools,
            disabled: saving || state?.status !== "ready",
            onChange: (event) => {
              setDraft((current) => ({ ...current, disableLegacySubagentTools: event.target.checked }));
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
              "该选项作为 volatile Config 写入当前 profile 的 cordis.patch.yml；Host 会同时处理 profile 层和 standard / ptc / cordis 等 Agent preset 的 standing PresetTree，把下列四个同名 entry 设为 disabled。取消勾选会恢复插件介入前的继承状态。"
            ),
            React.createElement(
              "span",
              { className: "dshatpo-toolids" },
              LEGACY_SUBAGENT_TOOL_IDS.join("\n")
            ),

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
              disabled: saving || draft.replacement === DEFAULT_REPLACEMENT,
              onClick: reset,
            },
            "恢复默认"
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dshatpo-btn dshatpo-save",
              disabled: saving || !ready || !dirty || !draft.replacement.trim(),
              onClick: save,
            },
            saving ? "保存中…" : "保存"
          ),
          message ? React.createElement("span", { className: "dshatpo-status" }, message) : null,
          error ? React.createElement("span", { className: "dshatpo-error" }, error) : null
        )
      );
    }

    const inject = ["slots"];

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
              : React.createElement(PromptOverrideForm, { form })
        )
      );
    }

    return { inject, apply };
  },
});
