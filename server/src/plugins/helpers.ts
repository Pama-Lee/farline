import type { AnthropicCompatibleOptions } from './types.ts'

export function anthropicCompatible(o: AnthropicCompatibleOptions): Record<string, string> {
  const small = o.smallModel ?? o.model
  return {
    ANTHROPIC_BASE_URL: o.baseUrl,
    ANTHROPIC_AUTH_TOKEN: o.token,
    ANTHROPIC_MODEL: o.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: o.model,
    // Claude Code's auto-mode classifier runs on the sonnet slot (checked in
    // 2.1.299: CLAUDE_CODE_AUTO_MODE_MODEL is not consulted).
    ANTHROPIC_DEFAULT_SONNET_MODEL: o.classifierModel ?? small,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: small,
    ANTHROPIC_SMALL_FAST_MODEL: small,
    CLAUDE_CODE_SUBAGENT_MODEL: o.model,
    // No Anthropic server-side classifier behind these APIs; classify locally
    // from the first call instead of probing.
    CLAUDE_CODE_AUTO_MODE_SERVER: '0',
    ...(o.contextWindow
      ? { CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(o.contextWindow), CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(o.contextWindow) }
      : {}),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    API_TIMEOUT_MS: '600000',
  }
}
