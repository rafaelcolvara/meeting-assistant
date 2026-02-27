import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import OpenAI from 'openai';
import { buildSummaryPrompt, getTranslationTargetLanguage } from './types';
import type { AIProvider } from './types';

type TranscriptionResponseFormat = 'verbose_json' | 'json' | 'text';
const execFileAsync = promisify(execFile);

export class OpenAIProvider implements AIProvider {
  private client: OpenAI | undefined;

  private getClient() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY. Set it in your environment or in a .env file.');
    }

    if (!this.client) {
      this.client = new OpenAI({ apiKey });
    }

    return this.client;
  }

  async transcribeAudio(filePath: string) {
    const client = this.getClient();
    const model = process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-4o-transcribe';
    const formats: TranscriptionResponseFormat[] = ['verbose_json', 'json', 'text'];
    const modelMaxSeconds = this.getModelMaxDurationSeconds();

    console.info('[transcription]', 'Starting transcription', {
      filePath: filePath.split('/').pop(),
      modelMaxSeconds
    });

    // Check for force chunking mode (useful for debugging)
    const forceChunking = process.env.OPENAI_FORCE_CHUNKING === 'true';
    if (forceChunking) {
      console.info('[transcription]', 'Force chunking mode enabled, skipping direct transcription');
      return this.transcribeFromChunks(client, filePath, model, formats, modelMaxSeconds);
    }

    const durationSeconds = await this.getDurationSeconds(filePath);
    console.info('[transcription]', 'Duration detection result', {
      durationSeconds,
      exceedsLimit: durationSeconds && durationSeconds > modelMaxSeconds
    });

    // If we detected duration and it exceeds limit, go straight to chunking
    if (durationSeconds && durationSeconds > modelMaxSeconds) {
      console.info('[transcription]', 'Audio exceeds limit, using chunking approach');
      return this.transcribeFromChunks(client, filePath, model, formats, modelMaxSeconds);
    }

    // For very large files (>25MB), assume they might be long and go straight to chunking
    try {
      const fs = await import('node:fs');
      const stats = fs.statSync(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);

      console.info('[transcription]', 'File size check', { fileSizeMB });

      // Use more conservative file size threshold for auto-chunking
      // Rough estimate: 1MB per minute of audio for typical recordings
      if (fileSizeMB > 15) { // ~15 minutes worth, well under the 23-minute limit
        console.info('[transcription]', 'Large file detected, using chunking approach as precaution');
        return this.transcribeFromChunks(client, filePath, model, formats, modelMaxSeconds);
      }
    } catch (sizeError) {
      console.warn('[transcription]', 'Could not check file size', sizeError);
    }

    try {
      console.info('[transcription]', 'Attempting direct transcription');
      const transcription = await this.transcribeWithFormats(client, filePath, model, formats);
      return this.buildTranscriptionResult(client, transcription);
    } catch (error) {
      console.warn('[transcription]', 'Direct transcription failed, checking for duration error', {
        error: this.toError(error).message
      });

      const maxDurationSeconds = this.extractMaxDurationSeconds(error);

      if (!maxDurationSeconds) {
        console.error('[transcription]', 'Non-duration error, failing');
        throw this.toError(error);
      }

      console.info('[transcription]', 'Duration limit error detected, falling back to chunking', {
        extractedMaxDuration: maxDurationSeconds
      });

      return this.transcribeFromChunks(client, filePath, model, formats, maxDurationSeconds);
    }
  }

  async generateSummaries(transcript: string, detectedLanguage: string) {
    const client = this.getClient();
    const model = process.env.OPENAI_SUMMARY_MODEL ?? 'gpt-4o';
    const translationTargetLanguage = getTranslationTargetLanguage(detectedLanguage);

    const summaryInDetectedLanguage = await this.generateSingleSummary(
      client,
      model,
      buildSummaryPrompt(transcript, detectedLanguage, detectedLanguage),
    );

    const summaryInEnglish = await this.generateSingleSummary(
      client,
      model,
      buildSummaryPrompt(transcript, detectedLanguage, translationTargetLanguage),
    );

    return {
      summaryInDetectedLanguage,
      summaryInEnglish,
    };
  }

  private async generateSingleSummary(client: OpenAI, model: string, prompt: string) {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });

    const content = response.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No summary generated by the model.');
    }

    return content;
  }

  private extractTranscript(transcription: unknown): string {
    if (typeof transcription === 'string') {
      return transcription;
    }

    if (
      typeof transcription === 'object' &&
      transcription !== null &&
      'text' in transcription &&
      typeof transcription.text === 'string'
    ) {
      return transcription.text;
    }

    return '';
  }

  private extractLanguage(transcription: unknown): string | undefined {
    if (
      typeof transcription === 'object' &&
      transcription !== null &&
      'language' in transcription &&
      typeof transcription.language === 'string' &&
      transcription.language.trim()
    ) {
      return transcription.language.trim();
    }

    return undefined;
  }

  private getModelMaxDurationSeconds() {
    const configured = Number(process.env.OPENAI_TRANSCRIPTION_MODEL_MAX_SECONDS);
    if (Number.isFinite(configured) && configured > 0) {
      return configured;
    }

    return 1400;
  }

  private async getDurationSeconds(filePath: string): Promise<number | undefined> {
    try {
      console.info('[transcription]', 'Attempting to detect duration with ffprobe');

      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ], { timeout: 10000 }); // 10 second timeout

      const value = parseFloat(String(stdout).trim());
      const duration = Number.isFinite(value) && value > 0 ? value : undefined;

      console.info('[transcription]', 'Duration detection successful', {
        duration,
        durationMinutes: duration ? (duration / 60).toFixed(1) : 'unknown'
      });

      return duration;
    } catch (error) {
      console.warn('[transcription]', 'Duration detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        isENOENT: error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
      });

      // If ffprobe is unavailable, fall back to API-based duration enforcement
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'ENOENT'
      ) {
        console.warn('[transcription]', 'ffprobe not installed - duration detection disabled');
        return undefined;
      }

      // For other errors (timeout, file issues, etc.), also return undefined
      // This allows the system to attempt direct transcription first
      return undefined;
    }
  }

  private async transcribeWithFormats(
    client: OpenAI,
    filePath: string,
    model: string,
    formats: TranscriptionResponseFormat[],
  ) {
    let lastError: unknown;

    for (const responseFormat of formats) {
      const maxRetries = 3;
      let attempt = 0;

      while (attempt < maxRetries) {
        try {
          // Add timeout to transcription requests
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Transcription request timeout after 5 minutes')), 300000)
          );

          const transcriptionPromise = client.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model,
            response_format: responseFormat,
          });

          const result = await Promise.race([transcriptionPromise, timeoutPromise]);
          return result as any; // TypeScript workaround for Promise.race
        } catch (error) {
          lastError = error;
          attempt++;

          // Check if it's a rate limit error or temporary server error
          const isRetryableError = this.isRetryableError(error);

          if (attempt < maxRetries && isRetryableError) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // Exponential backoff, max 30s
            console.warn('[transcription]', `Attempt ${attempt} failed, retrying in ${delay}ms`, { error: this.toError(error).message });
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            break; // Exit retry loop and try next format
          }
        }
      }
    }

    throw this.toError(lastError);
  }

  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();

    // Retry on rate limits, temporary server errors, timeouts
    return (
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('server error') ||
      message.includes('timeout') ||
      message.includes('service unavailable') ||
      message.includes('temporarily unavailable')
    );
  }

  private async transcribeFromChunks(
    client: OpenAI,
    filePath: string,
    model: string,
    formats: TranscriptionResponseFormat[],
    maxDurationSeconds: number,
  ) {
    const { chunkDir, chunkFiles } = await this.splitAudioForTranscription(filePath, maxDurationSeconds);

    try {
      console.info('[transcription]', `Processing ${chunkFiles.length} chunks in parallel`);

      // Process chunks in parallel with limited concurrency
      const maxConcurrency = Math.min(5, Math.max(1, chunkFiles.length)); // Max 5 concurrent requests
      const results: Array<{
        index: number;
        transcript: string;
        language?: string;
      }> = [];

      // Process chunks in batches
      for (let i = 0; i < chunkFiles.length; i += maxConcurrency) {
        const batch = chunkFiles.slice(i, i + maxConcurrency);
        const batchPromises = batch.map(async (chunkFilePath, batchIndex) => {
          const chunkIndex = i + batchIndex;

          try {
            console.info('[transcription]', `Processing chunk ${chunkIndex + 1}/${chunkFiles.length}`);

            const chunkTranscription = await this.transcribeWithFormats(client, chunkFilePath, model, formats);
            const chunkTranscript = this.extractTranscript(chunkTranscription).trim();
            const chunkLanguage = this.extractLanguage(chunkTranscription);

            return {
              index: chunkIndex,
              transcript: chunkTranscript,
              language: chunkLanguage && chunkLanguage.toLowerCase() !== 'unknown' ? chunkLanguage : undefined,
            };
          } catch (error) {
            console.error('[transcription]', `Error processing chunk ${chunkIndex + 1}:`, error);
            // Return empty result for failed chunks instead of failing entirely
            return {
              index: chunkIndex,
              transcript: '',
              language: undefined,
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Add small delay between batches to avoid rate limiting
        if (i + maxConcurrency < chunkFiles.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Sort results by original chunk order and extract transcripts
      results.sort((a, b) => a.index - b.index);
      const chunkTranscripts = results
        .filter(result => result.transcript)
        .map(result => result.transcript);

      const detectedLanguageFromChunks = results.find(result => result.language)?.language;

      const transcript = chunkTranscripts.join('\n\n').trim();

      if (!transcript) {
        throw new Error('No transcript text returned by the transcription model after processing all chunks.');
      }

      const detectedLanguage =
        detectedLanguageFromChunks ?? (await this.detectLanguageFromTranscript(client, transcript));

      console.info('[transcription]', `Completed processing ${chunkFiles.length} chunks, total transcript length: ${transcript.length}`);

      return {
        transcript,
        detectedLanguage,
      };
    } finally {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    }
  }

  private async buildTranscriptionResult(client: OpenAI, transcription: unknown) {
    const transcript = this.extractTranscript(transcription);

    if (!transcript.trim()) {
      throw new Error('No transcript text returned by the transcription model.');
    }

    const maybeLanguage = this.extractLanguage(transcription);
    const detectedLanguage =
      maybeLanguage && maybeLanguage !== 'unknown'
        ? maybeLanguage
        : await this.detectLanguageFromTranscript(client, transcript);

    return {
      transcript,
      detectedLanguage,
    };
  }

  private extractMaxDurationSeconds(error: unknown): number | undefined {
    if (!(error instanceof Error)) {
      return undefined;
    }

    const message = error.message.toLowerCase();

    console.info('[transcription]', 'Analyzing error for duration limit', {
      errorMessage: error.message,
      isDurationError: message.includes('duration') || message.includes('longer than') || message.includes('maximum')
    });

    // Check for various duration error patterns
    const durationErrorPatterns = [
      // "audio duration 1800.056 seconds is longer than 1400 seconds"
      /audio duration [0-9]+(?:\.[0-9]+)? seconds is longer than ([0-9]+(?:\.[0-9]+)?)\s*seconds/i,
      // "maximum ... seconds"
      /maximum.*?([0-9]+(?:\.[0-9]+)?)\s*seconds/i,
      // "longer than X seconds which is the maximum"
      /longer than ([0-9]+(?:\.[0-9]+)?)\s*seconds.*maximum/i,
      // Generic "X seconds" patterns
      /([0-9]+(?:\.[0-9]+)?)\s*seconds.*(?:maximum|limit)/i,
      /(?:maximum|limit).*?([0-9]+(?:\.[0-9]+)?)\s*seconds/i,
    ];

    for (const pattern of durationErrorPatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
          console.info('[transcription]', 'Extracted max duration from error', {
            pattern: pattern.source,
            extractedDuration: parsed
          });
          return parsed;
        }
      }
    }

    // If no specific duration found but it's clearly a duration error, use default
    if (message.includes('duration') && (message.includes('longer') || message.includes('maximum') || message.includes('limit'))) {
      console.info('[transcription]', 'Duration error detected but could not extract limit, using default 1400s');
      return 1400; // Default OpenAI Whisper limit
    }

    console.info('[transcription]', 'Error does not appear to be duration-related');
    return undefined;
  }

  private async splitAudioForTranscription(filePath: string, maxDurationSeconds: number) {
    const chunkDurationSeconds = this.resolveChunkDurationSeconds(maxDurationSeconds);
    const chunkDir = fs.mkdtempSync(join(tmpdir(), 'meeting-assistant-audio-chunks-'));
    const extension = extname(filePath) || '.webm';
    const outputPattern = join(chunkDir, `chunk-%03d${extension}`);

    console.info('[transcription]', `Splitting audio into ${chunkDurationSeconds}s chunks`, {
      filePath: filePath.split('/').pop(),
      maxDuration: maxDurationSeconds,
      chunkDuration: chunkDurationSeconds,
    });

    try {
      // Enhanced ffmpeg command with better error handling and compression
      await execFileAsync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'warning', // More verbose logging for debugging
        '-i',
        filePath,
        '-f',
        'segment',
        '-segment_time',
        String(chunkDurationSeconds),
        '-segment_format_options',
        'movflags=faststart', // Optimize for streaming
        '-avoid_negative_ts',
        'make_zero', // Avoid timestamp issues
        '-c:a',
        'aac', // Use efficient codec
        '-b:a',
        '64k', // Lower bitrate for faster processing
        '-ar',
        '16000', // Lower sample rate for transcription (OpenAI Whisper works well with this)
        '-ac',
        '1', // Mono audio for transcription
        outputPattern,
      ]);
    } catch (error) {
      // Clean up on failure
      try {
        fs.rmSync(chunkDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('[transcription]', 'Failed to cleanup chunk directory after error', cleanupError);
      }

      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        throw new Error(
          'Audio is longer than the model limit and ffmpeg is not installed. Install ffmpeg or send shorter audio files.',
        );
      }

      console.error('[transcription]', 'ffmpeg error details:', error);
      throw new Error(`Failed to split large audio file for transcription. ${this.toError(error).message}`);
    }

    const chunkFiles = fs
      .readdirSync(chunkDir)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) // Better numeric sorting
      .map((name) => join(chunkDir, name))
      .filter((chunkPath) => {
        try {
          const stats = fs.statSync(chunkPath);
          return stats.isFile() && stats.size > 0; // Filter out empty files
        } catch {
          return false;
        }
      });

    if (chunkFiles.length === 0) {
      fs.rmSync(chunkDir, { recursive: true, force: true });
      throw new Error('Failed to split audio into chunks for transcription - no valid chunks created.');
    }

    console.info('[transcription]', `Successfully created ${chunkFiles.length} audio chunks`);

    return { chunkDir, chunkFiles };
  }

  private resolveChunkDurationSeconds(maxDurationSeconds: number) {
    const configuredChunkSeconds = Number(process.env.OPENAI_TRANSCRIPTION_CHUNK_SECONDS);
    if (
      Number.isFinite(configuredChunkSeconds) &&
      configuredChunkSeconds > 0 &&
      configuredChunkSeconds < maxDurationSeconds
    ) {
      return Math.floor(configuredChunkSeconds);
    }

    // Use 80% of max duration instead of 85% to be more conservative
    // Also ensure minimum chunk size is reasonable for transcription quality
    return Math.max(120, Math.floor(maxDurationSeconds * 0.8)); // Minimum 2 minutes per chunk
  }

  private toError(error: unknown) {
    if (error instanceof Error) {
      return error;
    }

    return new Error('Unable to transcribe audio with any supported response format.');
  }

  private async detectLanguageFromTranscript(client: OpenAI, transcript: string) {
    const model = process.env.OPENAI_LANGUAGE_MODEL ?? process.env.OPENAI_SUMMARY_MODEL ?? 'gpt-4o-mini';
    const prompt = `Identify the main spoken language of the following transcript.
Return only a lowercase ISO 639-1 code (examples: en, pt, es, fr).
If uncertain, return "unknown".

Transcript:
${transcript.slice(0, 5000)}`;

    const response = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.choices?.[0]?.message?.content?.trim().toLowerCase();

    if (!content) {
      return 'unknown';
    }

    const languageCode = content.match(/^[a-z]{2,3}$/)?.[0];
    return languageCode ?? 'unknown';
  }
}
