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

function parseWsEventData(rawData: unknown): Record<string, unknown> {
  if (typeof rawData === 'string') {
    try {
      const parsed = JSON.parse(rawData);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      throw new Error('mensagem WebSocket inválida (JSON malformado)');
    }
  }

  if (rawData && typeof rawData === 'object') {
    return rawData as Record<string, unknown>;
  }

  throw new Error('mensagem WebSocket inválida (tipo inesperado)');
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

function MicIcon({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 14.4a3.6 3.6 0 0 0 3.6-3.6V6.6a3.6 3.6 0 1 0-7.2 0v4.2a3.6 3.6 0 0 0 3.6 3.6Zm-6-3.6a1 1 0 1 1 2 0 4 4 0 1 0 8 0 1 1 0 1 1 2 0 6.01 6.01 0 0 1-5 5.92V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.28a6.01 6.01 0 0 1-5-5.92Z"
        fill="currentColor"
      />
    </svg>
  );
}

function StopIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.1" fill="currentColor" />
    </svg>
  );
}

function DocIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill={color}
        d="M14 2H7a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V8l-6-6Zm0 2.4L17.6 8H14V4.4ZM8 12a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H9a1 1 0 0 1-1-1Zm1 3h6a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2Z"
      />
    </svg>
  );
}

export default function HomePage() {
  const [status, setStatus] = useState('pronto');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [currentRecordingMs, setCurrentRecordingMs] = useState(0);
  const [result, setResult] = useState<ProcessResult | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReadyResolverRef = useRef<((value: void | PromiseLike<void>) => void) | null>(null);
  const wsReadyPromiseRef = useRef<Promise<void> | null>(null);
  const wsResultResolverRef = useRef<((value: ProcessResult) => void) | null>(null);
  const wsResultRejectorRef = useRef<((reason?: unknown) => void) | null>(null);
  const wsResultPromiseRef = useRef<Promise<ProcessResult | null> | null>(null);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopResolverRef = useRef<((data: { durationMs: number }) => void) | null>(null);

  function buildAudioStreamWsUrl() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) {
      throw new Error('NEXT_PUBLIC_API_URL não definido.');
    }

    const normalized = apiUrl.replace(/\/$/, '');
    if (normalized.startsWith('https://')) {
      return `${normalized.replace('https://', 'wss://')}/ws/audio-stream`;
    }

    return `${normalized.replace('http://', 'ws://')}/ws/audio-stream`;
  }

  function cleanupSocket() {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    wsReadyPromiseRef.current = null;
    wsReadyResolverRef.current = null;
    wsResultResolverRef.current = null;
    wsResultRejectorRef.current = null;
  }

  function connectAudioSocket(mimeType: string) {
    const ws = new WebSocket(buildAudioStreamWsUrl());
    wsRef.current = ws;

    wsReadyPromiseRef.current = new Promise((resolve) => {
      wsReadyResolverRef.current = resolve;
    });

    const resultPromise = new Promise<ProcessResult>((resolve, reject) => {
      wsResultResolverRef.current = resolve;
      wsResultRejectorRef.current = reject;
    });

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'start', mimeType }));
      wsReadyResolverRef.current?.();
    });

    ws.addEventListener('message', (event) => {
      let payload: Record<string, unknown>;

      try {
        payload = parseWsEventData(event.data);
      } catch (error) {
        wsResultRejectorRef.current?.(
          error instanceof Error ? error : new Error('falha ao interpretar resposta do WebSocket'),
        );
        cleanupSocket();
        return;
      }

      const type = String(payload.type ?? '');

      if (type === 'result') {
        wsResultResolverRef.current?.(normalizeProcessResult(payload));
        cleanupSocket();
        return;
      }

      if (type === 'error') {
        wsResultRejectorRef.current?.(new Error(String(payload.error ?? 'falha ao processar áudio')));
        cleanupSocket();
      }
    });

    ws.addEventListener('close', () => {
      if (wsResultRejectorRef.current) {
        wsResultRejectorRef.current(new Error('conexão WebSocket encerrada antes da conclusão'));
      }
      cleanupSocket();
    });

    ws.addEventListener('error', () => {
      if (wsResultRejectorRef.current) {
        wsResultRejectorRef.current(new Error('erro na conexão WebSocket'));
      }
      cleanupSocket();
    });

    return resultPromise;
  }

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';

    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }

    return btoa(binary);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
      }
      cleanupSocket();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startRecording() {
    try {
      setRecordedDurationMs(0);
      setCurrentRecordingMs(0);
      setResult(null);
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(streamRef.current);
      recorderRef.current = mediaRecorder;
      const wsResultPromise = connectAudioSocket(mediaRecorder.mimeType || 'audio/webm');

      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          void (async () => {
            await wsReadyPromiseRef.current;
            const chunkBuffer = await event.data.arrayBuffer();
            const chunkBase64 = arrayBufferToBase64(chunkBuffer);

            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'chunk', chunkBase64 }));
            }
          })();
        }
      });

      mediaRecorder.addEventListener('stop', () => {
        const durationMs = Date.now() - startedAtRef.current;
        setRecordedDurationMs(durationMs);
        setStatus('gravação finalizada; aguardando processamento...');
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

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'finish', durationMs }));
        }

        if (stopResolverRef.current) {
          stopResolverRef.current({ durationMs });
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

      mediaRecorder.start(1000);
      setIsRecording(true);
      setStatus('gravando...');

      return wsResultPromise;
    } catch {
      setStatus('erro ao acessar microfone');
      return null;
    }
  }

  function stopRecording(): Promise<{ durationMs: number } | null> {
    if (recorderRef.current?.state !== 'recording') {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      stopResolverRef.current = resolve;
      recorderRef.current?.stop();
    });
  }

  async function finishAndProcess(durationMs: number, wsResultPromise: Promise<ProcessResult | null>) {
    if (durationMs > MAX_RECORDING_MS) {
      setStatus('erro: áudio excede o limite máximo de 2 horas');
      return;
    }

    setStatus('processando stream de áudio...');

    try {
      const payload = await wsResultPromise;
      if (!payload) {
        throw new Error('falha ao inicializar o stream de áudio');
      }
      setResult(payload);
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
      const wsResultPromise = startRecording();
      if (wsResultPromise) {
        wsResultPromiseRef.current = wsResultPromise;
      }
      return;
    }

    setIsProcessing(true);
    try {
      const recordingData = await stopRecording();
      if (!recordingData) {
        setStatus('erro: gravação não encontrada para envio');
        return;
      }

      if (!wsResultPromiseRef.current) {
        setStatus('erro: conexão de stream não inicializada');
        return;
      }

      await finishAndProcess(recordingData.durationMs, wsResultPromiseRef.current);
      wsResultPromiseRef.current = null;
    } finally {
      setIsProcessing(false);
    }
  }

  const primaryButtonLabel = isProcessing
    ? 'Processando...'
    : isRecording
      ? 'Finalizar'
      : 'Clique para gravar';

  const finishedWithContent = !isRecording && !isProcessing && Boolean(result);
  const centerMessage = isProcessing
    ? 'Processando...'
    : isRecording
      ? formatDuration(currentRecordingMs)
      : finishedWithContent
        ? 'Gravação concluída'
        : 'Clique para gravar';
  const headerStatus = isRecording ? 'REC' : isProcessing ? 'PROC' : finishedWithContent ? 'OK' : 'PRONTO';

  const effectiveDurationMs = isRecording ? currentRecordingMs : recordedDurationMs;
  const pulseClass = isRecording ? 'ring-pulse' : '';
  const topButtonColor = isProcessing ? '#e5d35d' : isRecording ? '#f71e1e' : '#2f72c7';
  const topButtonShadow = isProcessing
    ? '0 0 0 10px rgba(229, 211, 93, 0.32)'
    : isRecording
      ? '0 0 0 10px rgba(247, 30, 30, 0.22)'
      : '0 14px 22px rgba(47, 114, 199, 0.24)';

  const displayedTranscript =
    result?.transcript || 'A transcrição da reunião aparecerá aqui após a gravação...';
  const displayedSummaryPt =
    result?.summaryInDetectedLanguage || 'O resumo em português será gerado automaticamente...';
  const displayedSummaryEn = result?.summaryInEnglish || 'The English summary will be generated automatically...';
  const cardBodyStyle = {
    margin: 0,
    fontSize: 18,
    lineHeight: 1.45,
    color: '#0f1d39',
    whiteSpace: 'pre-wrap' as const,
  };

  return (
    <main className="meeting-app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-badge">
            <DocIcon color="#2f72c7" />
          </div>
          <strong>Meeting Assistant</strong>
        </div>
        <div className="session-pill">{headerStatus}</div>
      </header>

      <section className="hero">
        <button
          type="button"
          onClick={handleRecButtonClick}
          disabled={isProcessing}
          aria-label={primaryButtonLabel}
          className={`record-button ${pulseClass}`}
          style={{
            backgroundColor: topButtonColor,
            boxShadow: topButtonShadow,
            color: '#ffffff',
          }}
        >
          {isRecording ? <StopIcon /> : <MicIcon />}
        </button>

        <p className="hero-status" role="status" aria-live="polite">
          {centerMessage}
        </p>

        <div className="timer-row">
          {isRecording ? (
            <>
              <span className="eq-bars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </span>
              <span className="timer">{formatDuration(currentRecordingMs)}</span>
            </>
          ) : effectiveDurationMs > 0 ? (
            <span className="timer">Duração: {formatDuration(effectiveDurationMs)}</span>
          ) : (
            <span className="timer idle-label">Toque no botão para iniciar</span>
          )}
        </div>
      </section>

      <section className="result-grid">
        <article className="result-card">
          <header>
            <DocIcon color="#2f72c7" />
            <strong>TRANSCRIÇÃO</strong>
          </header>
          <div className="body">
            <p style={cardBodyStyle}>{displayedTranscript}</p>
          </div>
        </article>

        <article className="result-card">
          <header>
            <DocIcon color="#00aa7a" />
            <strong>RESUMO (PT)</strong>
          </header>
          <div className="body">
            <p style={cardBodyStyle}>{displayedSummaryPt}</p>
          </div>
        </article>

        <article className="result-card">
          <header>
            <DocIcon color="#e1be00" />
            <strong>SUMMARY (EN)</strong>
          </header>
          <div className="body">
            <p style={cardBodyStyle}>{displayedSummaryEn}</p>
          </div>
        </article>
      </section>

      <footer className="app-footer">
        <span>{status}</span>
      </footer>

      <style jsx>{`
        .meeting-app {
          min-height: 100vh;
          background: linear-gradient(180deg, #eef1f7 0%, #e5e9f1 100%);
          color: #121c34;
          display: flex;
          flex-direction: column;
          padding: 0 0 20px;
        }

        .topbar {
          height: 74px;
          border-bottom: 1px solid #c9d2df;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 min(9vw, 140px);
          background: rgba(255, 255, 255, 0.22);
          backdrop-filter: blur(7px);
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 34px;
        }

        .brand-badge {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: #d8e4f6;
          display: grid;
          place-items: center;
        }

        .session-pill {
          min-width: 66px;
          text-align: center;
          font-size: 13px;
          letter-spacing: 0.08em;
          font-weight: 800;
          color: #44516a;
          border: 1px solid #c4cedd;
          border-radius: 999px;
          padding: 8px 12px;
          background: #edf1f8;
        }

        .hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          margin-top: 40px;
          gap: 12px;
        }

        .record-button {
          width: 82px;
          height: 82px;
          border-radius: 999px;
          border: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 140ms ease, filter 180ms ease;
        }

        .record-button:hover {
          transform: translateY(-2px);
          filter: brightness(1.04);
        }

        .record-button:active {
          transform: translateY(0);
        }

        .record-button:disabled {
          cursor: progress;
          opacity: 0.95;
        }

        .ring-pulse {
          animation: recPulse 1.4s ease-in-out infinite;
        }

        @keyframes recPulse {
          0%,
          100% {
            box-shadow: 0 0 0 8px rgba(247, 30, 30, 0.26);
          }
          50% {
            box-shadow: 0 0 0 16px rgba(247, 30, 30, 0.08);
          }
        }

        .hero-status {
          margin: 0;
          font-size: 32px;
          font-weight: 600;
          min-height: 32px;
        }

        .timer-row {
          min-height: 28px;
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 22px;
          font-variant-numeric: tabular-nums;
        }

        .eq-bars {
          display: inline-flex;
          align-items: flex-end;
          gap: 4px;
          height: 16px;
        }

        .eq-bars span {
          display: block;
          width: 4px;
          background: #f21c1c;
          border-radius: 3px;
          animation: barBounce 0.85s ease-in-out infinite;
        }

        .eq-bars span:nth-child(1) {
          height: 10px;
          animation-delay: 0s;
        }
        .eq-bars span:nth-child(2) {
          height: 14px;
          animation-delay: 0.1s;
        }
        .eq-bars span:nth-child(3) {
          height: 7px;
          animation-delay: 0.2s;
        }
        .eq-bars span:nth-child(4) {
          height: 13px;
          animation-delay: 0.3s;
        }
        .eq-bars span:nth-child(5) {
          height: 9px;
          animation-delay: 0.4s;
        }

        @keyframes barBounce {
          0%,
          100% {
            transform: scaleY(0.4);
          }
          50% {
            transform: scaleY(1);
          }
        }

        .timer {
          color: #1c2a45;
          font-size: 22px;
        }

        .idle-label {
          color: #56617a;
          font-size: 16px;
        }

        .result-grid {
          margin: 36px auto 0;
          width: min(980px, calc(100% - 34px));
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 22px;
        }

        .result-card {
          border: 1px solid #b5c2d5;
          border-radius: 10px;
          overflow: hidden;
          background: #eef2f8;
          min-height: 228px;
        }

        .result-card header {
          min-height: 45px;
          background: #b3b8c2;
          color: #f8fafd;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 16px;
          font-size: 23px;
          letter-spacing: 0.01em;
        }

        .result-card .body {
          padding: 16px 18px 18px;
        }

        .app-footer {
          margin-top: auto;
          border-top: 1px solid #c9d2df;
          min-height: 48px;
          display: grid;
          place-items: center;
          color: #12213a;
          font-size: 14px;
          padding: 10px 20px 0;
          text-align: center;
        }

        @media (max-width: 980px) {
          .topbar {
            padding: 0 16px;
          }

          .brand {
            font-size: 20px;
          }

          .hero-status {
            font-size: 24px;
          }

          .timer {
            font-size: 18px;
          }

          .result-grid {
            grid-template-columns: 1fr;
            max-width: 620px;
          }
        }
      `}</style>
    </main>
  );
}
