import z from "@deepseek-ai/schemastery";
import { livePresetMounts } from "@deepseek-ai/dsh-agent-preset-registry";

export const name = "agent-team-prompt-override";
export const inject = ["systemPrompt"];

const ORIGINAL_FIRST_PARAGRAPH =
  "Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.";

export const DEFAULT_REPLACEMENT =
  "Agent Teams is available in this session. You may create teammates proactively when parallelization, specialization, or independent verification would materially improve the task. Do not wait for the user to explicitly request teammates. Avoid creating teammates for trivial, tightly coupled, or purely sequential work.";

export const Config = z.object({
  replacement: z.string().default(DEFAULT_REPLACEMENT).volatile(),
  disableLegacySubagentTools: z.boolean().default(false).volatile(),
});

export function rewriteTeamPolicy(text, replacement = DEFAULT_REPLACEMENT) {
  if (typeof text !== "string" || text.length === 0) {
    return { text, changed: false, match: "none" };
  }

  if (text.includes(ORIGINAL_FIRST_PARAGRAPH)) {
    return {
      text: text.replace(ORIGINAL_FIRST_PARAGRAPH, replacement),
      changed: true,
      match: "exact",
    };
  }

  // Forward-compatible fallback: if upstream rewrites the wording but keeps
  // the Agent Teams opener as the first paragraph, replace only that paragraph
  // and preserve every later coordination/safety rule verbatim.
  if (text.startsWith("Agent Teams is available")) {
    const paragraphEnd = text.indexOf("\n\n");
    if (paragraphEnd >= 0) {
      return {
        text: replacement + text.slice(paragraphEnd),
        changed: true,
        match: "first-paragraph",
      };
    }
  }

  return { text, changed: false, match: "none" };
}

const LEGACY_SUBAGENT_TOOL_IDS = Object.freeze([
  "tool-subagent-control",
  "tool-subagent-list-agents",
  "tool-subagent",
  "tool-subagent-fork",
]);
const LEGACY_SUBAGENT_TOOL_ID_SET = new Set(LEGACY_SUBAGENT_TOOL_IDS);
const DISABLE_ORDER = Object.freeze([
  "tool-subagent-list-agents",
  "tool-subagent-fork",
  "tool-subagent",
  "tool-subagent-control",
]);
const RESTORE_ORDER = Object.freeze([
  "tool-subagent-control",
  "tool-subagent-list-agents",
  "tool-subagent",
  "tool-subagent-fork",
]);

export function apply(ctx, config) {
  const logger = ctx.logger;

  // Same persistence model as dsh-prompt-persona: Settings owns one volatile
  // boolean in this plugin's profile row. Runtime effects stay in Host code.
  ctx.inject(["settings"], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });

  const live = (value) =>
    value !== null && typeof value === "object" && typeof value.get === "function"
      ? value.get()
      : value;

  const currentReplacement = () => {
    const raw = live(config?.replacement);
    return typeof raw === "string" && raw.trim().length > 0
      ? raw.trim()
      : DEFAULT_REPLACEMENT;
  };

  const shouldDisableLegacyTools = () =>
    live(config?.disableLegacySubagentTools) === true;

  /*
   * Web sessions resolve delegation tools from standing Agent preset trees.
   * Mutating profile/root rows is both redundant and insufficient, so this
   * plugin touches only the authoritative PresetTree entries.
   *
   * Baselines are weakly held: retired preset generations can be collected
   * without waiting for this plugin to be disposed.
   */
  const baseline = new WeakMap();
  let disposed = false;
  let syncTask;
  const pendingSyncReasons = new Set();

  const collectTargets = () => {
    const mounts = livePresetMounts(ctx.root?.fiber);
    const targets = [];
    const byId = new Map(LEGACY_SUBAGENT_TOOL_IDS.map((id) => [id, []]));

    for (const mount of mounts) {
      for (const entry of mount.tree.entries()) {
        const id = entry?.options?.id;
        if (!LEGACY_SUBAGENT_TOOL_ID_SET.has(id)) continue;
        const target = { entry, presetId: mount.presetId };
        targets.push(target);
        byId.get(id).push(target);
      }
    }

    return { mounts, targets, byId };
  };

  const syncLegacyTools = async (reason) => {
    const disable = shouldDisableLegacyTools();
    const { mounts, targets, byId } = collectTargets();
    const order = disable ? DISABLE_ORDER : RESTORE_ORDER;
    let changed = 0;

    for (const id of order) {
      for (const { entry } of byId.get(id)) {
        let targetDisabled;

        if (disable) {
          if (!baseline.has(entry)) baseline.set(entry, Boolean(entry.disabled));
          targetDisabled = true;
        } else {
          if (!baseline.has(entry)) continue;
          targetDisabled = baseline.get(entry);
        }

        if (Boolean(entry.disabled) === targetDisabled) continue;
        await entry.update({ disabled: targetDisabled });
        changed += 1;
      }
    }

    for (const mount of mounts) await mount.tree.await();

    logger.info(
      "agent-team-prompt-override: legacy Subagent policy=%s reason=%s changed=%d targets=%d presetTrees=%d",
      disable ? "disabled" : "inherited",
      reason,
      changed,
      targets.length,
      mounts.length,
    );

    if (disable) {
      const stillEnabled = targets.filter(({ entry }) => !entry.disabled);
      if (stillEnabled.length > 0) {
        logger.warn(
          "agent-team-prompt-override: %d targeted Subagent rows are still enabled after sync: %s",
          stillEnabled.length,
          stillEnabled
            .map(({ entry, presetId }) => presetId + "/" + entry.options.id)
            .join(", "),
        );
      }
    }
  };

  /*
   * entry.update() itself can emit tools/change. Coalesce all triggers while a
   * sync is running; at most one follow-up scan is needed after the mutations
   * settle instead of queueing one Promise per emitted event.
   */
  const scheduleToolSync = (reason) => {
    if (disposed) return Promise.resolve();

    pendingSyncReasons.add(reason);
    if (syncTask !== undefined) return syncTask;

    syncTask = (async () => {
      while (!disposed && pendingSyncReasons.size > 0) {
        const reasons = [...pendingSyncReasons].join("+");
        pendingSyncReasons.clear();
        await syncLegacyTools(reasons);
      }
    })()
      .catch((error) => {
        logger.warn(
          "agent-team-prompt-override: failed to apply Subagent tool policy: %s",
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        syncTask = undefined;
        if (!disposed && pendingSyncReasons.size > 0) {
          void scheduleToolSync("coalesced");
        }
      });

    return syncTask;
  };

  // Covers installations where the standing preset revisions already exist.
  void scheduleToolSync("startup");

  // The checkbox is volatile, so Host receives the new value without remount.
  const disposeVolatile = ctx.on("loader/volatile-update", (paths) => {
    if (
      paths.some(
        (path) =>
          path.length > 0 && path[0] === "disableLegacySubagentTools",
      )
    ) {
      void scheduleToolSync("settings");
    }
  });

  // New/recomposed preset trees register/unregister tool layers, which is the
  // authoritative invalidation signal for rescanning standing revisions.
  const disposeToolsChange = ctx.on("tools/change", () => {
    if (shouldDisableLegacyTools()) void scheduleToolSync("tools-change");
  });

  let warned = false;

  const disposePrompt = ctx.on(
    "system-prompt/assemble",
    async (_assembly, _context, next) => {
      const assembly = await next();
      const section = assembly.sections.find(
        (item) => item.name === "team:policy",
      );

      if (section === undefined) return assembly;

      const rewritten = rewriteTeamPolicy(
        section.text,
        currentReplacement(),
      );
      if (rewritten.changed) {
        section.text = rewritten.text;
        if (rewritten.match === "first-paragraph" && !warned) {
          warned = true;
          logger.warn(
            "agent-team-prompt-override: upstream team:policy opener changed; replaced its first paragraph using the compatibility fallback",
          );
        }
      } else if (!warned) {
        warned = true;
        logger.warn(
          "agent-team-prompt-override: team:policy was found but its opener was not recognized; leaving the official prompt unchanged",
        );
      }

      return assembly;
    },
  );

  return async () => {
    disposed = true;
    pendingSyncReasons.clear();
    disposeVolatile?.();
    disposeToolsChange?.();
    disposePrompt?.();

    // WeakMap is intentionally non-enumerable. Restore only currently live
    // preset entries; retired generations are already outside the runtime.
    const { mounts, byId } = collectTargets();
    for (const id of RESTORE_ORDER) {
      for (const { entry } of byId.get(id)) {
        if (!baseline.has(entry)) continue;
        const targetDisabled = baseline.get(entry);
        try {
          if (Boolean(entry.disabled) !== targetDisabled) {
            await entry.update({ disabled: targetDisabled });
          }
        } catch {
          // The preset generation may retire between collection and restore.
        }
      }
    }
    for (const mount of mounts) {
      try {
        await mount.tree.await();
      } catch {
        // A preset generation may already be retiring.
      }
    }
  };
}

export default { name, inject, Config, apply };
