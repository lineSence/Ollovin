import { NoteChunk, RetrievalResult } from "./types";
import { OllamaClient } from "./ollama";

export class Retriever {
  constructor(
    private readonly ollama: OllamaClient,
    private readonly embeddingModel: () => string,
    private readonly chunks: () => NoteChunk[],
  ) {}

  async search(query: string, limit = 8): Promise<RetrievalResult[]> {
    const all = this.chunks();
    if (all.length === 0) return [];

    const queryEmbedding = this.embeddingModel() ? (await this.ollama.embed(this.embeddingModel(), query))[0] : undefined;
    const normalizedQuery = query.toLowerCase();

    const scored = all.map((chunk) => {
      const text = `${chunk.title}\n${chunk.heading ?? ""}\n${chunk.content}\n${chunk.tags.join(" ")}`.toLowerCase();
      const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 2);
      const matches = terms.filter((term) => text.includes(term)).length;
      const keywordScore = terms.length ? matches / terms.length : 0;
      const semanticScore = queryEmbedding && chunk.embedding
        ? cosineSimilarity(queryEmbedding, chunk.embedding)
        : 0;
      const score = semanticScore * 0.75 + keywordScore * 0.25;
      return { chunk, score, semanticScore, keywordScore };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
