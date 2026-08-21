import { AIActionPlan, ChangePreview } from "./types";
import { ActionPlanner } from "./agent";
import { OllamaClient } from "./ollama";
import { VaultAnalysisPlan } from "./vault-analysis";

export class VaultActionPlanner {
  constructor(private readonly ollama: OllamaClient, private readonly planner: ActionPlanner) {}

  async createPlan(model: string, analysis: VaultAnalysisPlan): Promise<AIActionPlan> {
    const context = analysis.clusters.map(c => `${c.name}: ${c.description}\nЗаметки: ${c.notePaths.join(", ")}`).join("\n\n");
    const prompt = `Сформируй безопасный план организации Obsidian Vault на основе анализа ниже. Разрешены CREATE_NOTE, MOVE_NOTE, RENAME_NOTE, EDIT_NOTE, ADD_TAG, REMOVE_TAG, ADD_LINK, REMOVE_LINK, UPDATE_FRONTMATTER. Никогда не используй DELETE_NOTE. Используй только существующие пути из контекста для операций над существующими заметками. Верни только JSON в формате AIActionPlan, без markdown.\n\nАНАЛИЗ:\n${analysis.summary}\n\nКЛАСТЕРЫ:\n${context}\n\nСИРОТЫ:\n${analysis.orphanNotes.join(", ")}\n\nПОХОЖИЕ ГРУППЫ:\n${analysis.duplicateGroups.map(g => g.join(" | ")).join("\n")}`;
    const raw = await this.ollama.generate(model, prompt, "Ты безопасный планировщик изменений личного Obsidian Vault. Никогда не удаляй заметки.");
    return this.planner.buildPlan(raw);
  }

  async preview(plan: AIActionPlan): Promise<ChangePreview[]> {
    return this.planner.preview(plan);
  }

  async apply(previews: ChangePreview[]): Promise<() => Promise<void>> {
    return this.planner.apply(previews);
  }
}
