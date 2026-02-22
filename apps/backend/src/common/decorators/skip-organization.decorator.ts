import { SetMetadata } from '@nestjs/common';

export const SKIP_ORGANIZATION_KEY = 'skipOrganizationGuard';
export const SkipOrganization = () => SetMetadata(SKIP_ORGANIZATION_KEY, true);
