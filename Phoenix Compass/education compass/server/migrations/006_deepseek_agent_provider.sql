-- Allow DeepSeek as an Agent provider for agent runs.
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_provider_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_provider_check
  CHECK (provider IN ('openai', 'mock', 'deepseek'));
