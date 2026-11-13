import { AccountError, type AuthenticationDiagnostic } from './errors.ts'

/** Inspect provider errors for classification only; never return echoed text. */
function errorFields(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  const input = body as Record<string, unknown>
  return ['error', 'errorType', 'errorCode', 'errorMessage', 'developerMessage', 'message']
    .flatMap(key => typeof input[key] === 'string' ? [(input[key] as string).slice(0, 4096)] : [])
}

/** Only known public provider codes may appear in diagnostics. */
function providerCode(body: unknown): AuthenticationDiagnostic['providerCode'] {
  const known: NonNullable<AuthenticationDiagnostic['providerCode']>[] = [
    'ForbiddenOperationException', 'UnauthorizedOperationException', 'INVALID_APP_REGISTRATION', 'TooManyRequestsException',
  ]
  const fields = errorFields(body)
  return known.find(code => fields.includes(code))
}

/** The token exchange does not check ownership: a failure here is NOT proof of an unpurchased game. */
export function minecraftLoginError(status: number, body: unknown): AccountError {
  const fields = errorFields(body)
  const rejectedRegistration = fields.some(value =>
    /invalid\s+app(?:lication)?\s+registration|INVALID_APP_REGISTRATION|app(?:lication)?\s+(?:is\s+)?not\s+(?:approved|authorized|registered)/i.test(value),
  )
  const diagnostic: AuthenticationDiagnostic = { stage: 'minecraft-login', upstreamStatus: status }
  const code = providerCode(body)
  if (code) diagnostic.providerCode = code
  const failure = (message: string, reason: string, httpStatus = status >= 400 && status < 500 ? status : 502) =>
    new AccountError(message + '（Minecraft 令牌兑换，HTTP ' + status + '）', reason, { status: httpStatus, diagnostic })

  if (rejectedRegistration && (status === 400 || status === 403)) {
    return failure('启动器的 OAuth 应用注册被 Minecraft 服务拒绝。这与是否已购买游戏无关；需要发布方完成 Minecraft API 接入审核，或配置你获准使用且已通过审核的应用 ID。', 'MINECRAFT_APP_NOT_APPROVED')
  }
  if (status === 403) {
    return failure('Minecraft 服务拒绝了启动器的登录请求，尚未检查游戏购买状态。请检查应用接入权限或网络代理；不能据此认定账号未购买。', 'MINECRAFT_ACCESS_DENIED')
  }
  if (status === 401) {
    return failure('Minecraft 服务未接受本次 Xbox 授权，请重新在微软页面登录授权。这不是对游戏购买状态的判断。', 'MINECRAFT_IDENTITY_REJECTED')
  }
  if (status === 429) {
    return failure('Minecraft 登录请求过于频繁，请稍后重试。', 'MINECRAFT_RATE_LIMITED')
  }
  if (status >= 200 && status < 300) {
    return failure('Minecraft 服务未返回有效访问令牌，不能创建已登录账号，请稍后重试。', 'MINECRAFT_INVALID_TOKEN_RESPONSE')
  }
  return failure('Minecraft 令牌兑换失败，请重新授权或稍后重试。此阶段尚未检查购买状态。', 'MINECRAFT_LOGIN_FAILED')
}
