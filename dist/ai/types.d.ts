export type AIProviderName = "openai" | "deepseek";
export interface TranscriptionResult {
    transcript: string;
    detectedLanguage: string;
}
export interface SummariesResult {
    summaryInDetectedLanguage: string;
    summaryInEnglish: string;
}
export interface AIProvider {
    transcribeAudio(filePath: string): Promise<TranscriptionResult>;
    generateSummaries(transcript: string, detectedLanguage: string): Promise<SummariesResult>;
}
export declare function buildSummaryPrompt(transcript: string, detectedLanguage: string, targetLanguage: string): string;
//# sourceMappingURL=types.d.ts.map