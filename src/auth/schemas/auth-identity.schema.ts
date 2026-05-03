import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AuthIdentityDocument = HydratedDocument<AuthIdentity>;

@Schema({ timestamps: true, collection: 'auth_identities' })
export class AuthIdentity {
  @Prop({ required: true, index: true })
  tenantId: string;

  @Prop({ required: true })
  provider: string;

  @Prop({ required: true })
  externalSubject: string;
}

export const AuthIdentitySchema = SchemaFactory.createForClass(AuthIdentity);
AuthIdentitySchema.index({ tenantId: 1, createdAt: -1 });
