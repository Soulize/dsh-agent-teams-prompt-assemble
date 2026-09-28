import z from "@deepseek-ai/schemastery";

export const name = "agent-team-prompt-override";
export const inject = ["systemPrompt"];

const ORIGINAL_FIRST_PARAGRAPH =
  "Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.";

export const DEFAULT_REPLACEMENT =
  "Agent Teams is available in this session. You may create teammates proactively when parallelization, specialization, or independent verification would materially improve the task. Do not wait for the user to explicitly request teammates. Avoid creating teammates for trivial, tightly coupled, or purely sequential work.";

export const Config = z.object({
  replacement: z.string().default(DEFAULT_REPLACEMENT),
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
  const replacement =
    typeof config?.replacement === "string" && config.replacement.trim().length > 0
      ? config.replacement.trim()
      : DEFAULT_REPLACEMENT;

  let warned = false;

  // Do not register another "team:policy" section: the official Agent Teams
  // plugin already owns that name in agent.ctx, and duplicate registration in
  // the same scope throws. Instead, shape the authoritative assembled prompt
  // after downstream listeners have run.
  ctx.on("system-prompt/assemble", async (_assembly, _context, next) => {
    const assembly = await next();
    const section = assembly.sections.find((item) => item.name === "team:policy");

    // Team runtime not mounted for this agent/session: completely inert.
    if (section === undefined) return assembly;

    const rewritten = rewriteTeamPolicy(section.text, replacement);
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
}

export default { name, inject, Config, apply };
