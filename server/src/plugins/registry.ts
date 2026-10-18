// What enabled plugins have registered. Kept free of other imports so the
// session code can read providers and emit hooks without a cycle.
import type { AgentToolDefinition, ChannelDefinition, Disposable, HookName, HookPayloads, ProviderDefinition } from './types.ts'

interface Owned<T> {
  owner: string
  def: T
}

const providers = new Map<string, Owned<ProviderDefinition>>()
const channels = new Set<Owned<ChannelDefinition>>()
const hooks = new Map<HookName, Set<Owned<(payload: any) => unknown>>>()

const tools = new Map<string, Owned<AgentToolDefinition>>()

export function addAgentTool(owner: string, def: AgentToolDefinition): Disposable {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(def.name) || tools.has(def.name)) throw new Error(`tool name "${def.name}" is not allowed or taken`)
  tools.set(def.name, { owner, def })
  return { dispose: () => void (tools.get(def.name)?.owner === owner && tools.delete(def.name)) }
}

export function allAgentTools(): AgentToolDefinition[] {
  return [...tools.values()].map((t) => t.def)
}

export function agentTool(name: string): AgentToolDefinition | undefined {
  return tools.get(name)?.def
}

// Tool names as the agents see them: farline_x (pi), mcp__farline__x (Claude Code).
export function agentToolFromCall(called: string): AgentToolDefinition | undefined {
  const m = called.match(/^(?:mcp__farline__|farline_)(.+)$/)
  return m ? agentTool(m[1]) : undefined
}

export function isHiddenTool(called: string) {
  return !!agentToolFromCall(called)?.hidden
}

export function agentInstructions(): string {
  return allAgentTools().map((t) => t.instructions).filter(Boolean).join('\n\n')
}

// Environment variables that hold plugin secrets; never passed to agents.
export const secretEnv = new Set<string>()

export function addProvider(owner: string, def: ProviderDefinition): Disposable {
  if (def.id === 'claude' || providers.has(def.id)) throw new Error(`provider id "${def.id}" is taken`)
  providers.set(def.id, { owner, def })
  return { dispose: () => void (providers.get(def.id)?.owner === owner && providers.delete(def.id)) }
}

export function provider(id: string): ProviderDefinition | undefined {
  return providers.get(id)?.def
}

export function providerOwner(id: string): string | undefined {
  return providers.get(id)?.owner
}

export function allProviders(): ProviderDefinition[] {
  return [...providers.values()].map((p) => p.def)
}

export function addChannel(owner: string, def: ChannelDefinition): Disposable {
  const entry = { owner, def }
  channels.add(entry)
  return { dispose: () => void channels.delete(entry) }
}

export function allChannels(owner?: string): ChannelDefinition[] {
  return [...channels].filter((c) => !owner || c.owner === owner).map((c) => c.def)
}

export function addHook<E extends HookName>(owner: string, event: E, fn: (payload: HookPayloads[E]) => unknown): Disposable {
  const set = hooks.get(event) ?? new Set()
  hooks.set(event, set)
  const entry = { owner, def: fn }
  set.add(entry)
  return { dispose: () => void set.delete(entry) }
}

// Hooks run after the fact and never hold up a session.
export function emit<E extends HookName>(event: E, payload: HookPayloads[E]) {
  for (const h of hooks.get(event) ?? []) {
    Promise.resolve()
      .then(() => h.def(payload))
      .catch((e) => console.error(`[plugin ${h.owner}] ${event} hook failed:`, e?.message ?? e))
  }
}
