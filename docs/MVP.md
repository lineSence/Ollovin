# Ollovin MVP — Critical Core

## Goal

Build a local AI layer for Obsidian that understands the Vault through retrieval and can safely propose changes for user review.

## P0 capabilities

- Ollama local LLM provider
- Manual Markdown Vault indexing
- Local embeddings
- Hybrid semantic + keyword retrieval
- RAG context construction
- Sidebar assistant
- Current-note analysis
- Selection-ready AI foundation
- Suggested tags and wikilinks
- Structured action plans
- Action validation
- Review before applying changes
- Undo of the last AI operation

## Explicit non-goals

- File deletion
- Fully autonomous agent
- Cloud AI as a primary provider
- Mobile support
- Automatic continuous indexing
- Knowledge graph
- Vault Health dashboard
- Multimodal AI
- Complex preference learning
- Multi-provider UI

## Safety model

LLM output is treated as untrusted data. It may only produce typed actions. Actions are validated by the plugin and must be reviewed by the user before execution. DELETE is not part of the action schema.

## Vertical slice

```text
Ollama
  ↓
Vault scanner → chunks → embeddings → local index
  ↓
Hybrid retrieval
  ↓
RAG prompt
  ↓
LLM
  ↓
Answer / action plan
  ↓
Validation
  ↓
Review
  ↓
Apply
  ↓
Undo
```

## Current implementation status

The repository currently contains the plugin skeleton, Ollama client, Vault chunk index, retrieval layer, sidebar, settings, and initial action-planning/validation primitives. The next implementation step is to finish the action executor/review UI and harden indexing and retrieval behavior.
