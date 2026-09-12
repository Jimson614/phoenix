import { AgentContentCrypto, agentMessageAad, agentRunRequestAad } from '../ai/crypto'
import { AgentMessageSafetyState, AgentRun, AgentWorkerHeartbeat } from '../domain/model'
import {
  AgentRepository,
  ClaimAgentRunsInput
} from '../store/agent-repository'
import { Clock, IdFactory, iso, randomId, systemClock } from '../utils/runtime'

export interface AgentRunExecutionInput<TRequest = unknown> {
  run: AgentRun
  request: TRequest
  signal: AbortSignal
}

export interface AgentRunExecutionResult<TReply = unknown> {
  reply: TReply
  safetyState?: AgentMessageSafetyState
  terminalStatus?: 'SUCCEEDED' | 'BLOCKED'
  errorCode?: string
  inputTokens?: number
  outputTokens?: number
}

export interface AgentRunExecutor<TRequest = unknown, TReply = unknown> {
  execute(input: AgentRunExecutionInput<TRequest>): Promise<AgentRunExecutionResult<TReply>>
}

export class AgentExecutionError extends Error {
  constructor(readonly code: string, message = 'Agent execution failed') {
    super(message)
    this.name = 'AgentExecutionError'
  }
}

export interface AgentWorkerOptions {
  workerId: string
  buildVersion: string
  batchSize: number
  leaseMs: number
  intervalMs: number
  heartbeatTtlMs?: number
}

export interface AgentWorkerRunResult {
  claimed: number
  succeeded: number
  blocked: number
  failed: number
  stale: number
}

function boundedInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} is invalid`)
  return value
}

function stableErrorCode(error: unknown): string {
  const candidate = error instanceof AgentExecutionError ? error.code : 'AGENT_EXECUTION_FAILED'
  return /^[A-Z0-9_:-]{3,100}$/.test(candidate) ? candidate : 'AGENT_EXECUTION_FAILED'
}

function tokenCount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined
}

export class AgentWorker<TRequest = unknown, TReply = unknown> {
  private readonly heartbeatTtlMs: number
  private readonly controller = new AbortController()
  private startedAt: string | null = null
  private stopping = false
  private running = false

  constructor(
    private readonly repository: AgentRepository,
    private readonly crypto: AgentContentCrypto,
    private readonly executor: AgentRunExecutor<TRequest, TReply>,
    private readonly options: AgentWorkerOptions,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId
  ) {
    if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(options.workerId)) throw new Error('Agent worker ID is invalid')
    if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(options.buildVersion)) throw new Error('Agent worker build version is invalid')
    boundedInteger(options.batchSize, 1, 100, 'Agent worker batch size')
    boundedInteger(options.leaseMs, 1_000, 3_600_000, 'Agent worker lease')
    boundedInteger(options.intervalMs, 100, 3_600_000, 'Agent worker interval')
    this.heartbeatTtlMs = boundedInteger(options.heartbeatTtlMs ?? Math.max(options.leaseMs * 2, 60_000), 1_000, 86_400_000, 'Agent heartbeat TTL')
  }

  async runOnce(): Promise<AgentWorkerRunResult> {
    if (this.running) throw new Error('Agent worker runOnce is already running')
    if (this.stopping) return { claimed: 0, succeeded: 0, blocked: 0, failed: 0, stale: 0 }
    this.running = true
    const now = iso(this.clock)
    this.startedAt ??= now
    try {
      await this.heartbeat('HEALTHY', 0, null, now)
      const claimInput: ClaimAgentRunsInput = {
        workerId: this.options.workerId,
        batchSize: this.options.batchSize,
        leaseMs: this.options.leaseMs,
        now
      }
      const runs = await this.repository.claimRuns(claimInput)
      await this.heartbeat('HEALTHY', runs.length, null)
      const outcomes = await Promise.all(runs.map((run) => this.processRun(run)))
      const result: AgentWorkerRunResult = {
        claimed: runs.length,
        succeeded: outcomes.filter((outcome) => outcome === 'succeeded').length,
        blocked: outcomes.filter((outcome) => outcome === 'blocked').length,
        failed: outcomes.filter((outcome) => outcome === 'failed').length,
        stale: outcomes.filter((outcome) => outcome === 'stale').length
      }
      await this.heartbeat('HEALTHY', 0, null)
      return result
    } catch (error) {
      await this.heartbeat('ERROR', 0, stableErrorCode(error)).catch(() => undefined)
      throw error
    } finally {
      this.running = false
    }
  }

  async runForever(signal?: AbortSignal): Promise<void> {
    const onAbort = (): void => this.stop()
    signal?.addEventListener('abort', onAbort, { once: true })
    this.startedAt ??= iso(this.clock)
    await this.heartbeat('STARTING', 0, null)
    try {
      while (!this.stopping) {
        await this.runOnce()
        if (!this.stopping) await this.waitForNextRun()
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      await this.heartbeat('STOPPING', 0, null).catch(() => undefined)
      await this.repository.releaseWorkerLeases(this.options.workerId).catch(() => undefined)
      await this.heartbeat('STOPPED', 0, null).catch(() => undefined)
    }
  }

  stop(): void {
    if (this.stopping) return
    this.stopping = true
    this.controller.abort(new Error('Agent worker is stopping'))
  }

  private async processRun(run: AgentRun): Promise<'succeeded' | 'blocked' | 'failed' | 'stale'> {
    if (!run.requestEnvelope || !run.leaseToken) return 'stale'
    const runController = new AbortController()
    const abortRun = (): void => runController.abort(this.controller.signal.reason)
    this.controller.signal.addEventListener('abort', abortRun, { once: true })
    let renewing = false
    const renewalTimer = setInterval(() => {
      if (renewing || runController.signal.aborted) return
      renewing = true
      void this.repository.renewLease(
        run.id, run.leaseToken ?? '', run.fenceVersion, this.options.leaseMs
      ).then((renewed) => {
        if (!renewed) runController.abort(new Error('Agent run lease was lost'))
      }).catch(() => runController.abort(new Error('Agent run lease renewal failed')))
        .finally(() => { renewing = false })
    }, Math.max(500, Math.floor(this.options.leaseMs / 3)))
    renewalTimer.unref()

    try {
      const request = this.crypto.decryptJson<TRequest>(run.requestEnvelope, agentRunRequestAad({
        runId: run.id, conversationId: run.conversationId, promptVersion: run.promptVersion
      }))
      const result = await this.executor.execute({ run, request, signal: runController.signal })
      if (this.stopping || runController.signal.aborted) return 'stale'
      const assistantMessageId = this.ids('amsg')
      const contentEnvelope = this.crypto.encryptJson(result.reply, agentMessageAad({
        messageId: assistantMessageId, conversationId: run.conversationId,
        role: 'ASSISTANT', contentVersion: run.promptVersion
      }))
      const inputTokens = tokenCount(result.inputTokens)
      const outputTokens = tokenCount(result.outputTokens)
      const completed = await this.repository.completeRun({
        runId: run.id,
        leaseToken: run.leaseToken,
        fenceVersion: run.fenceVersion,
        assistantMessageId,
        contentEnvelope,
        safetyState: result.safetyState ?? 'ALLOWED',
        terminalStatus: result.terminalStatus ?? 'SUCCEEDED',
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {})
      })
      return completed ? (completed.status === 'BLOCKED' ? 'blocked' : 'succeeded') : 'stale'
    } catch (error) {
      if (this.stopping) return 'stale'
      const failed = await this.repository.failRun({
        runId: run.id,
        leaseToken: run.leaseToken,
        fenceVersion: run.fenceVersion,
        errorCode: stableErrorCode(error),
        retryable: false,
        maxAttempts: 1
      })
      return failed ? 'failed' : 'stale'
    } finally {
      clearInterval(renewalTimer)
      this.controller.signal.removeEventListener('abort', abortRun)
    }
  }

  private async heartbeat(
    status: AgentWorkerHeartbeat['status'],
    activeRuns: number,
    lastErrorCode: string | null,
    now = iso(this.clock)
  ): Promise<void> {
    this.startedAt ??= now
    await this.repository.upsertHeartbeat({
      id: this.options.workerId,
      buildVersion: this.options.buildVersion,
      status,
      activeRuns,
      lastErrorCode,
      startedAt: this.startedAt,
      lastSeenAt: now,
      expiresAt: new Date(Date.parse(now) + this.heartbeatTtlMs).toISOString()
    })
  }

  private async waitForNextRun(): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false
      let timer: NodeJS.Timeout
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.controller.signal.removeEventListener('abort', finish)
        resolve()
      }
      timer = setTimeout(finish, this.options.intervalMs)
      this.controller.signal.addEventListener('abort', finish, { once: true })
    })
  }
}
