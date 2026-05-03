import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModule } from '../user/user.module';
import { TenantModule } from '../tenant/tenant.module';
import { EmailModule } from '../email/email.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { TenantAdminGuard } from './guards/tenant-admin.guard';
import { TenantGuard } from './guards/tenant.guard';
import { AuthIdentityRepository } from './repositories/auth-identity.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import {
  AuthIdentity,
  AuthIdentitySchema,
} from './schemas/auth-identity.schema';
import {
  RefreshToken,
  RefreshTokenSchema,
} from './schemas/refresh-token.schema';
import { parseJwtExpiresIn } from './utils/jwt-expires.util';

@Module({
  imports: [
    UserModule,
    forwardRef(() => TenantModule),
    EmailModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: parseJwtExpiresIn(
            configService.get<string>('JWT_ACCESS_EXPIRES_IN'),
            '15m',
          ),
        },
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: AuthIdentity.name, schema: AuthIdentitySchema },
      { name: RefreshToken.name, schema: RefreshTokenSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthIdentityRepository,
    RefreshTokenRepository,
    JwtAuthGuard,
    TenantGuard,
    TenantAdminGuard,
    PlatformAdminGuard,
  ],
  exports: [
    AuthService,
    JwtModule,
    JwtAuthGuard,
    TenantGuard,
    TenantAdminGuard,
    PlatformAdminGuard,
  ],
})
export class AuthModule {}
