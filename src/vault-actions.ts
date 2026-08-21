import { AIActionPlan, ChangePreview } from "./types";
import { ActionPlanner } from "./agent";
import { OllamaClient } from "./ollama";
import { VaultAnalysisPlan } from "./vault-analysis";

export class VaultActionPlanner {
  constructor(private readonly ollama: OllamaClient, private readonly planner: ActionPlanner) {}

  async createPlan(model: string, analysis: VaultAnalysisPlan): Promise<AIActionPlan> {
    const context = analysis.clusters.map(c => `${c.name}: ${c.description}\nТочные пути заметок:\n${c.notePaths.join("\n")}`).join("\n\n");
    const prompt = `Организуй Obsidian Vault. Твоя задача — превратить поток несвязанных заметок в понятную структуру. НЕ ограничивайся тегами.

ОБЯЗАТЕЛЬНО стремись к четырём результатам:
1. СОЗДАТЬ ПАПКИ через MOVE_NOTE. Сгруппируй существующие заметки по смысловым разделам. Используй короткие понятные папки верхнего уровня.
2. ПЕРЕИМЕНОВАТЬ неинформативные заметки через RENAME_NOTE. Новые имена должны кратко описывать содержание и сохранять .md.
3. СОЗДАТЬ СВЯЗИ через ADD_LINK между действительно связанными заметками. Связи должны образовывать полезный граф, а не быть случайными.
4. ДОБАВИТЬ НЕБОЛЬШОЕ количество тегов через ADD_TAG только там, где они действительно помогают.

ПРИОРИТЕТ: структура папок + понятные имена + wikilinks. Теги вторичны.

РАЗРЕШЕННЫЕ ДЕЙСТВИЯ: CREATE_NOTE, MOVE_NOTE, RENAME_NOTE, EDIT_NOTE, ADD_TAG, REMOVE_TAG, ADD_LINK, REMOVE_LINK, UPDATE_FRONTMATTER. НИКОГДА не используй DELETE_NOTE.

ВАЖНО: каждое действие обязано иметь строковое поле file. Для существующих заметок используй только точные исходные пути ниже. Для MOVE_NOTE используй destination, для RENAME_NOTE — newPath, для ADD_LINK — target, для EDIT_NOTE — content, для ADD_TAG/REMOVE_TAG — tag.

ПРИМЕРЫ:
{"type":"MOVE_NOTE","file":"17.md","destination":"Разработка/17.md"}
{"type":"RENAME_NOTE","file":"17.md","newPath":"Разработка/Локальная транскрибация на Android.md"}
{"type":"ADD_LINK","file":"17.md","target":"Разработка/Whisper.md"}
{"type":"ADD_TAG","file":"17.md","tag":"#разработка"}

Не создавай действие, если обязательные поля неизвестны. Не меняй содержимое заметки без необходимости. Не создавай папки как отдельные действия: папки создадутся автоматически при MOVE_NOTE/CREATE_NOTE.

Верни ТОЛЬКО валидный JSON без markdown и пояснений:
{"summary":"до 300 символов","actions":[...]}

КРАТКИЙ SUMMARY: перечисли только 3–5 главных результатов организации, без рассуждений и длинных объяснений.

АНАЛИЗ:
${analysis.summary}

КЛАСТЕРЫ:
${context}

ЗАМЕТКИ БЕЗ ГРУППЫ:
${analysis.orphanNotes.join("\n")}

ПОХОЖИЕ ГРУППЫ:
${analysis.duplicateGroups.map(g => g.join(" | ")).join("\n")}`;
    const raw = await this.ollama.generate(model, prompt, "Ты лаконичный архитектор Obsidian Vault. Организуй заметки через папки, имена и связи. Никогда не удаляй заметки.", "json");
    return this.planner.buildPlan(raw);
  }

  async preview(plan: AIActionPlan): Promise<ChangePreview[]> { return this.planner.preview(plan); }
  async apply(previews: ChangePreview[]): Promise<() => Promise<void>> { return this.planner.apply(previews); }
}
