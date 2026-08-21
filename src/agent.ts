import { App, TFile, normalizePath } from "obsidian";
import { AIAction, AIActionPlan, ChangePreview } from "./types";

export const SYSTEM_PROMPT = `Ты Ollovin — локальный ИИ-помощник для Obsidian. Используй только контекст. Если нужно изменить хранилище, верни только JSON {"summary":"string","actions":[...]} . Типы: ADD_TAG(tag), REMOVE_TAG(tag), ADD_LINK(target), REMOVE_LINK(target), EDIT_NOTE(content), CREATE_NOTE(content), MOVE_NOTE(destination), RENAME_NOTE(newPath), UPDATE_FRONTMATTER(frontmatter). Никогда не используй DELETE.`;
const TYPES = ["ADD_TAG","REMOVE_TAG","ADD_LINK","REMOVE_LINK","EDIT_NOTE","CREATE_NOTE","MOVE_NOTE","RENAME_NOTE","UPDATE_FRONTMATTER"];

export class ActionPlanner {
  constructor(private readonly app: App) {}
  buildPlan(raw: string): AIActionPlan {
    const s = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
    const a=s.indexOf("{"), b=s.lastIndexOf("}"); if(a<0||b<=a) throw new Error("ИИ не вернул JSON");
    let p: any; try { p=JSON.parse(s.slice(a,b+1)); } catch { throw new Error("ИИ вернул некорректный JSON"); }
    if(!Array.isArray(p.actions)) throw new Error("ИИ вернул некорректный план изменений");
    return {summary:typeof p.summary==="string"?p.summary:"",actions:p.actions.map((x:any,i:number)=>this.validate(x,i))};
  }
  private validate(x:any,i:number):AIAction {
    if(!x||typeof x!=="object"||typeof x.id!=="string"||typeof x.type!=="string"||!TYPES.includes(x.type)||typeof x.file!=="string"||!x.file.trim()) throw new Error(`Некорректное действие №${i+1}`);
    const required:Record<string,string>={ADD_TAG:"tag",REMOVE_TAG:"tag",ADD_LINK:"target",REMOVE_LINK:"target",EDIT_NOTE:"content",CREATE_NOTE:"content",MOVE_NOTE:"destination",RENAME_NOTE:"newPath"};
    const k=required[x.type]; if(k&&typeof x[k]!=="string") throw new Error(`У действия №${i+1} отсутствует поле ${k}`);
    if(x.type==="UPDATE_FRONTMATTER"&&(!x.frontmatter||typeof x.frontmatter!=="object"||Array.isArray(x.frontmatter))) throw new Error(`У действия №${i+1} отсутствует frontmatter`);
    return x as AIAction;
  }
  async preview(plan:AIActionPlan):Promise<ChangePreview[]> { return Promise.all(plan.actions.map(a=>this.previewAction(a))); }
  private async previewAction(a:AIAction):Promise<ChangePreview>{
    const f=this.app.vault.getAbstractFileByPath(normalizePath(a.file));
    if(a.type==="CREATE_NOTE") return {action:a,valid:!f,error:f?"Файл уже существует":undefined,after:a.content};
    if(!(f instanceof TFile)) return {action:a,valid:false,error:"Файл не существует"};
    if(a.type==="EDIT_NOTE") return {action:a,before:await this.app.vault.read(f),after:a.content,valid:true};
    if(a.type==="MOVE_NOTE"||a.type==="RENAME_NOTE"){const d=normalizePath(a.type==="MOVE_NOTE"?a.destination:a.newPath),t=this.app.vault.getAbstractFileByPath(d);return {action:a,valid:!t,error:t?"Целевой путь уже существует":undefined};}
    return {action:a,valid:true};
  }
  async apply(ps:ChangePreview[]):Promise<()=>Promise<void>>{
    if(ps.some(p=>!p.valid)) throw new Error("План содержит недопустимые изменения");
    const snap=new Map<string,string|null>(), paths=new Set<string>();
    for(const p of ps){paths.add(p.action.file);if(p.action.type==="MOVE_NOTE")paths.add(p.action.destination);if(p.action.type==="RENAME_NOTE")paths.add(p.action.newPath);}
    for(const path of paths){const f=this.app.vault.getAbstractFileByPath(normalizePath(path));snap.set(path,f instanceof TFile?await this.app.vault.read(f):null);}
    try{for(const p of ps)await this.applyAction(p.action);}catch(e){await this.restore(snap);throw e;}
    return ()=>this.restore(snap);
  }
  private async applyAction(a:AIAction){
    const f=this.app.vault.getAbstractFileByPath(normalizePath(a.file));
    if(a.type==="CREATE_NOTE"){await this.app.vault.create(normalizePath(a.file),a.content);return;}
    if(!(f instanceof TFile))throw new Error(`Файл не найден: ${a.file}`);
    if(a.type==="EDIT_NOTE"){await this.app.vault.modify(f,a.content);return;}
    if(a.type==="ADD_TAG"||a.type==="REMOVE_TAG"){
      const c=await this.app.vault.read(f),tag=normTag(a.tag),re=new RegExp(`(^|\\s)${esc(tag)}(?=\\s|$)`,"gm"),has=re.test(c);
      const n=a.type==="ADD_TAG"&&!has?`${c.trimEnd()}\n\n${tag}\n`:a.type==="REMOVE_TAG"&&has?c.replace(new RegExp(`(^|\\s)${esc(tag)}(?=\\s|$)`,"gm"),"$1").replace(/\n{3,}/g,"\n\n"):c;await this.app.vault.modify(f,n);return;
    }
    if(a.type==="ADD_LINK"||a.type==="REMOVE_LINK"){
      const c=await this.app.vault.read(f),t=normLink(a.target),re=new RegExp(`\\[\\[${esc(t)}\\]\\]`,"g"),has=re.test(c);
      const n=a.type==="ADD_LINK"&&!has?`${c.trimEnd()}\n\n[[${t}]]\n`:a.type==="REMOVE_LINK"&&has?c.replace(re,""):c;await this.app.vault.modify(f,n);return;
    }
    if(a.type==="MOVE_NOTE"||a.type==="RENAME_NOTE"){await this.app.fileManager.renameFile(f,normalizePath(a.type==="MOVE_NOTE"?a.destination:a.newPath));return;}
    if(a.type==="UPDATE_FRONTMATTER"){await this.app.fileManager.processFrontMatter(f,fm=>Object.assign(fm,a.frontmatter));}
  }
  private async restore(s:Map<string,string|null>){for(const [path,c] of s){const f=this.app.vault.getAbstractFileByPath(normalizePath(path));if(c===null){if(f instanceof TFile)await this.app.vault.delete(f);}else if(f instanceof TFile)await this.app.vault.modify(f,c);else await this.app.vault.create(normalizePath(path),c);}}
}
function normTag(v:string){const s=v.trim();return s.startsWith("#")?s:`#${s}`;}
function normLink(v:string){return v.trim().replace(/^\[\[|\]\]$/g,"").trim();}
function esc(v:string){return v.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
