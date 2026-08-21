import { App, TFile, normalizePath } from "obsidian";
import { AIAction, AIActionPlan, ChangePreview } from "./types";

export const SYSTEM_PROMPT = `Ты Ollovin — локальный ИИ-помощник для Obsidian. Если предлагаешь изменения, верни только JSON {"summary":"string","actions":[{"id":"1","type":"ADD_TAG","file":"путь/заметки.md","tag":"тег"}]}. Для каждого действия нужен file с точным путём. Для EDIT_NOTE и CREATE_NOTE нужен content. Для MOVE_NOTE нужен destination, для RENAME_NOTE — newPath, для тегов — tag, для ссылок — target, для UPDATE_FRONTMATTER — объект frontmatter. Допустимые типы: ADD_TAG, REMOVE_TAG, ADD_LINK, REMOVE_LINK, EDIT_NOTE, CREATE_NOTE, MOVE_NOTE, RENAME_NOTE, UPDATE_FRONTMATTER. DELETE_NOTE запрещён.`;
const TYPES = ["ADD_TAG","REMOVE_TAG","ADD_LINK","REMOVE_LINK","EDIT_NOTE","CREATE_NOTE","MOVE_NOTE","RENAME_NOTE","UPDATE_FRONTMATTER"] as const;
type RawPlan = { summary?: unknown; actions?: unknown };

export class ActionPlanner {
  constructor(private readonly app: App) {}

  buildPlan(raw: string): AIActionPlan {
    const json = extractJson(raw);
    let parsed: RawPlan;
    try { parsed = JSON.parse(json) as RawPlan; } catch { throw new Error("ИИ вернул некорректный JSON"); }
    if (!Array.isArray(parsed.actions)) throw new Error("ИИ вернул план без массива actions");
    const actions: AIAction[] = [];
    const skipped: string[] = [];
    parsed.actions.forEach((value, index) => {
      try { actions.push(this.validate(value, index)); }
      catch (e) { skipped.push(`№${index + 1}: ${e instanceof Error ? e.message.replace(/^Некорректное действие №\d+:\s*/, "") : String(e)}`); }
    });
    if (!actions.length) throw new Error(`ИИ не сформировал ни одного корректного действия${skipped.length ? ` (${skipped.join("; ")})` : ""}`);
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    return { summary: skipped.length ? `${summary}${summary ? "\n\n" : ""}Пропущено некорректных действий: ${skipped.length}. ${skipped.slice(0, 5).join("; ")}` : summary, actions };
  }

  private validate(value: unknown, index: number): AIAction {
    const x = asRecord(value);
    if (!x || !nonEmptyString(x.id) || !nonEmptyString(x.type) || !TYPES.includes(x.type as typeof TYPES[number])) throw new Error(`Некорректное действие №${index + 1}: нужен id и допустимый type`);
    const type = x.type as AIAction["type"];
    if (!nonEmptyString(x.file)) {
      const alias = [x.path, x.notePath, x.note, x.targetFile].find(nonEmptyString);
      if (alias) x.file = alias;
    }
    if (!nonEmptyString(x.file)) throw new Error(`Некорректное действие №${index + 1}: отсутствует file`);
    const aliases: Record<string, string[]> = {
      ADD_TAG: ["tag", "tags"], REMOVE_TAG: ["tag", "tags"], ADD_LINK: ["target", "link", "targetFile"], REMOVE_LINK: ["target", "link", "targetFile"],
      EDIT_NOTE: ["content", "text", "body", "markdown", "newContent"], CREATE_NOTE: ["content", "text", "body", "markdown", "newContent"], MOVE_NOTE: ["destination", "destinationPath", "targetPath"], RENAME_NOTE: ["newPath", "destination", "destinationPath"]
    };
    const required = aliases[type];
    if (required) {
      const canonical = required[0];
      if (!nonEmptyString(x[canonical])) {
        const alias = required.slice(1).map(k => x[k]).find(nonEmptyString);
        if (alias) x[canonical] = alias;
      }
      if (!nonEmptyString(x[canonical])) throw new Error(`Некорректное действие №${index + 1}: отсутствует ${canonical}`);
    }
    if (type === "UPDATE_FRONTMATTER" && (!x.frontmatter || typeof x.frontmatter !== "object" || Array.isArray(x.frontmatter))) throw new Error(`Некорректное действие №${index + 1}: отсутствует frontmatter`);
    const action = { ...x, file: normalizePath((x.file as string).trim()) } as AIAction;
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
    if (a.type === "MOVE_NOTE" || a.type === "RENAME_NOTE") { const d = normalizePath(a.type === "MOVE_NOTE" ? a.destination : a.newPath); const target = this.app.vault.getAbstractFileByPath(d); return { action: a, valid: !target, error: target ? "Целевой путь уже существует" : undefined }; }
    return { action: a, valid: true };
  }

  async apply(previews: ChangePreview[]): Promise<() => Promise<void>> {
    if (previews.some(p => !p.valid)) throw new Error("План содержит недопустимые изменения");
    const snapshot = new Map<string, string | null>(); const paths = new Set<string>();
    for (const p of previews) { paths.add(p.action.file); if (p.action.type === "MOVE_NOTE") paths.add(p.action.destination); if (p.action.type === "RENAME_NOTE") paths.add(p.action.newPath); }
    for (const path of paths) { const f = this.app.vault.getAbstractFileByPath(normalizePath(path)); snapshot.set(path, f instanceof TFile ? await this.app.vault.read(f) : null); }
    try { for (const p of previews) await this.applyAction(p.action); } catch (e) { await this.restore(snapshot); throw e; }
    return () => this.restore(snapshot);
  }

  private async applyAction(a: AIAction) {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(a.file));
    if (a.type === "CREATE_NOTE") { await this.app.vault.create(normalizePath(a.file), a.content); return; }
    if (!(f instanceof TFile)) throw new Error(`Файл не найден: ${a.file}`);
    if (a.type === "EDIT_NOTE") { await this.app.vault.modify(f, a.content); return; }
    if (a.type === "ADD_TAG" || a.type === "REMOVE_TAG") { const c = await this.app.vault.read(f), tag = normTag(a.tag), re = new RegExp(`(^|\\s)${esc(tag)}(?=\\s|$)`, "gm"), has = re.test(c); const n = a.type === "ADD_TAG" && !has ? `${c.trimEnd()}\n\n${tag}\n` : a.type === "REMOVE_TAG" && has ? c.replace(new RegExp(`(^|\\s)${esc(tag)}(?=\\s|$)`, "gm"), "$1").replace(/\n{3,}/g, "\n\n") : c; await this.app.vault.modify(f, n); return; }
    if (a.type === "ADD_LINK" || a.type === "REMOVE_LINK") { const c = await this.app.vault.read(f), target = normLink(a.target), re = new RegExp(`\\[\\[${esc(target)}\\]\\]`, "g"), has = re.test(c); const n = a.type === "ADD_LINK" && !has ? `${c.trimEnd()}\n\n[[${target}]]\n` : a.type === "REMOVE_LINK" && has ? c.replace(re, "") : c; await this.app.vault.modify(f, n); return; }
    if (a.type === "MOVE_NOTE" || a.type === "RENAME_NOTE") { await this.app.fileManager.renameFile(f, normalizePath(a.type === "MOVE_NOTE" ? a.destination : a.newPath)); return; }
    if (a.type === "UPDATE_FRONTMATTER") await this.app.fileManager.processFrontMatter(f, fm => Object.assign(fm, a.frontmatter));
  }

  private async restore(snapshot: Map<string, string | null>) { for (const [path, content] of snapshot) { const f = this.app.vault.getAbstractFileByPath(normalizePath(path)); if (content === null) { if (f instanceof TFile) await this.app.vault.delete(f); } else if (f instanceof TFile) await this.app.vault.modify(f, content); else await this.app.vault.create(normalizePath(path), content); } }
}

function extractJson(raw: string): string { const text = typeof raw === "string" ? raw.trim() : ""; const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(); const source = fenced || text; const start = source.indexOf("{"); const end = source.lastIndexOf("}"); if (start < 0 || end <= start) throw new Error("ИИ не вернул JSON-план изменений"); return source.slice(start, end + 1); }
function asRecord(v: unknown): Record<string, any> | null { return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : null; }
function nonEmptyString(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0; }
function normTag(v: string) { return `#${v.trim().replace(/^#+/, "")}`; }
function normLink(v: string) { return v.trim().replace(/^\[\[|\]\]$/g, "").trim(); }
function esc(v: string) { return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
