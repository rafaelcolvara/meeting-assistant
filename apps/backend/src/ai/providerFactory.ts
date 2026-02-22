import { DeepSeekProvider } from './deepseekProvider';
import { OpenAIProvider } from './openaiProvider';
import type { AIProvider, AIProviderName } from './types';

let cachedProvider: AIProvider | undefined;

function resolveProviderName(): AIProviderName {
  const raw = (process.env.AI_PROVIDER ?? 'openai').toLowerCase();

  if (raw === 'openai' || raw === 'deepseek') {
    return raw;
  }

  throw new Error(`Invalid AI_PROVIDER "${raw}". Supported values: "openai", "deepseek".`);
}

export function getAIProvider(): AIProvider {
  if (!cachedProvider) {
    const providerName = resolveProviderName();
    cachedProvider = providerName === 'deepseek' ? new DeepSeekProvider() : new OpenAIProvider();
  }

  return cachedProvider;
}
