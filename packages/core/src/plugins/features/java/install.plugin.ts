import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { JavaService } from '../../../services/java.ts'

/** Single public operation: java.install. */
export default defineFeature<any,any>({
  id:"java.install",capability:"java.install",title:"java.install",
  depends:["paths.get","storage.read.sync","storage.write","download.text","download.batch"],
  http:{method:'POST',path:'/api/java/install',decode:json,status:200,background:{kind:"下载 Java 运行时",title:"下载 Java 运行时"}},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.java',ctx=>new JavaService(ctx)).install(string(input.component),taskContext(env))}
})
