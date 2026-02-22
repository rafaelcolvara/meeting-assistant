import type { AIProvider } from "./types.js";
export declare class DeepSeekProvider implements AIProvider {
    private client;
    private getClient;
    transcribeAudio(_filePath: string): Promise<{
        transcript: string;
        detectedLanguage: string;
    }>;
    generateSummaries(transcript: string, detectedLanguage: string): Promise<{
        summaryInDetectedLanguage: string;
        summaryInEnglish: string;
    }>;
    private generateSingleSummary;
}
//# sourceMappingURL=deepseekProvider.d.ts.map