import { App, TFile } from "obsidian";
import { AIAction, AIActionPlan, ChangePreview } from "./types";

const SYSTEM_PROMPT = `You are Ollovin, a local AI assistant for an Obsidian vault.
Use only the supplied vault context. Be concise and factual.
When asked to modify the vault, return ONLY valid JSON matching:
{"summary":"string","actions":[{"id":"string","type":"ADD_TAG|REMOVE_TAG|ADD_LINK|REMOVE_LINK|EDIT_NOTE|CREATE_NOTE|MOVE_NOTE|RENAME_NOTE|UPDATE_FRONTMATTER", ...}]}
Never return DELETE actions. Do not invent files that are not supported by the context.`;

export class ActionPlanner {
  constructor(private readonly app: App) {}

  buildPlan(raw: string): AIActionPlan {
    const json = extractJson(raw);
    const parsed = JSON.parse(json) as Partial<AIActionPlan>;
    if (!Array.isArray(parsed.actions)) throw new Error("AI returned an invalid action plan");
    const actions = parsed.actions.filter(isAllowedAction);
    if (actions.length !== parsed.actions.length) throw new Error("AI returned an unsupported action");
    return { summary: parsed.summary ?? "", actions };
  }

  async preview(plan: AIActionPlan): Promise<ChangePreview[]> {
    const previews: ChangePreview[] = [];
    for (const action of plan.actions) {
      previews.push(await this.previewAction(action));
    }
    return previews;
  }

  private async previewAction(action: AIAction): Promise<ChangePreview> {
    if (action.type === "CREATE_NOTE") {
      const exists = this.app.vault.getAbstractFileByPath(action.file) !== null;
      return { action, valid: !exists, error: exists ? "File already exists" : undefined, after: action.content };
    }
    const file = this.app.vault.getAbstractFileByPath(action.file);
    if (!(file instanceof TFile)) return { action, valid: false, error: "File does not exist" };

    if (action.type === "EDIT_NOTE") {
      const before = await this.app.vault.read(file);
      return { action, before, after: action.content, valid: true };
    }
    return { action, valid: true };
  }
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI did not return JSON");
  return candidate.slice(start, end + 1);
}

function isAllowedAction(value: unknown): value is AIAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<AIAction>;
  return typeof action.id === "string" && [
    "ADD_TAG", "REMOVE_TAG", "ADD_LINK", "REMOVE_LINK", "EDIT_NOTE",
    "CREATE_NOTE", "MOVE_NOTE", "RENAME_NOTE", "UPDATE_FRONTMATTER",
  ].includes(action.type ?? "");
}

export { SYSTEM_PROMPT };
