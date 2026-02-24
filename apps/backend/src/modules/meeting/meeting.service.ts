import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';
import { getAIProvider } from '../../ai/providerFactory';
import { PrismaService } from '../../prisma/prisma.service';

const mimeTypeToExtension: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.mp4',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/flac': '.flac',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
};

@Injectable()
export class MeetingService {
  constructor(private readonly prisma: PrismaService) {}

  async processAudio(file: { path: string; originalname: string; mimetype?: string }) {
    const sourcePath = file.path;

    if (!sourcePath || !existsSync(sourcePath)) {
      throw new InternalServerErrorException('Uploaded file could not be found.');
    }

    const originalExtension = extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype?.split(';')[0]?.trim().toLowerCase();
    const extensionFromMimeType = mimeType ? mimeTypeToExtension[mimeType] : undefined;
    const finalExtension = originalExtension || extensionFromMimeType || '.webm';

    const savedFileName = `audio-${Date.now()}${finalExtension}`;
    const filePath = join(process.cwd(), 'uploads', savedFileName);
    renameSync(sourcePath, filePath);

    try {
      const provider = getAIProvider();
      const transcription = await provider.transcribeAudio(filePath);
      const summaries = await provider.generateSummaries(
        transcription.transcript,
        transcription.detectedLanguage,
      );

      const meetingContext = await this.prisma.meetingContext.create({
        data: {
          originalFileName: file.originalname,
          savedFileName,
          mimeType,
          detectedLanguage: transcription.detectedLanguage,
          transcript: transcription.transcript,
          summaryInDetectedLanguage: summaries.summaryInDetectedLanguage,
          summaryInEnglish: summaries.summaryInEnglish,
        },
      });

      return {
        id: meetingContext.id,
        savedFileName,
        detectedLanguage: transcription.detectedLanguage,
        transcript: transcription.transcript,
        summaryInDetectedLanguage: summaries.summaryInDetectedLanguage,
        summaryInEnglish: summaries.summaryInEnglish,
      };
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown transcription error.';
      throw new InternalServerErrorException(`Failed to transcribe audio. ${details}`);
    } finally {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    }
  }
}
