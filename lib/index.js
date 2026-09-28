import z from "@deepseek-ai/schemastery";

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

  // Same persistence model as dsh-prompt-persona: this plugin owns volatile
  // Config fields, and Settings writes those fields into the current profile's
  // cordis.patch.yml. Runtime effects are derived from the live Config refs.
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

  // Baseline is captured before this plugin touches a row. Turning the option
  // off therefore restores the composition's inherited state rather than
  // forcing disabled:false over another bundle/profile decision.
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

  const resolveRows = (loader) => {
    const byId = new Map();
    for (const id of TOOL_IDS) {
      const matches = [...loader.entries()].filter((entry) => entry?.options?.id === id);
      if (matches.length === 1) {
        byId.set(id, matches[0]);
        if (!baseline.has(id)) baseline.set(id, Boolean(matches[0].disabled));
      } else if (matches.length > 1) {
        logger.warn(
          "agent-team-prompt-override: cannot control %s because %d loader entries share that id",
          id,
          matches.length,
        );
      }
    }
    return byId;
  };

  const syncLegacyTools = async (reason) => {
    const loader = loaderOf();
    if (loader === undefined) {
      logger.warn("agent-team-prompt-override: loader service unavailable; cannot apply Subagent tool policy");
      return;
    }

    const desired = shouldDisableLegacyTools();
    const rows = resolveRows(loader);
    const order = desired ? DISABLE_ORDER : RESTORE_ORDER;

    for (const id of order) {
      const entry = rows.get(id);
      if (entry === undefined) continue;
      const targetDisabled = desired ? true : (baseline.get(id) ?? Boolean(entry.disabled));
      if (Boolean(entry.disabled) === targetDisabled) continue;
      await entry.update({ disabled: targetDisabled });
    }
    await loader.await();

    const missing = TOOL_IDS.filter((id) => !rows.has(id));
    if (missing.length > 0) {
      logger.warn(
        "agent-team-prompt-override: Subagent tool policy applied partially; missing rows: %s",
        missing.join(", "),
      );
    } else {
      logger.info(
        "agent-team-prompt-override: legacy Subagent tools %s (%s)",
        desired ? "disabled" : "restored to inherited state",
        reason,
      );
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

  // Wait until the profile tree has settled so all four base rows exist.
  const loader = loaderOf();
  if (loader !== undefined) {
    void loader.await().then(() => scheduleToolSync("startup"));
  }

  // Volatile Settings edits update this fiber in place. This owning-fiber event
  // is the supported signal that the live Config refs have changed.
  const disposeVolatile = ctx.on("loader/volatile-update", (paths) => {
    if (paths.some((path) => path.length > 0 && path[0] === "disableLegacySubagentTools")) {
      void scheduleToolSync("settings");
    }
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

  return () => {
    disposed = true;
    disposeVolatile?.();
    disposePrompt?.();
  };
}

export default { name, inject, Config, apply };
