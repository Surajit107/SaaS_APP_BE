import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedRequestUser } from '../types/auth-request-user.types.js';

/**
 * Enforces that JWT auth has populated a tenant (tenantId from access token, not from client).
 * Use after JwtAuthGuard.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedRequestUser }>();
    const { tenantId } = request.user ?? {};
    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      throw new ForbiddenException('Tenant context is required');
    }
    return true;
  }
}
