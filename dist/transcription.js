import { getAIProvider } from "./ai/providerFactory.js";
export async function transcribeAudio(filePath) {
    const provider = getAIProvider();
    return provider.transcribeAudio(filePath);
}
//# sourceMappingURL=transcription.js.map