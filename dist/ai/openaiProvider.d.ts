import type { AIProvider } from "./types.js";
export declare class OpenAIProvider implements AIProvider {
    private client;
    private getClient;
    transcribeAudio(filePath: string): Promise<{
        transcript: string;
        detectedLanguage: string;
    }>;
    generateSummaries(transcript: string, detectedLanguage: string): Promise<{
        summaryInDetectedLanguage: string;
        summaryInEnglish: string;
    }>;
    private generateSingleSummary;
    private extractTranscript;
    private extractLanguage;
    private detectLanguageFromTranscript;
}
//# sourceMappingURL=openaiProvider.d.ts.map