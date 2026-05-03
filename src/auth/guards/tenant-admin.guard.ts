import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import type { AuthenticatedRequestUser } from '../types/auth-request-user.types';

/**
 * Enforces that the authenticated tenant user has the 'admin' role.
 * Must be used after JwtAuthGuard and TenantGuard.
 *
 * Platform admins are explicitly excluded — they operate under the /platform namespace,
 * not tenant user management APIs.
 */
@Injectable()
export class TenantAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedRequestUser }>();
    const user = request.user;

    if (!user || user.platformAdmin) {
      throw new ForbiddenException('Tenant administrator access required');
    }
    if (user.tenantRole === 'admin') {
      return true;
    }
    throw new ForbiddenException('Tenant administrator access required');
  }
}
