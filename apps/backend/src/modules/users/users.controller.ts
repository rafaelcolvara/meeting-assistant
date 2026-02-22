import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipOrganization } from '../../common/decorators/skip-organization.decorator';
import { UsersService } from './users.service';

@Controller('users')
@SkipOrganization()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: { sub: string }) {
    return this.usersService.me(user.sub);
  }
}
