import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthenticatedRequestUser } from '../types/auth-request-user.types';
import { AuthThrottle } from '../utils/auth-throttle.util';
import {
  DisableTotpDto,
  EnableTotpDto,
  RegenerateBackupCodesDto,
  UpdateMfaPreferencesDto,
} from './dto/mfa.dto';
import { MfaService } from './mfa.service';

/**
 * Self-service second-factor management.
 *
 * Guarded by `JwtAuthGuard` alone — deliberately *not* `TenantGuard`, so
 * platform operators (who carry an empty tenantId) can manage their own
 * security settings too.
 */
@ApiTags('Auth')
@Controller('auth/mfa')
@UseGuards(ThrottlerGuard, JwtAuthGuard)
@ApiBearerAuth('access-token')
@Throttle(AuthThrottle.manageMfa)
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  @Get('status')
  @ApiOperation({ summary: 'Second-factor state for the signed-in user' })
  async status(@CurrentUser() user: AuthenticatedRequestUser | undefined) {
    return this.mfaService.getStatus(requireUser(user));
  }

  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Begin authenticator enrollment. Returns a QR code and secret; nothing is enforced until POST /auth/mfa/totp/enable succeeds.',
  })
  @ApiResponse({ status: 409, description: 'Already enabled' })
  async setupTotp(@CurrentUser() user: AuthenticatedRequestUser | undefined) {
    return this.mfaService.startTotpEnrollment(requireUser(user));
  }

  @Post('totp/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm the authenticator code and switch on 2FA. Returns recovery codes exactly once.',
  })
  @ApiResponse({
    status: 401,
    description: 'Code did not match, or no pending enrollment',
  })
  async enableTotp(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: EnableTotpDto,
  ) {
    return this.mfaService.enableTotp(requireUser(user), body);
  }

  @Post('totp/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Turn off 2FA. Requires the password and a current code; signs out every session.',
  })
  @ApiResponse({ status: 401, description: 'Password or code did not match' })
  async disableTotp(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: DisableTotpDto,
  ) {
    return this.mfaService.disableTotp(requireUser(user), body);
  }

  @Post('backup-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Replace all recovery codes. Previous codes stop working immediately.',
  })
  @ApiResponse({ status: 401, description: 'Password did not match' })
  async regenerateBackupCodes(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: RegenerateBackupCodesDto,
  ) {
    return this.mfaService.regenerateBackupCodes(requireUser(user), body);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Toggle passwordless sign-in with an emailed code' })
  async updatePreferences(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: UpdateMfaPreferencesDto,
  ) {
    return this.mfaService.updatePreferences(requireUser(user), body);
  }
}

function requireUser(
  user: AuthenticatedRequestUser | undefined,
): AuthenticatedRequestUser {
  if (!user) {
    throw new UnauthorizedException();
  }
  return user;
}
