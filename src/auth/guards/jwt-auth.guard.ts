import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { AuthenticatedRequestUser } from '../types/auth-request-user.types.js';
import { JwtAccessPayload } from '../types/jwt-payload.types.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedRequestUser }>();
    const token = this.extractAccessToken(request);
    if (token === undefined) {
      throw new UnauthorizedException();
    }
    const secret = this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');
    let decoded: jwt.JwtPayload | string;
    try {
      decoded = jwt.verify(token, secret);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        if (err instanceof jwt.TokenExpiredError) {
          throw new UnauthorizedException('Access token expired');
        }
        if (err instanceof jwt.JsonWebTokenError) {
          throw new UnauthorizedException(
            `Invalid access token: ${err.message}`,
          );
        }
        if (err instanceof jwt.NotBeforeError) {
          throw new UnauthorizedException('Access token not active yet');
        }
      }
      throw new UnauthorizedException();
    }
    if (typeof decoded === 'string' || decoded === null) {
      throw new UnauthorizedException();
    }
    const payload = decoded as unknown as JwtAccessPayload;
    if (
      payload.type !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      payload.sub.length === 0
    ) {
      throw new UnauthorizedException();
    }
    /**
     * Legacy tokens issued before `tenantRole` was added lack the field entirely.
     * Default to 'admin' so pre-existing tenant owners aren't locked out of admin APIs
     * until their token naturally refreshes and gets the role baked in.
     */
    const tenantRole: 'admin' | 'member' | undefined = payload.platformAdmin
      ? undefined
      : (payload.tenantRole ?? 'admin');

    request.user = {
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      platformAdmin: payload.platformAdmin === true,
      tenantRole,
    };
    return true;
  }

  private extractAccessToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (typeof header === 'string') {
      const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
      if (m !== null) {
        return m[1];
      }
    }

    const cookieToken = request.cookies?.accessToken;
    if (typeof cookieToken === 'string' && cookieToken.trim().length > 0) {
      return cookieToken;
    }

    return undefined;
  }
}
