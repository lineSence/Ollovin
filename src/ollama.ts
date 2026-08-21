import { requestUrl } from "obsidian";
import { OllamaModel } from "./types";

export class OllamaClient {
  constructor(private readonly endpoint: string) {}

  private url(path: string): string {
    return `${this.endpoint.replace(/\/$/, "")}${path}`;
  }

  async listModels(): Promise<OllamaModel[]> {
    const response = await requestUrl({ url: this.url("/api/tags") });
    const data = response.json as { models?: OllamaModel[] };
    return data.models ?? [];
  }

  async generate(model: string, prompt: string, system?: string, format?: "json"): Promise<string> {
    if (!model) throw new Error("No LLM model selected. Configure it in Ollovin settings.");
    const response = await requestUrl({
      url: this.url("/api/generate"),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, system, stream: false, ...(format ? { format } : {}) }),
    });
    const data = response.json as { response?: string };
    return data.response ?? "";
  }

  async embed(model: string, input: string | string[]): Promise<number[][]> {
    if (!model) return [];
    const response = await requestUrl({
      url: this.url("/api/embed"),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input }),
    });
    const data = response.json as { embeddings?: number[][] };
    return data.embeddings ?? [];
  }

  async testConnection(): Promise<OllamaModel[]> {
    return this.listModels();
  }
}
