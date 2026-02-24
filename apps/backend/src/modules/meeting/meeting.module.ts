import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MeetingController } from './meeting.controller';
import { MeetingService } from './meeting.service';

@Module({
  imports: [PrismaModule],
  controllers: [MeetingController],
  providers: [MeetingService],
})
export class MeetingModule {}
