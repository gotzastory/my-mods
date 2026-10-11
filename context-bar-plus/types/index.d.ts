export type Cat = { name: string; tokens: number; color: string; kind: string }
export type Fill = {
  cats: Cat[]
  total: number
  window: number
  pct: number
  compactAt: number | null
}
// seconds of prompt cache left; 'live' while a turn runs; null before the first turn
export type Cache = number | 'live' | null
export type Mode = 'off' | 'auto' | 'soft' | 'strict'
export type AgentRow = {
  id: string
  type: string
  description: string
  model: string
  status: 'running' | 'done' | 'aborted'
  tokens: number
  startedAt: number
}
// a subscription window as the engine reports it (five_hour, seven_day, or a gateway spend_limit)
// resetLabel is computed when the reading arrives, so drawing never reads the clock
export type Limit = { kind: string; percentUsed: number; resetsAt?: string; resetLabel?: string }
// every token of the model's turns, cache reads included
export type ModelTokens = { total: number }

declare module 'claude-code' {
  interface PluginState {
    'context-bar-plus': {
      fill: Fill | null
      isHidden: boolean
      cache: Cache
      endsAt: number | null
      mode: Mode
      isSddActive: boolean
      agents: AgentRow[]
      byModel: Record<string, ModelTokens>
      limits: Limit[]
      limitsWarned: string[]
      unreviewed: string[]
    }
  }
}
