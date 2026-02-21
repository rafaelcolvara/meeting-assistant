export type AIProviderName = "openai" | "deepseek";

export interface AIProvider {
  transcribeAudio(filePath: string): Promise<string>;
  generateSummary(transcript: string, translate: boolean): Promise<string>;
}

export function buildSummaryPrompt(transcript: string, translate: boolean) {
  return `
You are a senior technical meeting analyst.

Analyze the following meeting transcript and generate:

1. Executive Summary
2. Key Decisions
3. Action Items
4. Risks
5. Strategic Insights

Transcript:
${transcript}

${translate ? "Translate the final output to Portuguese." : ""}
`;
}
