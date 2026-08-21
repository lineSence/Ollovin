import { App, TFile, normalizePath } from "obsidian";
import { AIAction, AIActionPlan, ChangePreview } from "./types";

export const SYSTEM_PROMPT = `Ты Ollovin — локальный ИИ-помощник для Obsidian. Используй только предоставленный контекст. Если нужно предложить изменения, верни только JSON вида {"summary":"string","actions":[...]}. Допустимые типы: ADD_TAG(tag), REMOVE_TAG(tag), ADD_LINK(target), REMOVE_LINK(target), EDIT_NOTE(content), CREATE_NOTE(content), MOVE_NOTE(destination), RENAME_NOTE(newPath), UPDATE_FRONTMATTER(frontmatter). Для ADD_TAG/REMOVE_TAG/ADD_LINK/REMOVE_LINK/EDIT_NOTE/CREATE_NOTE/MOVE_NOTE/RENAME_NOTE поле file обязательно. Никогда не используй DELETE.`;
const TYPES = ["ADD_TAG","REMOVE_TAG","ADD_LINK","REMOVE_LINK","EDIT_NOTE","CREATE_NOTE","MOVE_NOTE","RENAME_NOTE","UPDATE_FRONTMATTER"] as const;

type RawPlan = { summary?: unknown; actions?: unknown };

export class ActionPlanner {
  constructor(private readonly app: App) {}

  buildPlan(raw: string): AIActionPlan {
    const json = extractJson(raw);
    let parsed: RawPlan;
    try { parsed = JSON.parse(json) as RawPlan; } catch { throw new Error("ИИ вернул некорректный JSON"); }
    if (!Array.isArray(parsed.actions)) throw new Error("ИИ вернул план без массива actions");
    const actions = parsed.actions.map((x, i) => this.validate(x, i));
    return { summary: typeof parsed.summary === "string" ? parsed.summary : "", actions };
  }

  /** Проверяет и нормализует план. Важно: здесь никогда не вызываются методы строк у неизвестных значений. */
  private validate(value: unknown, index: number): AIAction {
    const x = asRecord(value);
    if (!x || typeof x.id !== "string" || !x.id.trim() || typeof x.type !== "string" || !TYPES.includes(x.type as typeof TYPES[number])) {
      throw new Error(`Некорректное действие №${index + 1}: нужен id и допустимый type`);
    }
    const type = x.type as AIAction["type"];
    const fileRequired = type !== "UPDATE_FRONTMATTER";
    if (fileRequired && !nonEmptyString(x.file)) throw new Error(`Некорректное действие №${index + 1}: отсутствует file`);
    const required: Partial<Record<AIAction["type"], string>> = {
      ADD_TAG: "tag", REMOVE_TAG: "tag", ADD_LINK: "target", REMOVE_LINK: "target",
      EDIT_NOTE: "content", CREATE_NOTE: "content", MOVE_NOTE: "destination", RENAME_NOTE: "newPath",
    };
    const field = required[type];
    if (field && !nonEmptyString(x[field])) throw new Error(`Некорректное действие №${index + 1}: отсутствует ${field}`);
    if (type === "UPDATE_FRONTMATTER" && (!x.frontmatter || typeof x.frontmatter !== "object" || Array.isArray(x.frontmatter))) {
      throw new Error(`Некорректное действие №${index + 1}: отсутствует frontmatter`);
    }
    const action = { ...x, file: typeof x.file === "string" ? normalizePath(x.file.trim()) : x.file } as AIAction;
    if (action.type === "ADD_TAG" || action.type === "REMOVE_TAG") action.tag = normTag(action.tag);
    if (action.type === "ADD_LINK" || action.type === "REMOVE_LINK") action.target = normLink(action.target);
    return action;
  }

  async preview(plan: AIActionPlan): Promise<ChangePreview[]> { return Promise.all(plan.actions.map(a => this.previewAction(a))); }
  private async previewAction(a: AIAction): Promise<ChangePreview> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(a.file));
    if (a.type === "CREATE_NOTE") return { action: a, valid: !f, error: f ? "Файл уже существует" : undefined, after: a.content };
    if (!(f instanceof TFile)) return { action: a, valid: false, error: "Файл не существует" };
    if (a.type === "EDIT_NOTE") return { action: a, before: await this.app.vault.read(f), after: a.content, valid: true };
    if (a.type === "MOVE_NOTE" || a.type === "RENAME_NOTE") {
      const d = normalizePath(a.type === "MOVE_NOTE" ? a.destination : a.newPath);
      const target = this.app.vault.getAbstractFileByPath(d);
      return { action: a, valid: !target, error: target ? "Целевой путь уже существует" : undefined };
    }
    return { action: a, valid: true };
  }

  async apply(previews: ChangePreview[]): Promise<() => Promise<void>> {
    if (previews.some(p => !p.valid)) throw new Error("План содержит недопустимые изменения");
    const snapshot = new Map<string, string | null>();
    const paths = new Set<string>();
    for (const p of previews) {
      paths.add(p.action.file);
      if (p.action.type === "MOVE_NOTE") paths.add(p.action.destination);
      if (p.action.type === "RENAME_NOTE") paths.add(p.action.newPath);
    }
    for (const path of paths) {
      const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
      snapshot.set(path, f instanceof TFile ? await this.app.vault.read(f) : null);
    }
    try { for (const p of previews) await this.applyAction(p.action); }
    catch (e) { await this.restore(snapshot); throw e; }
    return () => this.restore(snapshot);
  }

  private async applyAction(a: AIAction) {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(a.file));
    if (a.type === "CREATE_NOTE") { await this.app.vault.create(normalizePath(a.file), a.content); return; }
    if (!(f instanceof TFile)) throw new Error(`Файл не найден: ${a.file}`);
    if (a.type === "EDIT_NOTE") { await this.app.vault.modify(f, a.content); return; }
    if (a.type === "ADD_TAG" || a.type === "REMOVE_TAG") {
      const c = await this.app.vault.read(f), tag = normTag(a.tag), re = new RegExp(`(^|\\s)${esc(tag)}(?=\\s|$)`, "gm"), has = re.test(c);
      const n = a.type === "ADD_TAG" && !has ? `${c.trimEnd()}\n\n${tag}\n` : a.type === "REMOVE_TAG" && has ? c.replace(new RegExp(`(^|\\s)${esc(tag)}(?=\\s|$)`, "gm"), "$1").replace(/\n{3,}/g, "\n\n") : c;
      await this.app.vault.modify(f, n); return;
    }
    if (a.type === "ADD_LINK" || a.type === "REMOVE_LINK") {
      const c = await this.app.vault.read(f), target = normLink(a.target), re = new RegExp(`\\[\\[${esc(target)}\\]\\]`, "g"), has = re.test(c);
      const n = a.type === "ADD_LINK" && !has ? `${c.trimEnd()}\n\n[[${target}]]\n` : a.type === "REMOVE_LINK" && has ? c.replace(re, "") : c;
      await this.app.vault.modify(f, n); return;
    }
    if (a.type === "MOVE_NOTE" || a.type === "RENAME_NOTE") { await this.app.fileManager.renameFile(f, normalizePath(a.type === "MOVE_NOTE" ? a.destination : a.newPath)); return; }
    if (a.type === "UPDATE_FRONTMATTER") { await this.app.fileManager.processFrontMatter(f, fm => Object.assign(fm, a.frontmatter)); }
  }

  private async restore(snapshot: Map<string, string | null>) {
    for (const [path, content] of snapshot) {
      const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (content === null) { if (f instanceof TFile) await this.app.vault.delete(f); }
      else if (f instanceof TFile) await this.app.vault.modify(f, content);
      else await this.app.vault.create(normalizePath(path), content);
    }
  }
}

function extractJson(raw: string): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced || text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("ИИ не вернул JSON-план изменений");
  return source.slice(start, end + 1);
}
function asRecord(v: unknown): Record<string, any> | null { return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : null; }
function nonEmptyString(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0; }
function normTag(v: string) { const s = v.trim().replace(/^#+/, ""); return `#${s}`; }
function normLink(v: string) { return v.trim().replace(/^\[\[|\]\]$/g, "").trim(); }
function esc(v: string) { return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
