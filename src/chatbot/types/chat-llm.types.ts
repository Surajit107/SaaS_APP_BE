export type ChatLlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatLlmCompletionResult = {
  text: string;
  provider: 'openrouter' | 'groq' | 'gemini';
  model: string;
};
