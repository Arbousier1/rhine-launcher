import type {TaskSnapshot} from '@rhine/core'
/** Stable task rows: progress never destroys a focused cancel control. */
export class NativeTaskList{
 private rows=new Map<string,{root:HTMLElement;title:HTMLElement;detail:HTMLElement;cancel:HTMLButtonElement}>();private order=''
 constructor(private root:HTMLElement,private cancelOperation='cancel-known'){}
 update(tasks:readonly TaskSnapshot[]){
  const ids=new Set(tasks.map(task=>task.id));for(const [id,row]of this.rows)if(!ids.has(id)){row.root.remove();this.rows.delete(id)}
  for(const task of tasks){let row=this.rows.get(task.id);if(!row){const item=document.createElement('div'),text=document.createElement('span'),title=document.createElement('b'),detail=document.createElement('small'),cancel=document.createElement('button');item.className='native-list-row';cancel.className='inline-button';cancel.type='button';cancel.dataset.op=this.cancelOperation;cancel.dataset.id=task.id;cancel.textContent='取消';text.append(title,detail);item.append(text,cancel);row={root:item,title,detail,cancel};this.rows.set(task.id,row)}
   if(row.title.textContent!==task.title)row.title.textContent=task.title
   const label=({queued:'排队中',running:'进行中',succeeded:'完成',failed:'失败',cancelled:'已取消'} as Record<string,string>)[task.status]??task.status;const message=label+(task.progress?.message?' · '+task.progress.message:'')+(task.error?' · '+task.error:'');if(row.detail.textContent!==message)row.detail.textContent=message
   row.cancel.hidden=!['queued','running'].includes(task.status)
  }
  const order=tasks.map(task=>task.id).join('\n');if(order!==this.order||!this.root.firstChild){this.order=order;if(tasks.length)this.root.replaceChildren(...tasks.map(task=>this.rows.get(task.id)!.root));else{const empty=document.createElement('p');empty.textContent='没有后台任务。';this.root.replaceChildren(empty)}}
 }
}
