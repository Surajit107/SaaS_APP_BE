import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiSuccessResponse } from '../common/types/api-response.types';

export type PlatformAiChatbotStatusData = {
  openrouterKeyConfigured: boolean;
  groqKeyConfigured: boolean;
  geminiKeyConfigured: boolean;
  providerOrder: string;
  modelOpenrouter: string;
  modelGroq: string;
  modelGemini: string;
  systemPromptConfigured: boolean;
};

@Injectable()
export class PlatformAiChatbotService {
  constructor(private readonly config: ConfigService) {}

  getStatus(): ApiSuccessResponse<PlatformAiChatbotStatusData> {
    const providerOrder =
      this.config.get<string>('CHATBOT_PROVIDER_ORDER')?.trim() ?? 'openrouter,groq,gemini';
    return {
      success: true,
      message: 'OK',
      data: {
        openrouterKeyConfigured: Boolean(this.config.get<string>('OPENROUTER_API_KEY')?.trim()),
        groqKeyConfigured: Boolean(this.config.get<string>('GROQ_API_KEY')?.trim()),
        geminiKeyConfigured: Boolean(this.config.get<string>('GEMINI_API_KEY')?.trim()),
        providerOrder,
        modelOpenrouter:
          this.config.get<string>('CHATBOT_MODEL_OPENROUTER')?.trim() ?? 'openai/gpt-4o-mini',
        modelGroq: this.config.get<string>('CHATBOT_MODEL_GROQ')?.trim() ?? 'llama-3.3-70b-versatile',
        modelGemini: this.config.get<string>('CHATBOT_MODEL_GEMINI')?.trim() ?? 'gemini-2.0-flash',
        systemPromptConfigured: Boolean(this.config.get<string>('CHATBOT_SYSTEM_PROMPT')?.trim()),
      },
    };
  }
}
