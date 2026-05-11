import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import type { JwtAccessPayload } from '../../auth/types/jwt-payload.types';
import type { NotificationSocketAuth } from './notification-realtime.types';
import { notificationAdminRoom, notificationUserRoom } from './notification-rooms';

type AuthedSocketData = {
  tenantId: string;
  userId: string;
  platformAdmin: boolean;
  tenantRole: 'admin' | 'member' | undefined;
};

type AuthedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  AuthedSocketData
>;

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class NotificationRealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly log = new Logger(NotificationRealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly configService: ConfigService) {}

  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    const authed = this.authenticate(client);
    if (!authed) {
      client.disconnect(true);
      return;
    }
    const roomUser = notificationUserRoom({
      tenantId: authed.tenantId,
      userId: authed.userId,
    });
    await client.join(roomUser);

    if (!authed.platformAdmin && authed.tenantRole !== 'member') {
      await client.join(notificationAdminRoom({ tenantId: authed.tenantId }));
    }

    // Best-effort: helps debugging without breaking clients.
    client.emit('notifications:ready');
  }

  handleDisconnect(@ConnectedSocket() _client: Socket): void {
    // no-op; rooms are cleaned up by Socket.IO
  }

  private authenticate(client: Socket): AuthedSocketData | null {
    const token =
      this.extractBearerFromHeader(client) ??
      this.extractTokenFromAuth(client) ??
      this.extractTokenFromQuery(client);
    if (!token) return null;

    const secret = this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');
    let decoded: jwt.JwtPayload | string;
    try {
      decoded = jwt.verify(token, secret);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        this.log.warn(
          `Socket auth failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return null;
    }

    if (typeof decoded === 'string' || decoded === null) return null;
    const payload = decoded as unknown as JwtAccessPayload;
    if (
      payload.type !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      payload.sub.length === 0 ||
      payload.tenantId.length === 0
    ) {
      return null;
    }

    const tenantRole: 'admin' | 'member' | undefined = payload.platformAdmin
      ? undefined
      : (payload.tenantRole ?? 'admin');

    const data: AuthedSocketData = {
      tenantId: payload.tenantId,
      userId: payload.sub,
      platformAdmin: payload.platformAdmin === true,
      tenantRole,
    };

    // Attach for later debugging / potential future guards.
    (client as AuthedSocket).data = data;
    return data;
  }

  private extractBearerFromHeader(client: Socket): string | undefined {
    const raw = client.handshake.headers?.authorization;
    if (typeof raw !== 'string') return undefined;
    const m = /^Bearer\s+(\S+)$/i.exec(raw.trim());
    return m?.[1];
  }

  private extractTokenFromAuth(client: Socket): string | undefined {
    const auth = client.handshake.auth as NotificationSocketAuth | undefined;
    const raw = auth?.token;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
  }

  private extractTokenFromQuery(client: Socket): string | undefined {
    const raw = client.handshake.query?.token;
    if (typeof raw !== 'string') return undefined;
    return raw.trim().length > 0 ? raw.trim() : undefined;
  }
}
