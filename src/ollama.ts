import { requestUrl } from "obsidian";
import { OllamaModel } from "./types";

export interface EmbeddingDiagnostics {
  model: string;
  reachable: boolean;
  modelAvailable: boolean;
  dimensions: number;
  sampleCount: number;
  error?: string;
}

export class OllamaClient {
  constructor(private readonly endpoint: string) {}

  private url(path: string): string { return `${this.endpoint.replace(/\/$/, "")}${path}`; }

  async listModels(): Promise<OllamaModel[]> {
    const response = await requestUrl({ url: this.url("/api/tags") });
    const data = response.json as { models?: OllamaModel[] };
    return data.models ?? [];
  }

  async generate(model: string, prompt: string, system?: string, format?: "json"): Promise<string> {
    if (!model) throw new Error("No LLM model selected. Configure it in Ollovin settings.");
    const response = await requestUrl({ url: this.url("/api/generate"), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, prompt, system, stream: false, ...(format ? { format } : {}) }) });
    const data = response.json as { response?: string };
    return data.response ?? "";
  }

  async embed(model: string, input: string | string[]): Promise<number[][]> {
    if (!model) return [];
    const response = await requestUrl({ url: this.url("/api/embed"), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, input }) });
    const data = response.json as { embeddings?: number[][] };
    return data.embeddings ?? [];
  }

  async diagnoseEmbedding(model: string): Promise<EmbeddingDiagnostics> {
    const result: EmbeddingDiagnostics = { model, reachable: false, modelAvailable: false, dimensions: 0, sampleCount: 0 };
    if (!model.trim()) { result.error = "Модель эмбеддингов не выбрана."; return result; }
    try {
      const models = await this.listModels();
      result.reachable = true;
      result.modelAvailable = models.some(m => m.name === model || m.name.split(":")[0] === model.split(":")[0]);
      if (!result.modelAvailable) { result.error = `Модель «${model}» не найдена в Ollama.`; return result; }
      const embeddings = await this.embed(model, ["тестовая заметка про локальную транскрибацию", "другая мысль про голос и распознавание речи"]);
      result.sampleCount = embeddings.length;
      result.dimensions = embeddings[0]?.length ?? 0;
      if (!result.sampleCount || !result.dimensions) result.error = "Модель ответила без embedding-вектора.";
    } catch (e) { result.error = e instanceof Error ? e.message : String(e); }
    return result;
  }

  async testConnection(): Promise<OllamaModel[]> { return this.listModels(); }
}
