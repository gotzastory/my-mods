import { expect, test } from 'claude-code/testing'

const COMPOSE = {
  model: 'claude-sonnet-5-5',
  promptModel: 'claude-sonnet-5-5',
  surfaces: [],
  tools: [],
  outputStyle: null,
  traits: [],
}

test('/subagent cycles off → auto → soft → strict → off; strict blocks main-loop edits only', async ($, on) => {
  on('session.start', ($$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'base', scope: 'session' as const }] }))
  on('tool.call', () => ({ result: 'edited' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const section = async () =>
    (await $.prompt.compose(COMPOSE)).sections.find(s => s.id === 'context-bar-plus:subagent')?.text ?? null
  const edit = (agentId?: string) =>
    $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b', ...(agentId ? { agentId } : {}) })

  expect(await section()).toBeNull()

  await $.command.run({ command: 'subagent', args: '' })
  expect(await section()).toContain('auto')
  expect(await edit()).toMatchObject({ result: 'edited' })

  await $.command.run({ command: 'subagent', args: '' })
  expect(await section()).toContain('soft')
  expect(await edit()).toMatchObject({ result: 'edited' })

  await $.command.run({ command: 'subagent', args: '' })
  expect(await section()).toContain('strict')
  expect(await edit()).toMatchObject({ deny: expect.stringContaining('haiku-coder') })
  expect(await edit('sub-1')).toMatchObject({ result: 'edited' })

  await $.command.run({ command: 'subagent', args: '' })
  expect(await section()).toBeNull()
})

test('strict refuses haiku-coder until the SDD skill is invoked', async ($, on) => {
  on('session.start', ($$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('store.get', () => ({ value: 'strict' }))
  on('store.set', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'ok' }))
  on('prompt.submit', ($$, e) => ({ text: e.text }))
  on('clock.now', () => ({ value: 0 }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const dispatch = () => $.tool.call({ tool: 'Agent', description: 'task 1', prompt: 'do it', subagent_type: 'haiku-coder' })

  const general = () => $.tool.call({ tool: 'Agent', description: 'task', prompt: 'do it', subagent_type: 'general-purpose' })

  expect(await dispatch()).toMatchObject({ deny: expect.stringContaining('subagent-driven-development') })
  expect(await general()).toMatchObject({ deny: expect.stringContaining('subagent-driven-development') })
  expect(await $.tool.call({ tool: 'Agent', description: 'review', prompt: 'look', subagent_type: 'sonnet-reviewer' })).toMatchObject({ result: 'ok' })
  expect(await $.tool.call({ tool: 'Skill', skill: 'superpowers:subagent-driven-development' })).toMatchObject({ result: 'ok' })
  expect(await dispatch()).toMatchObject({ result: 'ok' })

  // a new request closes the gate again
  await $.prompt.submit({ text: 'next change' })
  expect(await dispatch()).toMatchObject({ deny: expect.stringContaining('subagent-driven-development') })
})

test('a mode on caps non-haiku subagents at sonnet; off leaves the model alone', async ($, on) => {
  const asked: (string | undefined)[] = []
  on('session.start', ($$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('store.get', () => ({ value: 'auto' }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', ($$, e) => (asked.push(e.model), { model: e.model ?? 'claude-opus-5-5', agentId: `a${asked.length}` }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const spawn = (subagentType: string, model?: string) =>
    $.agent.spawn({ tool_use_id: `t${asked.length}`, prompt: 'p', description: 'd', subagentType, ...(model ? { model } : {}) })

  await spawn('general-purpose', 'opus')
  await spawn('sonnet-reviewer')
  await spawn('haiku-coder')
  await spawn('haiku-coder', 'sonnet') // the controller asking for more: still haiku
  expect(asked).toEqual(['sonnet', 'sonnet', 'haiku', 'haiku'])

  await $.command.run({ command: 'subagent', args: '' }) // auto → soft
  await $.command.run({ command: 'subagent', args: '' }) // soft → strict
  await $.command.run({ command: 'subagent', args: '' }) // strict → off
  await spawn('general-purpose', 'opus')
  expect(asked[4]).toBe('opus')
})
