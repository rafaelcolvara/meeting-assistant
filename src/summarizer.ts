import { getAIProvider } from "./ai/providerFactory.js";

export async function generateSummary(
  transcript: string,
  translate: boolean
) {
  const provider = getAIProvider();
  return provider.generateSummary(transcript, translate);
}
