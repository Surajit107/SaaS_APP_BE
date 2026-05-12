import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatLlmCompletionResult, ChatLlmMessage } from '../types/chat-llm.types';

type ProviderId = 'openrouter' | 'groq' | 'gemini';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const GEMINI_GENERATE = 'https://generativelanguage.googleapis.com/v1beta/models';

@Injectable()
export class LlmRouterService {
  constructor(private readonly config: ConfigService) {}

  private parseProviderOrder(): ProviderId[] {
    const raw =
      this.config.get<string>('CHATBOT_PROVIDER_ORDER') ?? 'openrouter,groq,gemini';
    const parts = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is ProviderId => s === 'openrouter' || s === 'groq' || s === 'gemini');
    const unique: ProviderId[] = [];
    for (const p of parts) {
      if (!unique.includes(p)) {
        unique.push(p);
      }
    }
    return unique.length > 0 ? unique : ['openrouter', 'groq', 'gemini'];
  }

  private timeoutMs(): number {
    const n = Number(this.config.get<string>('CHATBOT_UPSTREAM_TIMEOUT_MS') ?? '55000');
    if (!Number.isFinite(n) || n < 5000) {
      return 55000;
    }
    return Math.min(n, 120_000);
  }

  async complete(messages: readonly ChatLlmMessage[]): Promise<ChatLlmCompletionResult> {
    const order = this.parseProviderOrder();
    const errors: string[] = [];
    for (const provider of order) {
      try {
        if (provider === 'openrouter') {
          return await this.completeOpenRouter(messages);
        }
        if (provider === 'groq') {
          return await this.completeGroq(messages);
        }
        return await this.completeGemini(messages);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${provider}: ${msg}`);
      }
    }
    throw new ServiceUnavailableException(
      `All LLM providers failed. Last errors: ${errors.join(' | ')}`,
    );
  }

  private async completeOpenRouter(
    messages: readonly ChatLlmMessage[],
  ): Promise<ChatLlmCompletionResult> {
    const key = this.config.get<string>('OPENROUTER_API_KEY')?.trim();
    if (!key) {
      throw new BadGatewayException('OpenRouter API key is not configured');
    }
    const model =
      this.config.get<string>('CHATBOT_MODEL_OPENROUTER')?.trim() ?? 'openai/gpt-4o-mini';
    const text = await this.openAiCompatibleChat(
      OPENROUTER_BASE,
      key,
      model,
      messages,
      {
        'HTTP-Referer':
          this.config.get<string>('OPENROUTER_HTTP_REFERER')?.trim() ?? 'http://localhost',
        'X-Title': this.config.get<string>('OPENROUTER_APP_TITLE')?.trim() ?? 'SaaS Backend',
      },
    );
    return { text, provider: 'openrouter', model };
  }

  private async completeGroq(messages: readonly ChatLlmMessage[]): Promise<ChatLlmCompletionResult> {
    const key = this.config.get<string>('GROQ_API_KEY')?.trim();
    if (!key) {
      throw new BadGatewayException('Groq API key is not configured');
    }
    const model =
      this.config.get<string>('CHATBOT_MODEL_GROQ')?.trim() ?? 'llama-3.3-70b-versatile';
    const text = await this.openAiCompatibleChat(GROQ_BASE, key, model, messages, {});
    return { text, provider: 'groq', model };
  }

  private async openAiCompatibleChat(
    baseUrl: string,
    apiKey: string,
    model: string,
    messages: readonly ChatLlmMessage[],
    extraHeaders: Record<string, string>,
  ): Promise<string> {
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...extraHeaders,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.6,
        }),
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new BadGatewayException(
          `OpenAI-compatible upstream HTTP ${res.status}: ${raw.slice(0, 500)}`,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw new BadGatewayException('OpenAI-compatible upstream returned non-JSON');
      }
      const text = extractOpenAiChoiceText(parsed);
      if (text.length === 0) {
        throw new BadGatewayException('OpenAI-compatible upstream returned empty content');
      }
      return text;
    } finally {
      clearTimeout(t);
    }
  }

  private async completeGemini(messages: readonly ChatLlmMessage[]): Promise<ChatLlmCompletionResult> {
    const key = this.config.get<string>('GEMINI_API_KEY')?.trim();
    if (!key) {
      throw new BadGatewayException('Gemini API key is not configured');
    }
    const model =
      this.config.get<string>('CHATBOT_MODEL_GEMINI')?.trim() ?? 'gemini-2.0-flash';
    const systemTexts: string[] = [];
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    for (const m of messages) {
      if (m.role === 'system') {
        systemTexts.push(m.content);
        continue;
      }
      const role = m.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: m.content }] });
    }
    const body: Record<string, unknown> = { contents };
    if (systemTexts.length > 0) {
      body.systemInstruction = {
        parts: [{ text: systemTexts.join('\n\n') }],
      };
    }
    const url = `${GEMINI_GENERATE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new BadGatewayException(`Gemini HTTP ${res.status}: ${raw.slice(0, 500)}`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw new BadGatewayException('Gemini returned non-JSON');
      }
      const text = extractGeminiText(parsed);
      if (text.length === 0) {
        throw new BadGatewayException('Gemini returned empty content');
      }
      return { text, provider: 'gemini', model };
    } finally {
      clearTimeout(t);
    }
  }
}

function extractOpenAiChoiceText(parsed: unknown): string {
  if (typeof parsed !== 'object' || parsed === null) {
    return '';
  }
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }
  const msg = (choices[0] as { message?: { content?: unknown } }).message;
  const content = msg?.content;
  if (typeof content === 'string') {
    return content;
  }
  return '';
}

function extractGeminiText(parsed: unknown): string {
  if (typeof parsed !== 'object' || parsed === null) {
    return '';
  }
  const candidates = (parsed as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return '';
  }
  const c0 = candidates[0] as { content?: { parts?: unknown } };
  const parts = c0.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return '';
  }
  const p0 = parts[0] as { text?: unknown };
  return typeof p0.text === 'string' ? p0.text : '';
}
