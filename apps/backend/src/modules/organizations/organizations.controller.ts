import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipOrganization } from '../../common/decorators/skip-organization.decorator';
import { OrganizationsService } from './organizations.service';

class CreateOrganizationDto {
  @IsString()
  @MinLength(2)
  name!: string;
}

@Controller('organizations')
@SkipOrganization()
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  async list(@CurrentUser() user: { sub: string }) {
    return this.organizationsService.listByUser(user.sub);
  }

  @Post()
  async create(@CurrentUser() user: { sub: string }, @Body() body: CreateOrganizationDto) {
    return this.organizationsService.create(user.sub, body.name);
  }
}
