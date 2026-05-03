import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'API entry — links to health and Swagger' })
  root() {
    return this.appService.getApiRoot();
  }

  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  health() {
    return this.appService.getHealth();
  }
}
