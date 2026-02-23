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

export default function HomePage() {
  const [status, setStatus] = useState('pronto');
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [result, setResult] = useState<ProcessResult | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const audioPreviewUrl = useMemo(() => {
    if (!recordedBlob) {
      return '';
    }
    return URL.createObjectURL(recordedBlob);
  }, [recordedBlob]);

  async function startRecording() {
    try {
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
        setRecordedBlob(blob);
        setRecordedDurationMs(Date.now() - startedAtRef.current);
        setStatus('gravação finalizada');
        setIsRecording(false);

        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }

        streamRef.current?.getTracks().forEach((track) => track.stop());
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

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }

  async function saveAndProcess() {
    if (!recordedBlob) {
      return;
    }

    if (recordedDurationMs > MAX_RECORDING_MS) {
      setStatus('erro: áudio excede o limite máximo de 2 horas');
      return;
    }

    setStatus('salvando e processando...');

    try {
      const timestamp = Date.now();
      const filename = `recording-${timestamp}.webm`;
      const file = new File([recordedBlob], filename, {
        type: recordedBlob.type || 'audio/webm',
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

      const data = (await response.json()) as ProcessResult;
      setResult(data);
      setStatus('processamento concluído');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erro inesperado';
      setStatus(`erro: ${message}`);
    }
  }

  return (
    <main>
      <h1>Meeting Assistant</h1>
      <p>Grave, salve e processe reuniões com transcrição e resumo.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button type="button" onClick={startRecording} disabled={isRecording}>
          Iniciar gravação
        </button>
        <button type="button" onClick={stopRecording} disabled={!isRecording}>
          Parar gravação
        </button>
        <button type="button" onClick={saveAndProcess} disabled={!recordedBlob || isRecording}>
          Salvar e processar
        </button>
      </div>

      <p>Status: {status}</p>

      {audioPreviewUrl ? <audio controls src={audioPreviewUrl} /> : null}

      <h2>Resultado</h2>
      <p>Arquivo salvo: {result?.savedFileName ?? '-'}</p>
      <p>Idioma detectado: {result?.detectedLanguage ?? '-'}</p>

      <h3>Transcrição</h3>
      <pre>{result?.transcript ?? '-'}</pre>

      <h3>Resumo (idioma detectado)</h3>
      <pre>{result?.summaryInDetectedLanguage ?? '-'}</pre>

      <h3>Summary (English)</h3>
      <pre>{result?.summaryInEnglish ?? '-'}</pre>
    </main>
  );
}
