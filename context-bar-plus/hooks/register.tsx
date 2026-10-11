import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { AgentRow, Fill, Limit, Mode, ModelTokens } from '../types'

const fill = atom({ plugin: 'context-bar-plus', key: 'fill' } as const, null)
const isHidden = atom({ plugin: 'context-bar-plus', key: 'isHidden' } as const, false)
const cache = atom({ plugin: 'context-bar-plus', key: 'cache' } as const, null)
// in $.state, not a module variable: a hot reload would lose it and freeze the countdown
const endsAt = atom({ plugin: 'context-bar-plus', key: 'endsAt' } as const, null)
// ponytail: fixed threshold; make it a userConfig option if it needs tuning
const CACHE_WARN_S = 30

// the cache countdown lives on the status line, not the band: a 1s band redraw made the Svg bar flicker
async function pushStatus($: EngineInterface) {
  const c = await read($, cache)
  const parts: string[] = []
  if (c !== null) {
    const dot = c === 'live' || c > 60 ? '🟢' : c === 0 ? '🔴' : '🟡'
    parts.push(`${dot} cache ${c === 'live' ? 'live' : c === 0 ? 'cold' : mmss(c)}`)
  }
  $.ui.status(parts.length ? parts.join('  ·  ') : undefined)
}

// ponytail: fixed 1-hour prompt-cache TTL (this account's); set 5 * 60 * 1000 for the 5-minute cache
const TTL_MS = 60 * 60 * 1000

const fmt = (n: number) =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`

const SHORT: Record<string, string> = {
  'system prompt': 'prompt',
  'system tools': 'tools',
  'mcp tools': 'mcp',
  'mcp server instructions': 'mcp instr',
  'custom agents': 'agents',
  'memory files': 'memory',
  messages: 'msgs',
  'autocompact buffer': 'buffer',
  'free space': 'free',
}

// SVG can't read theme keys; hex picked to match the desktop app's /context colours
const HEX: Record<string, string> = {
  prompt: '#b8b8b8',
  tools: '#4a4a4a',
  mcp: '#1a9bb5',
  'mcp instr': '#17a35f',
  skills: '#7a4a00',
  agents: '#c2410c',
  memory: '#d4a017',
  msgs: '#8a7fd0',
  buffer: '#4a4a4a',
  free: '#c4c4c4',
}

// ponytail: desktop's monospace cell is ~8.4px at the default font size; tune if the bar over/undershoots
const PX_PER_CELL = 8.4

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

// desktop: one interactive SVG, each segment a rect whose <title> is the native tooltip
const BAR_H = 10
const SVG_H = 26 // bar, then one line the hovered segment's label shows on

// pixel coordinates (no stretching) so the label text keeps its shape
// each segment is a <g>: CSS :hover reveals its label under the bar; <title> stays for surfaces that show it
function barSvg(shown: { label: string; tokens: number }[], sum: number, w: number) {
  let x = 0
  const segs = shown.map(k => {
    const sw = Math.max((k.tokens / sum) * w, 2)
    const pct = ((k.tokens / sum) * 100).toFixed(1)
    const color = HEX[k.label] ?? '#999999'
    const text = `${esc(k.label)} ${fmt(k.tokens)} · ${pct}%`
    const g =
      `<g class="s"><title>${text}</title>` +
      `<rect x="${x.toFixed(1)}" y="0" width="${sw.toFixed(1)}" height="${BAR_H}" fill="${color}"/>` +
      // invisible hit area down to the label line, so moving onto the label keeps it shown
      `<rect x="${x.toFixed(1)}" y="${BAR_H}" width="${sw.toFixed(1)}" height="${SVG_H - BAR_H}" fill="transparent"/>` +
      `<text x="0" y="${SVG_H - 4}"><tspan fill="${color}">■ </tspan>${text}</text></g>`
    x += sw
    return g
  })
  const css =
    '.s text{opacity:0;font:12px system-ui,sans-serif;fill:#888;pointer-events:none}' +
    '.s:hover text{opacity:1}.s:hover rect:first-of-type{opacity:.7}'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${SVG_H}" viewBox="0 0 ${w} ${SVG_H}"><style>${css}</style>${segs.join('')}</svg>`
}

const label = (name: string) => SHORT[name.toLowerCase()] ?? name.toLowerCase()

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// subscription windows: pushed by session.measure, read once at start
const limits = atom({ plugin: 'context-bar-plus', key: 'limits' } as const, [])
const limitsWarned = atom({ plugin: 'context-bar-plus', key: 'limitsWarned' } as const, [])
const LIMIT_WARN = 90
const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
const DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']

// "16:00" today, "ศ. 09:00" further out
function resetLabel(iso: string | undefined, now: number) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.getTime() - now < 20 * 3600 * 1000 ? hm : `${DAYS[d.getDay()]} ${hm}`
}

async function takeUsage($: EngineInterface, ls: readonly Limit[]) {
  const now = await $.clock.now()
  const next = ls.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt, resetLabel: resetLabel(resetsAt, now) }))
  await update($, limits, () => next)
  // one toast per window as it crosses 90%; re-armed once it drops back (a reset)
  const warned = await read($, limitsWarned)
  for (const l of next) {
    const label = LIMIT_LABEL[l.kind] ?? l.kind
    if (l.percentUsed >= LIMIT_WARN && !warned.includes(l.kind)) {
      $.ui.toast(`⏳ โควตา ${label} ใช้ไป ${Math.round(l.percentUsed)}% แล้ว${l.resetLabel ? ` · รีเซ็ต ${l.resetLabel}` : ''}`, { timeoutMs: 8000 })
    }
  }
  await update($, limitsWarned, () => next.filter(l => l.percentUsed >= LIMIT_WARN).map(l => l.kind))
}

// haiku-coder tasks finished since the last sonnet-reviewer dispatch; soft/strict send a review prompt if the turn ends with any
const unreviewed = atom({ plugin: 'context-bar-plus', key: 'unreviewed' } as const, [])

const reviewPrompt = (tasks: string[]) =>
  [
    'Review before reporting done: dispatch the Agent tool with subagent_type "sonnet-reviewer" for the work haiku-coder just finished:',
    ...tasks.map(t => `- ${t}`),
    'Give it the task as it was briefed and the files it changed. On CHANGES NEEDED, send the fixes back to "haiku-coder" and review again.',
  ].join(String.fromCharCode(10))

const USAGE_PROMPT = 'Use the Skill tool to run anthropic-skills:explain-usage.'

async function explainUsage($: EngineInterface) {
  void $.prompt.submit({ text: USAGE_PROMPT })
}

async function refresh($: EngineInterface) {
  try {
    const { context, rateLimits } = await $.session.usage({ breakdown: 'summary' })
    const b = context.breakdown
    const cats = (b?.categories ?? [])
      .filter(c => !c.isDeferred)
      .map(({ name, tokens, color, kind }) => ({ name, tokens, color, kind }))
    const buffer = cats.find(c => c.kind === 'buffer')
    const next: Fill | null = b
      ? {
          cats,
          total: b.totalTokens,
          window: b.rawMaxTokens,
          pct: b.percentage,
          compactAt: buffer ? b.rawMaxTokens - buffer.tokens : null,
        }
      : null
    await update($, fill, () => next)
    // after the fill: a failure in the quota row must not take the bar down with it
    await takeUsage($, rateLimits).catch(() => undefined)
  } catch {
    // no usage before the session binds; the next turn.complete retries
  }
}

// ---- subagent mode: off / soft / strict, the live pane, tokens per model ----
const mode = atom({ plugin: 'context-bar-plus', key: 'mode' } as const, 'off')
const agents = atom({ plugin: 'context-bar-plus', key: 'agents' } as const, [])
const byModel = atom({ plugin: 'context-bar-plus', key: 'byModel' } as const, {})

const STORE_KEY = 'mode'
const PANE = 'context-bar-plus-subagents'
const NEXT: Record<Mode, Mode> = { off: 'auto', auto: 'soft', soft: 'strict', strict: 'off' }
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

// set once the main loop invokes the SDD skill; strict refuses haiku-coder dispatches until then
// agent types that only read: free to dispatch before the skill runs
const READ_ONLY_AGENTS = new Set(['sonnet-reviewer', 'Explore', 'Plan', 'claude-code-guide'])
const isSddActive = atom({ plugin: 'context-bar-plus', key: 'isSddActive' } as const, false)
const SDD = 'superpowers:subagent-driven-development'

// a recipe, not a nudge: the model skipped the skill and dispatched one big task when told only "use SDD"
// MIX skill set: Matt Pocock's skills where they overlap superpowers (grilling, tdd, diagnosing-bugs, code-review axes),
// superpowers for the plan and the dispatch loop, which Matt's set has no counterpart for
const BUGS = 'A bug, error or failing test: invoke the Skill tool with mattpocock-skills:diagnosing-bugs and find the root cause before any fix is dispatched.'
// grilling asks in text rounds; the desktop app has a click-to-answer form, so each round goes through it instead
const GRILL_FORM =
  'When you run mattpocock-skills:grilling, put each round to the user with the AskUserQuestion tool instead of text: one question per frontier decision (at most 4 per call; a bigger frontier takes several calls), 2-4 options each, your recommended option first with "(Recommended)" after its label, a short header per question. A question with no fixed choices still goes in the form: offer your best guesses as options; the user types their own through "Other".'
const WORKFLOW = [
  'If you are a subagent, ignore this section.',
  BUGS,
  'For any request that changes code or files, run this workflow, in order:',
  '1. Requirements unclear or several readings possible: invoke the Skill tool with mattpocock-skills:grilling first. Clear request: skip this step.',
  GRILL_FORM,
  '2. A UI whose look or flow is still undecided: invoke the Skill tool with mattpocock-skills:prototype before planning.',
  '3. No written plan yet: invoke the Skill tool with superpowers:writing-plans and write one, split into small tasks (one file or one behaviour each). New modules or interfaces: apply mattpocock-skills:codebase-design while planning.',
  `4. Invoke the Skill tool with ${SDD} and follow it to the end. Within it:`,
  '   - implementer for each task: Agent tool, subagent_type "haiku-coder" (Haiku 5.5; it works test-first with mattpocock-skills:tdd), one task per dispatch, never the whole request in one;',
  '   - task review after each task: Agent tool, subagent_type "sonnet-reviewer" (Sonnet 5.5); fix loop until it approves;',
  '   - final whole-change review: subagent_type "sonnet-reviewer".',
  '5. Report what each task changed and each review verdict.',
  'Questions, explanations and reading files need no workflow.',
]
const NL = String.fromCharCode(10)
// auto: size the process to the change; the full SDD run only pays off on multi-file work
const AUTO = [
  '# Subagent mode: auto',
  'If you are a subagent, ignore this section.',
  BUGS,
  'For a request that changes code or files, first size it, then use the matching path:',
  '- small (one file, a few lines, no new behaviour): one Agent dispatch, subagent_type "haiku-coder", with the exact change; no review. A one-line fix you may make yourself.',
  '- medium (one feature, one to three files): one "haiku-coder" dispatch with a precise brief, then one "sonnet-reviewer" review of the result; fix once if it finds a real problem.',
  `- large (several files or steps, new structure): mattpocock-skills:grilling if the request is unclear, then superpowers:writing-plans, then ${'superpowers:subagent-driven-development'} with "haiku-coder" implementers and "sonnet-reviewer" reviews.`,
  GRILL_FORM,
  'Say which size you chose in one line before you start.',
  'Questions, explanations and reading files need no subagent.',
]
const SECTION: Record<Exclude<Mode, 'off'>, string> = {
  auto: AUTO.join(String.fromCharCode(10)),
  soft: ['# Subagent mode: soft', ...WORKFLOW, 'A one-line fix you may make yourself.'].join(NL),
  strict: [
    '# Subagent mode: strict',
    ...WORKFLOW,
    'Enforced: Edit, Write and NotebookEdit are blocked for you, and haiku-coder dispatches are refused until you have invoked ' + SDD + '.',
  ].join(NL),
}

const MODE_LABEL: Record<Mode, string> = {
  off: '🤖 subagent OFF',
  auto: '⚡ subagent AUTO',
  soft: '🤖 subagent SOFT',
  strict: '🔒 subagent STRICT',
}


// "claude-haiku-5-5-20260901" → "haiku"
const family = (model: string) => /haiku|sonnet|opus|fable/.exec(model)?.[0] ?? model

async function cycleMode($: EngineInterface) {
  await setMode($, NEXT[await read($, mode)])
}

async function setMode($: EngineInterface, m: Mode) {
  await update($, mode, () => m)
  await $.store.set(STORE_KEY, m) // remembered across sessions
}

// called from the main module's session.start (an event takes one unmatched hook per module)
async function startSubagents($: EngineInterface) {
  await $.command.register({ name: 'subagent', description: 'Cycle subagent mode: off → soft → strict' })
  await $.command.register({ name: 'subagents', description: 'Open the live subagents pane' })
  const saved = await $.store.get(STORE_KEY)
  await setMode($, saved === 'auto' || saved === 'soft' || saved === 'strict' ? saved : 'off')
}

// called from the main module's turn.complete, for main-loop and subagent turns alike
async function trackTurn($: EngineInterface, e: { agentId?: string; isAborted: boolean; usage?: TurnUsage }) {
  const u = e.usage
  const total = u ? u.input_tokens + u.output_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : 0
  if (u) {
    const fam = family(u.model)
    const key = e.agentId ? fam : `main·${fam}`
    await update($, byModel, (m: Record<string, ModelTokens>) => ({ ...m, [key]: { total: (m[key]?.total ?? 0) + total } }))
  }
  // a subagent's turn ends its row, with or without usage (an interrupt reports none)
  if (e.agentId) {
    const id = e.agentId
    await update($, agents, list =>
      list.map(a => (a.id === id ? { ...a, status: e.isAborted ? ('aborted' as const) : ('done' as const), tokens: a.tokens + total } : a)),
    )
    const row = (await read($, agents)).find(a => a.id === id)
    if (row?.type === 'haiku-coder' && !e.isAborted) await update($, unreviewed, list => [...list, row.description])
  }
}

const registerSubagents = (on: Parameters<Register>[0]) => {
  on('command.run', { command: 'subagents' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Subagents' })
    return { text: 'Subagents pane opened.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const m = await read($, mode)
    if (m === 'off') return result
    return { sections: [...result.sections, { id: 'context-bar-plus:subagent', scope: 'session' as const, text: SECTION[m] }] }
  })

  // strict: the main loop may not edit; subagents (agentId set) still can
  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e) // subagents work freely
    if (e.tool === 'Agent' && e.subagent_type === 'sonnet-reviewer') await update($, unreviewed, () => [])
    if (e.tool === 'Skill' && e.skill.includes('subagent-driven-development')) {
      await update($, isSddActive, () => true)
      return next(e)
    }
    if ((await read($, mode)) !== 'strict') return next(e)
    if (EDIT_TOOLS.has(e.tool)) {
      return { deny: `Subagent mode is STRICT: you may not edit files. Invoke the Skill tool with ${SDD} (after superpowers:writing-plans if there is no plan) and let haiku-coder make this change.` }
    }
    if (e.tool === 'Agent' && !READ_ONLY_AGENTS.has(e.subagent_type ?? 'general-purpose') && !(await read($, isSddActive))) {
      return { deny: `Subagent mode is STRICT: for this request, invoke the Skill tool with ${SDD} first (after superpowers:writing-plans if there is no plan), then dispatch "haiku-coder" one task at a time as it says. Read-only agents (sonnet-reviewer, Explore) need no skill.` }
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    // no Opus subagents while a mode is on: SDD's final review and late fix rounds ask for "the most capable model";
    // Sonnet 5.5 costs half. Forks always inherit the parent and ignore the field.
    // haiku-coder is pinned to Haiku: SDD's model selection let the controller run it on Sonnet for a "judgment" task
    const isOn = (await read($, mode)) !== 'off'
    const isCapped = isOn && e.subagentType !== 'fork' && e.subagentType !== 'haiku-coder' && !/haiku/i.test(e.model ?? '')
    const model = isOn && e.subagentType === 'haiku-coder' ? 'haiku' : isCapped ? 'sonnet' : e.model
    const r = await next(model === e.model ? e : { ...e, model })
    if ('agentId' in r && r.agentId) {
      const row: AgentRow = {
        id: r.agentId,
        type: e.subagentType,
        description: e.description,
        model: family(r.model),
        status: 'running',
        tokens: 0,
        startedAt: await $.clock.now(),
      }
      await update($, agents, list => [...list, row].slice(-50))
      // first subagent of the session: show the pane beside the transcript
      if ((await read($, agents)).length === 1) void $.ui.open({ id: PANE, title: 'Subagents' })
    }
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, agents)
    const tokens = await read($, byModel)
    const m = await read($, mode)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 8)
    const icon = { running: '⏳', done: '✅', aborted: '⛔' } as const

    return (
      <Box flexDirection="column">
        <Text bold>{MODE_LABEL[m]}</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Tokens by model</Text>
          {Object.keys(tokens).length === 0 && <Text dimColor>none yet</Text>}
          {Object.entries(tokens).map(([fam, t]) => (
            <Text key={fam}>
              {fam.padEnd(8)} <Text bold>{fmt(t.total)}</Text>
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Subagents ({list.length})</Text>
          {list.length === 0 && <Text dimColor>No subagents yet.</Text>}
          {list.slice(-room).reverse().map(a => (
            <Box key={a.id} flexDirection="column">
              <Text>
                {icon[a.status]} <Text bold>{a.type}</Text> <Text dimColor>({a.model})</Text> {a.tokens > 0 ? fmt(a.tokens) : ''}
              </Text>
              <Text dimColor>   {a.description}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}

export const register: Register = on => {
  registerSubagents(on)

  on('command.run', { command: 'subagent' }, async $ => {
    await cycleMode($)
    await pushStatus($)
    return { text: `Subagent mode: ${await read($, mode)}` }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-bar-plus',
      description: 'Show or hide the context window breakdown above the prompt',
    })
    await startSubagents($)
    await pushStatus($)
    const started = await next(e)
    // usage reads before the session binds came back empty and left the band hidden until the first turn ended:
    // read after next(e), then retry for a few seconds until a reading lands
    await refresh($)
    for (const ms of [1000, 3000, 8000]) {
      $.clock.after(ms, async () => {
        if ((await read($, fill)) === null) await refresh($)
      })
    }
    $.clock.every(1000, async () => {
      const end = await read($, endsAt)
      if (end === null) return
      const left = Math.max(0, Math.ceil((end - (await $.clock.now())) / 1000))
      const prev = await read($, cache)
      if (typeof prev === 'number' && prev > CACHE_WARN_S && left <= CACHE_WARN_S && left > 0) {
        $.ui.toast(`⏱ prompt cache จะหมดใน ${left} วินาที: ส่งข้อความตอนนี้จะถูกกว่า`, { timeoutMs: 6000 })
      }
      await update($, cache, () => left)
      await pushStatus($)
      if (left === 0) await update($, endsAt, () => null) // cold: stop redrawing every second
    })
    return started
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await takeUsage($, e.rateLimits)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, isSddActive, () => false) // strict: each new request runs the skill again
    await update($, endsAt, () => null)
    await update($, cache, () => 'live' as const)
    await pushStatus($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await trackTurn($, e)
    if (e.agentId) {
      await pushStatus($)
      return next(e) // a subagent's turn: the main cache clock and fill are untouched
    }
    // soft/strict: the controller ended its turn with unreviewed haiku work; ask once (cleared first, so it never loops)
    const pending = await read($, unreviewed)
    if (pending.length > 0 && !e.isAborted && ['soft', 'strict'].includes(await read($, mode))) {
      await update($, unreviewed, () => [])
      void $.prompt.submit({ text: reviewPrompt(pending) })
    }
    const end = (await $.clock.now()) + TTL_MS
    await update($, endsAt, () => end)
    await update($, cache, () => TTL_MS / 1000)
    await pushStatus($)
    await refresh($)
    return next(e)
  })

  on('command.run', { command: 'context-bar-plus' }, async $ => {
    const wasHidden = await read($, isHidden)
    await update($, isHidden, () => !wasHidden)
    if (wasHidden) await refresh($)
    return { text: wasHidden ? 'Context bar shown.' : 'Context bar hidden.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const reading = await read($, fill)
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    // before the first reading: the same band, an empty bar and "waiting for the first reply"
    const f: Fill = reading ?? { cats: [], total: 0, window: 0, pct: 0, compactAt: null }
    const isWaiting = reading === null

    const m = await read($, mode)
    // only running agents, redrawn on spawn and finish (no per-second timer: that made the band flicker)
    const running = (await read($, agents)).filter(a => a.status === 'running')
    const tokensByModel = Object.entries(await read($, byModel)).sort((a, b) => b[1].total - a[1].total)
    const ls = await read($, limits)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // Svg exists on desktop/vscode/mobile (not terminal); there it gives real <title> tooltips
    const Svg = 'Svg' in els ? els.Svg : null
    // the box the band draws into (narrower than the viewport beside a docked pane)
    const width = Math.max(24, (e.props.bodyColumns ?? 80) - 2)
    const sum = f.cats.reduce((a, k) => a + k.tokens, 0) || 1
    const shown = f.cats.filter(k => k.tokens > 0)
    // ponytail: fixed 70/85 thresholds, make them options if they need tuning
    const tone = f.pct >= 85 ? 'red' : f.pct >= 70 ? 'yellow' : 'green'

    return (
      <Box flexDirection="column" width={width}>
        <Box width={width} flexWrap="wrap" justifyContent="space-between">
          <Box>
            <Text bold>◆ context</Text>
            <Text>  </Text>
            <Button
              key="subagent"
              variant={m === 'off' ? undefined : 'primary'}
              label={MODE_LABEL[m]}
              onPress={async () => {
                await cycleMode($)
                await pushStatus($)
              }}
            />
            <Text> </Text>
            <Button key="skill-usage" label="📊 usage" onPress={() => explainUsage($)} />
          </Box>
          {isWaiting ? (
            <Text dimColor>รอข้อมูลจากคำตอบแรก…</Text>
          ) : (
            <Box>
              <Text bold>{fmt(f.total)}</Text>
              <Text dimColor> of {fmt(f.window)}</Text>
              {f.compactAt !== null && <Text dimColor> · compacts at {fmt(f.compactAt)} </Text>}
              <Text color={tone} inverse bold> {Math.round(f.pct)}% </Text>
            </Box>
          )}
        </Box>
        {Svg ? (
          <Box key="bar" width={width}>
            <Svg
              source={barSvg(shown.map(k => ({ label: label(k.name), tokens: k.tokens })), sum, Math.round(width * PX_PER_CELL))}
              alt={shown.map(k => `${label(k.name)} ${fmt(k.tokens)}`).join(', ')}
              // interactive Svg sits in an iframe (300px by default): size it from the band's cells
              width={Math.round(width * PX_PER_CELL)}
              height={SVG_H}
              isInteractive
            />
          </Box>
        ) : (
        <Box flexDirection="column" width={width}>
        {/* colour blocks sized by flex, not by glyph count: a glyph's advance differs per surface */}
        <Box width={width} height={1} overflow="hidden">
          {shown.map((k, i) => (
            <Box
              key={k.name}
              hover={{ scope: `seg-${i}` }}
              flexGrow={Math.max(1, Math.round((k.tokens / sum) * 1000))}
              minWidth={1}
              height={1}
              backgroundColor={k.color}
            />
          ))}
        </Box>
        {/* one fixed line: each segment's label is hidden until the pointer is on that segment */}
        <Box width={width} height={1}>
          {shown.map((k, i) => (
            <Box key={`info-${k.name}`} display="none" hover={{ scope: `seg-${i}`, display: 'flex' }}>
              <Text color={k.color}>■ </Text>
              <Text dimColor>{SHORT[k.name.toLowerCase()] ?? k.name.toLowerCase()} </Text>
              <Text bold>{fmt(k.tokens)}</Text>
              <Text dimColor> · {((k.tokens / sum) * 100).toFixed(1)}%</Text>
            </Box>
          ))}
        </Box>
        </Box>
        )}
        {ls.length > 0 && (
          <Box width={width} flexWrap="wrap">
            {ls.map(l => {
              const filled = Math.max(0, Math.min(10, Math.round(l.percentUsed / 10)))
              const color = l.percentUsed >= 90 ? 'red' : l.percentUsed >= 70 ? 'yellow' : 'green'
              const when = l.resetLabel
              return (
                <Box key={`lim-${l.kind}`} marginRight={3}>
                  <Text dimColor>{LIMIT_LABEL[l.kind] ?? l.kind} </Text>
                  <Text color={color}>{'█'.repeat(filled)}</Text>
                  <Text dimColor>{'░'.repeat(10 - filled)}</Text>
                  <Text bold> {Math.round(l.percentUsed)}%</Text>
                  {when ? <Text dimColor> · รีเซ็ต {when}</Text> : null}
                </Box>
              )
            })}
          </Box>
        )}
        {tokensByModel.length > 0 && (
          <Box width={width} flexWrap="wrap">
            <Text dimColor>tokens </Text>
            {tokensByModel.map(([fam, t], i) => (
              <Text key={`tok-${fam}`}>
                {i > 0 ? <Text dimColor> · </Text> : null}
                <Text dimColor>{fam} </Text>
                <Text bold>{fmt(t.total)}</Text>
              </Text>
            ))}
          </Box>
        )}
        {running.length > 0 && (
          <Box width={width} flexDirection="column" marginTop={1}>
            {running.map(a => (
              <Box key={`run-${a.id}`} width={width}>
                <Text color="yellow">⏳ </Text>
                <Text bold>{a.type}</Text>
                <Text dimColor> ({a.model}) </Text>
                <Text wrap="truncate-end">{a.description}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
