import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateUserDto } from './dto/create-user.dto';
import { UserService } from './user.service';

@ApiTags('User')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('status')
  @ApiOperation({ summary: 'User module health' })
  status() {
    return this.userService.getModuleStatus();
  }

  @Post()
  @ApiOperation({ summary: 'Example validated create user body' })
  create(@Body() body: CreateUserDto) {
    return this.userService.validateCreatePayload(body);
  }
}
