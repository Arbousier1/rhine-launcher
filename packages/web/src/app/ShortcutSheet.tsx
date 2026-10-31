/**
 * Keyboard shortcut reference, opened with "?" or from the nav footer.
 */
import { Dialog, KeyCap } from '@/ui'
import type { Translator } from '@/app/i18n'

export interface ShortcutSheetProps {
  open: boolean
  onClose: () => void
  t: Translator
}

const ROWS: { keys: string[]; descKey: string }[] = [
  { keys: ['↑', '↓', '←', '→'], descKey: 'shortcut.nav' },
  { keys: ['Enter'], descKey: 'shortcut.open' },
  { keys: ['N'], descKey: 'shortcut.new' },
  { keys: ['/'], descKey: 'shortcut.search' },
  { keys: ['Esc'], descKey: 'shortcut.escape' },
  { keys: ['?'], descKey: 'shortcut.help' },
]

export function ShortcutSheet({ open, onClose, t }: ShortcutSheetProps) {
  return (
    <Dialog open={open} onClose={onClose} caption={t('shortcut.caption')} title={t('shortcut.title')} width={420}>
      <div className="rh-shortcuts">
        {ROWS.map((row) => (
          <ShortcutRow key={row.descKey} keys={row.keys} desc={t(row.descKey)} />
        ))}
      </div>
    </Dialog>
  )
}

function ShortcutRow({ keys, desc }: { keys: string[]; desc: string }) {
  return (
    <>
      <span className="rh-shortcuts__keys">
        {keys.map((key) => (
          <KeyCap key={key}>{key}</KeyCap>
        ))}
      </span>
      <span className="rh-shortcuts__desc">{desc}</span>
    </>
  )
}
