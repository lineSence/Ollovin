import { App, TFile, normalizePath } from "obsidian";
import { AIAction, AIActionPlan, ChangePreview } from "./types";

export const SYSTEM_PROMPT = `Ты Ollovin — локальный ИИ-помощник для Obsidian.
Используй только предоставленный контекст. Отвечай кратко и по делу.
Если пользователь просит изменить хранилище, верни ТОЛЬКО JSON формата:
{"summary":"string","actions":[{"id":"string","type":"ADD_TAG|REMOVE_TAG|ADD_LINK|REMOVE_LINK|EDIT_NOTE|CREATE_NOTE|MOVE_NOTE|RENAME_NOTE|UPDATE_FRONTMATTER", ...}]}
Никогда не используй DELETE. Не придумывай файлы, которых нет в контексте.`;

export class ActionPlanner {
  constructor(private readonly app: App) {}

  buildPlan(raw: string): AIActionPlan {
    const json = extractJson(raw);
    const parsed = JSON.parse(json) as Partial<AIActionPlan>;
    if (!Array.isArray(parsed.actions)) throw new Error("ИИ вернул некорректный план изменений");
    const actions = parsed.actions.filter(isAllowedAction);
    if (actions.length !== parsed.actions.length) throw new Error("ИИ вернул неподдерживаемое действие");
    return { summary: parsed.summary ?? "", actions };
  }

  async preview(plan: AIActionPlan): Promise<ChangePreview[]> {
    return Promise.all(plan.actions.map((action) => this.previewAction(action)));
  }

  async apply(previews: ChangePreview[]): Promise<() => Promise<void>> {
    if (previews.some((preview) => !preview.valid)) throw new Error("План содержит недопустимые изменения");
    const snapshots = new Map<string, string | null>();
    const paths = new Set<string>();
    for (const preview of previews) {
      const action = preview.action;
      paths.add(action.file);
      if (action.type === "MOVE_NOTE") paths.add(action.destination);
      if (action.type === "RENAME_NOTE") paths.add(action.newPath);
    }
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      snapshots.set(path, file instanceof TFile ? await this.app.vault.read(file) : null);
    }

    try {
      for (const preview of previews) await this.applyAction(preview.action);
    } catch (error) {
      await this.restore(snapshots);
      throw error;
    }

    return async () => this.restore(snapshots);
  }

  private async restore(snapshots: Map<string, string | null>): Promise<void> {
    for (const [path, content] of snapshots) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (content === null) {
        if (file instanceof TFile) await this.app.vault.delete(file);
      } else if (file instanceof TFile) {
        await this.app.vault.modify(file, content);
      } else {
        await this.app.vault.create(normalizePath(path), content);
      }
    }
  }

  private async previewAction(action: AIAction): Promise<ChangePreview> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(action.file));
    if (action.type === "CREATE_NOTE") {
      return { action, valid: !file, error: file ? "Файл уже существует" : undefined, after: action.content };
    }
    if (!(file instanceof TFile)) return { action, valid: false, error: "Файл не существует" };
    if (action.type === "EDIT_NOTE") {
      const before = await this.app.vault.read(file);
      return { action, before, after: action.content, valid: true };
    }
    if (action.type === "MOVE_NOTE" || action.type === "RENAME_NOTE") {
      const destination = normalizePath(action.type === "MOVE_NOTE" ? action.destination : action.newPath);
      const target = this.app.vault.getAbstractFileByPath(destination);
      return { action, valid: !target, error: target ? "Целевой путь уже существует" : undefined };
    }
    return { action, valid: true };
  }

  private async applyAction(action: AIAction): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(action.file));
    switch (action.type) {
      case "CREATE_NOTE":
        await this.app.vault.create(normalizePath(action.file), action.content);
        return;
      case "EDIT_NOTE":
        if (!(file instanceof TFile)) throw new Error(`Файл не найден: ${action.file}`);
        await this.app.vault.modify(file, action.content);
        return;
      case "ADD_TAG":
      case "REMOVE_TAG": {
        if (!(file instanceof TFile)) throw new Error(`Файл не найден: ${action.file}`);
        const content = await this.app.vault.read(file);
        const tag = action.tag.startsWith("#") ? action.tag : `#${action.tag}`;
        const pattern = new RegExp(`(^|\\s)${escapeRegExp(tag)}(?=\\s|$)`, "gm");
        const has = pattern.test(content);
        const next = action.type === "ADD_TAG" && !has
          ? `${content.trimEnd()}\n\n${tag}\n`
          : action.type === "REMOVE_TAG" && has
            ? content.replace(new RegExp(`(^|\\s)${escapeRegExp(tag)}(?=\\s|$)`, "gm"), "$1").replace(/\n{3,}/g, "\n\n")
            : content;
        await this.app.vault.modify(file, next);
        return;
      }
      case "ADD_LINK":
      case "REMOVE_LINK": {
        if (!(file instanceof TFile)) throw new Error(`Файл не найден: ${action.file}`);
        const content = await this.app.vault.read(file);
        const target = action.target.replace(/^\[\[|\]\]$/g, "");
        const link = `[[${target}]]`;
        const pattern = new RegExp(`\\[\\[${escapeRegExp(target)}\\]\\]`, "g");
        const next = action.type === "ADD_LINK" && !pattern.test(content)
          ? `${content.trimEnd()}\n\n${link}\n`
          : action.type === "REMOVE_LINK" ? content.replace(pattern, "") : content;
        await this.app.vault.modify(file, next);
        return;
      }
      case "MOVE_NOTE":
      case "RENAME_NOTE":
        if (!(file instanceof TFile)) throw new Error(`Файл не найден: ${action.file}`);
        await this.app.fileManager.renameFile(file, normalizePath(action.type === "MOVE_NOTE" ? action.destination : action.newPath));
        return;
      case "UPDATE_FRONTMATTER":
        if (!(file instanceof TFile)) throw new Error(`Файл не найден: ${action.file}`);
        await this.app.fileManager.processFrontMatter(file, (fm) => Object.assign(fm, action.frontmatter));
        return;
    }
  }
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("ИИ не вернул JSON");
  return candidate.slice(start, end + 1);
}

function isAllowedAction(value: unknown): value is AIAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<AIAction>;
  return typeof action.id === "string" && ["ADD_TAG", "REMOVE_TAG", "ADD_LINK", "REMOVE_LINK", "EDIT_NOTE", "CREATE_NOTE", "MOVE_NOTE", "RENAME_NOTE", "UPDATE_FRONTMATTER"].includes(action.type ?? "");
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
