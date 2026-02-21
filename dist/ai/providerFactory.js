import { DeepSeekProvider } from "./deepseekProvider.js";
import { OpenAIProvider } from "./openaiProvider.js";
let cachedProvider;
function resolveProviderName() {
    const raw = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
    if (raw === "openai" || raw === "deepseek") {
        return raw;
    }
    throw new Error(`Invalid AI_PROVIDER "${raw}". Supported values: "openai", "deepseek".`);
}
export function getAIProvider() {
    if (!cachedProvider) {
        const providerName = resolveProviderName();
        cachedProvider =
            providerName === "deepseek" ? new DeepSeekProvider() : new OpenAIProvider();
    }
    return cachedProvider;
}
//# sourceMappingURL=providerFactory.js.map