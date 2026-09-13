import OpenAI from 'openai';

/** Secret-backed official SDK client; constructed only inside the bound send callable runtime. */
export function createOpenAIClient(readRuntimeSecret: () => string): OpenAI {
  return new OpenAI({ apiKey: readRuntimeSecret(), maxRetries: 0, timeout: 90_000 });
}
