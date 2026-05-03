import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import { Workspace, WorkspaceDocument } from '../schemas/workspace.schema';

export interface CreateWorkspaceRecordInput {
  tenantId: string;
  name: string;
}

@Injectable()
export class WorkspaceRepository {
  constructor(
    @InjectModel(Workspace.name) private readonly model: Model<Workspace>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  create(
    input: CreateWorkspaceRecordInput,
    session?: ClientSession,
  ): Promise<WorkspaceDocument> {
    const doc = new this.model({ tenantId: input.tenantId, name: input.name });
    return doc.save({ session });
  }

  findAllByTenant(tenantId: string): Promise<WorkspaceDocument[]> {
    return this.model
      .find({ tenantId })
      .sort({ createdAt: -1 })
      .exec();
  }

  findByIdAndTenant(
    workspaceId: string,
    tenantId: string,
  ): Promise<WorkspaceDocument | null> {
    if (!Types.ObjectId.isValid(workspaceId)) {
      return Promise.resolve(null);
    }
    return this.model
      .findOne({ _id: new Types.ObjectId(workspaceId), tenantId })
      .exec();
  }

  deleteByIdAndTenant(
    workspaceId: string,
    tenantId: string,
    session?: ClientSession,
  ): Promise<{ deletedCount: number }> {
    if (!Types.ObjectId.isValid(workspaceId)) {
      return Promise.resolve({ deletedCount: 0 });
    }
    return this.model
      .deleteOne({ _id: new Types.ObjectId(workspaceId), tenantId })
      .session(session ?? null)
      .exec();
  }

  countByTenantId(tenantId: string): Promise<number> {
    return this.model.countDocuments({ tenantId }).exec();
  }
}
