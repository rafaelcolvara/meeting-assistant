'use client';

import { useEffect, useRef, useState } from 'react';

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

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function RecIcon({
  isRecording,
  isProcessing,
}: {
  isRecording: boolean;
  isProcessing: boolean;
}) {
  if (isProcessing) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.35" />
        <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  if (isRecording) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7" fill="currentColor" />
    </svg>
  );
}

export default function HomePage() {
  const [status, setStatus] = useState('pronto');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [currentRecordingMs, setCurrentRecordingMs] = useState(0);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState('');
  const [result, setResult] = useState<ProcessResult | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopResolverRef = useRef<((data: { blob: Blob; durationMs: number }) => void) | null>(
    null,
  );

  useEffect(() => {
    if (!recordedBlob) {
      setAudioPreviewUrl('');
      return;
    }
    const previewUrl = URL.createObjectURL(recordedBlob);
    setAudioPreviewUrl(previewUrl);
    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [recordedBlob]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startRecording() {
    try {
      setRecordedBlob(null);
      setRecordedDurationMs(0);
      setCurrentRecordingMs(0);
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
        setCurrentRecordingMs(0);

        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (tickerRef.current) {
          clearInterval(tickerRef.current);
          tickerRef.current = null;
        }

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        if (stopResolverRef.current) {
          stopResolverRef.current({ blob, durationMs });
          stopResolverRef.current = null;
        }
      });

      startedAtRef.current = Date.now();
      tickerRef.current = setInterval(() => {
        setCurrentRecordingMs(Date.now() - startedAtRef.current);
      }, 1000);
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

  const primaryButtonLabel = isProcessing
    ? 'Processando...'
    : isRecording
      ? 'Finalizar e enviar'
      : 'REC';

  const effectiveDurationMs = isRecording ? currentRecordingMs : recordedDurationMs;

  return (
    <main
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at 20% 20%, #ffe6e6 0%, #f7f9fc 40%, #eef3f8 100%)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <section
        style={{
          width: 'min(900px, 100%)',
          backgroundColor: '#ffffff',
          color: '#0f172a',
          borderRadius: 16,
          boxShadow: '0 14px 30px rgba(19, 29, 46, 0.12)',
          border: '1px solid #e6ebf2',
          padding: 24,
        }}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: 30, color: '#0f172a' }}>Meeting Assistant</h1>
        <p style={{ margin: '0 0 16px', color: '#334155' }}>
          Grave sua reunião, finalize e envie automaticamente para transcrição e resumo.
        </p>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleRecButtonClick}
            disabled={isProcessing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: 0,
              borderRadius: 999,
              padding: '12px 18px',
              fontWeight: 700,
              fontSize: 15,
              color: '#fff',
              backgroundColor: isRecording ? '#b91c1c' : '#0f766e',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              opacity: isProcessing ? 0.8 : 1,
              transition: 'transform 120ms ease',
            }}
            aria-label={primaryButtonLabel}
          >
            <RecIcon isRecording={isRecording} isProcessing={isProcessing} />
            <span>{primaryButtonLabel}</span>
          </button>

          <div style={{ color: '#334155', fontWeight: 600 }}>
            Duração: <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDuration(effectiveDurationMs)}</span>
          </div>
        </div>

        <p
          role="status"
          aria-live="polite"
          style={{
            margin: '0 0 16px',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          Status: {status}
        </p>

        {audioPreviewUrl ? <audio controls src={audioPreviewUrl} style={{ width: '100%', marginBottom: 16 }} /> : null}

        <h2 style={{ marginTop: 0, color: '#0f172a' }}>Resultado</h2>

        <h3 style={{ color: '#0f172a' }}>Transcrição</h3>
        <pre style={{ backgroundColor: '#f8fafc', borderRadius: 8, padding: 12, whiteSpace: 'pre-wrap' }}>
          {result?.transcript ?? '-'}
        </pre>

        <h3 style={{ color: '#0f172a' }}>Resumo em português</h3>
        <pre style={{ backgroundColor: '#f8fafc', borderRadius: 8, padding: 12, whiteSpace: 'pre-wrap' }}>
          {result?.summaryInDetectedLanguage ?? '-'}
        </pre>

        <h3 style={{ color: '#0f172a' }}>Resumo em inglês</h3>
        <pre style={{ backgroundColor: '#f8fafc', borderRadius: 8, padding: 12, whiteSpace: 'pre-wrap' }}>
          {result?.summaryInEnglish ?? '-'}
        </pre>
      </section>
    </main>
  );
}
