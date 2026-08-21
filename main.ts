import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";
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
    this.addRibbonIcon("brain", "Открыть Ollovin", () => void this.activateView());
    this.addCommand({ id: "open-assistant", name: "Ollovin: Открыть помощника", callback: () => void this.activateView() });
    this.addCommand({ id: "analyze-current-note", name: "Ollovin: Анализировать текущую заметку", callback: () => void this.analyzeCurrentNote() });
    this.addCommand({ id: "find-related", name: "Ollovin: Найти связанные заметки", callback: () => void this.findRelated() });
    this.addCommand({ id: "reindex", name: "Ollovin: Переиндексировать хранилище", callback: () => void this.reindex() });
    this.addCommand({ id: "generate-test-vault", name: "Ollovin: Создать тестовые заметки", callback: () => void this.generateTestVault() });
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
    const notice = new Notice("Ollovin: индексация хранилища…", 0);
    try {
      await this.index.rebuild((current, total) => notice.setMessage(`Ollovin: индексация ${current}/${total}`));
      notice.hide();
      new Notice(`Ollovin: проиндексировано фрагментов — ${this.index.size}`);
      this.refreshViews();
    } catch (error) {
      notice.hide();
      new Notice(`Ollovin: ошибка индексации — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async analyzeCurrentNote(): Promise<void> {
    const file = this.getCurrentFile();
    if (!file) {
      new Notice("Ollovin: сначала откройте Markdown-заметку");
      return;
    }
    await this.activateView();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_OLLOVIN)[0]?.view;
    if (view instanceof OllovinView) await view.analyzeFile(file);
  }

  async findRelated(): Promise<void> {
    const file = this.getCurrentFile();
    if (!file) {
      new Notice("Ollovin: сначала откройте Markdown-заметку");
      return;
    }
    await this.activateView();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_OLLOVIN)[0]?.view;
    if (view instanceof OllovinView) await view.findRelatedForFile(file);
  }

  async generateTestVault(): Promise<void> {
    try {
      await generateTestVault(this.app);
      new Notice("Ollovin: тестовые заметки созданы");
      this.refreshViews();
    } catch (error) {
      new Notice(`Ollovin: не удалось создать тестовые заметки — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getCurrentFile(): TFile | null {
    // Важно: при нажатии кнопки в Sidebar активным view становится Sidebar,
    // поэтому getActiveViewOfType(MarkdownView) больше не подходит.
    return this.app.workspace.getActiveFile();
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_OLLOVIN)) {
      if (leaf.view instanceof OllovinView) leaf.view.render();
    }
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
    this.contentEl.createDiv({ cls: "ollovin-status", text: `Индекс: ${this.plugin.index.size} фрагментов` });

    const input = this.contentEl.createEl("textarea", { attr: { placeholder: "Задайте вопрос по вашему хранилищу…" } });
    const ask = this.contentEl.createEl("button", { text: "Спросить Ollovin" });
    ask.addEventListener("click", () => void this.ask(input.value));

    const actions = this.contentEl.createDiv({ cls: "ollovin-actions" });
    this.addButton(actions, "Анализировать текущую заметку", () => void this.analyzeCurrent());
    this.addButton(actions, "Найти связанные заметки", () => void this.findCurrentRelated());
    this.addButton(actions, "Создать тестовые заметки", () => void this.plugin.generateTestVault());
    this.addButton(actions, "Переиндексировать хранилище", () => void this.plugin.reindex());

    this.contentEl.createEl("h3", { text: "Результат" });
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
    if (!query.trim()) {
      new Notice("Ollovin: введите вопрос");
      return;
    }
    const response = this.responseEl();
    response.setText("Поиск по хранилищу…");
    try {
      const results = await this.plugin.retriever.search(query);
      const context = formatContext(results);
      const prompt = `Вопрос пользователя:\n${query}\n\nКонтекст хранилища:\n${context}\n\nОтвечай только на основании этого контекста. Если данных недостаточно, скажи об этом.`;
      const answer = await this.plugin.ollama.generate(this.plugin.settings.llmModel, prompt, SYSTEM_PROMPT);
      response.setText(answer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.setText(`Ошибка: ${message}`);
      new Notice(`Ollovin: ${message}`);
    }
  }

  async analyzeCurrent(): Promise<void> {
    const file = this.plugin.getCurrentFile();
    if (!file) {
      new Notice("Ollovin: сначала откройте Markdown-заметку");
      return;
    }
    await this.analyzeFile(file);
  }

  async analyzeFile(file: TFile): Promise<void> {
    const response = this.responseEl();
    response.setText("Анализ заметки…");
    try {
      const content = await this.plugin.app.vault.cachedRead(file);
      const results = await this.plugin.retriever.search(content.slice(0, 1000));
      const context = formatContext(results.filter((item) => item.chunk.path !== file.path));
      const prompt = `Проанализируй текущую заметку. Верни краткое резюме, основные темы, предлагаемые теги и предлагаемые wikilinks. Не изменяй заметку.\n\nТекущая заметка (${file.path}):\n${content}\n\nСвязанный контекст хранилища:\n${context}`;
      const answer = await this.plugin.ollama.generate(this.plugin.settings.llmModel, prompt, SYSTEM_PROMPT);
      response.setText(answer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.setText(`Ошибка анализа: ${message}`);
      new Notice(`Ollovin: ${message}`);
    }
  }

  async findCurrentRelated(): Promise<void> {
    const file = this.plugin.getCurrentFile();
    if (!file) {
      new Notice("Ollovin: сначала откройте Markdown-заметку");
      return;
    }
    await this.findRelatedForFile(file);
  }

  async findRelatedForFile(file: TFile): Promise<void> {
    const response = this.responseEl();
    response.setText("Поиск связанных заметок…");
    try {
      const content = await this.plugin.app.vault.cachedRead(file);
      const results = await this.plugin.retriever.search(content.slice(0, 1200), 10);
      response.empty();
      response.createEl("strong", { text: "Связанные заметки" });
      const related = results.filter((item) => item.chunk.path !== file.path);
      if (related.length === 0) {
        response.createDiv({ text: "Связанных заметок не найдено. Попробуйте переиндексировать хранилище." });
        return;
      }
      for (const result of related) {
        const row = response.createDiv();
        row.setText(`${result.chunk.title} — ${(result.score * 100).toFixed(0)}%`);
        row.addClass("ollovin-related-row");
        row.addEventListener("click", () => void this.plugin.app.workspace.openLinkText(result.chunk.path, file.path));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.setText(`Ошибка поиска: ${message}`);
      new Notice(`Ollovin: ${message}`);
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
    containerEl.createEl("h2", { text: "Ollovin — локальный ИИ для Obsidian" });

    new Setting(containerEl).setName("Адрес Ollama").setDesc("Адрес локального сервера Ollama.").addText((text) => text
      .setValue(this.plugin.settings.ollamaEndpoint)
      .setPlaceholder("http://localhost:11434")
      .onChange(async (value) => {
        this.plugin.settings.ollamaEndpoint = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName("Модель ИИ").setDesc("Модель для чата и анализа заметок.").addText((text) => text
      .setValue(this.plugin.settings.llmModel)
      .setPlaceholder("qwen3:8b")
      .onChange(async (value) => {
        this.plugin.settings.llmModel = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName("Модель эмбеддингов").setDesc("Локальная модель Ollama для семантического поиска. После смены модели переиндексируйте хранилище.").addText((text) => text
      .setValue(this.plugin.settings.embeddingModel)
      .setPlaceholder("embeddinggemma")
      .onChange(async (value) => {
        this.plugin.settings.embeddingModel = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName("Подключение").setDesc("Проверить доступность Ollama и список моделей.").addButton((button) => button
      .setButtonText("Проверить Ollama")
      .onClick(async () => {
        try {
          const models = await this.plugin.ollama.testConnection();
          new Notice(`Ollama подключена — моделей: ${models.length}`);
        } catch (error) {
          new Notice(`Ошибка подключения к Ollama — ${error instanceof Error ? error.message : String(error)}`);
        }
      }));

    new Setting(containerEl).setName("Тестовые данные").setDesc("Создать синтетическое хранилище для проверки поиска и RAG.").addButton((button) => button
      .setButtonText("Создать тестовые заметки")
      .onClick(() => void this.plugin.generateTestVault()));

    new Setting(containerEl).setName("Индекс").setDesc(`Сейчас проиндексировано: ${this.plugin.index.size} фрагментов.`).addButton((button) => button
      .setButtonText("Переиндексировать")
      .onClick(() => void this.plugin.reindex()));
  }
}
