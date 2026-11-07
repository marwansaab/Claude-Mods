// Reads a JavaScript object literal (a prototype register, a Kit.journey call) as data, without running it.
// It takes what those files are written in: objects with bare or quoted keys, arrays, strings in ' " or `
// (a template with ${…} is refused), numbers, true, false, null, undefined, comments and trailing commas.
// Anything else (a call, a variable, an operator) throws, saying where.

export type Literal = string | number | boolean | null | undefined | Literal[] | { [key: string]: Literal }

export class LiteralError extends Error {}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' }
const IDENT = /[A-Za-z0-9_$]/

/** Parses the literal that starts at `from` (skipping space and comments first); returns it and where it ended. */
export function parseLiteral(src: string, from = 0): { value: Literal; end: number } {
  let i = from

  const fail = (what: string): never => {
    const line = src.slice(0, i).split('\n').length
    throw new LiteralError(`${what} at line ${line}`)
  }

  const skip = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i]!)) i++
      if (src.startsWith('//', i)) {
        const nl = src.indexOf('\n', i)
        i = nl < 0 ? src.length : nl + 1
      } else if (src.startsWith('/*', i)) {
        const close = src.indexOf('*/', i + 2)
        if (close < 0) fail('an unclosed comment')
        i = close + 2
      } else return
    }
  }

  const string = (): string => {
    const quote = src[i]!
    i++
    let out = ''
    while (i < src.length && src[i] !== quote) {
      const ch = src[i]!
      if (quote === '`' && ch === '$' && src[i + 1] === '{') fail('a template with ${…}')
      if (ch === '\n' && quote !== '`') fail('a line break inside a string')
      if (ch !== '\\') {
        out += ch
        i++
        continue
      }
      const next = src[i + 1] ?? ''
      if (next === 'u') {
        const braced = src[i + 2] === '{'
        const hex = braced ? src.slice(i + 3, src.indexOf('}', i)) : src.slice(i + 2, i + 6)
        if (!/^[0-9a-fA-F]+$/.test(hex)) fail('a bad \\u escape')
        out += String.fromCodePoint(parseInt(hex, 16))
        i += braced ? hex.length + 4 : 6
      } else if (next === 'x') {
        out += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16))
        i += 4
      } else if (next === '\n') {
        i += 2 // a line continuation
      } else if (next === '\r' && src[i + 2] === '\n') {
        i += 3
      } else {
        out += ESCAPES[next] ?? next
        i += 2
      }
    }
    if (src[i] !== quote) fail('an unclosed string')
    i++
    return out
  }

  const word = (): string => {
    const start = i
    while (i < src.length && IDENT.test(src[i]!)) i++
    return src.slice(start, i)
  }

  const value = (): Literal => {
    skip()
    const ch = src[i]
    if (ch === undefined) return fail('the end of the text')
    if (ch === '{') {
      i++
      const obj: { [key: string]: Literal } = {}
      for (;;) {
        skip()
        if (src[i] === '}') {
          i++
          return obj
        }
        const c = src[i]!
        const key = c === "'" || c === '"' || c === '`' ? string() : word()
        if (!key) fail(`an unexpected "${c}"`)
        skip()
        if (src[i] !== ':') fail(`a missing ":" after "${key}"`)
        i++
        obj[key] = value()
        skip()
        if (src[i] === ',') i++
        else if (src[i] !== '}') fail(`a missing "," after "${key}"`)
      }
    }
    if (ch === '[') {
      i++
      const arr: Literal[] = []
      for (;;) {
        skip()
        if (src[i] === ']') {
          i++
          return arr
        }
        arr.push(value())
        skip()
        if (src[i] === ',') i++
        else if (src[i] !== ']') fail('a missing "," in a list')
      }
    }
    if (ch === "'" || ch === '"' || ch === '`') return string()
    if (/[-+.\d]/.test(ch)) {
      const m = /^[-+]?(\d[\d_]*\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i))
      if (!m) return fail(`an unexpected "${ch}"`)
      i += m[0].length
      return Number(m[0].replace(/_/g, ''))
    }
    const w = word()
    if (w === 'true') return true
    if (w === 'false') return false
    if (w === 'null') return null
    if (w === 'undefined') return undefined
    return fail(w ? `code ("${w}") where a value belongs` : `an unexpected "${ch}"`)
  }

  const v = value()
  return { value: v, end: i }
}
