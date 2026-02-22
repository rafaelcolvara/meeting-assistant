import { getAIProvider } from "./ai/providerFactory.js";
export async function generateSummaries(transcript, detectedLanguage) {
    const provider = getAIProvider();
    return provider.generateSummaries(transcript, detectedLanguage);
}
//# sourceMappingURL=summarizer.js.map