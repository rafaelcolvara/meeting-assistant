export function buildSummaryPrompt(transcript, translate) {
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
//# sourceMappingURL=types.js.map