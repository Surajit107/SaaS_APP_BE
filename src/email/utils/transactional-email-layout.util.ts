import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml } from './html-escape.util';

export function formatIsoForEmail(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString('en-IN', {
    dateStyle: 'long',
    timeStyle: 'short',
  });
}

/** Brand accent (cyan) — aligns with product logo. */
const CTA_BG = '#06b6d4';

let cachedLogoDataUri: string | undefined;

function getLogoDataUri(): string | null {
  if (cachedLogoDataUri !== undefined) {
    return cachedLogoDataUri || null;
  }
  try {
    const logoPath = join(__dirname, 'logo.png');
    if (!existsSync(logoPath)) {
      cachedLogoDataUri = '';
      return null;
    }
    const buf = readFileSync(logoPath);
    cachedLogoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
    return cachedLogoDataUri;
  } catch {
    cachedLogoDataUri = '';
    return null;
  }
}

function paragraphsHtml(lines: string[]): string {
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  return nonEmpty
    .map(
      (l) =>
        `<p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.55">${escapeHtml(l)}</p>`,
    )
    .join('');
}

function primaryActionBlock(action: { href: string; label: string }): string {
  const safeHref = escapeHtml(action.href);
  const safeLabel = escapeHtml(action.label);
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:6px 0 22px;">
<tr><td align="left">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="12%" strokecolor="${CTA_BG}" fillcolor="${CTA_BG}">
<w:anchorlock/>
<center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:600;">${safeLabel}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="${safeHref}" style="display:inline-block;padding:14px 26px;background:${CTA_BG};color:#ffffff !important;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;line-height:1.2;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;mso-hide:all;">${safeLabel}</a>
<!--<![endif]-->
</td></tr>
<tr><td style="padding-top:12px;">
<p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">If the button does not work, copy and paste this link into your browser:<br />
<span style="word-break:break-all;color:#475569;">${safeHref}</span></p>
</td></tr>
</table>`;
}

export function buildTransactionalMail(params: {
  brand: string;
  headline: string;
  bodyLines: string[];
  /**
   * Paragraphs after the main `bodyLines` (and after the CTA when `primaryAction` is set),
   * e.g. “ignore this email” disclaimers.
   */
  postActionLines?: string[];
  footerHint?: string;
  /** When set, replaces the default dark header ("Platform" + brand). */
  header?: { eyebrow: string; title: string };
  textSignature?: string;
  primaryAction?: { href: string; label: string };
}): { text: string; html: string } {
  const { brand, headline, bodyLines } = params;
  const footerHint =
    params.footerHint ??
    `This automated email was sent by ${brand}. Please do not reply — this inbox is not monitored. If you did not expect this message, you can ignore it.`;

  const headerEyebrow = params.header?.eyebrow ?? 'Platform';
  const headerTitle = params.header?.title ?? brand;
  const textSignature = params.textSignature ?? `— ${brand}`;

  const preCta = bodyLines.filter((l) => l.trim().length > 0);
  const postCta = (params.postActionLines ?? []).filter(
    (l) => l.trim().length > 0,
  );

  const textParts: string[] = [headline, '', ...preCta];
  if (params.primaryAction) {
    textParts.push(
      '',
      `${params.primaryAction.label}: ${params.primaryAction.href}`,
    );
  }
  if (postCta.length > 0) {
    textParts.push('', ...postCta);
  }
  textParts.push('', textSignature, '', footerHint);

  const text = textParts.join('\n');

  const bodyHtmlMain = paragraphsHtml(preCta);
  const ctaHtml = params.primaryAction
    ? primaryActionBlock(params.primaryAction)
    : '';
  const bodyHtmlAfter = paragraphsHtml(postCta);

  const logoUri = getLogoDataUri();
  const logoBlock =
    logoUri !== null
      ? `<img src="${logoUri}" alt="${escapeHtml(brand)}" width="132" height="auto" style="display:block;max-width:140px;height:auto;border:0;outline:none;text-decoration:none;" />`
      : '';

  const headerInner =
    logoUri !== null
      ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
<td style="width:1%;vertical-align:middle;padding-right:18px;background:#000000;border-radius:8px;padding:12px 16px;">
${logoBlock}
</td>
<td style="vertical-align:middle;">
<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;margin-bottom:6px;">${escapeHtml(headerEyebrow)}</div>
<div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;">${escapeHtml(headerTitle)}</div>
</td>
</tr></table>`
      : `<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;margin-bottom:6px;">${escapeHtml(headerEyebrow)}</div>
<div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;">${escapeHtml(headerTitle)}</div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="x-ua-compatible" content="ie=edge">
<title>${escapeHtml(headline)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
<tr>
<td style="padding:22px 26px;background:linear-gradient(135deg,#020617 0%,#0f172a 55%,#1e293b 100%);color:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
${headerInner}
</td>
</tr>
<tr>
<td style="padding:28px 26px 8px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<h1 style="margin:0 0 18px;font-size:20px;font-weight:600;color:#0f172a;line-height:1.35;">${escapeHtml(headline)}</h1>
${bodyHtmlMain}
${ctaHtml}
${bodyHtmlAfter}
</td>
</tr>
<tr>
<td style="padding:18px 26px 26px;border-top:1px solid #e2e8f0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">
<p style="margin:0;font-size:12px;line-height:1.55;color:#64748b;">${escapeHtml(footerHint)}</p>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { text, html };
}
