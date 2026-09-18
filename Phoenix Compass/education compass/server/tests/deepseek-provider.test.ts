import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentProviderInput, AgentReplyDraft } from '../src/ai/provider/agent-provider'
import { createAgentProvider } from '../src/ai/provider/create-agent-provider'
import { DeepSeekChatProvider, DeepSeekFetch } from '../src/ai/provider/deepseek-chat-provider'
import { createOpenAISafetyIdentifier } from '../src/ai/provider/openai-responses-provider'
import { loadConfig } from '../src/config'
import { AppError } from '../src/domain/errors'

const safetyKey = 'deepseek-safety-hmac-key-is-dedicated-and-long-enough'
const draft: AgentReplyDraft = {
  answer: '从本次测评看，可以先围绕学习节奏做一次小调整。', keyPoints: ['只依据本次测评快照。'], nextSteps: ['本周试行一次复盘。'],
  limitations: ['不代表录取结果或专业诊断。'], sourceAliases: ['S1'],
  safety: { level: 'STANDARD', requiresGuardianAttention: false }
}
const input: AgentProviderInput = {
  taskType: 'ASSESSMENT_ANALYSIS',
  safetyIdentifier: createOpenAISafetyIdentifier('usr_deepseek_owner_0001', safetyKey),
  report: {
    dataAsOf: '2026-09-18', confidence: 'medium', disclaimer: '仅供参考',
    modules: [{ key: 'student_profile', title: '学生画像', summary: '方向待验证', items: [] }],
    sources: [{ alias: 'S1', applicableYear: '2026', verifiedAt: '2026-09-18T00:00:00.000Z', dataVersion: 'v1' }]
  },
  history: [], message: '请分析本次测评'
}

type Call = { url: string, headers: Record<string, string>, body: Record<string, any> }

function reply(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body
  }
}

function completion(content: string, finishReason = 'stop') {
  return { model: 'deepseek-chat', choices: [{ finish_reason: finishReason, message: { content } }], usage: { prompt_tokens: 11, completion_tokens: 22 } }
}

const isModeration = (call: Call) => String(call.body.messages[0].content).includes('内容安全分类器')

// Route generation vs moderation calls; each handler returns the fake HTTP response.
function fakeFetch(calls: Call[], handlers: { generate?: () => unknown, moderate?: () => unknown }): DeepSeekFetch {
  return async (url, init) => {
    const call: Call = { url, headers: init.headers, body: JSON.parse(init.body) }
    calls.push(call)
    const handler = isModeration(call) ? handlers.moderate : handlers.generate
    return (handler ? handler() : reply(completion(JSON.stringify({ flagged: false, categories: [] })))) as any
  }
}

function provider(fetch: DeepSeekFetch): DeepSeekChatProvider {
  return new DeepSeekChatProvider({
    apiKey: 'sk-test-deepseek', model: 'deepseek-chat', timeoutMs: 30_000, maxOutputTokens: 1200,
    fetch, sleep: async () => undefined, random: () => 0
  })
}

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => (error as { code?: string }).code === code)
}

test('DeepSeek provider sends a fixed-origin JSON-mode request and moderates the output', async () => {
  const calls: Call[] = []
  const result = await provider(fakeFetch(calls, { generate: () => reply(completion(JSON.stringify(draft))) }))
    .createReportFollowup(input)
  assert.equal(result.draft.answer, draft.answer)
  assert.equal(result.model, 'deepseek-chat')
  assert.deepEqual([result.inputTokens, result.outputTokens], [11, 22])

  assert.equal(calls.length, 2)
  const [generation, moderation] = calls as [Call, Call]
  assert.equal(generation.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(generation.headers.Authorization, 'Bearer sk-test-deepseek')
  assert.deepEqual(generation.body.response_format, { type: 'json_object' })
  assert.equal(generation.body.model, 'deepseek-chat')
  assert.equal(generation.body.max_tokens, 1200)
  assert.equal(generation.body.stream, false)
  assert.equal(generation.body.messages.length, 2)
  assert.match(generation.body.messages[0].content, /json/)
  assert.match(generation.body.messages[0].content, /只能取自：S1/)
  assert.equal(JSON.parse(generation.body.messages[1].content).guardianQuestion, '请分析本次测评')
  assert.equal(JSON.stringify(generation.body).includes('usr_deepseek_owner_0001'), false)
  assert.ok(isModeration(moderation))
  assert.equal(moderation.body.temperature, 0)
  assert.equal(JSON.parse(moderation.body.messages[1].content).text.includes(draft.answer), true)
})

test('DeepSeek moderation fails closed and flags guardian attention', async () => {
  const flagged = await provider(fakeFetch([], {
    moderate: () => reply(completion(JSON.stringify({ flagged: true, categories: ['self-harm'] })))
  })).moderate('测试文本')
  assert.deepEqual(flagged, { allowed: false, categories: ['self-harm'], requiresGuardianAttention: true })

  for (const verdict of [{ flagged: 'no', categories: [] }, { flagged: false, categories: ['unknown'] }, { categories: [] }]) {
    await rejectsWith(provider(fakeFetch([], { moderate: () => reply(completion(JSON.stringify(verdict))) }))
      .moderate('测试文本'), 'DEEPSEEK_MODERATION_INVALID')
  }
  await rejectsWith(provider(fakeFetch([], {
    generate: () => reply(completion(JSON.stringify(draft))),
    moderate: () => reply(completion(JSON.stringify({ flagged: true, categories: ['violence'] })))
  })).createReportFollowup(input), 'DEEPSEEK_OUTPUT_MODERATION_BLOCKED')
})

test('DeepSeek errors map to stable codes and only transient failures retry once', async () => {
  const cases: Array<{ code: string, attempts: number, generate: () => unknown }> = [
    { code: 'DEEPSEEK_RATE_LIMITED', attempts: 2, generate: () => reply({}, 429) },
    { code: 'DEEPSEEK_UPSTREAM_ERROR', attempts: 2, generate: () => reply({}, 503) },
    { code: 'DEEPSEEK_AUTH_ERROR', attempts: 1, generate: () => reply({}, 401) },
    { code: 'DEEPSEEK_INSUFFICIENT_BALANCE', attempts: 1, generate: () => reply({}, 402) },
    { code: 'DEEPSEEK_REQUEST_REJECTED', attempts: 1, generate: () => reply({}, 422) },
    { code: 'DEEPSEEK_INCOMPLETE', attempts: 1, generate: () => reply(completion('{"answer":', 'length')) },
    { code: 'DEEPSEEK_CONTENT_FILTERED', attempts: 1, generate: () => reply(completion('', 'content_filter')) },
    { code: 'DEEPSEEK_OUTPUT_EMPTY', attempts: 2, generate: () => reply(completion('   ')) },
    { code: 'DEEPSEEK_OUTPUT_JSON_INVALID', attempts: 1, generate: () => reply(completion('{bad')) },
    { code: 'DEEPSEEK_CONNECTION_ERROR', attempts: 2, generate: () => { throw new TypeError('fetch failed') } }
  ]
  for (const item of cases) {
    const calls: Call[] = []
    await rejectsWith(provider(fakeFetch(calls, { generate: item.generate })).createReportFollowup(input), item.code)
    assert.equal(calls.length, item.attempts, `${item.code} attempts`)
  }
  await assert.rejects(provider(fakeFetch([], {
    generate: () => reply(completion(JSON.stringify({ ...draft, extra: true })))
  })).createReportFollowup(input), (error: unknown) => error instanceof AppError && error.code === 'AGENT_OUTPUT_SCHEMA_INVALID')
})

test('AGENT_PROVIDER=deepseek requires an API key and builds the DeepSeek provider', () => {
  const base = {
    NODE_ENV: 'test',
    SESSION_SECRET: 'deepseek-config-session-secret-at-least-32-characters',
    DATABASE_URL: 'postgresql://test:test@db.internal/phoenix',
    OPENAI_AGENT_ENABLED: 'true',
    AGENT_PROVIDER: 'deepseek',
    OPENAI_SAFETY_HMAC_KEY: safetyKey,
    AI_CONTENT_KEYRING_JSON: JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }),
    AI_CONTENT_CURRENT_KEY_VERSION: 'v1'
  }
  assert.throws(() => loadConfig(base), (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID')
  assert.throws(() => loadConfig({ ...base, DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_MODEL: 'bad model!' }),
    (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID')
  assert.throws(() => loadConfig({ ...base, DEEPSEEK_API_KEY: 'sk-test', DATABASE_URL: '' }),
    (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID')
  const config = loadConfig({ ...base, DEEPSEEK_API_KEY: 'sk-test' })
  assert.equal(config.agentProvider, 'deepseek')
  assert.equal(config.deepseekModel, 'deepseek-chat')
  const built = createAgentProvider(config)
  assert.equal(built.name, 'deepseek')
  assert.equal(built.model, 'deepseek-chat')
  assert.equal(createAgentProvider({ ...config, agentProvider: 'mock' }).name, 'mock')
})
