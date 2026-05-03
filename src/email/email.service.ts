import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { buildTransactionalMail } from './utils/transactional-email-layout.util';
import { escapeHtml } from './utils/html-escape.util';

/**
 * Transactional SMTP (e.g. Gmail app password). If env is incomplete, sends are no-ops (logged once).
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private warnedNotConfigured = false;

  constructor(private readonly config: ConfigService) {}

  /** Public name in From header and templates (override with PLATFORM_BRAND_NAME). */
  platformBrand(): string {
    return (
      this.config.get<string>('PLATFORM_BRAND_NAME')?.trim() || 'Asteriq.in'
    );
  }

  private getTransporter(): Transporter | null {
    if (this.transporter) {
      return this.transporter;
    }
    const user = this.config.get<string>('EMAIL_ID')?.trim();
    const pass = this.config.get<string>('EMAIL_APP_PASSWORD')?.trim();
    const host =
      this.config.get<string>('EMAIL_HOST')?.trim() ?? 'smtp.gmail.com';
    const portRaw = this.config.get<string>('EMAIL_PORT', '587');
    const port = Number.parseInt(portRaw, 10);
    if (!user || !pass || !Number.isFinite(port) || port <= 0) {
      if (!this.warnedNotConfigured) {
        this.warnedNotConfigured = true;
        this.log.warn(
          'SMTP not fully configured (EMAIL_ID, EMAIL_APP_PASSWORD, EMAIL_PORT); outbound email skipped',
        );
      }
      return null;
    }
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    return this.transporter;
  }

  /**
   * Branded transactional mail: subject `[Brand] …`, HTML layout, plain-text fallback.
   */
  async sendPlatformTransactional(params: {
    to: string;
    subjectLine: string;
    headline: string;
    bodyLines: string[];
    footerHint?: string;
    /**
     * Bracket label before subjectLine. Default: platform brand.
     * Pass null for no `[label]` prefix (subject is exactly subjectLine).
     */
    subjectPrefixLabel?: string | null;
    header?: { eyebrow: string; title: string };
    textSignature?: string;
    fromDisplayName?: string;
  }): Promise<void> {
    const brand = this.platformBrand();
    const subject =
      params.subjectPrefixLabel === null
        ? params.subjectLine
        : `[${params.subjectPrefixLabel ?? brand}] ${params.subjectLine}`;
    const { text, html } = buildTransactionalMail({
      brand,
      headline: params.headline,
      bodyLines: params.bodyLines,
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
   * Low-level send. Prefer `sendPlatformTransactional` for product emails.
   */
  async sendTransactional(params: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    fromDisplayName?: string;
  }): Promise<void> {
    const transporter = this.getTransporter();
    const from = this.config.get<string>('EMAIL_ID')?.trim();
    if (!transporter || !from) {
      return;
    }
    const to = params.to.trim();
    if (!to) {
      return;
    }
    const displayName =
      params.fromDisplayName?.trim() || this.platformBrand();
    const html = params.html ?? `<p>${escapeHtml(params.text)}</p>`;
    try {
      await transporter.sendMail({
        from: `"${displayName}" <${from}>`,
        to,
        subject: params.subject,
        text: params.text,
        html,
      });
    } catch (err) {
      this.log.error(
        err instanceof Error ? err.message : 'sendMail failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
