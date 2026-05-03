import { Injectable } from '@nestjs/common';
import type { ApiSuccessResponse } from '../common/types/api-response.types';
import { CreateUserDto } from './dto/create-user.dto';
import { UserRepository } from './repositories/user.repository';

@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  getModuleStatus(): ApiSuccessResponse<{
    module: string;
    dbReady: boolean;
  }> {
    return {
      success: true,
      message: 'User module ready',
      data: {
        module: 'user',
        dbReady: this.userRepository.isMongooseReady(),
      },
    };
  }

  validateCreatePayload(
    dto: CreateUserDto,
  ): ApiSuccessResponse<{ received: CreateUserDto }> {
    return {
      success: true,
      message: 'Payload validated (user creation not implemented)',
      data: { received: dto },
    };
  }
}
