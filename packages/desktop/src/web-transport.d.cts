export const APP_ORIGIN: string
export const SCHEME: string
interface Frame { url: string }
interface Contents { mainFrame: Frame }
interface Owner { webContents: Contents; isDestroyed(): boolean }
export interface HeaderRequest { url: string; webContentsId?: number; requestHeaders: Record<string, string> }
export interface HeaderResult { cancel?: boolean; requestHeaders?: Record<string, string> }
export function isApplicationUrl(value: string): boolean
export function assertMainApplication(event: { sender: Contents; senderFrame?: Frame | null }, window: Owner | undefined): void
export function forwardWebRequest(request: Request, host: string, fetcher?: typeof fetch): Promise<Response>
export function websocketRequestHeaders(details: HeaderRequest, host: string | undefined, ownerId: number | undefined): HeaderResult
