import type { AIProvider } from "./types.js";
export declare class OpenAIProvider implements AIProvider {
    private client;
    private getClient;
    transcribeAudio(filePath: string): Promise<string>;
    generateSummary(transcript: string, translate: boolean): Promise<string>;
}
//# sourceMappingURL=openaiProvider.d.ts.map