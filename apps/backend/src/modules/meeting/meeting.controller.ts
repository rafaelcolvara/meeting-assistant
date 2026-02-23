import {
  BadRequestException,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { Public } from '../../common/decorators/public.decorator';
import { SkipOrganization } from '../../common/decorators/skip-organization.decorator';
import { MeetingService } from './meeting.service';

const uploadsDir = join(process.cwd(), 'uploads');

if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

@Controller()
export class MeetingController {
  constructor(private readonly meetingService: MeetingService) {}

  @Public()
  @SkipOrganization()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Public()
  @SkipOrganization()
  @Post('api/process-audio')
  @UseInterceptors(
    FileInterceptor('audio', {
      dest: uploadsDir,
      limits: {
        fileSize: 25 * 1024 * 1024,
      },
    }),
  )
  async processAudio(@UploadedFile() file?: { path: string; originalname: string }) {
    if (!file) {
      throw new BadRequestException('No audio file was provided.');
    }

    return this.meetingService.processAudio(file);
  }
}
