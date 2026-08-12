import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { buildThrottlerOptions } from './common/throttler/throttler.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CommonModule } from './common/common.module';
import { EmailModule } from './email/email.module';
import { FileModule } from './file/file.module';
import { NotificationModule } from './notification/notification.module';
import { PlatformModule } from './platform/platform.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantUserModule } from './tenant-user/tenant-user.module';
import { UserModule } from './user/user.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { ChatbotModule } from './chatbot/chatbot.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        '.env.local',
        '.env',
        'backend/.env.local',
        'backend/.env',
      ],
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: buildThrottlerOptions,
      inject: [ConfigService],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    CommonModule,
    AuthModule,
    PlatformModule,
    TenantModule,
    TenantUserModule,
    UserModule,
    BillingModule,
    WorkspaceModule,
    FileModule,
    NotificationModule,
    EmailModule,
    ChatbotModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
