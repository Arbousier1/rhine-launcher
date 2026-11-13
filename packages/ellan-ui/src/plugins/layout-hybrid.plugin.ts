import { defineFeature } from '@rhine/plugin-api'
import css from '../styles/layout-hybrid.css?inline'
export default defineFeature({
 id:'ui.layout.hybrid',capability:'ui.layout.hybrid',title:'启动与实例布局',
 execute:()=>({layout:'hybrid',source:'PCL2/HMCL/Rhine'}),
 setup(env){
  const root=document.documentElement, previous=root.getAttribute('data-rhine-layout'), style=document.createElement('style')
  style.dataset.rhinePlugin='ui.layout.hybrid';style.textContent=css;document.head.append(style);root.setAttribute('data-rhine-layout','hybrid')
  env.onDispose(()=>{style.remove();if(root.getAttribute('data-rhine-layout')==='hybrid'){if(previous===null)root.removeAttribute('data-rhine-layout');else root.setAttribute('data-rhine-layout',previous)}})
 }
})
