// Emoji reactions on messages. The agent keeps one reaction per message (a
// new one replaces it); the user toggles any number. Stored with the
// session's metadata, since neither agent's transcript has room for them.
import type { Item, Reaction } from '../../shared/types.ts'
import { save, state, type SessionMeta } from './store.ts'
import type { ItemLog } from './transcript.ts'

export function nextReactions(list: Reaction[] = [], emoji: string, by: Reaction['by']): Reaction[] {
  if (by === 'agent') return [...list.filter((r) => r.by !== 'agent'), { emoji, by }]
  const has = list.some((r) => r.by === 'user' && r.emoji === emoji)
  return has ? list.filter((r) => !(r.by === 'user' && r.emoji === emoji)) : [...list, { emoji, by }]
}

// Returns false when the message is not there or can't take a reaction.
export function applyReaction(view: { id: string; meta: SessionMeta; log: ItemLog }, itemId: string, emoji: string, by: Reaction['by']): boolean {
  const item = view.log.get(itemId)
  if (!item || (item.kind !== 'user' && item.kind !== 'text')) return false
  const next = nextReactions(item.reactions, emoji.trim().slice(0, 16), by)
  view.meta.reactions = { ...view.meta.reactions, [itemId]: next }
  if (!next.length) delete view.meta.reactions[itemId]
  state.sessions[view.id] = { ...view.meta }
  save()
  view.log.upsert({ ...item, reactions: next.length ? next : undefined } as Item)
  return true
}

export function restoreReactions(view: { meta: SessionMeta; log: ItemLog }) {
  for (const [itemId, list] of Object.entries(view.meta.reactions ?? {})) {
    const it = view.log.get(itemId)
    if (it && (it.kind === 'user' || it.kind === 'text')) view.log.upsert({ ...it, reactions: list } as Item)
  }
}

export function lastUserMessageId(log: ItemLog): string | undefined {
  for (let i = log.items.length - 1; i >= 0; i--) if (log.items[i].kind === 'user') return log.items[i].id
  return undefined
}
