import { OllamaModel } from "./types";

export class OllamaClient {
  constructor(private readonly endpoint: string) {}

  private url(path: string): string {
    return `${this.endpoint.replace(/\/$/, "")}${path}`;
  }

  async listModels(): Promise<OllamaModel[]> {
    const response = await fetch(this.url("/api/tags"));
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const data = (await response.json()) as { models?: OllamaModel[] };
    return data.models ?? [];
  }

  async generate(model: string, prompt: string, system?: string): Promise<string> {
    const response = await fetch(this.url("/api/generate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, system, stream: false }),
    });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const data = (await response.json()) as { response?: string };
    return data.response ?? "";
  }

  async embed(model: string, input: string | string[]): Promise<number[][]> {
    const response = await fetch(this.url("/api/embed"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input }),
    });
    if (!response.ok) throw new Error(`Ollama embedding returned HTTP ${response.status}`);
    const data = (await response.json()) as { embeddings?: number[][] };
    return data.embeddings ?? [];
  }

  async testConnection(): Promise<OllamaModel[]> {
    return this.listModels();
  }
}
