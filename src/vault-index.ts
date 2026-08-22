import { App, TFile } from "obsidian";
import { OllovinSettings, NoteChunk } from "./types";
import { OllamaClient } from "./ollama";

const INDEX_FILE = ".obsidian/plugins/ollovin/index.json";
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 180;

export interface IndexDiagnostics {
  embeddingModel: string;
  chunks: number;
  embeddedChunks: number;
  dimensions: number;
  valid: boolean;
  message: string;
}

export class VaultIndex {
  private chunks: NoteChunk[] = [];
  private lastDiagnostics: IndexDiagnostics = { embeddingModel: "", chunks: 0, embeddedChunks: 0, dimensions: 0, valid: false, message: "Индекс ещё не проверен." };

  constructor(private readonly app: App, private readonly settings: OllovinSettings, private readonly ollama: OllamaClient) {}
  get size(): number { return this.chunks.length; }
  get diagnostics(): IndexDiagnostics { return this.lastDiagnostics; }

  async load(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(INDEX_FILE))) return;
    try {
      const raw = await adapter.read(INDEX_FILE);
      const parsed = JSON.parse(raw) as { version: number; chunks: NoteChunk[] };
      if (parsed.version === this.settings.indexVersion) this.chunks = parsed.chunks ?? [];
      this.updateDiagnostics();
    } catch { this.chunks = []; }
  }

  async save(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const parent = ".obsidian/plugins/ollovin";
    if (!(await adapter.exists(parent))) await adapter.mkdir(parent);
    await adapter.write(INDEX_FILE, JSON.stringify({ version: this.settings.indexVersion, chunks: this.chunks }));
  }

  async rebuild(onProgress?: (current: number, total: number) => void): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const next: NoteChunk[] = [];
    let embeddedChunks = 0;
    let dimensions = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = await this.app.vault.cachedRead(file);
      const chunks = this.chunkFile(file, content);
      if (chunks.length > 0 && this.settings.embeddingModel) {
        const embeddings = await this.ollama.embed(this.settings.embeddingModel, chunks.map(chunk => chunk.content));
        chunks.forEach((chunk, index) => { chunk.embedding = embeddings[index]; });
        embeddedChunks += chunks.filter(chunk => Array.isArray(chunk.embedding) && chunk.embedding.length > 0).length;
        dimensions = dimensions || chunks.find(chunk => chunk.embedding?.length)?.embedding?.length || 0;
        const invalid = chunks.some(chunk => chunk.embedding && chunk.embedding.length !== dimensions);
        if (invalid) throw new Error("Embedding-модель вернула векторы разной размерности.");
      }
      next.push(...chunks);
      onProgress?.(i + 1, files.length);
    }
    this.chunks = next;
    await this.save();
    this.lastDiagnostics = {
      embeddingModel: this.settings.embeddingModel,
      chunks: next.length,
      embeddedChunks,
      dimensions,
      valid: !this.settings.embeddingModel || (embeddedChunks === next.length && dimensions > 0),
      message: !this.settings.embeddingModel ? "Embedding-модель не выбрана." : `Embedding работает: ${embeddedChunks}/${next.length} фрагментов, ${dimensions} измерений.`,
    };
    if (this.settings.embeddingModel && !this.lastDiagnostics.valid) {
      throw new Error(`${this.lastDiagnostics.message} Проверьте модель эмбеддингов и переиндексируйте хранилище.`);
    }
  }

  getChunks(): NoteChunk[] { return this.chunks; }

  private updateDiagnostics(): void {
    const embedded = this.chunks.filter(c => Array.isArray(c.embedding) && c.embedding.length > 0);
    const dimensions = embedded[0]?.embedding?.length ?? 0;
    const sameDimensions = embedded.every(c => c.embedding?.length === dimensions);
    this.lastDiagnostics = {
      embeddingModel: this.settings.embeddingModel,
      chunks: this.chunks.length,
      embeddedChunks: embedded.length,
      dimensions,
      valid: !this.settings.embeddingModel || (embedded.length === this.chunks.length && dimensions > 0 && sameDimensions),
      message: !this.settings.embeddingModel ? "Embedding-модель не выбрана." : `Индекс: ${embedded.length}/${this.chunks.length} фрагментов, ${dimensions} измерений.`,
    };
  }

  private chunkFile(file: TFile, content: string): NoteChunk[] {
    const lines = content.split("\n"); const title = file.basename;
    const tags = Array.from(content.matchAll(/(^|\s)#([\w-]+)/g)).map(match => `#${match[2]}`);
    const links = Array.from(content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)).map(match => match[1]);
    const result: NoteChunk[] = []; let heading = ""; let buffer = ""; let start = 0;
    const flush = (): void => { const text = buffer.trim(); if (!text) return; result.push({ id: `${file.path}:${start}`, path: file.path, title, heading, content: text, tags: [...new Set(tags)], links: [...new Set(links)], hash: simpleHash(text) }); };
    for (let i = 0; i < lines.length; i++) { const line = lines[i]; const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line); if (headingMatch) heading = headingMatch[2].trim(); if (buffer.length + line.length + 1 > CHUNK_SIZE && buffer.trim()) { flush(); buffer = buffer.slice(Math.max(0, buffer.length - CHUNK_OVERLAP)); start = i; } buffer += `${line}\n`; }
    flush(); return result;
  }
}
function simpleHash(value: string): string { let hash = 2166136261; for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, "0"); }
