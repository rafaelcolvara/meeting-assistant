import { IsBase64, IsNumber, IsOptional, IsString, Max } from 'class-validator';

export class ProcessAudioDto {
  @IsBase64()
  audioBase64!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsNumber()
  @Max(2 * 60 * 60 * 1000)
  durationMs?: number;
}
