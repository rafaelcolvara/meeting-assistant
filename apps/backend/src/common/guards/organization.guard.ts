import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_ORGANIZATION_KEY } from '../decorators/skip-organization.decorator';

@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const skipOrg = this.reflector.getAllAndOverride<boolean>(SKIP_ORGANIZATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipOrg) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { sub?: string } | undefined;
    const organizationId = request.headers['x-organization-id'] as string | undefined;

    if (!user?.sub) {
      throw new UnauthorizedException('Missing authenticated user.');
    }

    if (!organizationId) {
      throw new ForbiddenException('x-organization-id header is required.');
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: user.sub,
        organizationId,
        status: 'ACTIVE',
      },
    });

    if (!membership) {
      throw new ForbiddenException('User is not a member of this organization.');
    }

    request.organizationId = organizationId;
    return true;
  }
}
