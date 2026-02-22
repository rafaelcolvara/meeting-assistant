import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, userId: string) {
    await this.ensureUserInOrganization(organizationId, userId);

    return this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: true },
    });
  }

  private async ensureUserInOrganization(organizationId: string, userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId, userId, status: 'ACTIVE' },
    });

    if (!membership) {
      throw new ForbiddenException('You are not part of this organization.');
    }
  }
}
