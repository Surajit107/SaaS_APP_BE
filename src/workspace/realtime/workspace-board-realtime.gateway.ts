import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import type { JwtAccessPayload } from '../../auth/types/jwt-payload.types';
import { WorkspaceRepository } from '../repositories/workspace.repository';
import type { WorkspaceBoardSocketAuth } from './workspace-board-realtime.types';
import { memberMyTasksRoom, workspaceBoardRoom } from './workspace-board-rooms';

type AuthedSocketData = {
  tenantId: string;
  userId: string;
  platformAdmin: boolean;
  tenantRole: 'admin' | 'member' | undefined;
};

type BoardSocketData = AuthedSocketData & { boardRoom?: string; myTasksRoom?: string };

type AuthedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  BoardSocketData
>;

@WebSocketGateway({
  namespace: '/workspace',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class WorkspaceBoardRealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly log = new Logger(WorkspaceBoardRealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly configService: ConfigService,
    private readonly workspaceRepository: WorkspaceRepository,
  ) {}

  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    const authed = this.authenticate(client);
    if (!authed) {
      client.disconnect(true);
      return;
    }
    client.emit('workspace:ready');
  }

  handleDisconnect(@ConnectedSocket() _client: Socket): void {
    // rooms dropped by Socket.IO
  }

  @SubscribeMessage('workspace:subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { workspaceId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const authed = client.data as BoardSocketData;
    if (!authed?.tenantId) {
      return { ok: false, error: 'unauthorized' };
    }
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId.trim() : '';
    if (workspaceId.length === 0) {
      return { ok: false, error: 'workspaceId_required' };
    }
    const workspace = await this.workspaceRepository.findByIdAndTenant(
      workspaceId,
      authed.tenantId,
    );
    if (!workspace) {
      return { ok: false, error: 'workspace_not_found' };
    }
    const room = workspaceBoardRoom({
      tenantId: authed.tenantId,
      workspaceId,
    });
    const data = client.data as BoardSocketData;
    const prev = data.boardRoom;
    if (typeof prev === 'string' && prev.length > 0 && prev !== room) {
      await client.leave(prev);
    }
    await client.join(room);
    data.boardRoom = room;
    return { ok: true };
  }

  @SubscribeMessage('workspace:unsubscribe')
  async handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { workspaceId?: string },
  ): Promise<{ ok: boolean }> {
    const data = client.data as BoardSocketData;
    if (!data?.tenantId) {
      return { ok: false };
    }
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId.trim() : '';
    if (workspaceId.length === 0) {
      return { ok: false };
    }
    const room = workspaceBoardRoom({
      tenantId: data.tenantId,
      workspaceId,
    });
    await client.leave(room);
    if (data.boardRoom === room) {
      delete data.boardRoom;
    }
    return { ok: true };
  }

  @SubscribeMessage('member-tasks:subscribe')
  async handleMemberTasksSubscribe(
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean; error?: string }> {
    const data = client.data as BoardSocketData;
    if (!data?.tenantId || !data.userId) {
      return { ok: false, error: 'unauthorized' };
    }
    const room = memberMyTasksRoom({ tenantId: data.tenantId, userId: data.userId });
    const prev = data.myTasksRoom;
    if (typeof prev === 'string' && prev.length > 0 && prev !== room) {
      await client.leave(prev);
    }
    await client.join(room);
    data.myTasksRoom = room;
    return { ok: true };
  }

  @SubscribeMessage('member-tasks:unsubscribe')
  async handleMemberTasksUnsubscribe(
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean }> {
    const data = client.data as BoardSocketData;
    if (!data?.tenantId) {
      return { ok: false };
    }
    const room = data.myTasksRoom;
    if (typeof room === 'string' && room.length > 0) {
      await client.leave(room);
      delete data.myTasksRoom;
    }
    return { ok: true };
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

    (client as AuthedSocket).data = { ...data };
    return data;
  }

  private extractBearerFromHeader(client: Socket): string | undefined {
    const raw = client.handshake.headers?.authorization;
    if (typeof raw !== 'string') return undefined;
    const m = /^Bearer\s+(\S+)$/i.exec(raw.trim());
    return m?.[1];
  }

  private extractTokenFromAuth(client: Socket): string | undefined {
    const auth = client.handshake.auth as WorkspaceBoardSocketAuth | undefined;
    const raw = auth?.token;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
  }

  private extractTokenFromQuery(client: Socket): string | undefined {
    const raw = client.handshake.query?.token;
    if (typeof raw !== 'string') return undefined;
    return raw.trim().length > 0 ? raw.trim() : undefined;
  }
}
