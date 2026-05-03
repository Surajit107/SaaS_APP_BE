import { Injectable } from '@nestjs/common';
import type { ApiSuccessResponse } from './common/types/api-response.types';

@Injectable()
export class AppService {
  getHealth(): ApiSuccessResponse<{ status: string }> {
    return {
      success: true,
      message: 'OK',
      data: { status: 'up' },
    };
  }

  getApiRoot(): ApiSuccessResponse<{
    health: string;
    docs: string;
    openApiJson: string;
  }> {
    return {
      success: true,
      message: 'SaaS API',
      data: {
        health: '/api/health',
        docs: '/api/docs',
        openApiJson: '/api/docs/json',
      },
    };
  }
}
