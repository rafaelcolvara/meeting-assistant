import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAIProvider } from '../../ai/providerFactory';
import { ProcessAudioDto } from './dto-process-audio';

const MAX_RECORDING_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class MeetingService {
  private readonly audioDir = join(process.cwd(), 'audio');

  async processAudio(payload: ProcessAudioDto) {
    if (typeof payload.durationMs === 'number' && payload.durationMs > MAX_RECORDING_MS) {
      throw new BadRequestException('Audio duration exceeds the 2-hour maximum limit.');
    }

    await mkdir(this.audioDir, { recursive: true });

    const extension = this.extensionFromMimeType(payload.mimeType);
    const fileName = `recording-${this.getTimestamp()}.${extension}`;
    const outputPath = join(this.audioDir, fileName);
    const audioBuffer = Buffer.from(payload.audioBase64, 'base64');

    await writeFile(outputPath, audioBuffer);

    const provider = getAIProvider();
    const transcription = await provider.transcribeAudio(outputPath);
    const summaries = await provider.generateSummaries(
      transcription.transcript,
      transcription.detectedLanguage,
    );

    return {
      savedFileName: fileName,
      detectedLanguage: transcription.detectedLanguage,
      transcript: transcription.transcript,
      summaryInDetectedLanguage: summaries.summaryInDetectedLanguage,
      summaryInEnglish: summaries.summaryInEnglish,
    };
  }

  private getTimestamp() {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(
      2,
      '0',
    )}${String(now.getSeconds()).padStart(2, '0')}`;

    return `${date}-${time}`;
  }

  private extensionFromMimeType(mimeType?: string) {
    if (!mimeType) {
      return 'webm';
    }

    if (mimeType.includes('webm')) {
      return 'webm';
    }

    if (mimeType.includes('ogg')) {
      return 'ogg';
    }

    if (mimeType.includes('mp4')) {
      return 'mp4';
    }

    if (mimeType.includes('mpeg')) {
      return 'mp3';
    }

    if (mimeType.includes('wav')) {
      return 'wav';
    }

    return 'webm';
  }
}
