import { Body, Controller, Get, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SkipOrganization } from '../../common/decorators/skip-organization.decorator';
import { MeetingService } from './meeting.service';
import { ProcessAudioDto } from './dto-process-audio';

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
  async processAudio(@Body() payload: ProcessAudioDto) {
    return this.meetingService.processAudio(payload);
  }
}
