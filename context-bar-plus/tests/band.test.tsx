import { expect, test } from 'claude-code/testing'

const cats = [
  { name: 'System prompt', tokens: 4700, color: 'inactive', isDeferred: false, kind: 'used' },
  { name: 'Messages', tokens: 84000, color: 'permission', isDeferred: false, kind: 'used' },
  { name: 'Free space', tokens: 811000, color: 'promptBorder', isDeferred: false, kind: 'free' },
  { name: 'Autocompact buffer', tokens: 33000, color: 'inactive', isDeferred: false, kind: 'buffer' },
]

test('band draws on terminal and desktop', async ($, on) => {
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: {
      tokens: 156000,
      window: 1000000,
      percent: 16,
      breakdown: { categories: cats, totalTokens: 156000, maxTokens: 1000000, rawMaxTokens: 1000000, percentage: 16 },
    },
    rateLimits: [],
  } }))
  on('session.start', ($$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'context-bar-plus' } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'context-bar-plus',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /context/ })).toBeDefined()
    if (surface === 'desktop') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source)).toContain('<title>msgs 84k')
    }
    await ui.unmount()
  }
})

test('a new session draws the band before the first usage reading', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 1000000, percent: 0 }, rateLimits: [] } }))
  on('session.start', ($$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'context-bar-plus',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /context/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /subagent/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /รอข้อมูล/ })).toBeDefined()
  await ui.unmount()
})
