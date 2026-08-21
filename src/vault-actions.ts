import { App, TFile } from "obsidian";
import { AIActionPlan, ChangePreview } from "./types";
import { ActionPlanner } from "./agent";
import { OllamaClient } from "./ollama";
import { VaultAnalysisPlan } from "./vault-analysis";

export class VaultActionPlanner {
  constructor(private readonly app: App, private readonly ollama: OllamaClient, private readonly planner: ActionPlanner) {}

  async createPlan(model: string, analysis: VaultAnalysisPlan): Promise<AIActionPlan> {
    const files = this.app.vault.getMarkdownFiles();
    const selected = new Set(analysis.clusters.flatMap(c => c.notePaths));
    const notes = [] as string[];
    for (const f of files) {
      if (selected.size && !selected.has(f.path) && !analysis.orphanNotes.includes(f.path)) continue;
      const content = await this.app.vault.cachedRead(f);
      notes.push(`FILE: ${f.path}\n${content.slice(0, 3500)}`);
    }
    const prompt = `Ты планировщик изменений Obsidian. На основании анализа и содержимого заметок создай безопасный план организации хранилища. Цель — сделать структуру понятнее, сохранив исходную информацию. Можно создавать папки через MOVE_NOTE/RENAME_NOTE, переименовывать, редактировать текст, добавлять теги и wikilinks, создавать новые заметки. НИКОГДА не удаляй заметки. Каждое действие должно быть самостоятельным и обратимым. Не предлагай бессмысленных изменений. Пути должны существовать или быть создаваемыми. Верни ТОЛЬКО JSON: {"summary":"...","actions":[{"id":"a1","type":"MOVE_NOTE","file":"...","destination":"...","reason":"..."}]}\n\nАНАЛИЗ:\n${JSON.stringify(analysis, null, 2)}\n\nЗАМЕТКИ:\n${notes.join("\n\n")}`;
    return this.planner.buildPlan(await this.ollama.generate(model, prompt, "Ты безопасный планировщик изменений личного Obsidian-хранилища. Отвечай строго JSON. Никогда не используй DELETE."));
  }

  async preview(plan: AIActionPlan): Promise<ChangePreview[]> { return this.planner.preview(plan); }
  async apply(previews: ChangePreview[]): Promise<() => Promise<void>> { return this.planner.apply(previews); }
}
