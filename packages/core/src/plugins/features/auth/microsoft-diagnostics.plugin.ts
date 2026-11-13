import { defineFeature } from '@rhine/plugin-api'
import { microsoftFailureDiagnostic } from '../../../accounts/auth-diagnostics.ts'

/** A single read-only diagnostic capability; independent of starting or saving a login. */
export default defineFeature<undefined, ReturnType<typeof microsoftFailureDiagnostic>>({
  id: 'auth.microsoft.diagnostics', capability: 'auth.microsoft.diagnostics', title: '读取微软登录失败诊断',
  http: { method: 'GET', path: '/api/accounts/microsoft/diagnostics', decode: () => undefined },
  execute(_input, env) { return microsoftFailureDiagnostic(env) },
})
