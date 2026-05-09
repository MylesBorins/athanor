import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const EXT_ID = "plan-mode";
const PLAN_DIR = path.join(process.cwd(), "context", "plans");
const STATE_PATH = path.join(PLAN_DIR, ".plan-state.json");

type Mode = "agent" | "plan";

interface State {
  mode: Mode;
  activePlan: string;
}

function ensureDir(): void {
  fs.mkdirSync(PLAN_DIR, { recursive: true });
}

function atomicWrite(filepath: string, data: string): void {
  const tmp = filepath + ".tmp";
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, filepath);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "plan";
}

function todaySlug(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultPlanName(): string {
  const base = path.basename(process.cwd());
  return `${todaySlug()}-${slugify(base)}.md`;
}

function defaultState(): State {
  return { mode: "agent", activePlan: defaultPlanName() };
}

function loadState(): State {
  try {
    ensureDir();
    if (!fs.existsSync(STATE_PATH)) return defaultState();
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as Partial<State>;
    return {
      mode: raw.mode === "plan" ? "plan" : "agent",
      activePlan: typeof raw.activePlan === "string" && raw.activePlan.length > 0
        ? raw.activePlan
        : defaultPlanName(),
    };
  } catch {
    return defaultState();
  }
}

function saveState(state: State): void {
  ensureDir();
  atomicWrite(STATE_PATH, JSON.stringify(state, null, 2));
}

function activePlanPath(state: State): string {
  return path.join(PLAN_DIR, state.activePlan);
}

function planTemplate(title: string): string {
  return `# Plan: ${title}

## Status
Planning

## Current Goal
- [ ] Capture the current goal

## Context
- Add relevant context here

## Constraints
- Add constraints here

## Task List
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

## Notes
- Add notes here

## Changed Files
- None yet
`;
}

function ensurePlanFile(state: State): string {
  ensureDir();
  const filepath = activePlanPath(state);
  if (!fs.existsSync(filepath)) {
    const title = state.activePlan.replace(/\.md$/, "");
    atomicWrite(filepath, planTemplate(title));
  }
  return filepath;
}

function relativePlanPath(state: State): string {
  return path.relative(process.cwd(), activePlanPath(state)) || activePlanPath(state);
}

function updateUi(ctx: ExtensionContext, state: State): void {
  if (state.mode === "plan") {
    ctx.ui.setStatus(EXT_ID, `plan · ${state.activePlan}`);
    ctx.ui.setWidget(
      EXT_ID,
      [`Plan: ${relativePlanPath(state)} · Ctrl+J toggle · /plan-done`],
      { placement: "belowEditor" }
    );
  } else {
    ctx.ui.setStatus(EXT_ID, undefined);
    ctx.ui.setWidget(EXT_ID, undefined);
  }
}

async function syncPlan(ctx: ExtensionCommandContext | ExtensionContext, state: State): Promise<string> {
  const filepath = ensurePlanFile(state);
  updateUi(ctx, state);
  return filepath;
}

export default function (pi: ExtensionAPI) {
  let state = loadState();

  pi.on("session_start", async (_event, ctx) => {
    state = loadState();
    if (state.mode === "plan") ensurePlanFile(state);
    updateUi(ctx, state);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    state = loadState();
    if (state.mode !== "plan") return;
    const filepath = ensurePlanFile(state);
    const rel = path.relative(process.cwd(), filepath);
    const planText = fs.readFileSync(filepath, "utf8");
    updateUi(ctx, state);
    return {
      systemPrompt: `${event.systemPrompt}\n\nPlan mode is active. Before making substantial changes, consult and maintain the active plan file at ${rel}. Prefer planning, task tracking, and explicit checklists. Keep the plan current as work progresses.\n\nActive plan file contents:\n\n${planText}`,
    };
  });

  pi.registerShortcut("ctrl+j", {
    description: "Toggle plan mode",
    handler: async (ctx) => {
      state = { ...loadState(), mode: loadState().mode === "plan" ? "agent" : "plan" };
      if (state.mode === "plan") {
        const filepath = await syncPlan(ctx, state);
        saveState(state);
        ctx.ui.notify(`Plan mode enabled · ${path.relative(process.cwd(), filepath)}`, "success");
      } else {
        saveState(state);
        updateUi(ctx, state);
        ctx.ui.notify("Agent mode enabled", "info");
      }
    },
  });

  pi.registerCommand("plan", {
    description: "Create or sync the active plan file",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      state = loadState();
      state.mode = "plan";
      const filepath = await syncPlan(ctx, state);
      saveState(state);
      ctx.ui.notify(`Plan ready: ${path.relative(process.cwd(), filepath)}`, "success");
    },
  });

  pi.registerCommand("plan-open", {
    description: "Show the active plan file path",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      state = loadState();
      const filepath = ensurePlanFile(state);
      updateUi(ctx, state);
      ctx.ui.notify(`Active plan: ${path.relative(process.cwd(), filepath)}`, "info");
    },
  });

  pi.registerCommand("plan-sync", {
    description: "Ensure the active plan file exists and refresh plan UI",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      state = loadState();
      const filepath = await syncPlan(ctx, state);
      saveState(state);
      ctx.ui.notify(`Plan synced: ${path.relative(process.cwd(), filepath)}`, "success");
    },
  });

  pi.registerCommand("plan-done", {
    description: "Leave plan mode and return to agent mode",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      state = loadState();
      if (state.mode !== "plan") {
        ctx.ui.notify("Plan mode is not active", "info");
        return;
      }
      const ok = await ctx.ui.confirm(
        "Finish planning?",
        "Switch back to agent mode and continue executing against the active plan?"
      );
      if (!ok) return;
      state.mode = "agent";
      saveState(state);
      updateUi(ctx, state);
      ctx.ui.notify(`Agent mode enabled · continue with ${relativePlanPath(state)}`, "success");
    },
  });

  pi.registerCommand("plan-new", {
    description: "Create a new named plan and make it active",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const name = args.trim();
      if (!name) {
        ctx.ui.notify("Usage: /plan-new <name>", "error");
        return;
      }
      state = loadState();
      state.activePlan = `${slugify(name)}.md`;
      state.mode = "plan";
      const filepath = await syncPlan(ctx, state);
      saveState(state);
      ctx.ui.notify(`New active plan: ${path.relative(process.cwd(), filepath)}`, "success");
    },
  });
}
