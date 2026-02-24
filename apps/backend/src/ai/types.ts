export type AIProviderName = 'openai' | 'deepseek';

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

export function isEnglishLanguage(detectedLanguage: string): boolean {
  const normalized = detectedLanguage.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (normalized === 'english') {
    return true;
  }

  const primaryCode = normalized.split(/[-_]/)[0];
  return primaryCode === 'en';
}

export function getTranslationTargetLanguage(detectedLanguage: string): 'Portuguese' | 'English' {
  return isEnglishLanguage(detectedLanguage) ? 'Portuguese' : 'English';
}

export function buildSummaryPrompt(
  transcript: string,
  detectedLanguage: string,
  targetLanguage: string,
) {
  return `
You are a senior technical meeting analyst.

The transcript language is: ${detectedLanguage}.
Create a complete meeting summary in ${targetLanguage}.

Generate the response with these sections:
1. Executive Summary
2. Key Decisions
3. Action Items
4. Risks
5. Strategic Insights

Transcript:
${transcript}
`;
}
