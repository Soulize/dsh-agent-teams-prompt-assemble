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

export function apply(ctx, config) {
  const logger = ctx.logger;
  const TOOL_IDS = Object.freeze([
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
  const RESTORE_ORDER = Object.freeze([
    "tool-subagent-control",
    "tool-subagent-list-agents",
    "tool-subagent",
    "tool-subagent-fork",
  ]);

  // Same persistence model as dsh-prompt-persona: the option itself is one
  // volatile Config field persisted by Settings into the profile patch.
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

  const shouldDisableLegacyTools = () => live(config?.disableLegacySubagentTools) === true;

  /*
   * Web sessions do NOT use the four top-level dsh-base rows directly.
   * standard/ptc/cordis/etc. each mount their own in-memory PresetTree with a
   * nested "delegation" group containing another set of rows with these ids.
   * Updating only ctx.loader therefore changes the profile plane but leaves
   * the model-facing preset tools alive. Track both planes.
   */
  const baseline = new Map();
  let syncChain = Promise.resolve();
  let disposed = false;

  const loaderOf = () => {
    try {
      if (typeof ctx.get === "function") {
        const value = ctx.get("loader");
        if (value !== undefined) return value;
      }
    } catch {
      // fall through
    }
    return ctx.loader ?? ctx.root?.loader;
  };

  const remember = (entry) => {
    if (!baseline.has(entry)) baseline.set(entry, Boolean(entry.disabled));
  };

  const collectTargets = () => {
    const targets = [];
    const seen = new Set();
    const trees = new Set();
    const rootLoader = loaderOf();

    const add = (entries, source) => {
      for (const entry of entries) {
        if (!TOOL_IDS.includes(entry?.options?.id) || seen.has(entry)) continue;
        seen.add(entry);
        remember(entry);
        targets.push({ entry, source });
      }
    };

    if (rootLoader !== undefined) {
      add(rootLoader.entries(), "profile");
    }

    const rootFiber = ctx.root?.fiber;
    for (const mount of livePresetMounts(rootFiber)) {
      trees.add(mount.tree);
      add(mount.tree.entries(), "preset:" + mount.presetId);
    }

    return { rootLoader, trees: [...trees], targets };
  };

  const syncLegacyTools = async (reason) => {
    const desired = shouldDisableLegacyTools();
    const { rootLoader, trees, targets } = collectTargets();
    const order = desired ? DISABLE_ORDER : RESTORE_ORDER;
    let changed = 0;

    for (const id of order) {
      for (const { entry } of targets) {
        if (entry.options.id !== id) continue;
        const targetDisabled = desired
          ? true
          : (baseline.get(entry) ?? Boolean(entry.disabled));
        if (Boolean(entry.disabled) === targetDisabled) continue;
        await entry.update({ disabled: targetDisabled });
        changed += 1;
      }
    }

    if (rootLoader !== undefined) await rootLoader.await();
    for (const tree of trees) await tree.await();

    const bySource = new Map();
    for (const { entry, source } of targets) {
      const current = bySource.get(source) ?? { count: 0, disabled: 0 };
      current.count += 1;
      if (entry.disabled) current.disabled += 1;
      bySource.set(source, current);
    }

    const presetRows = [...bySource.entries()]
      .filter(([source]) => source.startsWith("preset:"))
      .map(([source, value]) => source + "=" + value.disabled + "/" + value.count)
      .join(", ");

    logger.info(
      "agent-team-prompt-override: legacy Subagent policy=%s reason=%s changed=%d targets=%d presets=[%s]",
      desired ? "disabled" : "inherited",
      reason,
      changed,
      targets.length,
      presetRows,
    );

    if (desired) {
      const stillEnabled = targets.filter(({ entry }) => !entry.disabled);
      if (stillEnabled.length > 0) {
        logger.warn(
          "agent-team-prompt-override: %d targeted Subagent rows are still enabled after sync: %s",
          stillEnabled.length,
          stillEnabled.map(({ entry, source }) => source + "/" + entry.options.id).join(", "),
        );
      }
    }
  };

  const scheduleToolSync = (reason) => {
    syncChain = syncChain
      .then(() => disposed ? undefined : syncLegacyTools(reason))
      .catch((error) => {
        logger.warn(
          "agent-team-prompt-override: failed to apply Subagent tool policy: %s",
          error instanceof Error ? error.message : String(error),
        );
      });
    return syncChain;
  };

  const rootLoader = loaderOf();
  if (rootLoader !== undefined) {
    void rootLoader.await().then(() => scheduleToolSync("startup"));
  } else {
    void scheduleToolSync("startup");
  }

  // Settings commits volatile values into this owning fiber without remounting.
  const disposeVolatile = ctx.on("loader/volatile-update", (paths) => {
    if (paths.some((path) => path.length > 0 && path[0] === "disableLegacySubagentTools")) {
      void scheduleToolSync("settings");
    }
  });

  // A preset revision can be mounted after this plugin starts. Its tool
  // registrations emit tools/change; while the policy is enabled, rescan the
  // standing preset mounts and immediately disable matching rows there too.
  const disposeToolsChange = ctx.on("tools/change", () => {
    if (shouldDisableLegacyTools()) void scheduleToolSync("tools-change");
  });

  // Profile HMR can replace a preset declaration with a new PresetTree.
  const disposeReload = ctx.on("app-boot/config-reload", () => {
    if (shouldDisableLegacyTools()) void scheduleToolSync("config-reload");
  });

  let warned = false;

  const disposePrompt = ctx.on("system-prompt/assemble", async (_assembly, _context, next) => {
    const assembly = await next();
    const section = assembly.sections.find((item) => item.name === "team:policy");

    if (section === undefined) return assembly;

    const rewritten = rewriteTeamPolicy(section.text, currentReplacement());
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
  });

  return async () => {
    disposed = true;
    disposeVolatile?.();
    disposeToolsChange?.();
    disposeReload?.();
    disposePrompt?.();

    // Do not leave standing preset trees modified if this plugin is disabled,
    // uninstalled, or hot-replaced.
    for (const [entry, wasDisabled] of [...baseline.entries()].reverse()) {
      try {
        if (Boolean(entry.disabled) !== wasDisabled) {
          await entry.update({ disabled: wasDisabled });
        }
      } catch {
        // The preset generation may already have been retired.
      }
    }
  };
}

export default { name, inject, Config, apply };
