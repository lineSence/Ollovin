import { App, Notice, TFolder } from "obsidian";

interface TestNote {
  path: string;
  content: string;
}

const NOTES: TestNote[] = [
  {
    path: "Ollovin Test Vault/AI/Local LLM.md",
    content: `# Local LLM\n\nLocal large language models allow private text processing without sending notes to a cloud API. Useful runtimes include Ollama and LM Studio.\n\nRelated ideas: [[Ollama]], [[RAG]], [[Embeddings]], [[On-device ML]].\n\nTags: #ai #local-ai #llm\n`,
  },
  {
    path: "Ollovin Test Vault/AI/Ollama.md",
    content: `# Ollama\n\nOllama provides a local HTTP API for running language models. A desktop assistant can use it for chat, summarization and structured actions.\n\nThe local endpoint is commonly exposed at http://localhost:11434.\n\nRelated: [[Local LLM]], [[RAG]], [[Ollovin]].\n`,
  },
  {
    path: "Ollovin Test Vault/AI/Embeddings.md",
    content: `# Embeddings\n\nEmbeddings turn text into vectors that can be compared for semantic similarity. They are useful for retrieving related notes even when the wording differs.\n\nRelated: [[Semantic Search]], [[Vector Database]], [[Hybrid Retrieval]], [[RAG]].\n`,
  },
  {
    path: "Ollovin Test Vault/AI/RAG.md",
    content: `# Retrieval Augmented Generation\n\nRAG combines retrieval with generation. The application first finds relevant chunks and then gives those chunks to the language model as context.\n\nA good RAG pipeline needs chunking, embeddings, ranking and context limits.\n\nRelated: [[Semantic Search]], [[Hybrid Retrieval]], [[Ollama]].\n`,
  },
  {
    path: "Ollovin Test Vault/AI/Vector Database.md",
    content: `# Vector Database\n\nA vector database stores embeddings and supports similarity search. For a small personal Vault, a lightweight local index may be enough instead of a server database.\n\nRelated: [[Embeddings]], [[Semantic Search]].\n`,
  },
  {
    path: "Ollovin Test Vault/Research/Semantic Search.md",
    content: `# Semantic Search\n\nSemantic search finds text by meaning rather than exact words. For example, a query about private speech recognition may retrieve a note that only says Whisper runs locally.\n\nRelated: [[Embeddings]], [[Hybrid Retrieval]], [[Whisper]], [[Speech Recognition]].\n`,
  },
  {
    path: "Ollovin Test Vault/Research/Hybrid Retrieval.md",
    content: `# Hybrid Retrieval\n\nHybrid retrieval combines keyword matching with semantic similarity. Keyword search is precise for names and identifiers, while embeddings help with paraphrases.\n\nA simple weighted score can combine both signals before sending the top chunks to an LLM.\n\nRelated: [[Semantic Search]], [[RAG]].\n`,
  },
  {
    path: "Ollovin Test Vault/Research/Whisper.md",
    content: `# Whisper\n\nWhisper is a speech recognition model that can transcribe audio. Running a suitable model locally avoids uploading private recordings.\n\nThis is relevant to mobile voice notes and offline assistants.\n\nRelated: [[Speech Recognition]], [[On-device ML]], [[Android AI]].\n`,
  },
  {
    path: "Ollovin Test Vault/Research/Speech Recognition.md",
    content: `# Speech Recognition\n\nSpeech recognition converts spoken audio into text. Local transcription is attractive when recordings contain private conversations or ideas.\n\nPossible approaches include Whisper and smaller quantized models.\n\nRelated: [[Whisper]], [[On-device ML]], [[Android AI]].\n`,
  },
  {
    path: "Ollovin Test Vault/Android/Android AI.md",
    content: `# Android AI\n\nRunning AI directly on Android can reduce latency and keep user data offline. Model size, memory use and battery consumption are the main constraints.\n\nSpeech recognition is one promising use case.\n\nRelated: [[On-device ML]], [[Whisper]], [[Flutter]].\n`,
  },
  {
    path: "Ollovin Test Vault/Android/On-device ML.md",
    content: `# On-device ML\n\nOn-device machine learning runs inference directly on a phone. Quantization can make models small enough for mobile hardware.\n\nThis approach is useful for offline classification, embeddings and speech recognition.\n\nRelated: [[Android AI]], [[Whisper]].\n`,
  },
  {
    path: "Ollovin Test Vault/Android/Flutter.md",
    content: `# Flutter\n\nFlutter is a cross-platform UI toolkit. It can be used for Android applications that call local inference engines or native ML libraries.\n\nRelated: [[Android AI]], [[Pinzon]].\n`,
  },
  {
    path: "Ollovin Test Vault/Projects/Ollovin.md",
    content: `# Ollovin\n\nOllovin is a local AI assistant for Obsidian. Its critical MVP loop is: index Vault, retrieve context, ask a local model, propose structured actions, review changes and undo.\n\nThe assistant should never delete notes automatically.\n\nRelated: [[Local LLM]], [[RAG]], [[Semantic Search]], [[Pinzon]].\n`,
  },
  {
    path: "Ollovin Test Vault/Projects/Pinzon.md",
    content: `# Pinzon\n\nPinzon is a visual archive for saving and sorting product links. The project uses Android and focuses on collecting product cards from shared links.\n\nIdeas from Pinzon that may transfer to Ollovin include offline-first storage and robust handling of unreliable external data.\n\nRelated: [[Ollovin]], [[Flutter]], [[Visual Bookmarking]].\n`,
  },
  {
    path: "Ollovin Test Vault/Projects/Visual Bookmarking.md",
    content: `# Visual Bookmarking\n\nA visual bookmark can preserve a screenshot, title, URL and useful metadata. A local archive should remain useful even if the source website changes.\n\nRelated: [[Pinzon]].\n`,
  },
  {
    path: "Ollovin Test Vault/Ideas/Offline Assistant.md",
    content: `# Offline Assistant\n\nAn assistant that works without a cloud connection could summarize notes, find related ideas and prepare edits. The main advantage is privacy.\n\nThe assistant needs a local model, a searchable index and a safe action layer.\n\nPotentially related to mobile inference: [[Android AI]], [[Local LLM]].\n`,
  },
  {
    path: "Ollovin Test Vault/Ideas/Voice Notes.md",
    content: `# Voice Notes\n\nI want to capture ideas quickly by speaking. A future workflow could transcribe recordings locally and then organize the resulting text into the Vault.\n\nPossible technology: Whisper.\n`,
  },
  {
    path: "Ollovin Test Vault/Ideas/Knowledge Graph.md",
    content: `# Knowledge Graph\n\nA graph view could show connections between projects, technologies and research notes. It is interesting, but not required for the first Ollovin MVP.\n\nRelated: [[Semantic Search]], [[Ollovin]].\n`,
  },
  {
    path: "Ollovin Test Vault/Inbox/Messy AI Idea.md",
    content: `# random idea\n\nmaybe use local whisper for voice stuff and embeddings to find old notes. Need something that understands what I mean even when I don't use same words. Could be useful in ollovin.\n`,
  },
  {
    path: "Ollovin Test Vault/Inbox/Unlinked Android Idea.md",
    content: `# Android transcription idea\n\nSmall speech models on phones might be good enough. Need to test memory usage and battery. Maybe this connects to the Whisper research but I haven't linked it yet.\n`,
  },
  {
    path: "Ollovin Test Vault/Inbox/Unsorted Project.md",
    content: `# Project thought\n\nKeep everything local. Search should combine words and meaning. Changes should be suggestions, not silent edits.\n`,
  },
  {
    path: "Ollovin Test Vault/Books/AI Engineering.md",
    content: `# AI Engineering\n\nNotes about production AI systems: retrieval quality often matters as much as model quality. Structured outputs make tool use safer.\n\nRelated: [[RAG]], [[Hybrid Retrieval]], [[Ollovin]].\n`,
  },
  {
    path: "Ollovin Test Vault/Tasks/Ollovin MVP.md",
    content: `# Ollovin MVP tasks\n\n- [ ] Test Ollama connection\n- [ ] Index synthetic Vault\n- [ ] Test semantic search\n- [ ] Test current-note analysis\n- [ ] Test suggested links\n- [ ] Test review and undo\n`,
  },
  {
    path: "Ollovin Test Vault/Meta/Test Queries.md",
    content: `# Test Queries\n\n1. What notes are related to local transcription on Android?\n2. Find everything I wrote about private speech recognition.\n3. What connects Ollama, embeddings and RAG?\n4. Which notes should be linked to the current note?\n5. Summarize my ideas about offline AI.\n6. Find notes that discuss semantic search without using that exact phrase.\n7. What is the relationship between Pinzon and Ollovin?\n`,
  },
];

export async function generateTestVault(app: App): Promise<void> {
  const root = "Ollovin Test Vault";
  const existing = app.vault.getAbstractFileByPath(root);
  if (existing && !(existing instanceof TFolder)) {
    throw new Error(`${root} exists but is not a folder`);
  }

  const folders = new Set<string>();
  for (const note of NOTES) {
    const parts = note.path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      folders.add(current);
    }
  }

  for (const folder of [...folders].sort((a, b) => a.length - b.length)) {
    if (!app.vault.getAbstractFileByPath(folder)) {
      await app.vault.createFolder(folder);
    }
  }

  let created = 0;
  let skipped = 0;
  for (const note of NOTES) {
    const existingNote = app.vault.getAbstractFileByPath(note.path);
    if (existingNote) {
      skipped++;
      continue;
    }
    await app.vault.create(note.path, note.content);
    created++;
  }

  new Notice(`Ollovin: test Vault ready — ${created} notes created${skipped ? `, ${skipped} already existed` : ""}`);
}
