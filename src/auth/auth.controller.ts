import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenBodyDto } from './dto/refresh-token-body.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestLoginCodeDto } from './dto/request-login-code.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TenantGuard } from './guards/tenant.guard';
import { AuthService, isMfaRequired } from './auth.service';
import type { AuthSessionPayload } from './auth.service';
import { VerifyMfaDto } from './mfa/dto/mfa.dto';
import { AuthenticatedRequestUser } from './types/auth-request-user.types';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  buildAuthCookieClearOptions,
  buildAuthCookieOptions,
} from './utils/auth-cookie.util';
import { AuthThrottle } from './utils/auth-throttle.util';

@ApiTags('Auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Auth module health' })
  status() {
    return this.authService.getModuleStatus();
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(AuthThrottle.register)
  @ApiOperation({
    summary:
      'Register the first user and a new organization (tenant is created server-side). Sends email verification — no session until POST /auth/verify-email then POST /auth/login.',
  })
  @ApiResponse({ status: 409, description: 'User already exists' })
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle(AuthThrottle.verifyEmail)
  @ApiOperation({
    summary:
      'Confirm the registering user’s email using the token from the verification message.',
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  async verifyEmail(@Body() body: VerifyEmailDto) {
    return this.authService.verifyEmail(body);
  }

  @Post('login')
  @Throttle(AuthThrottle.login)
  @ApiOperation({
    summary:
      'Log in with email and password. For tenant scope, send tenantRole (admin|member) matching the sign-in page; platform scope omits tenantRole.',
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many sign-in attempts' })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(body);
    // A challenge is not a session: no cookies until the second factor passes.
    if (!isMfaRequired(result.data)) {
      this.setSessionCookies(response, result.data);
    }
    return result;
  }

  @Post('login/email-code')
  @HttpCode(HttpStatus.OK)
  @Throttle(AuthThrottle.requestLoginCode)
  @ApiOperation({
    summary:
      'Email a one-time sign-in code. Answers with a challenge to complete at POST /auth/mfa/verify. The response never reveals whether the address belongs to an account.',
  })
  @ApiResponse({ status: 429, description: 'Too many code requests' })
  async requestLoginCode(@Body() body: RequestLoginCodeDto) {
    return this.authService.requestLoginCode(body);
  }

  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(AuthThrottle.verifyCode)
  @ApiOperation({
    summary:
      'Finish a sign-in that requires a second factor. Accepts a 6-digit authenticator code or a recovery code.',
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired challenge, or wrong code' })
  @ApiResponse({ status: 429, description: 'Too many verification attempts' })
  async verifyMfa(
    @Body() body: VerifyMfaDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.verifyMfaChallenge(body);
    this.setSessionCookies(response, result.data);
    return result;
  }

  @Post('refresh')
  @ApiOperation({
    summary:
      'Rotate refresh token and issue a new access token (single-use refresh)',
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh' })
  async refresh(
    @Req() request: Request,
    @Body() body: RefreshTokenBodyDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.readRefreshToken(request, body);
    if (refreshToken === undefined) {
      throw new UnauthorizedException('Refresh token required');
    }
    const result = await this.authService.refresh(refreshToken);
    this.setSessionCookies(response, result.data);
    return result;
  }

  @Post('logout')
  @ApiOperation({ summary: 'Invalidate the presented refresh token' })
  @ApiResponse({ status: 401, description: 'Invalid refresh' })
  async logout(
    @Req() request: Request,
    @Body() body: RefreshTokenBodyDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.readRefreshToken(request, body);
    const result = await this.authService.logout(refreshToken);
    this.clearSessionCookies(response);
    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Current user from access JWT' })
  async me(@CurrentUser() user: AuthenticatedRequestUser | undefined) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.authService.getMe(user);
  }

  private readRefreshToken(
    request: Request,
    body: RefreshTokenBodyDto,
  ): string | undefined {
    const cookieToken = request.cookies?.[REFRESH_TOKEN_COOKIE];
    if (typeof cookieToken === 'string' && cookieToken.trim().length > 0) {
      return cookieToken;
    }
    if (
      typeof body.refreshToken === 'string' &&
      body.refreshToken.trim().length > 0
    ) {
      return body.refreshToken;
    }
    return undefined;
  }

  private setSessionCookies(
    response: Response,
    session: AuthSessionPayload,
  ): void {
    const cookieOptions = buildAuthCookieOptions(
      this.configService,
      session.expiresIn,
    );
    response.cookie(ACCESS_TOKEN_COOKIE, session.accessToken, cookieOptions.access);
    response.cookie(
      REFRESH_TOKEN_COOKIE,
      session.refreshToken,
      cookieOptions.refresh,
    );
  }

  private clearSessionCookies(response: Response): void {
    const cookieOptions = buildAuthCookieClearOptions(this.configService);
    response.clearCookie(ACCESS_TOKEN_COOKIE, cookieOptions.access);
    response.clearCookie(REFRESH_TOKEN_COOKIE, cookieOptions.refresh);
  }
}
