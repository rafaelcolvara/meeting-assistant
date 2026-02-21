export type AIProviderName = "openai" | "deepseek";
export interface AIProvider {
    transcribeAudio(filePath: string): Promise<string>;
    generateSummary(transcript: string, translate: boolean): Promise<string>;
}
export declare function buildSummaryPrompt(transcript: string, translate: boolean): string;
//# sourceMappingURL=types.d.ts.map