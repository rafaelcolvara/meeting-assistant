import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';
import { getAIProvider } from '../../ai/providerFactory';

@Injectable()
export class MeetingService {
  async processAudio(file: { path: string; originalname: string }) {
    const sourcePath = file.path;

    if (!sourcePath || !existsSync(sourcePath)) {
      throw new InternalServerErrorException('Uploaded file could not be found.');
    }

    const savedFileName = `audio-${Date.now()}${extname(file.originalname) || '.webm'}`;
    const filePath = join(process.cwd(), 'uploads', savedFileName);
    renameSync(sourcePath, filePath);

    try {
      const provider = getAIProvider();
      const transcription = await provider.transcribeAudio(filePath);
      const summaries = await provider.generateSummaries(
        transcription.transcript,
        transcription.detectedLanguage,
      );

      return {
        savedFileName,
        detectedLanguage: transcription.detectedLanguage,
        transcript: transcription.transcript,
        summaryInDetectedLanguage: summaries.summaryInDetectedLanguage,
        summaryInEnglish: summaries.summaryInEnglish,
      };
    } catch {
      throw new InternalServerErrorException('Failed to transcribe audio.');
    } finally {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    }
  }
}
