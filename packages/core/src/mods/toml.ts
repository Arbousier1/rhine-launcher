/**
 * Tiny TOML reader for `mods.toml` / `neoforge.mods.toml`.
 *
 * The subset implemented here is exactly what Forge and NeoForge use for their
 * mod descriptors: comments, bare/quoted keys, dotted keys, tables, arrays of
 * tables, strings (literal, basic, multi-line), numbers, booleans and arrays.
 * Anything more exotic falls back to the raw string so parsing never throws.
 */

/** A parsed TOML value. */
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable

/** A parsed TOML table. */
export interface TomlTable { [key: string]: TomlValue }

/**
 * Parse a TOML document.
 *
 * Malformed documents do not throw: the parser keeps whatever it understood so
 * a broken `mods.toml` still yields a name instead of hiding the mod entirely.
 */
export function parseToml(text: string): TomlTable {
  const root: TomlTable = {}
  let current: TomlTable = root
  const lines = splitLines(text)

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
    const line = stripComment(raw).trim()
    if (!line) continue

    if (line.startsWith('[[') && line.endsWith(']]')) {
      const path = parseKeyPath(line.slice(2, -2))
      current = pushArrayTable(root, path)
      continue
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      const path = parseKeyPath(line.slice(1, -1))
      current = ensureTable(root, path)
      continue
    }

    const eq = findAssignment(line)
    if (eq < 0) continue
    const keyPath = parseKeyPath(line.slice(0, eq))
    let valueText = line.slice(eq + 1).trim()

    // Multi-line arrays and strings: keep consuming until brackets balance.
    while (!isCompleteValue(valueText) && index + 1 < lines.length) {
      index++
      valueText += '\n' + stripComment(lines[index])
    }
    assignValue(current, keyPath, parseValue(valueText))
  }

  return root
}

/** Read a nested value by dotted path. */
export function tomlGet(table: TomlTable, path: string): TomlValue | undefined {
  let cursor: TomlValue | undefined = table
  for (const part of path.split('.')) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined
    cursor = (cursor as TomlTable)[part.trim()]
  }
  return cursor
}

/** Coerce a TOML value to a string (arrays become comma separated). */
export function tomlString(value: TomlValue | undefined): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => tomlString(item) ?? '').filter(Boolean).join(', ')
  return undefined
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/** Remove a trailing `#` comment while respecting quoted strings. */
function stripComment(line: string): string {
  let quote: string | undefined
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quote) {
      if (char === '\\' && quote === '"') {
        index++
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') return line.slice(0, index)
  }
  return line
}

function findAssignment(line: string): number {
  let quote: string | undefined
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quote) {
      if (char === '\\' && quote === '"') {
        index++
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '=') return index
  }
  return -1
}

function isCompleteValue(text: string): boolean {
  let depth = 0
  let quote: string | undefined
  let triple = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote) {
      if (char === '\\' && quote === '"') {
        index++
        continue
      }
      if (triple && text.startsWith(quote.repeat(3), index)) {
        index += 2
        quote = undefined
        triple = false
        continue
      }
      if (!triple && char === quote) quote = undefined
      continue
    }
    if (text.startsWith('"""', index) || text.startsWith("'''", index)) {
      quote = text[index]
      triple = true
      index += 2
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '[' || char === '{') depth++
    if (char === ']' || char === '}') depth--
  }
  return depth <= 0 && !quote
}

/** Split a dotted key path, honouring quoted segments. */
export function parseKeyPath(text: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: string | undefined
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote) {
      if (char === quote) {
        quote = undefined
        continue
      }
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '.') {
      if (current.trim()) parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function ensureTable(root: TomlTable, path: string[]): TomlTable {
  let cursor = root
  for (const part of path) {
    const next = cursor[part]
    if (Array.isArray(next)) {
      const last = next[next.length - 1]
      if (last && typeof last === 'object') {
        cursor = last as TomlTable
        continue
      }
      const table: TomlTable = {}
      next.push(table)
      cursor = table
      continue
    }
    if (!next || typeof next !== 'object') cursor[part] = {}
    cursor = cursor[part] as TomlTable
  }
  return cursor
}

function pushArrayTable(root: TomlTable, path: string[]): TomlTable {
  if (path.length === 0) return root
  const parent = ensureTable(root, path.slice(0, -1))
  const key = path[path.length - 1]
  const array = parent[key]
  const table: TomlTable = {}
  if (Array.isArray(array)) array.push(table)
  else parent[key] = [table]
  return table
}

function assignValue(table: TomlTable, path: string[], value: TomlValue): void {
  if (path.length === 0) return
  let cursor = table
  for (const part of path.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {}
    cursor = cursor[part] as TomlTable
  }
  cursor[path[path.length - 1]] = value
}

/** Parse a TOML value literal. */
export function parseValue(text: string): TomlValue {
  const value = text.trim()
  if (!value) return ''
  if (value.startsWith('"""') && value.endsWith('"""') && value.length >= 6) {
    return unescapeBasic(value.slice(3, -3))
  }
  if (value.startsWith("'''") && value.endsWith("'''") && value.length >= 6) {
    return value.slice(3, -3)
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return unescapeBasic(value.slice(1, -1))
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1)
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitTopLevel(value.slice(1, -1), ',').map((item) => parseValue(item)).filter((item) => item !== '')
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const table: TomlTable = {}
    for (const pair of splitTopLevel(value.slice(1, -1), ',')) {
      const eq = findAssignment(pair)
      if (eq < 0) continue
      const key = parseKeyPath(pair.slice(0, eq))
      assignValue(table, key, parseValue(pair.slice(eq + 1)))
    }
    return table
  }
  if (value === 'true') return true
  if (value === 'false') return false
  const numeric = Number(value.replace(/_/g, ''))
  if (!Number.isNaN(numeric) && /^[-+0-9._eExXoObA-F]+$/.test(value)) return numeric
  return value
}

/** Split on a separator that is not inside a string, array or table. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let quote: string | undefined
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote) {
      current += char
      if (char === '\\' && quote === '"') {
        current += text[++index] ?? ''
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '[' || char === '{') depth++
    if (char === ']' || char === '}') depth--
    if (char === separator && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current)
  return parts
}

function unescapeBasic(text: string): string {
  return text.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (match, escape: string) => {
    if (escape.length === 5 && escape[0] === 'u') {
      return String.fromCharCode(parseInt(escape.slice(1), 16))
    }
    switch (escape) {
      case 'n': return '\n'
      case 't': return '\t'
      case 'r': return '\r'
      case '"': return '"'
      case '\\': return '\\'
      default: return escape
    }
  }).replace(/\n/g, '\n')
}
