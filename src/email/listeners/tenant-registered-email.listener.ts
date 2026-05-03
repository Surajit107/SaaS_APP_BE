import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import {
  TenantAuthEventName,
  type TenantUserRegisteredPayload,
} from '../../common/domain-events/tenant-auth.domain-events';
import { EmailService } from '../email.service';

@Injectable()
export class TenantRegisteredEmailListener {
  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  @OnEvent(TenantAuthEventName.UserRegistered)
  async onUserRegistered(payload: TenantUserRegisteredPayload): Promise<void> {
    const brand = this.email.platformBrand();
    const frontendBase =
      this.config.get<string>('FRONTEND_BASE_URL')?.replace(/\/$/, '') ??
      'http://localhost:5173';
    const params = new URLSearchParams({
      token: payload.rawEmailVerificationToken,
      email: payload.email,
    });
    const verifyLink = `${frontendBase}/verify-email?${params.toString()}`;
    const greeting = payload.displayName?.trim()
      ? `Hi ${payload.displayName.trim()},`
      : 'Hi there,';
    await this.email.sendPlatformTransactional({
      to: payload.email,
      subjectLine: `Verify your email — ${payload.organizationName}`,
      headline: `Confirm your email for ${payload.organizationName}`,
      bodyLines: [
        greeting,
        `Thanks for creating "${payload.organizationName}" on ${brand}.`,
        'Verify your email address to activate sign-in. This link expires in 48 hours.',
        verifyLink,
        'If you did not create this account, you can ignore this email.',
      ],
    });
  }
}
