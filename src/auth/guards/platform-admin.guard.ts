import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import type { AuthenticatedRequestUser } from '../types/auth-request-user.types';

/**
 * Requires a JWT with `platformAdmin: true` (issued server-side from `User.isPlatformAdmin`).
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedRequestUser }>();
    const u = request.user;
    if (u?.platformAdmin === true) {
      return true;
    }
    throw new ForbiddenException('Platform administrator access required');
  }
}
