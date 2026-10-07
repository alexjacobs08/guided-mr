import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BuildStatus, Guide, Hunk } from '../types'
import { assembleGuide, buildPrompt, parseDiff, parseTarget, sizeBar, splitHunk, SYSTEM, truncateHunk } from './guide'
import { renderHtml } from './html'

const PANE = 'guided-mr'
const MODEL = 'opus'
const SPLIT_MIN_COLUMNS = 110
const COLLAPSED_LINES = 25
const USAGE = [
  ['/guided-mr', "this branch against the repo's default branch"],
  ['/guided-mr 123', 'PR or MR 123 on the GitHub or GitLab repo origin points at'],
  ['/guided-mr #123', 'GitHub PR 123'],
  ['/guided-mr !123', 'GitLab MR 123'],
  ['/guided-mr <url>', 'a GitHub PR or GitLab MR link'],
  ['/guided-mr some-ref', 'this branch against that ref'],
] as const

const guideAtom = atom({ plugin: 'guided-mr', key: 'guide' } as const, null)
const viewAtom = atom({ plugin: 'guided-mr', key: 'view' } as const, -1)
const statusAtom = atom({ plugin: 'guided-mr', key: 'status' } as const, { kind: 'idle', message: '' })
const splitAtom = atom({ plugin: 'guided-mr', key: 'isSplit' } as const, false)
const argsAtom = atom({ plugin: 'guided-mr', key: 'lastArgs' } as const, '')
const reviewedAtom = atom({ plugin: 'guided-mr', key: 'reviewed' } as const, [])
const visitedAtom = atom({ plugin: 'guided-mr', key: 'visited' } as const, [])
const expandedAtom = atom({ plugin: 'guided-mr', key: 'expanded' } as const, [])

type Collected = { diff: string; source: string; background: string }

const INSTALL_HINTS: Record<string, string> = {
  gh: 'Install the GitHub CLI (https://cli.github.com) and run `gh auth login`.',
  glab: 'Install the GitLab CLI (https://gitlab.com/gitlab-org/cli) and run `glab auth login`.',
}

async function run($: EngineInterface, argv: string[], timeoutMs = 60000): Promise<string> {
  let result
  try {
    result = await $.process.run(argv, { timeoutMs })
  } catch (error) {
    const hint = INSTALL_HINTS[argv[0] ?? '']
    throw new Error(`${argv[0]} could not run.${hint ? ` ${hint}` : ''} (${error instanceof Error ? error.message : String(error)})`)
  }
  if (result.exitCode !== 0) {
    throw new Error(`${argv.slice(0, 3).join(' ')} failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`)
  }

  return result.stdout
}

async function tryRun($: EngineInterface, argv: string[]): Promise<string | null> {
  try {
    return (await run($, argv)).trim()
  } catch {
    return null
  }
}

async function defaultBase($: EngineInterface): Promise<string> {
  const head = await tryRun($, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (head) return head
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    if ((await tryRun($, ['git', 'rev-parse', '--verify', '--quiet', ref])) !== null) return ref
  }

  return 'main'
}

async function collect($: EngineInterface, args: string): Promise<Collected> {
  const target = parseTarget(args, (await tryRun($, ['git', 'remote', 'get-url', 'origin'])) ?? '')

  if (target.kind === 'github') {
    const view = JSON.parse(
      await run($, ['gh', 'pr', 'view', target.ref, '--json', 'number,title,body,headRefName,baseRefName']),
    ) as { number?: number; title?: string; body?: string; headRefName?: string; baseRefName?: string }
    const diff = await run($, ['gh', 'pr', 'diff', target.ref, '--color=never'], 120000)

    return {
      diff,
      source: `#${view.number ?? target.ref} ${view.title ?? ''} (${view.headRefName ?? '?'} into ${view.baseRefName ?? '?'})`,
      background: view.body ?? '',
    }
  }

  if (target.kind === 'gitlab') {
    const repo = target.repo ? ['-R', target.repo] : []
    const view = JSON.parse(await run($, ['glab', 'mr', 'view', target.ref, ...repo, '-F', 'json'])) as {
      title?: string
      description?: string
      source_branch?: string
      target_branch?: string
    }
    const diff = await run($, ['glab', 'mr', 'diff', target.ref, ...repo, '--raw', '--color=never'], 120000)

    return {
      diff,
      source: `!${target.ref} ${view.title ?? ''} (${view.source_branch ?? '?'} into ${view.target_branch ?? '?'})`,
      background: view.description ?? '',
    }
  }

  const base = target.base || (await defaultBase($))
  const branch = (await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const diff = await run($, ['git', 'diff', '--no-color', '--no-ext-diff', '-U3', `${base}...HEAD`], 120000)
  const log = await run($, ['git', 'log', '--no-merges', '--format=- %s%n%b', `${base}..HEAD`])

  return { diff, source: `${branch} compared with ${base}`, background: log.trim() }
}

async function setStatus($: EngineInterface, status: BuildStatus) {
  await update($, statusAtom, () => status)
}

async function build($: EngineInterface, args: string) {
  await update($, argsAtom, () => args)
  try {
    await setStatus($, { kind: 'loading', message: 'Reading the diff...' })
    const { diff, source, background } = await collect($, args)
    const hunks = parseDiff(diff)
    if (hunks.length === 0) throw new Error(`No changes found for ${source}.`)

    await setStatus($, { kind: 'loading', message: `Grouping ${hunks.length} hunks into steps...` })
    const result = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: buildPrompt(hunks, source, background),
      maxTokens: 8000,
      timeoutMs: 300000,
    })
    if (!result.isAnswered) throw new Error(`The model call failed: ${result.reason}`)

    const guide = assembleGuide(result.text, hunks, source)
    await update($, guideAtom, () => guide)
    await update($, viewAtom, () => -1)
    await update($, reviewedAtom, () => [])
    await update($, visitedAtom, () => [])
    await update($, expandedAtom, () => [])
    await setStatus($, { kind: 'idle', message: '' })
    $.ui.toast(`Guided MR ready: ${guide.steps.length} steps`)
  } catch (error) {
    await setStatus($, { kind: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

async function openInBrowser($: EngineInterface, guide: Guide): Promise<string> {
  const slug = guide.source.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'guide'
  const path = `/tmp/guided-mr/${slug}.html`
  await run($, ['mkdir', '-p', '/tmp/guided-mr'])
  await $.fs.write(path, renderHtml(guide))
  await run($, ['open', path])

  return path
}

function registerCommand($: EngineInterface) {
  return $.command.register({
    name: 'guided-mr',
    description: 'Guided review: a GitHub PR, GitLab MR or branch diff as ordered steps in a pane',
    argumentHint: '[PR/MR number or URL | base ref | show | web]',
  })
}

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter(one => one !== item) : [...list, item]
}

// A module variable, not $.state, so a build cut off by a reload never blocks the next one.
let isBuilding = false

async function rebuild($: EngineInterface, args: string) {
  if (isBuilding) return
  isBuilding = true
  try {
    await build($, args)
  } finally {
    isBuilding = false
  }
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await registerCommand($)

    return next(e)
  })

  on('command.run', { command: 'guided-mr' }, async ($, e) => {
    const args = e.args.trim()
    await $.ui.open({ id: PANE, title: 'Guided MR', focus: true })
    if (args === 'show') return { text: 'Guided MR pane opened.' }
    if (args === 'web') {
      const guide = await read($, guideAtom)
      if (!guide) return { text: 'No guide yet. Run /guided-mr first.' }

      return { text: `Opened ${await openInBrowser($, guide)} in your browser.` }
    }
    if (isBuilding) return { text: 'A guide is already being built.' }

    await rebuild($, args)
    const status = await read($, statusAtom)
    if (status.kind === 'error') return { text: `Guided MR failed: ${status.message}` }
    const guide = await read($, guideAtom)

    return { text: `Guided MR ready: ${guide?.steps.length ?? 0} steps. Press n in the pane to start.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code, Markdown } = $.ui.resolve(e)
    const guide: Guide | null = await read($, guideAtom)
    const status = await read($, statusAtom)
    const view = await read($, viewAtom)
    const isSplit = await read($, splitAtom)
    const reviewed = await read($, reviewedAtom)
    const visited = await read($, visitedAtom)
    const expanded = await read($, expandedAtom)
    const lastArgs = await read($, argsAtom)
    const columns = e.props.bodyColumns

    const statusRow =
      status.kind === 'loading' ? (
        <Text color="warning">◌ {status.message}</Text>
      ) : status.kind === 'error' ? (
        <Text color="error">✗ {status.message}</Text>
      ) : null

    if (!guide) {
      return (
        <Box flexDirection="column" gap={1}>
          {statusRow}
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
            <Text bold color="claude">
              Guided MR
            </Text>
            <Text dimColor>A guided, step-by-step walk through a change.</Text>
            <Text> </Text>
            {USAGE.map(([command, what]) => (
              <Text>
                <Text color="suggestion">{command.padEnd(21)}</Text>
                <Text dimColor>{what}</Text>
              </Text>
            ))}
          </Box>
        </Box>
      )
    }

    const steps = guide.steps
    const current = Math.min(view, steps.length - 1)
    const byId = new Map(guide.hunks.map(hunk => [hunk.id, hunk] as const))
    const hunksOf = (index: number) =>
      (steps[index]?.hunkIds ?? []).map(id => byId.get(id)).filter((hunk): hunk is Hunk => hunk !== undefined)
    const sizeOf = (hunks: Hunk[]) => hunks.reduce((sum, hunk) => sum + hunk.added + hunk.removed, 0)
    const maxStepSize = Math.max(1, ...steps.map((_, index) => sizeOf(hunksOf(index))))
    const maxHunkSize = Math.max(1, ...guide.hunks.map(hunk => hunk.added + hunk.removed))

    const go = async (index: number) => {
      await update($, viewAtom, () => index)
      if (index >= 0) await update($, visitedAtom, list => (list.includes(index) ? list : [...list, index]))
    }

    const counts = (added: number, removed: number) => (
      <Text>
        <Text color="success">+{added}</Text> <Text color="error">−{removed}</Text>
      </Text>
    )

    const tracker = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text>
          {steps.map((_, index) => {
            const glyph = index === current ? '◉' : reviewed.includes(index) ? '✓' : visited.includes(index) ? '●' : '○'
            const color = index === current ? 'claude' : reviewed.includes(index) ? 'success' : visited.includes(index) ? 'text' : 'inactive'

            return (
              <Text color={color} bold={index === current}>
                {glyph}{' '}
              </Text>
            )
          })}
        </Text>
        <Text dimColor>{current < 0 ? 'Overview' : `Step ${current + 1} of ${steps.length}`}</Text>
        <Text dimColor>·</Text>
        <Text color={reviewed.length === steps.length ? 'success' : 'subtle'}>
          {reviewed.length} of {steps.length} reviewed
        </Text>
      </Box>
    )

    const key = (hotkey: string, label: string, onPress: () => unknown) => (
      <Button key={`key-${hotkey}`} plain dimColor hotkey={hotkey} label={label} onPress={onPress} />
    )

    if (current < 0) {
      const added = guide.hunks.reduce((sum, hunk) => sum + hunk.added, 0)
      const removed = guide.hunks.reduce((sum, hunk) => sum + hunk.removed, 0)
      const files = new Set(guide.hunks.map(hunk => hunk.path)).size

      return (
        <Box flexDirection="column" gap={1}>
          {statusRow}
          {tracker}
          <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
            <Text bold>{guide.title}</Text>
            <Markdown text={guide.context} />
            <Text dimColor>
              {guide.source} · {files} files · {counts(added, removed)}
            </Text>
          </Box>
          <Box flexDirection="column">
            {steps.map((step, index) => {
              const hunks = hunksOf(index)
              const isReviewed = reviewed.includes(index)

              return (
                <Box key={`step-${index}`} flexDirection="column" marginBottom={1}>
                  <Box flexDirection="row" gap={1}>
                    <Text backgroundColor={isReviewed ? 'success' : 'claude'} color="inverseText" bold>
                      {` ${isReviewed ? '✓' : index + 1} `}
                    </Text>
                    <Button
                      key={`goto-${index}`}
                      plain
                      hotkey={index < 9 ? String(index + 1) : undefined}
                      label={step.title}
                      onPress={() => go(index)}
                    />
                  </Box>
                  <Box paddingLeft={4} flexDirection="column">
                    <Markdown dimColor text={step.summary} />
                    <Text dimColor>
                      {new Set(hunks.map(hunk => hunk.path)).size} files ·{' '}
                      {counts(
                        hunks.reduce((sum, hunk) => sum + hunk.added, 0),
                        hunks.reduce((sum, hunk) => sum + hunk.removed, 0),
                      )}{' '}
                      <Text color="suggestion">{sizeBar(sizeOf(hunks), maxStepSize)}</Text>
                    </Text>
                  </Box>
                </Box>
              )
            })}
          </Box>
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            {key('n', 'start', () => go(0))}
            {key('w', 'open in browser', () => openInBrowser($, guide))}
            {key('r', 'rebuild', () => rebuild($, lastArgs))}
          </Box>
        </Box>
      )
    }

    const step = steps[current]
    if (!step) return <Box>{tracker}</Box>
    const stepHunks = hunksOf(current)
    const isReviewed = reviewed.includes(current)
    const sideBySide = columns >= SPLIT_MIN_COLUMNS
    const paths = [...new Set(stepHunks.map(hunk => hunk.path))]
    const anyCollapsed = stepHunks.some(
      hunk => !expanded.includes(hunk.id) && truncateHunk(hunk.source, COLLAPSED_LINES).hidden > 0,
    )

    const drawHunk = (hunk: Hunk) => {
      const heading = (
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          <Text bold color="suggestion">
            {hunk.path}
          </Text>
          {counts(hunk.added, hunk.removed)}
          <Text color="subtle">{sizeBar(hunk.added + hunk.removed, maxHunkSize)}</Text>
        </Box>
      )
      if (hunk.note) {
        return (
          <Box key={hunk.id} flexDirection="column" marginBottom={1}>
            {heading}
            <Text dimColor italic>
              {hunk.note}
            </Text>
          </Box>
        )
      }

      const cut = expanded.includes(hunk.id) ? { source: hunk.source, hidden: 0 } : truncateHunk(hunk.source, COLLAPSED_LINES)
      const more =
        cut.hidden > 0 ? (
          <Text dimColor italic>
            … {cut.hidden} more lines (press e to expand)
          </Text>
        ) : null

      if (!isSplit) {
        return (
          <Box key={hunk.id} flexDirection="column" marginBottom={1}>
            {heading}
            <Code format="diff" source={cut.source} path={hunk.path} />
            {more}
          </Box>
        )
      }
      const parts = splitHunk(cut.source)

      return (
        <Box key={hunk.id} flexDirection="column" marginBottom={1}>
          {heading}
          <Box flexDirection={sideBySide ? 'row' : 'column'} gap={1}>
            <Box flexDirection="column" width={sideBySide ? '50%' : '100%'} borderStyle="single" borderColor="diffRemovedDimmed" paddingX={1}>
              <Text color="error" bold>
                Before
              </Text>
              <Code source={parts.before || ' '} path={hunk.path} startLine={parts.beforeStart} />
            </Box>
            <Box flexDirection="column" width={sideBySide ? '50%' : '100%'} borderStyle="single" borderColor="diffAddedDimmed" paddingX={1}>
              <Text color="success" bold>
                After
              </Text>
              <Code source={parts.after || ' '} path={hunk.path} startLine={parts.afterStart} />
            </Box>
          </Box>
          {more}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {statusRow}
        {tracker}
        <Box flexDirection="column" borderStyle="round" borderColor={isReviewed ? 'success' : 'claude'} paddingX={1}>
          <Box flexDirection="row" gap={1}>
            <Text backgroundColor={isReviewed ? 'success' : 'claude'} color="inverseText" bold>
              {` ${current + 1} `}
            </Text>
            <Text bold>{step.title}</Text>
            {isReviewed ? <Text color="success">✓ reviewed</Text> : null}
          </Box>
          <Markdown text={step.summary} />
          {step.watch ? (
            <Text color="warning">
              <Text bold>⚠ Check: </Text>
              {step.watch}
            </Text>
          ) : null}
          <Text dimColor>
            {paths.length} files · {counts(
              stepHunks.reduce((sum, hunk) => sum + hunk.added, 0),
              stepHunks.reduce((sum, hunk) => sum + hunk.removed, 0),
            )}
          </Text>
        </Box>
        <Box flexDirection="column">{stepHunks.map(drawHunk)}</Box>
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          {key('n', 'next', () => go(Math.min(steps.length - 1, current + 1)))}
          {key('p', 'prev', () => go(current - 1))}
          {key('x', isReviewed ? 'unmark' : 'reviewed', () => update($, reviewedAtom, list => toggle(list, current)))}
          {key('s', isSplit ? 'unified' : 'before/after', () => update($, splitAtom, value => !value))}
          {key('e', anyCollapsed ? 'expand' : 'collapse', () =>
            update($, expandedAtom, list => {
              const ids = stepHunks.map(hunk => hunk.id)

              return anyCollapsed ? [...new Set([...list, ...ids])] : list.filter(id => !ids.includes(id))
            }),
          )}
          {key('a', 'ask', () =>
            $.prompt.fill({
              text: `About step ${current + 1} of the guided MR ("${step.title}", in ${paths.join(', ')}): `,
              mode: 'replace',
            }),
          )}
          {key('o', 'overview', () => go(-1))}
          {key('w', 'browser', () => openInBrowser($, guide))}
        </Box>
      </Box>
    )
  })
}
