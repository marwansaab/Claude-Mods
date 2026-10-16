// The Reviews/ folder's layout: pending/<id>/ and reviewed/<id>/, each holding pack.json, draft.json
// and, once submitted, outcome.md and outcome.json. The file system calls live in register.tsx.

export const FILES = { pack: 'pack.json', draft: 'draft.json', outcome: 'outcome.md', outcomeJson: 'outcome.json' }

export const README = `# Reviews

Review packs for the owner, written by Claude through the review-desk mod and answered in its panel (\`/review\`).

- \`pending/<id>/pack.json\`: what is up for review; \`draft.json\`: the owner's answers so far.
- \`reviewed/<id>/\`: the same, plus \`outcome.md\` and \`outcome.json\` once submitted.

These files mirror the project's records (files, notes, documents); they are never the record. Claude applies an outcome in the record's own home.
`

export const sepOf = (root: string) => (root.includes('\\') && !root.includes('/') ? '\\' : '/')
export const join = (root: string, ...parts: string[]) => [root.replace(/[\\/]+$/, ''), ...parts].join(sepOf(root))
export const isWindowsPath = (path: string) => sepOf(path) === '\\' || /^[A-Za-z]:/.test(path)

/** The command that moves a folder, by the platform the path belongs to (no shell). */
export const moveArgv = (from: string, to: string): string[] =>
  isWindowsPath(from) ? ['cmd', '/d', '/c', 'move', '/y', from, to] : ['mv', from, to]

/** `submittedAt` from an outcome.json, if it parses. */
export function submittedAtOf(text: string | undefined): string | undefined {
  if (!text) return undefined
  try {
    const at = JSON.parse(text).submittedAt
    return typeof at === 'string' ? at : undefined
  } catch {
    return undefined
  }
}
