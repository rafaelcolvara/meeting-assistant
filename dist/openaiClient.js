import OpenAI from "openai";
let cachedClient;
export function getOpenAIClient() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error("Missing OPENAI_API_KEY. Set it in your environment or in a .env file.");
    }
    if (!cachedClient) {
        cachedClient = new OpenAI({ apiKey });
    }
    return cachedClient;
}
//# sourceMappingURL=openaiClient.js.map