// The desk's folder: pending/<id>/ and reviewed/<id>/ for walks (walk.json, draft.json, outcome.md,
// outcome.json), and notes/<initiative>.json for the owner's own notes while walking a journey.
// Adapted from review-desk's disk.ts. The file system calls live in register.tsx.

export const FILES = { walk: 'walk.json', draft: 'draft.json', outcome: 'outcome.md', outcomeJson: 'outcome.json' }

export const README = `# Discovery desk

Walks and notes for the owner, written by the discovery-desk mod and answered in its panel (\`/discovery\`).

- \`pending/<id>/walk.json\`: the questions and decisions Claude put up; \`draft.json\`: the owner's answers so far.
- \`reviewed/<id>/\`: the same, plus \`outcome.md\` and \`outcome.json\` once submitted.
- \`notes/<initiative>.json\`: the owner's step notes, walked ticks and questions raised while walking.

These files mirror the project's record (the vault, the catalogue, the ADRs); they are never the record.
Claude applies an outcome in the record first, then mirrors it into the prototype.
`

export const sepOf = (root: string) => (root.includes('\\') && !root.includes('/') ? '\\' : '/')
export const join = (root: string, ...parts: string[]) => [root.replace(/[\\/]+$/, ''), ...parts.map(p => p.replace(/^[\\/]+|[\\/]+$/g, ''))].filter(Boolean).join(sepOf(root))
export const isWindowsPath = (path: string) => sepOf(path) === '\\' || /^[A-Za-z]:/.test(path)
/** A path made relative to the root, with forward slashes. */
export const relTo = (root: string, path: string) => {
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const p = path.replace(/\\/g, '/')
  return p.toLowerCase().startsWith(r.toLowerCase() + '/') ? p.slice(r.length + 1) : p
}

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

/** A file-safe name for an initiative's notes. */
export const notesName = (id: string) => `${id.replace(/[^\w.-]+/g, '-') || 'initiative'}.json`
