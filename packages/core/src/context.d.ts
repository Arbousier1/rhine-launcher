/**
 * Ambient Cordis context augmentation.
 *
 * Gives every plugin a typed `ctx.<service>` without importing implementation
 * modules, mirroring how DeepSeek-Harness augments its own context.
 */
import type { RhServices } from './contracts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context extends RhServices {}
}
