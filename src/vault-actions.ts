import { AIActionPlan, ChangePreview } from "./types";
import { ActionPlanner } from "./agent";
import { OllamaClient } from "./ollama";
import { VaultAnalysisPlan } from "./vault-analysis";

interface OrganizationDecision { folders?: Record<string,string>; names?: Record<string,string>; links?: Array<{from:string;to:string}>; tags?: Record<string,string[]>; summary?: string; }

export class VaultActionPlanner {
  constructor(private readonly ollama: OllamaClient, private readonly planner: ActionPlanner) {}

  async createPlan(model: string, analysis: VaultAnalysisPlan): Promise<AIActionPlan> {
    const paths = analysis.clusters.flatMap(c => c.notePaths);
    const context = analysis.clusters.map(c => `${c.name}: ${c.description}\n${c.notePaths.join("\n")}`).join("\n\n");
    const prompt = `Ты архитектор Obsidian Vault. НЕ генерируй файловые операции. Прими только решения: в какую папку поместить заметку, как её назвать и какие заметки связать. Ответ должен быть коротким и пригодным для машинного разбора.\n\nВерни ТОЛЬКО JSON: {"summary":"до 300 символов","folders":{"точный/путь.md":"Папка"},"names":{"точный/путь.md":"Новое имя без .md"},"links":[{"from":"точный/путь.md","to":"точный/путь.md"}],"tags":{"точный/путь.md":["тег"]}}\n\nПравила:\n- Используй ТОЛЬКО пути из списка.\n- Не удаляй заметки и не создавай новые.\n- Папки короткие, 3–7 основных разделов.\n- Новое имя должно описывать смысл заметки. Не переименовывай уже понятные имена без необходимости.\n- Добавляй только действительно полезные связи.\n- Теги вторичны, максимум 1–2 на заметку.\n- Не включай ключи, если решение для них не требуется.\n\nДОПУСТИМЫЕ ПУТИ:\n${paths.join("\n")}\n\nКЛАСТЕРЫ:\n${context}\n\nСИРОТСКИЕ:\n${analysis.orphanNotes.join("\n")}`;
    const raw = await this.ollama.generate(model, prompt, "Ты лаконичный архитектор Obsidian. Возвращай только компактный JSON с решениями, без действий и объяснений.", "json");
    const d = parseDecision(raw);
    const allowed = new Set(paths);
    const actions: any[] = [];
    for (const [file, folder] of Object.entries(d.folders ?? {})) if (allowed.has(file) && typeof folder === "string" && folder.trim()) actions.push({ id:`move-${actions.length+1}`, type:"MOVE_NOTE", file, destination:`${folder.replace(/^\/|\/$/g, "")}/${file.split("/").pop()}` });
    for (const [file, name] of Object.entries(d.names ?? {})) if (allowed.has(file) && typeof name === "string" && name.trim()) { const dir=file.includes("/")?file.slice(0,file.lastIndexOf("/")):""; const target=`${dir ? dir+"/" : ""}${name.trim().replace(/\.md$/i,"")}.md`; if (target!==file) actions.push({id:`rename-${actions.length+1}`,type:"RENAME_NOTE",file,newPath:target}); }
    for (const link of d.links ?? []) if (link && allowed.has(link.from) && allowed.has(link.to) && link.from!==link.to) actions.push({id:`link-${actions.length+1}`,type:"ADD_LINK",file:link.from,target:link.to.replace(/\.md$/i,"")});
    for (const [file,tags] of Object.entries(d.tags ?? {})) if (allowed.has(file) && Array.isArray(tags)) for (const tag of tags.slice(0,2)) if (typeof tag === "string" && tag.trim()) actions.push({id:`tag-${actions.length+1}`,type:"ADD_TAG",file,tag});
    if (!actions.length) throw new Error("ИИ не предложил изменений для структуры хранилища");
    return this.planner.buildPlan(JSON.stringify({summary:d.summary ?? "Подготовлена новая структура хранилища",actions}));
  }
  async preview(plan: AIActionPlan): Promise<ChangePreview[]> { return this.planner.preview(plan); }
  async apply(previews: ChangePreview[]): Promise<() => Promise<void>> { return this.planner.apply(previews); }
}

function parseDecision(raw:string):OrganizationDecision { const text=raw.trim(), start=text.indexOf("{"), end=text.lastIndexOf("}"); if(start<0||end<=start) throw new Error("ИИ не вернул структуру организации"); try { const x=JSON.parse(text.slice(start,end+1)) as OrganizationDecision; if(!x || typeof x!=="object") throw new Error(); return x; } catch { throw new Error("ИИ вернул некорректную структуру организации"); } }
