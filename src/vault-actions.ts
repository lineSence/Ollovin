import { AIActionPlan, ChangePreview } from "./types";
import { ActionPlanner } from "./agent";
import { OllamaClient } from "./ollama";
import { VaultAnalysisPlan } from "./vault-analysis";

export class VaultActionPlanner {
  constructor(private readonly ollama: OllamaClient, private readonly planner: ActionPlanner) {}

  async createPlan(model: string, analysis: VaultAnalysisPlan): Promise<AIActionPlan> {
    const context = analysis.clusters.map(c => `${c.name}: ${c.description}\nЗаметки (используй эти точные пути в поле file):\n${c.notePaths.join("\n")}`).join("\n\n");
    const prompt = `Сформируй безопасный план организации Obsidian Vault на основе анализа ниже. Разрешены CREATE_NOTE, MOVE_NOTE, RENAME_NOTE, EDIT_NOTE, ADD_TAG, REMOVE_TAG, ADD_LINK, REMOVE_LINK, UPDATE_FRONTMATTER. Никогда не используй DELETE_NOTE.

ФОРМАТ КАЖДОГО ACTION:
{"id":"1","type":"ADD_TAG","file":"точный/путь/заметки.md","tag":"тег"}

КРИТИЧЕСКОЕ ПРАВИЛО: каждое действие ОБЯЗАТЕЛЬНО должно иметь строковое поле file. Для существующей заметки file должен быть одним из точных путей ниже. Не используй path, notePath, note или targetFile вместо file. Даже UPDATE_FRONTMATTER обязан иметь file. Для CREATE_NOTE file — новый путь создаваемой заметки. Не создавай действия без file.

Верни ТОЛЬКО валидный JSON без markdown и пояснений в формате {"summary":"...","actions":[...]}. Если не можешь безопасно сформировать действие с точным file — не включай его.

АНАЛИЗ:
${analysis.summary}

КЛАСТЕРЫ:
${context}

СИРОТЫ:
${analysis.orphanNotes.join("\n")}

ПОХОЖИЕ ГРУППЫ:
${analysis.duplicateGroups.map(g => g.join(" | ")).join("\n")}`;
    const raw = await this.ollama.generate(model, prompt, "Ты безопасный планировщик изменений личного Obsidian Vault. Никогда не удаляй заметки. Никогда не создавай action без file.");
    return this.planner.buildPlan(raw);
  }

  async preview(plan: AIActionPlan): Promise<ChangePreview[]> { return this.planner.preview(plan); }
  async apply(previews: ChangePreview[]): Promise<() => Promise<void>> { return this.planner.apply(previews); }
}
