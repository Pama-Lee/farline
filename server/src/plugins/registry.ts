// What enabled plugins have registered. Kept free of other imports so the
// session code can read providers and emit hooks without a cycle.
import type { ChannelDefinition, Disposable, HookName, HookPayloads, ProviderDefinition } from './types.ts'

interface Owned<T> {
  owner: string
  def: T
}

const providers = new Map<string, Owned<ProviderDefinition>>()
const channels = new Set<Owned<ChannelDefinition>>()
const hooks = new Map<HookName, Set<Owned<(payload: any) => unknown>>>()

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
