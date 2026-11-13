export const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]!)
export function formatDate(value?:number){if(!value||!Number.isFinite(value))return '—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'})}
export function formatPlaytime(ms?:number){if(!ms||ms<60000)return '不到 1 分钟';const minutes=Math.floor(ms/60000);if(minutes<60)return minutes+' 分钟';const hours=Math.floor(minutes/60);return hours+' 小时 '+(minutes%60)+' 分'}
export function loaderLabel(loaders?:{kind:string;version?:string}[]){const active=(loaders??[]).filter(loader=>loader.kind&&loader.kind!=='vanilla');if(!active.length)return '原版';return active.map(loader=>loader.kind[0].toUpperCase()+loader.kind.slice(1)+(loader.version?' '+loader.version:'')).join(' · ')}
export const accountKindLabel=(kind:string)=>kind==='offline'?'离线':kind==='microsoft'?'Microsoft':'外置认证'
export function taskLabel(status:string){return ({queued:'排队中',running:'进行中',succeeded:'已完成',failed:'失败',cancelled:'已取消'} as Record<string,string>)[status]??status}
