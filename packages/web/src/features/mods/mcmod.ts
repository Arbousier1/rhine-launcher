/**
 * MC 百科（mcmod.cn）入口，行为对齐 PCL2：
 *  - 已知百科条目：直达 https://www.mcmod.cn/class/<id>.html
 *  - 否则按模组名搜索：https://www.mcmod.cn/s?key=<name>&site=all&filter=0
 *
 * PCL2 用内置数据库按 slug 匹配得到条目 ID；本启动器没有那份数据表，
 * 因此只使用可公开推导的信息（Modrinth/CurseForge slug 与模组名），
 * 绝不编造条目 ID。
 */
export interface WikiLink{kind:'entry'|'search';url:string;label:string}

/** CamelCase → 空格分词，再以 + 连接；与 PCL2 的搜索词构造保持一致。 */
export function wikiSearchTerm(name:string):string{
 return name
  .replace(/[_\s]+/g,' ')
  .replace(/([a-z0-9])([A-Z])/g,'$1 $2')
  .replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2')
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .join('+')
}

export function wikiSearchUrl(name:string):string{
 return 'https://www.mcmod.cn/s?key='+encodeURIComponent(wikiSearchTerm(name)).replace(/%2B/g,'+')+'&site=all&filter=0'
}

/** A project with a numeric wiki id can link straight to its encyclopedia page. */
export function mcmodLink(input:{name:string;wikiId?:number|null}):WikiLink{
 const id=input.wikiId
 if(typeof id==='number'&&Number.isInteger(id)&&id>0)return {kind:'entry',url:'https://www.mcmod.cn/class/'+id+'.html',label:'MC 百科'}
 return {kind:'search',url:wikiSearchUrl(input.name),label:'在 MC 百科搜索'}
}
