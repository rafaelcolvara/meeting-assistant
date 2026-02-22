import dotenv from "dotenv";
dotenv.config();
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSummaries } from "./summarizer.js";
import { transcribeAudio } from "./transcription.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const audioDir = path.join(projectRoot, "audio");
const port = Number(process.env.PORT ?? 3000);
const MAX_RECORDING_MS = 2 * 60 * 60 * 1000;
function getTimestampFileName() {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
    return `${date}-${time}`;
}
function extensionFromMimeType(mimeType) {
    if (!mimeType) {
        return "webm";
    }
    if (mimeType.includes("webm")) {
        return "webm";
    }
    if (mimeType.includes("ogg")) {
        return "ogg";
    }
    if (mimeType.includes("mp4")) {
        return "mp4";
    }
    if (mimeType.includes("mpeg")) {
        return "mp3";
    }
    if (mimeType.includes("wav")) {
        return "wav";
    }
    return "webm";
}
async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) {
        return {};
    }
    return JSON.parse(raw);
}
function sendJson(res, statusCode, body) {
    res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
}
async function serveStatic(res, relativePath, contentType) {
    const filePath = path.join(publicDir, relativePath);
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": contentType });
    res.end(data);
}
async function handleProcessAudio(req, res) {
    try {
        const payload = await readJsonBody(req);
        if (!payload.audioBase64) {
            sendJson(res, 400, { error: "Missing audioBase64 in request body." });
            return;
        }
        if (typeof payload.durationMs === "number" && payload.durationMs > MAX_RECORDING_MS) {
            sendJson(res, 400, { error: "Audio duration exceeds the 2-hour maximum limit." });
            return;
        }
        await mkdir(audioDir, { recursive: true });
        const extension = extensionFromMimeType(payload.mimeType);
        const timestamp = getTimestampFileName();
        const fileName = `recording-${timestamp}.${extension}`;
        const outputPath = path.join(audioDir, fileName);
        const audioBuffer = Buffer.from(payload.audioBase64, "base64");
        await writeFile(outputPath, audioBuffer);
        const transcription = await transcribeAudio(outputPath);
        const summaries = await generateSummaries(transcription.transcript, transcription.detectedLanguage);
        sendJson(res, 200, {
            savedFileName: fileName,
            detectedLanguage: transcription.detectedLanguage,
            transcript: transcription.transcript,
            summaryInDetectedLanguage: summaries.summaryInDetectedLanguage,
            summaryInEnglish: summaries.summaryInEnglish,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        sendJson(res, 500, { error: message });
    }
}
const server = createServer(async (req, res) => {
    if (!req.url || !req.method) {
        sendJson(res, 400, { error: "Invalid request." });
        return;
    }
    if (req.method === "GET" && req.url === "/") {
        await serveStatic(res, "index.html", "text/html; charset=utf-8");
        return;
    }
    if (req.method === "GET" && req.url === "/app.js") {
        await serveStatic(res, "app.js", "application/javascript; charset=utf-8");
        return;
    }
    if (req.method === "GET" && req.url === "/styles.css") {
        await serveStatic(res, "styles.css", "text/css; charset=utf-8");
        return;
    }
    if (req.method === "POST" && req.url === "/api/process-audio") {
        await handleProcessAudio(req, res);
        return;
    }
    sendJson(res, 404, { error: "Route not found." });
});
server.listen(port, () => {
    console.log(`Meeting Assistant running on http://localhost:${port}`);
});
//# sourceMappingURL=index.js.map