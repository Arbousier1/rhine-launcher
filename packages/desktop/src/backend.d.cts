export interface BackendOptions { repository: string; dataDirectory: string; port: number; executable: string; timeoutMs?: number }
export interface BackendHandle { origin: string; owned: boolean; pid: number; stop(): Promise<void> }
export function ensureBackend(options: BackendOptions): Promise<BackendHandle>
export function sameDirectory(left: string, right: string): boolean
