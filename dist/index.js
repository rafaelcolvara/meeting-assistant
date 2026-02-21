import dotenv from "dotenv";
dotenv.config();
import { transcribeAudio } from "./transcription.js";
import { generateSummary } from "./summarizer.js";
async function main() {
    const filePath = "./audio/meeting.mp4";
    const translate = process.argv.includes("--translate");
    console.log("🔄 Transcribing audio...");
    const transcript = await transcribeAudio(filePath);
    console.log("🧠 Generating summary...");
    const summary = await generateSummary(transcript, translate);
    console.log("\n===== RESULT =====\n");
    console.log(summary);
}
main();
//# sourceMappingURL=index.js.map