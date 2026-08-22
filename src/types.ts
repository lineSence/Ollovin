export interface OllovinSettings {
  ollamaEndpoint: string;
  llmModel: string;
  embeddingModel: string;
  indexVersion: number;
}

export interface OllamaModel {
  name: string;
  size?: number;
  details?: Record<string, unknown>;
}

export interface NoteChunk {
  id: string;
  path: string;
  title: string;
  content: string;
  heading?: string;
  tags: string[];
  links: string[];
  hash: string;
  embedding?: number[];
}

export interface RetrievalResult {
  chunk: NoteChunk;
  score: number;
  semanticScore: number;
  keywordScore: number;
}

export type AIAction =
  | { id: string; type: "ADD_TAG"; file: string; tag: string; reason?: string }
  | { id: string; type: "REMOVE_TAG"; file: string; tag: string; reason?: string }
  | { id: string; type: "ADD_LINK"; file: string; target: string; reason?: string }
  | { id: string; type: "REMOVE_LINK"; file: string; target: string; reason?: string }
  | { id: string; type: "EDIT_NOTE"; file: string; content: string; reason?: string }
  | { id: string; type: "CREATE_NOTE"; file: string; content: string; reason?: string }
  | { id: string; type: "MOVE_NOTE"; file: string; destination: string; reason?: string }
  | { id: string; type: "RENAME_NOTE"; file: string; newPath: string; reason?: string }
  | { id: string; type: "UPDATE_FRONTMATTER"; file: string; frontmatter: Record<string, unknown>; reason?: string };

export interface AIActionPlan {
  summary: string;
  actions: AIAction[];
}

export interface ChangePreview {
  action: AIAction;
  before?: string;
  after?: string;
  valid: boolean;
  error?: string;
}
