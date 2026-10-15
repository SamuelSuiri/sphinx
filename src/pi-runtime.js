import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { AssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';

const size = value => Buffer.byteLength(JSON.stringify(value));

/** Embed Pi's real AgentSession, with no ambient resources, tools or credentials. */
export async function runPiSession({ systemPrompt, prompt, tools, request, maxContextBytes, maxOutputTokens, signal, onCompaction, canCompact = () => true }) {
  signal.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'sphinx-reviewer-'));
  let session, fatal;
  const abort = () => { void session?.abort(); };
  try {
    const contextWindow = Math.max(256, Math.floor(maxContextBytes / 4));
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true, reserveTokens: Math.floor(contextWindow * 0.4), keepRecentTokens: Math.floor(contextWindow * 0.15) },
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
      cacheWarming: 'off', enableInstallTelemetry: false, enableAnalytics: false,
    });
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
      modelsPath: null, refreshOnCreate: false, allowModelNetwork: false, signal,
    });
    const fail = error => { fatal ??= error; return error; };
    // Pi uses this same provider entry for investigation AND built-in compaction.
    // The Sphinx transport accounts for each request before submitting it.
    const streamSimple = (model, context, options = {}) => {
      const stream = new AssistantMessageEventStream();
      const response = {
        role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: [], stopReason: 'stop', timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      void (async () => {
        try {
          if (fatal) throw fatal;
          signal.throwIfAborted();
          const result = await request({
            systemPrompt: getCurrentSystemPrompt(context.messages), tools: getCurrentTools(context.messages),
            messages: context.messages.filter(message => message.role !== 'system'),
            signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
          });
          signal.throwIfAborted();
          // Sphinx reserves the last charged request for assessment synthesis.
          // Disable Pi's automatic compaction before it checks the next boundary;
          // otherwise a summary can consume the request needed to finish.
          if (!canCompact()) settingsManager.setCompactionEnabled(false);
          response.content = result.content;
          response.stopReason = result.content.some(item => item.type === 'toolCall') ? 'toolUse' : 'stop';
          if (result.nativeMessage) response.sphinxNativeMessage = result.nativeMessage;
          // CLI transports do not expose reliable tokens. Conservative byte estimates
          // drive Pi compaction; these are never reported as billed usage.
          response.usage.input = Math.ceil(result.inputBytes / 4);
          response.usage.output = Math.ceil(size(result) / 4);
          response.usage.totalTokens = response.usage.input + response.usage.output;
          stream.push({ type: 'done', reason: response.stopReason, message: response });
        } catch (error) {
          fail(error);
          response.stopReason = signal.aborted ? 'aborted' : 'error';
          response.errorMessage = 'Sphinx stopped this review request.';
          stream.push({ type: 'error', reason: response.stopReason, error: response });
        } finally { stream.end(); }
      })();
      return stream;
    };
    const provider = 'sphinx-reviewer';
    modelRuntime.registerProvider(provider, {
      api: 'openai-completions', baseUrl: 'https://sphinx.invalid', apiKey: 'sphinx-managed-transport', streamSimple,
      models: [{ id: 'selected-route', name: 'Sphinx selected evaluator', reasoning: false, input: ['text'], contextWindow, maxTokens: maxOutputTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    });
    const resourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
      getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => systemPrompt,
      getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
      extendResources: () => {}, reload: async () => {},
    };
    ({ session } = await createAgentSession({
      cwd: directory, agentDir: directory, modelRuntime, model: modelRuntime.getModel(provider, 'selected-route'),
      thinkingLevel: 'off', resourceLoader, sessionManager: SessionManager.inMemory(directory), settingsManager,
      tools: tools.map(tool => tool.name), noTools: 'builtin',
      customTools: tools.map(tool => ({ ...tool, label: tool.name, execute: async (...args) => {
        if (fatal) throw fatal;
        try {
          const result = await tool.execute(...args);
          if (result.terminate) settingsManager.setCompactionEnabled(false);
          return result;
        } catch (error) { fail(error); settingsManager.setCompactionEnabled(false); throw error; }
      } })),
    }));
    session.agent.toolExecution = 'sequential';
    session.subscribe(event => {
      if (event.type === 'compaction_end' && event.result) onCompaction?.(event.result);
    });
    signal.addEventListener('abort', abort, { once: true });
    signal.throwIfAborted();
    await session.prompt(prompt);
    signal.throwIfAborted();
    if (fatal) throw fatal;
  } finally {
    signal.removeEventListener('abort', abort);
    session?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}
