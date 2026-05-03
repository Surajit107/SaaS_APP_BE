import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { URLSearchParams } from 'node:url';
import { buildTransactionalMail } from './utils/transactional-email-layout.util';
import { escapeHtml } from './utils/html-escape.util';

/**
 * Transactional email via Resend (no-reply: automated sender, explicit Reply-To, RFC auto-generated).
 * If env is incomplete, sends are no-ops (logged once).
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private client: Resend | null = null;
  private warnedNotConfigured = false;

  constructor(private readonly config: ConfigService) {}

  /**
   * Bare RFC mailbox from `RESEND_FROM_EMAIL`.
   * Accepts `addr@dom` or legacy `Name <addr@dom>` (only the address is used; display name comes from brand/caller).
   */
  private extractSenderEmail(raw: string): string {
    const t = raw.trim();
    const angle = t.match(/<([^<>]+@[^<>]+)>/);
    if (angle) {
      return angle[1].trim();
    }
    return t;
  }

  /** Resolved mailbox for `RESEND_FROM_EMAIL` (must contain `@`). */
  private getConfiguredSenderEmail(): string | null {
    const raw = this.config.get<string>('RESEND_FROM_EMAIL')?.trim();
    if (!raw) {
      return null;
    }
    const addr = this.extractSenderEmail(raw);
    return addr.includes('@') ? addr : null;
  }

  /** Public name in From header and templates (override with PLATFORM_BRAND_NAME). */
  platformBrand(): string {
    return (
      this.config.get<string>('PLATFORM_BRAND_NAME')?.trim() || 'Asteriq.in'
    );
  }

  /**
   * Shorter label for email subjects (e.g. `Asteriq.in` → `Asteriq`).
   * Full `platformBrand()` remains in body copy and footers.
   */
  private conciseSubjectBrand(): string {
    const name = this.platformBrand().trim();
    const shortened = name.replace(
      /\.(com|in|io|app|co|net|org|dev|ai)\s*$/i,
      '',
    );
    return shortened.length > 0 ? shortened : name;
  }

  /**
   * Transactional subject: `Prefix — Subject line` (no bracket spam).
   * `subjectPrefixLabel === null` yields `subjectLine` only.
   */
  private formatTransactionalSubject(
    subjectLine: string,
    subjectPrefixLabel?: string | null,
  ): string {
    if (subjectPrefixLabel === null) {
      return subjectLine;
    }
    const prefix = (subjectPrefixLabel ?? this.conciseSubjectBrand()).trim();
    return `${prefix} — ${subjectLine}`;
  }

  private getClient(): Resend | null {
    if (this.client) {
      return this.client;
    }
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const fromEmail = this.getConfiguredSenderEmail();
    if (!apiKey || !fromEmail) {
      if (!this.warnedNotConfigured) {
        this.warnedNotConfigured = true;
        this.log.warn(
          'Resend not fully configured (RESEND_API_KEY, RESEND_FROM_EMAIL); outbound email skipped',
        );
      }
      return null;
    }
    this.client = new Resend(apiKey);
    return this.client;
  }

  /**
   * Branded transactional mail: subject `Brand — …`, HTML layout, plain-text fallback.
   */
  async sendPlatformTransactional(params: {
    to: string;
    subjectLine: string;
    headline: string;
    bodyLines: string[];
    postActionLines?: string[];
    primaryAction?: { href: string; label: string };
    footerHint?: string;
    /**
     * Prefix before subjectLine (em dash). Default: concise platform brand.
     * Pass null for no prefix (subject is exactly subjectLine).
     */
    subjectPrefixLabel?: string | null;
    header?: { eyebrow: string; title: string };
    textSignature?: string;
    fromDisplayName?: string;
  }): Promise<void> {
    const brand = this.platformBrand();
    const subject = this.formatTransactionalSubject(
      params.subjectLine,
      params.subjectPrefixLabel,
    );
    const { text, html } = buildTransactionalMail({
      brand,
      headline: params.headline,
      bodyLines: params.bodyLines,
      postActionLines: params.postActionLines,
      primaryAction: params.primaryAction,
      footerHint: params.footerHint,
      header: params.header,
      textSignature: params.textSignature,
    });
    await this.sendTransactional({
      to: params.to,
      subject,
      text,
      html,
      fromDisplayName: params.fromDisplayName?.trim() || brand,
    });
  }

  /**
   * Organizer self-registration: send verification mail or throw if Resend reports failure.
   * Returns `'skipped'` when outbound email is not configured (no API key / from) — same as a no-op send.
   */
  async sendOrganizerRegistrationVerificationEmail(params: {
    email: string;
    organizationName: string;
    displayName?: string;
    rawEmailVerificationToken: string;
  }): Promise<'sent' | 'skipped'> {
    const brand = this.platformBrand();
    const frontendBase =
      this.config.get<string>('FRONTEND_BASE_URL')?.replace(/\/$/, '') ??
      'http://localhost:5173';
    const query = new URLSearchParams({
      token: params.rawEmailVerificationToken,
      email: params.email,
    });
    const verifyLink = `${frontendBase}/verify-email?${query.toString()}`;
    const greeting = params.displayName?.trim()
      ? `Hi ${params.displayName.trim()},`
      : 'Hi there,';
    const subject = this.formatTransactionalSubject(
      `Verify your email for ${params.organizationName}`,
    );
    const { text, html } = buildTransactionalMail({
      brand,
      headline: `Confirm your email for ${params.organizationName}`,
      bodyLines: [
        greeting,
        `Thanks for creating "${params.organizationName}" on ${brand}.`,
        'Verify your email address to activate sign-in. This secure link expires in 48 hours.',
      ],
      postActionLines: [
        'If you did not create this account, you can ignore this email.',
      ],
      primaryAction: {
        href: verifyLink,
        label: 'Verify email address',
      },
    });
    const outcome = await this.deliverViaResend({
      to: params.email,
      subject,
      text,
      html,
      fromDisplayName: brand,
    });
    if (outcome.kind === 'failed') {
      throw new BadGatewayException(
        `Email delivery failed: ${outcome.message}`,
      );
    }
    return outcome.kind === 'skipped' ? 'skipped' : 'sent';
  }

  /**
   * Low-level send. Prefer `sendPlatformTransactional` for product emails.
   */
  async sendTransactional(params: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    fromDisplayName?: string;
  }): Promise<void> {
    const html = params.html ?? `<p>${escapeHtml(params.text)}</p>`;
    const outcome = await this.deliverViaResend({
      to: params.to,
      subject: params.subject,
      text: params.text,
      html,
      fromDisplayName: params.fromDisplayName,
    });
    if (outcome.kind === 'failed') {
      this.log.error(outcome.message);
    }
  }

  private async deliverViaResend(params: {
    to: string;
    subject: string;
    text: string;
    html: string;
    fromDisplayName?: string;
  }): Promise<
    { kind: 'skipped' } | { kind: 'sent' } | { kind: 'failed'; message: string }
  > {
    const client = this.getClient();
    const fromEmail = this.getConfiguredSenderEmail();
    if (!client || !fromEmail) {
      return { kind: 'skipped' };
    }
    const to = params.to.trim();
    if (!to) {
      return { kind: 'skipped' };
    }
    const baseDisplay = params.fromDisplayName?.trim() || this.platformBrand();
    const displayName = /\((no reply|do not reply)\)/i.test(baseDisplay)
      ? baseDisplay
      : `${baseDisplay} (No reply)`;
    try {
      const { error } = await client.emails.send({
        from: `"${displayName}" <${fromEmail}>`,
        to,
        subject: params.subject,
        text: params.text,
        html: params.html,
        /** Same mailbox as From; use an unmonitored `noreply@` address in Resend so replies are dropped or autobounced. */
        replyTo: fromEmail,
        headers: {
          'Auto-Submitted': 'auto-generated',
        },
      });
      if (error) {
        const message = `Resend emails.send failed: ${error.message} (${error.name}, status ${String(error.statusCode)})`;
        this.log.error(message);
        return { kind: 'failed', message };
      }
      return { kind: 'sent' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Resend send failed';
      this.log.error(message, err instanceof Error ? err.stack : undefined);
      return { kind: 'failed', message };
    }
  }
}
