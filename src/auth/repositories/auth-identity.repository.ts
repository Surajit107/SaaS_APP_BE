import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import { AuthIdentity } from '../schemas/auth-identity.schema';

@Injectable()
export class AuthIdentityRepository {
  constructor(
    @InjectModel(AuthIdentity.name)
    private readonly model: Model<AuthIdentity>,
  ) {}

  /** True when this model’s Mongoose connection is connected (no collection query). */
  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }
}
