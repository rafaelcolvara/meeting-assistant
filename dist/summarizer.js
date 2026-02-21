import { getAIProvider } from "./ai/providerFactory.js";
export async function generateSummary(transcript, translate) {
    const provider = getAIProvider();
    return provider.generateSummary(transcript, translate);
}
//# sourceMappingURL=summarizer.js.map