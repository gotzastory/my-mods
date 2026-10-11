import { expect, test } from 'claude-code/testing'

const cats = [
  { name: 'Messages', tokens: 100000, color: 'permission', isDeferred: false, kind: 'used' },
  { name: 'Free space', tokens: 900000, color: 'promptBorder', isDeferred: false, kind: 'free' },
]

test('a running subagent shows under the bar until its turn ends', async ($, on) => {
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: { tokens: 100000, window: 1000000, percent: 10, breakdown: { categories: cats, totalTokens: 100000, maxTokens: 1000000, rawMaxTokens: 1000000, percentage: 10 } },
    rateLimits: [],
  } }))
  on('session.start', ($$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const band = () =>
    $.ui.mount({
      plugin: 'context-bar-plus',
      surface: 'desktop',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })

  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Add FAQ section', subagentType: 'haiku-coder' })
  let ui = await band()
  expect(await ui.find({ type: 'Text', text: /Add FAQ section/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete({ answer: '', agentId: 'a1' })
  ui = await band()
  expect(await ui.find({ type: 'Text', text: /Add FAQ section/ })).toBeUndefined()
  await ui.unmount()
})

test('the main loop is counted apart from subagents of the same model', async ($, on) => {
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: { tokens: 100000, window: 1000000, percent: 10, breakdown: { categories: cats, totalTokens: 100000, maxTokens: 1000000, rawMaxTokens: 1000000, percentage: 10 } },
    rateLimits: [],
  } }))
  on('session.start', ($$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const sonnet = { model: 'claude-sonnet-5-5', input_tokens: 1000000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  await $.turn.complete({ answer: '', usage: sonnet }) // main: 1.0M
  await $.turn.complete({ answer: '', agentId: 'r1', usage: { ...sonnet, input_tokens: 500000 } }) // reviewer: 500k
  const ui = await $.ui.mount({
    plugin: 'context-bar-plus',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: 'main·sonnet ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1M' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '500k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /compact/ })).toBeUndefined()
  await ui.unmount()
})
