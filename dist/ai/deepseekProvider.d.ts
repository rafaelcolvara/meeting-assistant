import type { AIProvider } from "./types.js";
export declare class DeepSeekProvider implements AIProvider {
    private client;
    private getClient;
    transcribeAudio(_filePath: string): Promise<string>;
    generateSummary(transcript: string, translate: boolean): Promise<string>;
}
//# sourceMappingURL=deepseekProvider.d.ts.map