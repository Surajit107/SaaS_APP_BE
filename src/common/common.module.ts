import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SecretCipherService } from './crypto/secret-cipher.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [SecretCipherService],
  exports: [SecretCipherService],
})
export class CommonModule {}
