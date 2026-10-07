import type { Guide, Hunk, Step } from '../types'

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const PER_HUNK_CHARS = 6000
const PROMPT_BUDGET_CHARS = 250000

export function parseDiff(text: string): Hunk[] {
  const hunks: Hunk[] = []
  const lines = text.split('\n')
  let path = ''
  let note = ''
  let fileHunks = 0
  let current: Hunk | null = null
  let oldLeft = 0
  let newLeft = 0

  const closeFile = () => {
    if (path && fileHunks === 0) {
      hunks.push({ id: `H${hunks.length + 1}`, path, source: '', note: note || 'No content changes', added: 0, removed: 0 })
    }
  }

  for (const line of lines) {
    if (current && (oldLeft > 0 || newLeft > 0)) {
      const mark = line[0]
      if (mark === '+') {
        current.added += 1
        newLeft -= 1
      } else if (mark === '-') {
        current.removed += 1
        oldLeft -= 1
      } else if (mark === ' ' || line === '') {
        oldLeft -= 1
        newLeft -= 1
      } else if (mark !== '\\') {
        current = null
      }
      if (current) {
        current.source += `\n${line}`
        continue
      }
    }
    if (current && line.startsWith('\\')) {
      current.source += `\n${line}`
      continue
    }

    if (line.startsWith('diff --git ')) {
      closeFile()
      current = null
      fileHunks = 0
      note = ''
      const match = / b\/(.*)$/.exec(line)
      path = match?.[1] ?? line.slice('diff --git '.length)
    } else if (line.startsWith('+++ b/')) {
      path = line.slice('+++ b/'.length)
    } else if (line.startsWith('rename from ')) {
      note = `Renamed from ${line.slice('rename from '.length)}`
    } else if (line.startsWith('new file mode')) {
      note = 'New empty file'
    } else if (line.startsWith('deleted file mode')) {
      note = 'File deleted'
    } else if (line.startsWith('Binary files')) {
      note = 'Binary file changed'
    } else {
      const header = HUNK_HEADER.exec(line)
      if (header && path) {
        oldLeft = header[2] === undefined ? 1 : Number(header[2])
        newLeft = header[4] === undefined ? 1 : Number(header[4])
        current = { id: `H${hunks.length + 1}`, path, source: line, added: 0, removed: 0 }
        hunks.push(current)
        fileHunks += 1
      }
    }
  }
  closeFile()

  return hunks
}

export function buildPrompt(hunks: Hunk[], source: string, background: string): string {
  let budget = PROMPT_BUDGET_CHARS
  const blocks = hunks.map(hunk => {
    const head = `### ${hunk.id} ${hunk.path} (+${hunk.added} -${hunk.removed})`
    if (hunk.note) return `${head}\n${hunk.note}`
    const body = hunk.source.length > PER_HUNK_CHARS ? `${hunk.source.slice(0, PER_HUNK_CHARS)}\n[... hunk cut]` : hunk.source
    if (body.length > budget) return `${head}\n[body omitted for length]`
    budget -= body.length

    return `${head}\n${body}`
  })

  return [
    `Change under review: ${source}`,
    background ? `Background from the author (MR description and commit messages):\n${background}` : '',
    `The diff, split into hunks with ids:\n\n${blocks.join('\n\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export const SYSTEM = `You write guided code reviews. A reviewer will read the change one step at a time, so turn the hunks into the story of the change.

Group the hunks into 2 to 8 ordered steps, in the order a reviewer should read them: foundations first (schemas, models, types, config), then the core logic, then its callers (routes, UI, jobs), then tests and docs. A test belongs to the step it tests unless the tests are large enough to be a step of their own. Every hunk id must appear in exactly one step.

For each step give:
- "title": at most 8 words, saying what the step does.
- "summary": 1 to 3 plain sentences on what changes and why.
- "watch": one sentence on what the reviewer should check carefully in this step, or "" if nothing stands out.
- "hunks": the hunk ids, in reading order.

Also give the guide a "title" (at most 10 words) and a "context": one sentence on what the whole change does and why.

Also give a "diagram": a Mermaid flowchart (starting "flowchart LR") of the main parts the change touches (modules, classes, functions, endpoints; at most 12 nodes) and how they call or feed each other. Label each node with a short name, and label edges or nodes with the step numbers that change them, like "(2)". Use plain alphanumeric node ids and put labels in double quotes.

Reply with JSON only, no prose and no code fence:
{"title": "...", "context": "...", "diagram": "flowchart LR\\n ...", "steps": [{"title": "...", "summary": "...", "watch": "...", "hunks": ["H1"]}]}`

type RawStep = { title?: unknown; summary?: unknown; watch?: unknown; hunks?: unknown }

export function assembleGuide(reply: string, hunks: Hunk[], source: string): Guide {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model did not reply with JSON.')
  const raw = JSON.parse(reply.slice(start, end + 1)) as { title?: unknown; context?: unknown; diagram?: unknown; steps?: unknown }

  const known = new Set(hunks.map(hunk => hunk.id))
  const placed = new Set<string>()
  const steps: Step[] = []
  for (const item of Array.isArray(raw.steps) ? (raw.steps as RawStep[]) : []) {
    const ids = (Array.isArray(item.hunks) ? item.hunks : [])
      .map(String)
      .filter(id => known.has(id) && !placed.has(id))
    ids.forEach(id => placed.add(id))
    if (ids.length === 0) continue
    steps.push({
      title: String(item.title ?? 'Untitled step'),
      summary: String(item.summary ?? ''),
      watch: String(item.watch ?? ''),
      hunkIds: ids,
    })
  }

  const leftover = hunks.filter(hunk => !placed.has(hunk.id)).map(hunk => hunk.id)
  if (leftover.length > 0) {
    steps.push({ title: 'Other changes', summary: 'Hunks the guide did not place in a step.', watch: '', hunkIds: leftover })
  }

  return {
    title: String(raw.title ?? 'Guided review'),
    context: String(raw.context ?? ''),
    source,
    diagram: /^\s*(flowchart|graph)\b/.test(String(raw.diagram ?? '')) ? String(raw.diagram).trim() : '',
    steps,
    hunks,
  }
}

export function splitHunk(source: string): { before: string; after: string; beforeStart: number; afterStart: number } {
  const [header, ...lines] = source.split('\n')
  const match = HUNK_HEADER.exec(header ?? '')
  const before: string[] = []
  const after: string[] = []
  for (const line of lines) {
    if (line.startsWith('\\')) continue
    const text = line.slice(1)
    if (line[0] !== '+') before.push(text)
    if (line[0] !== '-') after.push(text)
  }

  return {
    before: before.join('\n'),
    after: after.join('\n'),
    beforeStart: Math.max(1, Number(match?.[1] ?? 1)),
    afterStart: Math.max(1, Number(match?.[3] ?? 1)),
  }
}

// Keeps the first `maxLines` lines of a hunk and rewrites its header counts so it still parses as a diff.
export function truncateHunk(source: string, maxLines: number): { source: string; hidden: number } {
  const [header = '', ...lines] = source.split('\n')
  if (lines.length <= maxLines) return { source, hidden: 0 }
  const match = HUNK_HEADER.exec(header)
  if (!match) return { source, hidden: 0 }

  const kept = lines.slice(0, maxLines)
  const oldCount = kept.filter(line => line[0] !== '+' && line[0] !== '\\').length
  const newCount = kept.filter(line => line[0] !== '-' && line[0] !== '\\').length
  const rest = header.slice(match[0].length)

  return {
    source: [`@@ -${match[1]},${oldCount} +${match[3]},${newCount} @@${rest}`, ...kept].join('\n'),
    hidden: lines.length - maxLines,
  }
}

export function sizeBar(size: number, max: number, width = 8): string {
  const filled = max <= 0 ? 0 : Math.max(size > 0 ? 1 : 0, Math.round((size / max) * width))

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
