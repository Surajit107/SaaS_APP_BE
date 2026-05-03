import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('status')
  @ApiOperation({ summary: 'Billing module health' })
  status() {
    return this.billingService.getModuleStatus();
  }
}
