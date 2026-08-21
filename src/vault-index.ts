import { App, TFile } from "obsidian";
import { OllovinSettings, NoteChunk } from "./types";
import { OllamaClient } from "./ollama";

const INDEX_FILE = ".obsidian/plugins/ollovin/index.json";
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 180;

export class VaultIndex {
  private chunks: NoteChunk[] = [];

  constructor(
    private readonly app: App,
    private readonly settings: OllovinSettings,
    private readonly ollama: OllamaClient,
  ) {}

  get size(): number {
    return this.chunks.length;
  }

  async load(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(INDEX_FILE))) return;
    try {
      const raw = await adapter.read(INDEX_FILE);
      const parsed = JSON.parse(raw) as { version: number; chunks: NoteChunk[] };
      if (parsed.version === this.settings.indexVersion) this.chunks = parsed.chunks ?? [];
    } catch {
      this.chunks = [];
    }
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
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = await this.app.vault.cachedRead(file);
      const chunks = this.chunkFile(file, content);
      if (chunks.length > 0 && this.settings.embeddingModel) {
        const embeddings = await this.ollama.embed(this.settings.embeddingModel, chunks.map((chunk) => chunk.content));
        chunks.forEach((chunk, index) => { chunk.embedding = embeddings[index]; });
      }
      next.push(...chunks);
      onProgress?.(i + 1, files.length);
    }
    this.chunks = next;
    await this.save();
  }

  getChunks(): NoteChunk[] {
    return this.chunks;
  }

  private chunkFile(file: TFile, content: string): NoteChunk[] {
    const lines = content.split("\n");
    const title = file.basename;
    const tags = Array.from(content.matchAll(/(^|\s)#([\w-]+)/g)).map((match) => `#${match[2]}`);
    const links = Array.from(content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)).map((match) => match[1]);
    const result: NoteChunk[] = [];
    let heading = "";
    let buffer = "";
    let start = 0;

    const flush = (): void => {
      const text = buffer.trim();
      if (!text) return;
      result.push({
        id: `${file.path}:${start}`,
        path: file.path,
        title,
        heading,
        content: text,
        tags: [...new Set(tags)],
        links: [...new Set(links)],
        hash: simpleHash(text),
      });
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
      if (headingMatch) heading = headingMatch[2].trim();
      if (buffer.length + line.length + 1 > CHUNK_SIZE && buffer.trim()) {
        flush();
        const overlap = buffer.slice(Math.max(0, buffer.length - CHUNK_OVERLAP));
        buffer = overlap;
        start = i;
      }
      buffer += `${line}\n`;
    }
    flush();
    return result;
  }
}

function simpleHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
