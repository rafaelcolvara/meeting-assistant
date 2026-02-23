'use client';

import { useMemo, useRef, useState } from 'react';

const MAX_RECORDING_MS = 2 * 60 * 60 * 1000;

type ProcessResult = {
  savedFileName: string;
  detectedLanguage: string;
  transcript: string;
  summaryInDetectedLanguage: string;
  summaryInEnglish: string;
};

function normalizeProcessResult(payload: unknown): ProcessResult {
  const data = (payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data: unknown }).data
    : payload) as Record<string, unknown>;

  return {
    savedFileName: String(data.savedFileName ?? ''),
    detectedLanguage: String(data.detectedLanguage ?? ''),
    transcript: String(data.transcript ?? data.transcription ?? ''),
    summaryInDetectedLanguage: String(data.summaryInDetectedLanguage ?? ''),
    summaryInEnglish: String(data.summaryInEnglish ?? ''),
  };
}

export default function HomePage() {
  const [status, setStatus] = useState('pronto');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [result, setResult] = useState<ProcessResult | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopResolverRef = useRef<((data: { blob: Blob; durationMs: number }) => void) | null>(
    null,
  );

  const audioPreviewUrl = useMemo(() => {
    if (!recordedBlob) {
      return '';
    }
    return URL.createObjectURL(recordedBlob);
  }, [recordedBlob]);

  async function startRecording() {
    try {
      setRecordedBlob(null);
      setRecordedDurationMs(0);
      setResult(null);
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];

      const mediaRecorder = new MediaRecorder(streamRef.current);
      recorderRef.current = mediaRecorder;

      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      mediaRecorder.addEventListener('stop', () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const durationMs = Date.now() - startedAtRef.current;
        setRecordedBlob(blob);
        setRecordedDurationMs(durationMs);
        setStatus('gravação finalizada');
        setIsRecording(false);
        recorderRef.current = null;

        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        if (stopResolverRef.current) {
          stopResolverRef.current({ blob, durationMs });
          stopResolverRef.current = null;
        }
      });

      startedAtRef.current = Date.now();
      timerRef.current = setTimeout(() => {
        if (recorderRef.current?.state === 'recording') {
          recorderRef.current.stop();
          setStatus('limite de 2 horas atingido; gravação parada automaticamente');
        }
      }, MAX_RECORDING_MS);

      mediaRecorder.start();
      setIsRecording(true);
      setStatus('gravando...');
    } catch {
      setStatus('erro ao acessar microfone');
    }
  }

  function stopRecording(): Promise<{ blob: Blob; durationMs: number } | null> {
    if (recorderRef.current?.state !== 'recording') {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      stopResolverRef.current = resolve;
      recorderRef.current?.stop();
    });
  }

  async function saveAndProcess(blob: Blob, durationMs: number) {
    if (!blob || blob.size === 0) {
      setStatus('erro: nenhum áudio gravado para envio');
      return;
    }

    if (durationMs > MAX_RECORDING_MS) {
      setStatus('erro: áudio excede o limite máximo de 2 horas');
      return;
    }

    setStatus('salvando e processando...');

    try {
      const timestamp = Date.now();
      const filename = `recording-${timestamp}.webm`;
      const file = new File([blob], filename, {
        type: blob.type || 'audio/webm',
      });

      const formData = new FormData();
      formData.append('audio', file);

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/process-audio`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`falha ao processar áudio (${response.status})`);
      }

      const payload = (await response.json()) as unknown;
      setResult(normalizeProcessResult(payload));
      setStatus('processamento concluído');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erro inesperado';
      setStatus(`erro: ${message}`);
    }
  }

  async function handleRecButtonClick() {
    if (isProcessing) {
      return;
    }

    if (!isRecording) {
      await startRecording();
      return;
    }

    setIsProcessing(true);
    try {
      const recordingData = await stopRecording();
      if (!recordingData) {
        setStatus('erro: gravação não encontrada para envio');
        return;
      }

      await saveAndProcess(recordingData.blob, recordingData.durationMs);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <main>
      <h1>Meeting Assistant</h1>
      <p>Grave, salve e processe reuniões com transcrição e resumo.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button type="button" onClick={handleRecButtonClick} disabled={isProcessing}>
          {isProcessing ? 'Processando...' : isRecording ? 'Finalizar e enviar' : 'REC'}
        </button>
      </div>

      <p>Status: {status}</p>

      {audioPreviewUrl ? <audio controls src={audioPreviewUrl} /> : null}

      <h2>Resultado</h2>

      <h3>Transcrição</h3>
      <pre>{result?.transcript ?? '-'}</pre>

      <h3>Resumo em português</h3>
      <pre>{result?.summaryInDetectedLanguage ?? '-'}</pre>

      <h3>Resumo em inglês</h3>
      <pre>{result?.summaryInEnglish ?? '-'}</pre>


    </main>
  );
}
