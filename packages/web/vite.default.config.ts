import {defineConfig} from 'vite'
import {fileURLToPath} from 'node:url'
const r=(p:string)=>fileURLToPath(new URL(p,import.meta.url))
/** Plain DOM launcher surfaces (console/default-ui). Built beside the shell, not default. */
export default defineConfig({
 root:r('./'),base:'/',
 resolve:{alias:{'@rhine/core':r('../core/src/index.ts'),'@':r('./src')}},
 build:{outDir:'dist',emptyOutDir:false,sourcemap:true,rollupOptions:{input:{legacy:r('./index.html')}}},
})
