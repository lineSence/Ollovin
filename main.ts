import { App, ItemView, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { OllamaClient } from "./src/ollama";
import { OllovinSettings, RetrievalResult } from "./src/types";
import { VaultIndex } from "./src/vault-index";
import { Retriever } from "./src/retrieval";
import { ActionPlanner, SYSTEM_PROMPT } from "./src/agent";
import { generateTestVault } from "./src/test-vault-generator";

const DEFAULT_SETTINGS: OllovinSettings = {
  ollamaEndpoint: "http://localhost:11434",
  llmModel: "",
  embeddingModel: "",
  indexVersion: 1,
};

export default class OllovinPlugin extends Plugin {
  settings!: OllovinSettings;
  ollama!: OllamaClient;
  index!: VaultIndex;
  retriever!: Retriever;
  planner!: ActionPlanner;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.ollama = new OllamaClient(this.settings.ollamaEndpoint);
    this.index = new VaultIndex(this.app, this.settings, this.ollama);
    await this.index.load();
    this.retriever = new Retriever(this.ollama, () => this.settings.embeddingModel, () => this.index.getChunks());
    this.planner = new ActionPlanner(this.app);

    this.registerView(VIEW_TYPE_OLLOVIN, (leaf) => new OllovinView(leaf, this));
    this.addRibbonIcon("brain", "Open Ollovin", () => void this.activateView());
    this.addCommand({ id: "open-assistant", name: "Open Assistant", callback: () => this.activateView() });
    this.addCommand({ id: "analyze-current-note", name: "Analyze Current Note", callback: () => void this.analyzeCurrentNote() });
    this.addCommand({ id: "find-related", name: "Find Related Notes", callback: () => void this.findRelated() });
    this.addCommand({ id: "reindex", name: "Reindex Vault", callback: () => void this.reindex() });
    this.addCommand({ id: "generate-test-vault", name: "Generate Test Vault", callback: () => void generateTestVault(this.app) });
    this.addSettingTab(new OllovinSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.ollama = new OllamaClient(this.settings.ollamaEndpoint);
    this.retriever = new Retriever(this.ollama, () => this.settings.embeddingModel, () => this.index.getChunks());
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_OLLOVIN);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_OLLOVIN, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async reindex(): Promise<void> {
    const notice = new Notice("Ollovin: indexing Vault...", 0);
    try {
      await this.index.rebuild((current, total) => notice.setMessage(`Ollovin: indexing ${current}/${total}`));
      notice.hide();
      new Notice(`Ollovin: indexed ${this.index.size} chunks`);
    } catch (error) {
      notice.hide();
      new Notice(`Ollovin: indexing failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async analyzeCurrentNote(): Promise<void> {
    const file = this.getCurrentFile();
    if (!file) {
      new Notice("Ollovin: open a Markdown note first");
      return;
    }
    await this.activateView();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_OLLOVIN)[0]?.view;
    if (view instanceof OllovinView) await view.analyzeFile(file);
  }

  async findRelated(): Promise<void> {
    const file = this.getCurrentFile();
    if (!file) return;
    await this.activateView();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_OLLOVIN)[0]?.view;
    if (view instanceof OllovinView) await view.findRelatedForFile(file);
  }

  getCurrentFile(): TFile | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
  }
}

export const VIEW_TYPE_OLLOVIN = "ollovin-sidebar";

class OllovinView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private readonly plugin: OllovinPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_OLLOVIN; }
  getDisplayText(): string { return "Ollovin"; }
  getIcon(): string { return "brain"; }

  async onOpen(): Promise<void> { this.render(); }
  async onClose(): Promise<void> { this.contentEl.empty(); }

  render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("ollovin-view");
    this.contentEl.createEl("h2", { text: "🧠 Ollovin" });
    this.contentEl.createDiv({ cls: "ollovin-status", text: `Index: ${this.plugin.index.size} chunks` });

    const input = this.contentEl.createEl("textarea", { attr: { placeholder: "Ask Ollovin about your Vault..." } });
    const ask = this.contentEl.createEl("button", { text: "Ask Ollovin" });
    ask.addEventListener("click", () => void this.ask(input.value));

    const actions = this.contentEl.createDiv({ cls: "ollovin-actions" });
    this.addButton(actions, "Analyze current note", () => void this.analyzeCurrent());
    this.addButton(actions, "Find related", () => void this.findCurrentRelated());
    this.addButton(actions, "Generate test Vault", () => void generateTestVault(this.plugin.app));
    this.addButton(actions, "Reindex Vault", () => void this.plugin.reindex());

    this.contentEl.createEl("h3", { text: "Response" });
    this.contentEl.createDiv({ cls: "ollovin-response" });
  }

  private addButton(parent: HTMLElement, text: string, callback: () => void): void {
    const button = parent.createEl("button", { text });
    button.addEventListener("click", callback);
  }

  private responseEl(): HTMLElement {
    return this.contentEl.querySelector(".ollovin-response") as HTMLElement;
  }

  async ask(query: string): Promise<void> {
    if (!query.trim()) return;
    const response = this.responseEl();
    response.setText("Searching Vault...");
    try {
      const results = await this.plugin.retriever.search(query);
      const context = formatContext(results);
      const prompt = `User question:\n${query}\n\nVault context:\n${context}\n\nAnswer using only this context. If the context is insufficient, say so.`;
      const answer = await this.plugin.ollama.generate(this.plugin.settings.llmModel, prompt, SYSTEM_PROMPT);
      response.setText(answer);
    } catch (error) {
      response.setText(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async analyzeCurrent(): Promise<void> {
    const file = this.plugin.getCurrentFile();
    if (file) await this.analyzeFile(file);
  }

  async analyzeFile(file: TFile): Promise<void> {
    const response = this.responseEl();
    response.setText("Analyzing note...");
    try {
      const content = await this.plugin.app.vault.cachedRead(file);
      const results = await this.plugin.retriever.search(content.slice(0, 1000));
      const context = formatContext(results);
      const prompt = `Analyze the current note. Return a concise summary, topics, suggested tags and suggested wikilinks.\n\nCurrent note (${file.path}):\n${content}\n\nRelated Vault context:\n${context}`;
      const answer = await this.plugin.ollama.generate(this.plugin.settings.llmModel, prompt, SYSTEM_PROMPT);
      response.setText(answer);
    } catch (error) {
      response.setText(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async findCurrentRelated(): Promise<void> {
    const file = this.plugin.getCurrentFile();
    if (file) await this.findRelatedForFile(file);
  }

  async findRelatedForFile(file: TFile): Promise<void> {
    const response = this.responseEl();
    const content = await this.plugin.app.vault.cachedRead(file);
    const results = await this.plugin.retriever.search(content.slice(0, 1200), 10);
    response.empty();
    response.createEl("strong", { text: "Related notes" });
    for (const result of results.filter((item) => item.chunk.path !== file.path)) {
      const row = response.createDiv();
      row.setText(`${result.chunk.title} — ${(result.score * 100).toFixed(0)}%`);
      row.addClass("ollovin-related-row");
      row.addEventListener("click", () => void this.plugin.app.workspace.openLinkText(result.chunk.path, file.path));
    }
  }
}

function formatContext(results: RetrievalResult[]): string {
  return results.map((result, index) => `[#${index + 1}] ${result.chunk.path}\n${result.chunk.content}`).join("\n\n");
}

class OllovinSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: OllovinPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Ollovin" });

    new Setting(containerEl).setName("Ollama endpoint").addText((text) => text
      .setValue(this.plugin.settings.ollamaEndpoint)
      .setPlaceholder("http://localhost:11434")
      .onChange(async (value) => {
        this.plugin.settings.ollamaEndpoint = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName("LLM model").setDesc("Model used for chat and analysis.").addText((text) => text
      .setValue(this.plugin.settings.llmModel)
      .setPlaceholder("qwen3:8b")
      .onChange(async (value) => {
        this.plugin.settings.llmModel = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName("Embedding model").setDesc("Local Ollama embedding model. Reindex after changing it.").addText((text) => text
      .setValue(this.plugin.settings.embeddingModel)
      .setPlaceholder("embeddinggemma")
      .onChange(async (value) => {
        this.plugin.settings.embeddingModel = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName("Connection").addButton((button) => button
      .setButtonText("Test Ollama")
      .onClick(async () => {
        try {
          const models = await this.plugin.ollama.testConnection();
          new Notice(`Ollama connected — ${models.length} model(s)`);
        } catch (error) {
          new Notice(`Ollama connection failed — ${error instanceof Error ? error.message : String(error)}`);
        }
      }));

    new Setting(containerEl).setName("Test data").setDesc("Creates a synthetic Vault with AI, Android, research and project notes for testing retrieval and RAG.").addButton((button) => button
      .setButtonText("Generate test Vault")
      .onClick(() => void generateTestVault(this.plugin.app)));

    new Setting(containerEl).setName("Index").setDesc(`${this.plugin.index.size} chunks currently indexed.`).addButton((button) => button
      .setButtonText("Reindex Vault")
      .onClick(() => void this.plugin.reindex()));
  }
}
