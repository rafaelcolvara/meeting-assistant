export function buildSummaryPrompt(transcript, detectedLanguage, targetLanguage) {
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
//# sourceMappingURL=types.js.map