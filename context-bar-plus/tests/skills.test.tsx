import { expect, test } from 'claude-code/testing'

const cats = [
  { name: 'Messages', tokens: 100000, color: 'permission', isDeferred: false, kind: 'used' },
  { name: 'Free space', tokens: 900000, color: 'promptBorder', isDeferred: false, kind: 'free' },
]

const setup = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], mode: string) => {
  const sent: string[] = []
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: { tokens: 100000, window: 1000000, percent: 10, breakdown: { categories: cats, totalTokens: 100000, maxTokens: 1000000, rawMaxTokens: 1000000, percentage: 10 } },
    rateLimits: [],
  } }))
  on('session.start', ($$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('store.get', () => ({ value: mode }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('prompt.submit', ($$, e) => (sent.push(e.text), { text: e.text }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return sent
}

test('soft/strict: a turn that ends with unreviewed haiku work asks for sonnet-reviewer, once', async ($, on) => {
  const sent = await setup($, on, 'strict')

  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Add lenis smooth scroll', subagentType: 'haiku-coder' })
  await $.turn.complete({ answer: '', agentId: 'a1' }) // haiku finishes
  await $.turn.complete({ answer: '' }) // the controller ends its turn without a review
  expect(sent.filter(t => t.includes('sonnet-reviewer') && t.includes('Add lenis smooth scroll')).length).toBe(1)

  await $.turn.complete({ answer: '' }) // the next turn ends: nothing left to ask
  expect(sent.filter(t => t.includes('sonnet-reviewer')).length).toBe(1)
})

test('a reviewer dispatched by the controller itself clears the queue: no extra prompt', async ($, on) => {
  const sent = await setup($, on, 'soft')

  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'task', subagentType: 'haiku-coder' })
  await $.turn.complete({ answer: '', agentId: 'a1' })
  await $.tool.call({ tool: 'Agent', description: 'review', prompt: 'look', subagent_type: 'sonnet-reviewer' })
  await $.turn.complete({ answer: '' })
  expect(sent.filter(t => t.includes('sonnet-reviewer')).length).toBe(0)
})

test('auto mode leaves the review to the controller', async ($, on) => {
  const sent = await setup($, on, 'auto')

  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'task', subagentType: 'haiku-coder' })
  await $.turn.complete({ answer: '', agentId: 'a1' })
  await $.turn.complete({ answer: '' })
  expect(sent.length).toBe(0)
})
