import { expect, test } from 'claude-code/testing'

// These tests run the BUILT module (hooks/center.js) under Claude Code's own test runner, with the engine's
// behaviour beneath it replaced by the hooks each test registers. See scripts/test-mod.mjs.

const HUD = {
  hudVersion: 1,
  generatedAt: '2026-03-04T12:00:00.000Z',
  project: { name: 'demo', ecosystems: ['node'], packageManager: 'npm' },
  git: { state: 'dirty', branch: 'main', changedFiles: 3 },
  verification: { status: 'FAILED', at: '2026-03-04T11:55:00.000Z', reasons: ['unit-test failed with exit code 1.'], checksAvailable: ['unit-test'] },
  languageServersMissing: [],
  runtime: { offline: false, approval: 'risk-based' },
}

const PANE = {
  plugin: 'jpe',
  component: 'Pane',
  requestId: 'jpe-center',
  props: { title: 'JPE', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const SUMMARY = {
  file: 'src/a.js', added: 1, removed: 0, unchanged: 1,
  hunks: [{ beforeStart: 2, afterStart: 2, removed: [], added: ['eval(x)'] }],
  symbolsAdded: [], symbolsRemoved: [],
  risksIntroduced: [{ id: 'dynamic-eval', line: 2, severity: 'high', message: 'Possible dynamic code execution' }],
  risksResolved: [], approximate: false,
}
const REVIEW = {
  files: [{ status: 'modified', isTest: false, summary: SUMMARY }],
  notes: [{ basis: 'confirmed', text: 'src/a.js:2 introduces a possible high risk' }],
  checklist: ['Read each diff'],
  skipped: [],
  decision: { state: 'none', fileCount: 1 },
}
const HUD_WITH_REVIEW = { ...HUD, review: { changedFiles: 1, state: 'none' } }

interface Setup {
  /** The facts the command line reports; defaults to HUD. */
  hud?: unknown
  /** What show review --json answers. */
  reviewRun?: { exitCode: number; stdout: string; stderr: string }
  /** What review approve or reject answers. */
  decideRun?: { exitCode: number; stdout: string; stderr: string }
  run?: { exitCode: number; stdout: string; stderr: string }
  placed?: boolean
  /** When set, nothing beneath answers command.run, so running a command rejects. */
  commandFails?: string
}

/** Stands in for the engine beneath the module, and records what the module asked of it. */
function engine(on: any, setup: Setup = {}) {
  const calls = { argv: [] as string[][], opened: [] as any[], status: [] as Array<string | undefined>, toasts: [] as string[], commands: [] as Array<{ command: string; args: string }>, decisions: [] as string[][], stored: [] as Array<{ key: string; value: any }> }
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('process.run', (_: unknown, e: any) => {
    calls.argv.push([...e.argv])
    const args = (e.argv as string[]).slice(2)
    if (args[0] === 'show' && args[1] === 'review') return { value: setup.reviewRun ?? { exitCode: 0, stdout: JSON.stringify(REVIEW), stderr: '' } }
    if (args[0] === 'review') {
      calls.decisions.push(args.slice(1))
      return { value: setup.decideRun ?? { exitCode: 0, stdout: 'Recorded', stderr: '' } }
    }
    return { value: setup.run ?? { exitCode: 0, stdout: JSON.stringify(setup.hud ?? HUD), stderr: '' } }
  })
  on('ui.open', (_: unknown, e: any) => {
    calls.opened.push(e)
    return { value: { isPlaced: setup.placed ?? true } }
  })
  on('ui.status', (_: unknown, e: any) => {
    calls.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_: unknown, e: any) => {
    calls.toasts.push(e.text)
    return { value: undefined }
  })
  on('store.set', (_: unknown, e: any) => {
    calls.stored.push({ key: e.key, value: e.value })
    return { value: undefined }
  })
  // With nothing beneath to answer a command, `$.command.run` rejects: that is how a command that cannot run looks.
  if (setup.commandFails === undefined) {
    on('command.run', (_: unknown, e: any) => {
      calls.commands.push({ command: e.command, args: e.args })
      return { text: 'the skill ran' }
    })
  }
  return calls
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const settle = async ($: any) => {
  for (let i = 0; i < 8; i++) await $.tool.call({ tool: 'Bash', command: 'true' })
}

test('a bare /jpe opens the pane and tells the person how to use it', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  const result = await $.command.run({ command: 'jpe:jpe' })
  expect(result.text).toContain('command center opened')
  expect(result.isTextDisplayOnly).toBe(true)
  expect(calls.opened).toEqual([{ id: 'jpe-center', title: 'JPE', focus: true, closeOnEscape: true }])
})

test('it reads the project facts from the JPE command line, with no shell, and nothing else', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  await $.command.run({ command: 'jpe:jpe' })
  expect(calls.argv.length).toBeGreaterThan(0)
  for (const argv of calls.argv) expect(argv).toEqual(['node', expect.stringMatching(/dist\/cli\.js$/), 'center', 'hud', '--json'])
})

test('with no pane to show, /jpe prints the home screen as plain text, from the real facts', async ($, on) => {
  engine(on, { placed: false })
  await $.session.start(START)
  const result = await $.command.run({ command: 'jpe:jpe' })
  expect(result.isTextDisplayOnly).toBe(true)
  expect(result.text).toContain('JPE command center')
  expect(result.text).toContain('FAILED')
  expect(result.text).toContain('unit-test failed with exit code 1.')
  expect(result.text).toContain('1. /jpe:fix')
  expect(result.text).toContain('3 uncommitted files')
  expect(result.text).not.toContain('\u001b')
})

test('when the facts cannot be read it says so and why, instead of showing anything made up', async ($, on) => {
  engine(on, { placed: false, run: { exitCode: 1, stdout: '', stderr: 'boom' } })
  await $.session.start(START)
  const result = await $.command.run({ command: 'jpe:jpe' })
  expect(result.text).toContain("Could not read this project's facts: boom")
  expect(result.text).not.toContain('FAILED')
  expect(result.text).toContain('/jpe:verify')
})

test('facts in a format this version does not understand are refused, not half-used', async ($, on) => {
  engine(on, { placed: false, run: { exitCode: 0, stdout: JSON.stringify({ ...HUD, hudVersion: 99 }), stderr: '' } })
  await $.session.start(START)
  const result = await $.command.run({ command: 'jpe:jpe' })
  expect(result.text).toContain('does not understand')
  expect(result.text).not.toContain('FAILED')
})

test('output that is not JSON at all is reported as a failure', async ($, on) => {
  engine(on, { placed: false, run: { exitCode: 0, stdout: 'not json', stderr: '' } })
  await $.session.start(START)
  expect((await $.command.run({ command: 'jpe:jpe' })).text).toContain("Could not read this project's facts")
})

test('/jpe with arguments, and every other command, go straight through to the skill', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  expect((await $.command.run({ command: 'jpe:jpe', args: 'verify' })).text).toBe('the skill ran')
  expect((await $.command.run({ command: 'jpe:explain', args: 'src/a.ts' })).text).toBe('the skill ran')
  expect(calls.opened).toEqual([])
  expect(calls.commands).toEqual([{ command: 'jpe:jpe', args: 'verify' }, { command: 'jpe:explain', args: 'src/a.ts' }])
})

test('a command typed outside the pane is remembered in the history, and unknown ones are not', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  await $.command.run({ command: 'jpe:verify' })
  await $.command.run({ command: 'jpe:jpe', args: 'audit' })
  await $.command.run({ command: 'jpe:nonsense' })
  await $.command.run({ command: 'compact' })
  await settle($)
  const last = calls.stored.at(-1)
  expect(last?.key).toBe('center-memory')
  expect(last?.value.history.map((h: { id: string }) => h.id)).toEqual(['audit', 'verify'])
})

test('the status line and one toast report a confirmed finding, and the same finding is not toasted twice', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  await settle($)
  await $.command.run({ command: 'jpe:jpe' })
  await settle($)
  expect(calls.status).toContain('JPE: FAILED · main +3 changed')
  expect(calls.toasts).toHaveLength(1)
  expect(calls.toasts[0]).toContain('Fix the failing checks')
})

test('the pane shows the facts, numbered next steps and a palette, on every surface', async ($, on) => {
  engine(on)
  await $.session.start(START)
  await settle($)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /JPE command center/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /FAILED/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /unit-test failed with exit code 1\./ })).toBeDefined()
    expect((await ui.find({ key: 'action-1' }))?.text).toContain('1. /jpe:fix')
    expect((await ui.find({ key: 'action-6' }))?.text).toContain('6. /jpe:verify')
    expect(await ui.find({ key: 'palette' })).toBeDefined()
    await ui.unmount()
  }
})

test('before the facts arrive the pane says it is reading them, rather than showing blanks', async ($, on) => {
  engine(on, { run: { exitCode: 1, stdout: '', stderr: 'no node' } })
  await $.session.start(START)
  await settle($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Could not read this project's facts: no node/ })).toBeDefined()
  expect(await ui.find({ key: 'action-1' })).toBeUndefined()
  await ui.unmount()
})

test('pressing a command that can change things asks first, and runs nothing until the person says yes', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  await settle($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'action-1' })
  expect(await ui.find({ type: 'Text', text: /can change files, settings or installed software/ })).toBeDefined()
  expect(calls.commands).toEqual([])
  await ui.press({ key: 'confirm-run' })
  await settle($)
  expect(calls.commands).toEqual([{ command: 'jpe:fix', args: '' }])
  expect(await ui.find({ type: 'Text', text: /Ran \/jpe:fix\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /can change files/ })).toBeUndefined()
  await ui.unmount()
})

test('cancelling the confirmation runs nothing and removes the question', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  await settle($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'action-1' })
  await ui.press({ key: 'confirm-cancel' })
  expect(calls.commands).toEqual([])
  expect(await ui.find({ type: 'Text', text: /can change files/ })).toBeUndefined()
  await ui.unmount()
})

test('a read-only command runs at once when pressed', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  await settle($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'action-6' })
  await settle($)
  expect(calls.commands).toEqual([{ command: 'jpe:verify', args: '' }])
  await ui.unmount()
})

test('a command that fails is reported as a failure, never as a success', async ($, on) => {
  engine(on, { commandFails: 'nothing answers' })
  await $.session.start(START)
  await settle($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'action-6' })
  await settle($)
  expect(await ui.find({ type: 'Text', text: /Could not run \/jpe:verify:/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Ran \/jpe:verify/ })).toBeUndefined()
  await ui.unmount()
})

test('the palette finds a command as you type and shows the matches', async ($, on) => {
  engine(on)
  await $.session.start(START)
  await settle($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'palette', text: 'ver', kind: 'change' })
  const results = await ui.find({ key: 'results' })
  expect(results).toBeDefined()
  expect(JSON.stringify(results)).toContain('/jpe:verify')
  await ui.unmount()
})

test('submitting the palette launches the best match, an item number, or a typed command with its arguments', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  await settle($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'palette', text: 'ver' })
  await ui.input({ key: 'palette', text: 'explain src/app.ts' })
  await ui.input({ key: 'palette', text: '3' })
  await settle($)
  expect(calls.commands).toEqual([
    { command: 'jpe:verify', args: '' },
    { command: 'jpe:explain', args: 'src/app.ts' },
    { command: 'jpe:research', args: '' },
  ])
  await ui.unmount()
})

test('a palette query that matches nothing says so and launches nothing', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  await settle($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'palette', text: 'qqqzzz', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /No command matches "qqqzzz"\./ })).toBeDefined()
  await ui.input({ key: 'palette', text: 'qqqzzz' })
  await settle($)
  expect(calls.commands).toEqual([])
  await ui.unmount()
})

test('a favourite is stored, and appears first next time', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  await settle($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'palette', text: 'audit', kind: 'change' })
  await ui.press({ key: 'favorite' })
  await settle($)
  expect(calls.stored.at(-1)?.value.favorites).toEqual(['audit'])
  await ui.unmount()
})

// ---- the review screen ----------------------------------------------------------------------------------------

const reviewJson = (over: object = {}) => ({ exitCode: 0, stdout: JSON.stringify({ ...REVIEW, ...over }), stderr: '' })

async function openReview($: any, on: any, setup: Setup = {}) {
  const calls = engine(on, { hud: HUD_WITH_REVIEW, ...setup })
  await $.session.start(START)
  await settle($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'open-review' })
  await settle($)
  return { calls, ui }
}

test('the home screen offers the review only when there are uncommitted changes to review', async ($, on) => {
  engine(on)
  await $.session.start(START)
  await settle($)
  const plain = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await plain.find({ key: 'open-review' })).toBeUndefined()
  await plain.unmount()
})

test('pressing the review button reads the review and draws the overview, notes, decision and the controls', async ($, on) => {
  const { calls, ui } = await openReview($, on)
  expect(calls.argv.some((a: string[]) => a.slice(2).join(' ') === 'show review --json')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /Code review of uncommitted changes/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No review decision recorded for these changes/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /src\/a\.js/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\[confirmed\] src\/a\.js:2 introduces a possible high risk/ })).toBeDefined()
  for (const key of ['file-1', 'review-note', 'approve', 'reject', 'refresh-review', 'back']) expect(await ui.find({ key }), key).toBeDefined()
  await ui.unmount()
})

test('the home button names how many files, and the review is drawn on every surface', async ($, on) => {
  engine(on, { hud: HUD_WITH_REVIEW })
  await $.session.start(START)
  await settle($)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'open-review' }))?.text).toContain('1 uncommitted file')
    await ui.press({ key: 'open-review' })
    await settle($)
    expect(await ui.find({ type: 'Text', text: /Code review of uncommitted changes/ }), surface).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('back returns to the command center', async ($, on) => {
  const { ui } = await openReview($, on)
  await ui.press({ key: 'back' })
  await settle($)
  expect(await ui.find({ type: 'Text', text: /JPE command center/ })).toBeDefined()
  expect(await ui.find({ key: 'approve' })).toBeUndefined()
  await ui.unmount()
})

test("a file button opens that file's diff, and pressing it again closes it", async ($, on) => {
  const { ui } = await openReview($, on)
  expect(await ui.find({ type: 'Text', text: /@@ -2 \+2 @@/ })).toBeUndefined()
  await ui.press({ key: 'file-1' })
  expect(await ui.find({ type: 'Text', text: /@@ -2 \+2 @@/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /eval\(x\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /A possible risk was introduced/ })).toBeDefined()
  await ui.press({ key: 'file-1' })
  expect(await ui.find({ type: 'Text', text: /@@ -2 \+2 @@/ })).toBeUndefined()
  await ui.unmount()
})

test('approving records the decision through the command line, and says so only after it succeeded', async ($, on) => {
  const { calls, ui } = await openReview($, on)
  await ui.press({ key: 'approve' })
  await settle($)
  expect(calls.decisions).toEqual([['approve']])
  expect(await ui.find({ type: 'Text', text: /Recorded: approved\. This only records your decision/ })).toBeDefined()
  // The review is read again afterwards, so what is shown is what is now recorded.
  expect(calls.argv.filter((a: string[]) => a.slice(2).join(' ') === 'show review --json').length).toBeGreaterThanOrEqual(2)
  await ui.unmount()
})

test('rejecting with a note passes the note as its own argument', async ($, on) => {
  const { calls, ui } = await openReview($, on)
  await ui.input({ key: 'review-note', text: 'needs a test', kind: 'change' })
  await ui.press({ key: 'reject' })
  await settle($)
  expect(calls.decisions).toEqual([['reject', '--note', 'needs a test']])
  expect(await ui.find({ type: 'Text', text: /Recorded: rejected\./ })).toBeDefined()
  await ui.unmount()
})

test('a note with shell characters is one argument, never interpreted', async ($, on) => {
  const { calls, ui } = await openReview($, on)
  const hostile = '"; rm -rf / #  $(whoami) `id` && echo hi'
  await ui.input({ key: 'review-note', text: hostile, kind: 'change' })
  await ui.press({ key: 'approve' })
  await settle($)
  expect(calls.decisions).toEqual([['approve', '--note', hostile]])
  await ui.unmount()
})

test('a decision that could not be recorded is reported as a failure, never as a success', async ($, on) => {
  const { ui } = await openReview($, on, { decideRun: { exitCode: 1, stdout: '', stderr: 'jpe: There are no uncommitted changes to review.' } })
  await ui.press({ key: 'approve' })
  await settle($)
  // The pane wraps long messages across rows, so each part is looked for on its own.
  expect(await ui.find({ type: 'Text', text: /Could not record the decision:/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /no uncommitted changes/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Recorded:/ })).toBeUndefined()
  await ui.unmount()
})

test('a review that cannot be read says why, and offers no approve or reject', async ($, on) => {
  const { ui } = await openReview($, on, { reviewRun: { exitCode: 1, stdout: '', stderr: 'jpe: This folder is not a git repository, so there is no committed version to compare against.' } })
  expect(await ui.find({ type: 'Text', text: /Could not read the review: This folder is not a git repository/ })).toBeDefined()
  for (const key of ['approve', 'reject', 'review-note', 'file-1']) expect(await ui.find({ key }), key).toBeUndefined()
  expect(await ui.find({ key: 'back' })).toBeDefined()
  await ui.unmount()
})

test('review data in a format this version does not understand is refused, not half-drawn', async ($, on) => {
  const { ui } = await openReview($, on, { reviewRun: reviewJson({ files: [{ status: 'renamed', isTest: false, summary: SUMMARY }] }) })
  expect(await ui.find({ type: 'Text', text: /does not understand/ })).toBeDefined()
  expect(await ui.find({ key: 'approve' })).toBeUndefined()
  await ui.unmount()
})

test('with nothing to review there is nothing to approve', async ($, on) => {
  const { ui } = await openReview($, on, { reviewRun: reviewJson({ files: [], notes: [], decision: { state: 'none', fileCount: 0 } }) })
  expect(await ui.find({ type: 'Text', text: /There are no uncommitted changes to review\./ })).toBeDefined()
  expect(await ui.find({ key: 'approve' })).toBeUndefined()
  expect(await ui.find({ key: 'reject' })).toBeUndefined()
  await ui.unmount()
})

test('a stale decision is drawn as stale, never as current', async ($, on) => {
  const { ui } = await openReview($, on, { reviewRun: reviewJson({ decision: { state: 'stale', fileCount: 1, decision: 'approved', at: '2026-03-04T12:00:00.000Z' } }) })
  expect(await ui.find({ type: 'Text', text: /Stale: the last decision \(approved\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /unchanged since/ })).toBeUndefined()
  await ui.unmount()
})

test('a current approval is drawn as approved and unchanged since', async ($, on) => {
  const { ui } = await openReview($, on, { reviewRun: reviewJson({ decision: { state: 'current', fileCount: 1, decision: 'approved', at: '2026-03-04T12:00:00.000Z' } }) })
  expect(await ui.find({ type: 'Text', text: /Approved, and these changes are unchanged since/ })).toBeDefined()
  await ui.unmount()
})

test('a bare /jpe returns to the command center even if the review was open', async ($, on) => {
  const { ui } = await openReview($, on)
  await $.command.run({ command: 'jpe:jpe' })
  await settle($)
  expect(await ui.find({ type: 'Text', text: /JPE command center/ })).toBeDefined()
  expect(await ui.find({ key: 'approve' })).toBeUndefined()
  await ui.unmount()
})
