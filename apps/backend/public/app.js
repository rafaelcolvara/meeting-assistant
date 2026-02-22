const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const saveBtn = document.getElementById("saveBtn");
const audioPlayer = document.getElementById("audioPlayer");
const statusEl = document.getElementById("status");

const savedFileNameEl = document.getElementById("savedFileName");
const detectedLanguageEl = document.getElementById("detectedLanguage");
const transcriptEl = document.getElementById("transcript");
const summaryDetectedEl = document.getElementById("summaryDetected");
const summaryEnglishEl = document.getElementById("summaryEnglish");
const MAX_RECORDING_MS = 2 * 60 * 60 * 1000;

let mediaRecorder;
let stream;
let audioChunks = [];
let recordedBlob;
let recordingStartedAt = 0;
let recordedDurationMs = 0;
let maxDurationTimer;

function nowFileTimestamp() {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(
    2,
    "0"
  )}${String(now.getSeconds()).padStart(2, "0")}`;

  return `${date}-${time}`;
}

function downloadBlob(blob, mimeType) {
  const extension = mimeType.includes("ogg") ? "ogg" : "webm";
  const fileName = `recording-${nowFileTimestamp()}.${extension}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setStatus(message) {
  statusEl.textContent = `Status: ${message}`;
}

async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";

  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

startBtn.addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", () => {
      const mimeType = mediaRecorder.mimeType || "audio/webm";
      recordedBlob = new Blob(audioChunks, { type: mimeType });
      recordedDurationMs = Date.now() - recordingStartedAt;
      audioPlayer.src = URL.createObjectURL(recordedBlob);
      saveBtn.disabled = false;
      setStatus("gravação finalizada");
      startBtn.disabled = false;
      stopBtn.disabled = true;

      if (maxDurationTimer) {
        clearTimeout(maxDurationTimer);
        maxDurationTimer = undefined;
      }

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    });

    recordingStartedAt = Date.now();
    mediaRecorder.start();
    maxDurationTimer = setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        setStatus("limite de 2 horas atingido; gravação parada automaticamente");
      }
    }, MAX_RECORDING_MS);

    startBtn.disabled = true;
    stopBtn.disabled = false;
    saveBtn.disabled = true;
    setStatus("gravando...");
  } catch (error) {
    setStatus("erro ao acessar microfone");
    console.error(error);
  }
});

stopBtn.addEventListener("click", () => {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    return;
  }

  mediaRecorder.stop();
});

saveBtn.addEventListener("click", async () => {
  if (!recordedBlob) {
    return;
  }

  if (recordedDurationMs > MAX_RECORDING_MS) {
    setStatus("erro: áudio excede o limite máximo de 2 horas");
    return;
  }

  try {
    setStatus("salvando e processando...");
    saveBtn.disabled = true;

    const mimeType = recordedBlob.type || "audio/webm";
    downloadBlob(recordedBlob, mimeType);

    const audioBase64 = await blobToBase64(recordedBlob);
    const response = await fetch("/api/process-audio", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        audioBase64,
        mimeType,
        durationMs: recordedDurationMs,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Falha ao processar áudio.");
    }

    savedFileNameEl.textContent = payload.savedFileName;
    detectedLanguageEl.textContent = payload.detectedLanguage;
    transcriptEl.textContent = payload.transcript;
    summaryDetectedEl.textContent = payload.summaryInDetectedLanguage;
    summaryEnglishEl.textContent = payload.summaryInEnglish;

    setStatus("processamento concluído");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado";
    setStatus(`erro: ${message}`);
  } finally {
    saveBtn.disabled = false;
  }
});
