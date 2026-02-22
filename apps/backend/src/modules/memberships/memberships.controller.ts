import { Controller, Get } from '@nestjs/common';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MembershipsService } from './memberships.service';

@Controller('memberships')
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Get()
  async list(
    @CurrentOrganization() organizationId: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.membershipsService.list(organizationId, user.sub);
  }
}
