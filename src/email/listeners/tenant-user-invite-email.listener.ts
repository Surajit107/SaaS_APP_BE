import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import {
  TenantUserManagementEventName,
  type TenantUserInvitedPayload,
} from '../../common/domain-events/tenant-user-management.domain-events';
import type { TenantUserRole } from '../../user/schemas/user.schema';
import { EmailService } from '../email.service';

function formatInviteRoleSentence(role: TenantUserRole): string {
  return role === 'admin' ? 'an administrator' : 'a member';
}

@Injectable()
export class TenantUserInviteEmailListener {
  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  @OnEvent(TenantUserManagementEventName.UserInvited)
  async onUserInvited(payload: TenantUserInvitedPayload): Promise<void> {
    const brand = this.email.platformBrand();
    const rolePhrase = formatInviteRoleSentence(payload.role);
    const frontendBase =
      this.config.get<string>('FRONTEND_BASE_URL')?.replace(/\/$/, '') ??
      'http://localhost:5173';

    const params = new URLSearchParams({
      token: payload.rawToken,
      email: payload.email,
    });
    const inviteLink = `${frontendBase}/accept-invite?${params.toString()}`;

    const greeting = payload.displayName
      ? `Hi ${payload.displayName},`
      : 'Hi there,';

    const inviterLabel =
      payload.invitedByDisplayName?.trim() || payload.invitedByEmail;

    await this.email.sendPlatformTransactional({
      to: payload.email,
      subjectPrefixLabel: payload.tenantName,
      subjectLine: "You're invited to join the team",
      header: {
        eyebrow: 'Organization',
        title: payload.tenantName,
      },
      headline: `Join ${payload.tenantName}`,
      bodyLines: [
        greeting,
        `${inviterLabel} has invited you to join ${payload.tenantName} as ${rolePhrase}.`,
        'Use the link below to choose a password and activate your account. This link expires in 48 hours.',
        inviteLink,
        'If you did not expect this invitation, you can safely ignore this email.',
      ],
      footerHint: `Sent on behalf of ${payload.tenantName}. If you did not request access, you may disregard this message. Account notifications are delivered through ${brand}.`,
      textSignature: `— ${payload.tenantName}`,
      fromDisplayName: payload.tenantName,
    });
  }
}
