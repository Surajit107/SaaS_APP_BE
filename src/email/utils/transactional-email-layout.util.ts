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

export function buildTransactionalMail(params: {
  brand: string;
  headline: string;
  bodyLines: string[];
  /** Shown in plain text and small footer in HTML */
  footerHint?: string;
  /** When set, replaces the default dark header ("Platform" + brand). */
  header?: { eyebrow: string; title: string };
  /** Plain-text line before the footer (default: em dash + brand). */
  textSignature?: string;
}): { text: string; html: string } {
  const { brand, headline, bodyLines } = params;
  const footerHint =
    params.footerHint ??
    `This email was sent by ${brand}. If you did not expect it, you can ignore this message.`;

  const headerEyebrow = params.header?.eyebrow ?? 'Platform';
  const headerTitle = params.header?.title ?? brand;
  const textSignature = params.textSignature ?? `— ${brand}`;

  const nonEmptyBody = bodyLines.filter((l) => l.trim().length > 0);
  const text = [
    headline,
    '',
    ...nonEmptyBody,
    '',
    textSignature,
    '',
    footerHint,
  ].join('\n');

  const bodyHtml = nonEmptyBody
    .map(
      (l) =>
        `<p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.55">${escapeHtml(l)}</p>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(headline)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
<tr>
<td style="padding:22px 26px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#f8fafc;">
<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;margin-bottom:6px;">${escapeHtml(headerEyebrow)}</div>
<div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;">${escapeHtml(headerTitle)}</div>
</td>
</tr>
<tr>
<td style="padding:28px 26px 8px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<h1 style="margin:0 0 18px;font-size:19px;font-weight:600;color:#0f172a;line-height:1.3;">${escapeHtml(headline)}</h1>
${bodyHtml}
</td>
</tr>
<tr>
<td style="padding:18px 26px 24px;border-top:1px solid #e2e8f0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
<p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">${escapeHtml(footerHint)}</p>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { text, html };
}
