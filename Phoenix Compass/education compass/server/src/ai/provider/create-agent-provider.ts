import type { AppConfig } from '../../config'
import { AgentProvider } from './agent-provider'
import { DeepSeekChatProvider } from './deepseek-chat-provider'
import { MockAgentProvider } from './mock-agent-provider'
import { OpenAIResponsesProvider } from './openai-responses-provider'

// Shared by the API process and the agent worker so both always run the same provider.
// OPENAI_REQUEST_TIMEOUT_MS / OPENAI_MAX_OUTPUT_TOKENS are the generic AI request limits.
export function createAgentProvider(config: AppConfig): AgentProvider {
  if (config.agentProvider === 'openai') {
    return new OpenAIResponsesProvider({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      moderationModel: config.openaiModerationModel,
      timeoutMs: config.openaiRequestTimeoutMs,
      maxOutputTokens: config.openaiMaxOutputTokens
    })
  }
  if (config.agentProvider === 'deepseek') {
    return new DeepSeekChatProvider({
      apiKey: config.deepseekApiKey,
      model: config.deepseekModel,
      timeoutMs: config.openaiRequestTimeoutMs,
      maxOutputTokens: config.openaiMaxOutputTokens
    })
  }
  return new MockAgentProvider()
}
