import { App, TFile } from "obsidian";
import { OllamaClient } from "./ollama";
import { RetrievalResult } from "./types";

export interface VaultAnalysisCluster {
  name: string;
  description: string;
  notePaths: string[];
  suggestedTags: string[];
  confidence: number;
}

export interface VaultAnalysisPlan {
  summary: string;
  clusters: VaultAnalysisCluster[];
  orphanNotes: string[];
  duplicateGroups: string[][];
  suggestedActions: string[];
}

export class VaultAnalyzer {
  constructor(private readonly app: App, private readonly ollama: OllamaClient) {}

  async analyze(model: string, files: TFile[], retrieval: (q: string, limit?: number) => Promise<RetrievalResult[]>): Promise<VaultAnalysisPlan> {
    const notes = [] as Array<{ path: string; content: string }>;
    for (const f of files.filter(f => f.extension === "md")) {
      notes.push({ path: f.path, content: await this.app.vault.cachedRead(f) });
    }
    if (!notes.length) throw new Error("В хранилище нет Markdown-заметок для анализа.");

    const compact = notes.map((n, i) => `[#${i + 1}] ${n.path}\n${n.content.slice(0, 1800)}`).join("\n\n");
    const prompt = `Проанализируй бессвязное личное хранилище заметок. Твоя задача — найти смысловые кластеры и предложить безопасный план организации. Не удаляй и не выдумывай заметки. Используй только пути из списка. Верни ТОЛЬКО JSON следующего вида:\n{"summary":"...","clusters":[{"name":"...","description":"...","notePaths":["..."],"suggestedTags":["..."],"confidence":0.0}],"orphanNotes":["..."],"duplicateGroups":[["...","..."]],"suggestedActions":["..."]}\n\nЗаметки:\n${compact}`;

    const raw = await this.ollama.generate(model, prompt, "Ты анализатор личной базы знаний. Отвечай строго валидным JSON без markdown.");
    const parsed = this.parse(raw, new Set(notes.map(n => n.path)));

    // Retrieval pass: enrich confidence for clusters using the local index without changing model output.
    for (const cluster of parsed.clusters) {
      if (!cluster.notePaths.length) continue;
      const query = `${cluster.name}. ${cluster.description}`;
      const hits = await retrieval(query, Math.min(8, notes.length));
      const hitPaths = new Set(hits.map(h => h.chunk.path));
      const overlap = cluster.notePaths.filter(p => hitPaths.has(p)).length;
      cluster.confidence = Math.max(0, Math.min(1, Math.max(cluster.confidence, overlap / Math.max(1, cluster.notePaths.length))));
    }
    return parsed;
  }

  private parse(raw: string, validPaths: Set<string>): VaultAnalysisPlan {
    const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error("ИИ вернул некорректный JSON при разборе хранилища."); }
    if (!value || typeof value !== "object") throw new Error("Ответ ИИ не является объектом.");
    const v = value as Record<string, unknown>;
    const arr = (x: unknown) => Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : [];
    const clusters: VaultAnalysisCluster[] = Array.isArray(v.clusters) ? v.clusters.map((c: unknown) => {
      const x = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      const paths = arr(x.notePaths).filter(p => validPaths.has(p));
      const confidence = typeof x.confidence === "number" && Number.isFinite(x.confidence) ? Math.max(0, Math.min(1, x.confidence)) : 0.5;
      return { name: typeof x.name === "string" ? x.name : "Без названия", description: typeof x.description === "string" ? x.description : "", notePaths: paths, suggestedTags: arr(x.suggestedTags).map(t => t.startsWith("#") ? t : `#${t}`), confidence };
    }).filter(c => c.notePaths.length) : [];
    const orphanNotes = arr(v.orphanNotes).filter(p => validPaths.has(p));
    const duplicateGroups = Array.isArray(v.duplicateGroups) ? v.duplicateGroups.map(g => arr(g).filter(p => validPaths.has(p))).filter(g => g.length > 1) : [];
    return { summary: typeof v.summary === "string" ? v.summary : "Анализ хранилища завершён.", clusters, orphanNotes, duplicateGroups, suggestedActions: arr(v.suggestedActions) };
  }
}
