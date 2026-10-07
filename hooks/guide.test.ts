import { expect, test } from 'claude-code/testing'

import { assembleGuide, parseDiff, sizeBar, splitHunk, truncateHunk } from './guide'

const DIFF = [
  'diff --git a/src/a.py b/src/a.py',
  'index 111..222 100644',
  '--- a/src/a.py',
  '+++ b/src/a.py',
  '@@ -1,3 +1,3 @@ def f():',
  ' x = 1',
  '--- y = 2',
  '+y = 3',
  ' z = 4',
  '@@ -10 +10,2 @@',
  ' tail',
  '+more',
  'diff --git a/logo.png b/logo.png',
  'Binary files a/logo.png and b/logo.png differ',
  'diff --git a/old.py b/new.py',
  'similarity index 100%',
  'rename from old.py',
  'rename to new.py',
  '',
].join('\n')

test('parseDiff splits files into hunks and keeps hunkless files', async () => {
  const hunks = parseDiff(DIFF)
  expect(hunks.map(hunk => hunk.id)).toEqual(['H1', 'H2', 'H3', 'H4'])
  expect(hunks[0]!.path).toBe('src/a.py')
  expect(hunks[0]!.removed).toBe(1)
  expect(hunks[0]!.added).toBe(1)
  expect(hunks[0]!.source.split('\n')).toHaveLength(5)
  expect(hunks[1]!.added).toBe(1)
  expect(hunks[2]!.note).toBe('Binary file changed')
  expect(hunks[3]!.path).toBe('new.py')
  expect(hunks[3]!.note).toBe('Renamed from old.py')
})

test('assembleGuide drops unknown and repeated ids and collects leftovers', async () => {
  const hunks = parseDiff(DIFF)
  const reply = JSON.stringify({
    title: 'T',
    context: 'C',
    steps: [
      { title: 'One', summary: 's', watch: '', hunks: ['H2', 'H9'] },
      { title: 'Two', summary: 's', watch: 'w', hunks: ['H2', 'H1'] },
      { title: 'Empty', summary: 's', hunks: ['H9'] },
    ],
  })
  const guide = assembleGuide(`Here you go:\n${reply}`, hunks, 'src')
  expect(guide.steps.map(step => step.title)).toEqual(['One', 'Two', 'Other changes'])
  expect(guide.steps[1]!.hunkIds).toEqual(['H1'])
  expect(guide.steps[2]!.hunkIds).toEqual(['H3', 'H4'])
})

test('splitHunk gives before and after with their start lines', async () => {
  const parts = splitHunk(parseDiff(DIFF)[0]!.source)
  expect(parts.before).toBe('x = 1\n-- y = 2\nz = 4')
  expect(parts.after).toBe('x = 1\ny = 3\nz = 4')
  expect(parts.beforeStart).toBe(1)
})

test('truncateHunk keeps a parseable header for the lines it keeps', async () => {
  const cut = truncateHunk('@@ -1,3 +1,3 @@ def f():\n x = 1\n-y = 2\n+y = 3\n z = 4', 2)
  expect(cut.source).toBe('@@ -1,2 +1,1 @@ def f():\n x = 1\n-y = 2')
  expect(cut.hidden).toBe(2)
  expect(truncateHunk('@@ -1 +1 @@\n-a\n+b', 5).hidden).toBe(0)
})

test('sizeBar scales to the largest size and shows at least one block', async () => {
  expect(sizeBar(10, 10, 4)).toBe('████')
  expect(sizeBar(1, 100, 4)).toBe('█░░░')
  expect(sizeBar(0, 10, 4)).toBe('░░░░')
})
