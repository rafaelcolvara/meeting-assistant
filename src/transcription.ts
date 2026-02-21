import { getAIProvider } from "./ai/providerFactory.js";

export async function transcribeAudio(filePath: string) {
  const provider = getAIProvider();
  return provider.transcribeAudio(filePath);
}
