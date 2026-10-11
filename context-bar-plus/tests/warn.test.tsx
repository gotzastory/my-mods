import { expect, test } from 'claude-code/testing'

const usage = (pct: number) => ({
  startedAt: 0,
  context: {
    tokens: pct * 10000,
    window: 1000000,
    percent: pct,
    breakdown: {
      categories: [
        { name: 'Messages', tokens: pct * 10000, color: 'permission', isDeferred: false, kind: 'used' },
        { name: 'Free space', tokens: 1000000 - pct * 10000, color: 'promptBorder', isDeferred: false, kind: 'free' },
      ],
      totalTokens: pct * 10000,
      maxTokens: 1000000,
      rawMaxTokens: 1000000,
      percentage: pct,
    },
  },
  rateLimits: [],
})

test('subscription windows draw under the bar, and 90% toasts once', async ($, on) => {
  const toasts: string[] = []
  let used = 62
  on('session.usage', () => ({ value: { ...usage(10), rateLimits: [{ kind: 'five_hour', percentUsed: used }] } }))
  on('session.start', ($$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.toast', ($$, e) => (toasts.push(e.text), { value: undefined }))
  on('session.measure', ($$, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'context-bar-plus',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: ' 62%' })).toBeDefined()
  await ui.unmount()

  used = 93
  const reading = { context: usage(10).context, rateLimits: [{ kind: 'five_hour', percentUsed: 93 }], changed: ['rateLimits' as const] }
  await $.session.measure(reading)
  await $.session.measure(reading)
  expect(toasts.filter(t => t.includes('5h') && t.includes('93%')).length).toBe(1)
})
