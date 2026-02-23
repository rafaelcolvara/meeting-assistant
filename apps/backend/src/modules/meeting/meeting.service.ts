import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';
import OpenAI from 'openai';
import fs from 'node:fs';

@Injectable()
export class MeetingService {
  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async processAudio(file: { path: string; originalname: string }) {
    const sourcePath = file.path;

    if (!sourcePath || !existsSync(sourcePath)) {
      throw new InternalServerErrorException('Uploaded file could not be found.');
    }

    const filename = `audio-${Date.now()}${extname(file.originalname) || '.webm'}`;
    const filePath = join(process.cwd(), 'uploads', filename);
    renameSync(sourcePath, filePath);

    try {
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'gpt-4o-transcribe',
      });

      return { transcription: transcription.text };
    } catch {
      throw new InternalServerErrorException('Failed to transcribe audio.');
    } finally {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    }
  }
}
