import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import { Task, TaskDocument } from '../schemas/task.schema';
import {
  TASK_STATUS_VALUES,
  TaskStatus,
  TaskStatusCounts,
} from '../types/task.types';

export type CreateTaskRecordInput = {
  workspaceId: string;
  tenantId: string;
  title: string;
  description: string | null;
  attachmentUrls: string[];
  status: TaskStatus;
  assignedTo: string | null;
  createdBy: string;
};

export type UpdateTaskRecordInput = {
  title?: string;
  description?: string | null;
  attachmentUrls?: string[];
  status?: TaskStatus;
  assignedTo?: string | null;
};

@Injectable()
export class TaskRepository {
  constructor(@InjectModel(Task.name) private readonly model: Model<Task>) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  create(
    input: CreateTaskRecordInput,
    session?: ClientSession,
  ): Promise<TaskDocument> {
    const doc = new this.model({
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      title: input.title,
      description: input.description,
      attachmentUrls: input.attachmentUrls,
      status: input.status,
      assignedTo: input.assignedTo,
      createdBy: input.createdBy,
      deletedAt: null,
    });
    return doc.save({ session });
  }

  private buildFilter(params: {
    tenantId: string;
    workspaceId: string;
    status?: TaskStatus;
    assignedTo?: string;
    search?: string;
  }): Record<string, unknown> {
    const filter: Record<string, unknown> = {
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      deletedAt: null,
    };
    if (params.status) {
      filter.status = params.status;
    }
    if (params.assignedTo) {
      filter.assignedTo = params.assignedTo;
    }
    if (params.search) {
      filter.$text = { $search: params.search };
    }
    return filter;
  }

  /** Cross-workspace filter — omits workspaceId, always scopes by assignedTo. */
  private buildUserFilter(params: {
    tenantId: string;
    assignedTo: string;
    status?: TaskStatus;
    search?: string;
  }): Record<string, unknown> {
    const filter: Record<string, unknown> = {
      tenantId: params.tenantId,
      assignedTo: params.assignedTo,
      deletedAt: null,
    };
    if (params.status) {
      filter.status = params.status;
    }
    if (params.search) {
      filter.$text = { $search: params.search };
    }
    return filter;
  }

  async findMyTasksPaginated(params: {
    tenantId: string;
    assignedTo: string;
    status?: TaskStatus;
    search?: string;
    skip: number;
    limit: number;
  }): Promise<{ items: TaskDocument[]; total: number }> {
    const filter = this.buildUserFilter(params);

    const findQuery = this.model.find(filter).skip(params.skip).limit(params.limit);
    if (params.search) {
      findQuery
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
        .select({ score: { $meta: 'textScore' } });
    } else {
      findQuery.sort({ createdAt: -1 });
    }

    const [items, total] = await Promise.all([
      findQuery.exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  async countMyTasksByStatus(params: {
    tenantId: string;
    assignedTo: string;
    search?: string;
  }): Promise<TaskStatusCounts> {
    const filter = this.buildUserFilter(params);

    const grouped = await this.model
      .aggregate<{ _id: TaskStatus; count: number }>([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();

    const counts = TASK_STATUS_VALUES.reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as TaskStatusCounts,
    );

    for (const row of grouped) {
      if (row._id !== null && row._id !== undefined && TASK_STATUS_VALUES.includes(row._id)) {
        counts[row._id] = row.count;
      }
    }
    return counts;
  }

  async countByStatusForWorkspace(params: {
    tenantId: string;
    workspaceId: string;
    assignedTo?: string;
    search?: string;
  }): Promise<TaskStatusCounts> {
    const filter = this.buildFilter({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      assignedTo: params.assignedTo,
      search: params.search,
    });

    const grouped = await this.model
      .aggregate<{ _id: TaskStatus; count: number }>([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();

    const counts = TASK_STATUS_VALUES.reduce((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {} as TaskStatusCounts);

    for (const row of grouped) {
      if (
        row._id !== null &&
        row._id !== undefined &&
        TASK_STATUS_VALUES.includes(row._id)
      ) {
        counts[row._id] = row.count;
      }
    }
    return counts;
  }

  async findManyPaginated(params: {
    tenantId: string;
    workspaceId: string;
    status?: TaskStatus;
    assignedTo?: string;
    search?: string;
    skip: number;
    limit: number;
  }): Promise<{ items: TaskDocument[]; total: number }> {
    const filter = this.buildFilter(params);

    const findQuery = this.model.find(filter).skip(params.skip).limit(params.limit);
    if (params.search) {
      findQuery
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
        .select({ score: { $meta: 'textScore' } });
    } else {
      findQuery.sort({ createdAt: -1 });
    }

    const [items, total] = await Promise.all([
      findQuery.exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  findActiveByIdAndWorkspace(
    taskId: string,
    workspaceId: string,
    tenantId: string,
    session?: ClientSession,
  ): Promise<TaskDocument | null> {
    if (!Types.ObjectId.isValid(taskId)) {
      return Promise.resolve(null);
    }
    return this.model
      .findOne({
        _id: new Types.ObjectId(taskId),
        workspaceId,
        tenantId,
        deletedAt: null,
      })
      .session(session ?? null)
      .exec();
  }

  updateByIdAndWorkspace(
    taskId: string,
    workspaceId: string,
    tenantId: string,
    input: UpdateTaskRecordInput,
    session?: ClientSession,
  ): Promise<TaskDocument | null> {
    if (!Types.ObjectId.isValid(taskId)) {
      return Promise.resolve(null);
    }
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(taskId),
          workspaceId,
          tenantId,
          deletedAt: null,
        },
        { $set: input },
        { returnDocument: 'after', session },
      )
      .exec();
  }

  async softDeleteByIdAndWorkspace(
    taskId: string,
    workspaceId: string,
    tenantId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(taskId)) {
      return false;
    }
    const result = await this.model
      .updateOne(
        {
          _id: new Types.ObjectId(taskId),
          workspaceId,
          tenantId,
          deletedAt: null,
        },
        { $set: { deletedAt: new Date() } },
      )
      .session(session ?? null)
      .exec();
    return result.modifiedCount > 0;
  }

  /** Cascade soft-delete all active tasks belonging to a workspace. */
  async softDeleteAllByWorkspace(
    workspaceId: string,
    tenantId: string,
    session?: ClientSession,
  ): Promise<number> {
    const result = await this.model
      .updateMany(
        { workspaceId, tenantId, deletedAt: null },
        { $set: { deletedAt: new Date() } },
      )
      .session(session ?? null)
      .exec();
    return result.modifiedCount;
  }

  async executeInTransaction<T>(
    operation: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.model.db.startSession();
    try {
      session.startTransaction();
      const result = await operation(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
