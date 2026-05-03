import { Injectable } from '@nestjs/common';
import type { ApiSuccessResponse } from '../common/types/api-response.types';
import { SubscriptionRepository } from './repositories/subscription.repository';

@Injectable()
export class BillingService {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
  ) {}

  getModuleStatus(): ApiSuccessResponse<{
    module: string;
    dbReady: boolean;
  }> {
    return {
      success: true,
      message: 'Billing module ready',
      data: {
        module: 'billing',
        dbReady: this.subscriptionRepository.isMongooseReady(),
      },
    };
  }
}
