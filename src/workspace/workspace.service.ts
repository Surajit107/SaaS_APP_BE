import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ApiSuccessResponse } from '../common/types/api-response.types';
import {
  TaskAssignedEventPayload,
  TaskCompletedEventPayload,
  TaskCreatedEventPayload,
  TaskEventName,
} from '../common/domain-events/task.domain-events';
import { AuthenticatedRequestUser } from '../auth/types/auth-request-user.types';
import { SubscriptionEntitlementsService } from '../billing/services/subscription-entitlements.service';
import { FileService } from '../file/file.service';
import { UserRepository } from '../user/repositories/user.repository';
import { CreateTaskDto } from './dto/create-task.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { WorkspaceRepository } from './repositories/workspace.repository';
import { TaskDocument } from './schemas/task.schema';
import { WorkspaceDocument } from './schemas/workspace.schema';
import { TaskRepository } from './repositories/task.repository';
import { TaskPublic, TaskStatus, TaskStatusCounts } from './types/task.types';

export type WorkspacePublic = {
  id: string;
  tenantId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly userRepository: UserRepository,
    private readonly fileService: FileService,
    private readonly eventEmitter: EventEmitter2,
    private readonly entitlements: SubscriptionEntitlementsService,
  ) {}

  getModuleStatus(): ApiSuccessResponse<{
    module: string;
    dbReady: boolean;
  }> {
    return {
      success: true,
      message: 'Workspace module ready',
      data: {
        module: 'workspace',
        dbReady:
          this.taskRepository.isMongooseReady() &&
          this.workspaceRepository.isMongooseReady(),
      },
    };
  }

  // ─── Workspace CRUD ───────────────────────────────────────────────────────

  async createWorkspace(
    user: AuthenticatedRequestUser,
    dto: CreateWorkspaceDto,
  ): Promise<ApiSuccessResponse<WorkspacePublic>> {
    if (this.isTenantMember(user)) {
      throw new ForbiddenException('Only tenant admins can create workspaces');
    }

    const currentCount = await this.workspaceRepository.countByTenantId(user.tenantId);
    await this.entitlements.assertWithinWorkspaceLimit(user.tenantId, currentCount);

    const created = await this.workspaceRepository.create({
      tenantId: user.tenantId,
      name: dto.name.trim(),
    });

    return {
      success: true,
      message: 'Workspace created',
      data: this.toWorkspacePublic(created),
    };
  }

  async listWorkspaces(
    user: AuthenticatedRequestUser,
  ): Promise<ApiSuccessResponse<WorkspacePublic[]>> {
    const workspaces = await this.workspaceRepository.findAllByTenant(user.tenantId);
    return {
      success: true,
      message: 'Workspaces fetched',
      data: workspaces.map((w) => this.toWorkspacePublic(w)),
    };
  }

  async deleteWorkspace(
    user: AuthenticatedRequestUser,
    workspaceId: string,
  ): Promise<ApiSuccessResponse<{ workspaceId: string; deleted: true }>> {
    if (this.isTenantMember(user)) {
      throw new ForbiddenException('Only tenant admins can delete workspaces');
    }

    const workspace = await this.workspaceRepository.findByIdAndTenant(
      workspaceId,
      user.tenantId,
    );
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    await this.taskRepository.executeInTransaction(async (session) => {
      await this.taskRepository.softDeleteAllByWorkspace(workspaceId, user.tenantId, session);
      const result = await this.workspaceRepository.deleteByIdAndTenant(
        workspaceId,
        user.tenantId,
        session,
      );
      if (result.deletedCount === 0) {
        throw new NotFoundException('Workspace not found');
      }
    });

    return {
      success: true,
      message: 'Workspace deleted',
      data: { workspaceId, deleted: true },
    };
  }

  // ─── Task CRUD ────────────────────────────────────────────────────────────

  async createTask(
    user: AuthenticatedRequestUser,
    workspaceId: string,
    body: CreateTaskDto,
  ): Promise<ApiSuccessResponse<TaskPublic>> {
    if (this.isTenantMember(user)) {
      throw new ForbiddenException('Members cannot create workspace tasks');
    }

    await this.assertWorkspaceBelongsToTenant(workspaceId, user.tenantId);

    if (body.assignedTo) {
      await this.assertAssignedUserInTenant(user.tenantId, body.assignedTo);
    }

    const created = await this.taskRepository.executeInTransaction(async (session) => {
      const draftTask = await this.taskRepository.create(
        {
          workspaceId,
          tenantId: user.tenantId,
          title: body.title.trim(),
          description: body.description?.trim() ?? null,
          attachmentUrls: body.attachmentUrls ?? [],
          status: body.status ?? 'TODO',
          assignedTo: body.assignedTo ?? null,
          createdBy: user.userId,
        },
        session,
      );

      const finalizedAssets = await this.fileService.finalizeTemporaryAssets({
        tenantId: user.tenantId,
        taskId: draftTask.id,
        temporaryPublicIds: body.tempAttachmentPublicIds ?? [],
        scope: 'workspace-tasks',
        session,
      });
      const mergedAttachmentUrls = this.mergeAttachmentUrls(
        draftTask.attachmentUrls,
        finalizedAssets.map((asset) => asset.secureUrl),
      );

      const attachmentsUnchanged =
        mergedAttachmentUrls.length === draftTask.attachmentUrls.length &&
        mergedAttachmentUrls.every(
          (value, index) => value === draftTask.attachmentUrls[index],
        );
      if (attachmentsUnchanged) {
        return draftTask;
      }

      const taskWithFinalAttachments = await this.taskRepository.updateByIdAndWorkspace(
        draftTask.id,
        workspaceId,
        user.tenantId,
        { attachmentUrls: mergedAttachmentUrls },
        session,
      );
      if (!taskWithFinalAttachments) {
        throw new NotFoundException('Task not found after creation');
      }

      return taskWithFinalAttachments;
    });

    const createdPayload: TaskCreatedEventPayload = {
      taskId: created.id,
      workspaceId,
      tenantId: created.tenantId,
      createdBy: user.userId,
      assignedTo: created.assignedTo,
      status: created.status,
    };
    await this.eventEmitter.emitAsync(TaskEventName.Created, createdPayload);

    if (created.assignedTo) {
      const assignedPayload: TaskAssignedEventPayload = {
        taskId: created.id,
        workspaceId,
        tenantId: created.tenantId,
        assignedTo: created.assignedTo,
        assignedBy: user.userId,
      };
      await this.eventEmitter.emitAsync(TaskEventName.Assigned, assignedPayload);
    }
    if (created.status === 'DONE') {
      const completedPayload: TaskCompletedEventPayload = {
        taskId: created.id,
        workspaceId,
        tenantId: created.tenantId,
        completedBy: user.userId,
      };
      await this.eventEmitter.emitAsync(TaskEventName.Completed, completedPayload);
    }

    return {
      success: true,
      message: 'Task created',
      data: this.toTaskPublic(created),
    };
  }

  async listTasks(
    user: AuthenticatedRequestUser,
    workspaceId: string,
    query: ListTasksQueryDto,
  ): Promise<
    ApiSuccessResponse<{
      items: TaskPublic[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      statusCounts: TaskStatusCounts;
    }>
  > {
    await this.assertWorkspaceBelongsToTenant(workspaceId, user.tenantId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const assignedToFilter = this.isTenantMember(user) ? user.userId : query.assignedTo;

    const [listResult, statusCounts] = await Promise.all([
      this.taskRepository.findManyPaginated({
        tenantId: user.tenantId,
        workspaceId,
        status: query.status,
        assignedTo: assignedToFilter,
        search: query.search,
        skip,
        limit,
      }),
      this.taskRepository.countByStatusForWorkspace({
        tenantId: user.tenantId,
        workspaceId,
        assignedTo: assignedToFilter,
        search: query.search,
      }),
    ]);

    const { items, total } = listResult;

    return {
      success: true,
      message: 'Tasks fetched',
      data: {
        items: items.map((task) => this.toTaskPublic(task)),
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        statusCounts,
      },
    };
  }

  async getTaskDetails(
    user: AuthenticatedRequestUser,
    workspaceId: string,
    taskId: string,
  ): Promise<ApiSuccessResponse<TaskPublic>> {
    await this.assertWorkspaceBelongsToTenant(workspaceId, user.tenantId);

    const task = await this.taskRepository.findActiveByIdAndWorkspace(
      taskId,
      workspaceId,
      user.tenantId,
    );
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (this.isTenantMember(user) && task.assignedTo !== user.userId) {
      throw new NotFoundException('Task not found');
    }
    return {
      success: true,
      message: 'Task details fetched',
      data: this.toTaskPublic(task),
    };
  }

  async updateTask(
    user: AuthenticatedRequestUser,
    workspaceId: string,
    taskId: string,
    body: UpdateTaskDto,
  ): Promise<ApiSuccessResponse<TaskPublic>> {
    if (this.isTenantMember(user)) {
      if (body.assignedTo !== undefined) {
        throw new ForbiddenException('Members cannot reassign tasks');
      }
      if (body.attachmentUrls !== undefined || (body.tempAttachmentPublicIds ?? []).length > 0) {
        throw new ForbiddenException('Members cannot change task attachments');
      }
    }

    if (
      body.title === undefined &&
      body.description === undefined &&
      body.attachmentUrls === undefined &&
      body.tempAttachmentPublicIds === undefined &&
      body.status === undefined &&
      body.assignedTo === undefined
    ) {
      throw new BadRequestException('No fields to update');
    }

    await this.assertWorkspaceBelongsToTenant(workspaceId, user.tenantId);

    const updateTransactionResult = await this.taskRepository.executeInTransaction(
      async (session) => {
        const existing = await this.taskRepository.findActiveByIdAndWorkspace(
          taskId,
          workspaceId,
          user.tenantId,
          session,
        );
        if (!existing) {
          throw new NotFoundException('Task not found');
        }

        if (this.isTenantMember(user) && existing.assignedTo !== user.userId) {
          throw new ForbiddenException('You can only update tasks assigned to you');
        }

        if (body.assignedTo && body.assignedTo !== existing.assignedTo) {
          await this.assertAssignedUserInTenant(user.tenantId, body.assignedTo);
        }
        if (
          body.status !== undefined &&
          !this.isStatusTransitionAllowed(existing.status, body.status)
        ) {
          throw new BadRequestException(
            existing.status === 'DONE'
              ? 'Completed tasks cannot change status'
              : `Invalid status transition: ${existing.status} -> ${body.status}`,
          );
        }

        const updatePatch: {
          title?: string;
          description?: string | null;
          attachmentUrls?: string[];
          status?: TaskStatus;
          assignedTo?: string | null;
        } = {};

        if (body.title !== undefined) updatePatch.title = body.title.trim();
        if (body.description !== undefined) updatePatch.description = body.description;
        if (body.status !== undefined) updatePatch.status = body.status;
        if (body.assignedTo !== undefined) updatePatch.assignedTo = body.assignedTo;

        const finalizedAssets = await this.fileService.finalizeTemporaryAssets({
          tenantId: user.tenantId,
          taskId,
          temporaryPublicIds: body.tempAttachmentPublicIds ?? [],
          scope: 'workspace-tasks',
          session,
        });
        const nextAttachmentUrls = this.mergeAttachmentUrls(
          body.attachmentUrls ?? existing.attachmentUrls ?? [],
          finalizedAssets.map((asset) => asset.secureUrl),
        );
        if (body.attachmentUrls !== undefined || finalizedAssets.length > 0) {
          updatePatch.attachmentUrls = nextAttachmentUrls;
        }

        const updated = await this.taskRepository.updateByIdAndWorkspace(
          taskId,
          workspaceId,
          user.tenantId,
          updatePatch,
          session,
        );
        if (!updated) {
          throw new NotFoundException('Task not found');
        }

        return {
          previousAssignedTo: existing.assignedTo,
          previousStatus: existing.status,
          updated,
        };
      },
    );

    const { updated, previousAssignedTo, previousStatus } = updateTransactionResult;

    if (body.assignedTo !== undefined && body.assignedTo !== previousAssignedTo) {
      if (updated.assignedTo) {
        const assignedPayload: TaskAssignedEventPayload = {
          taskId: updated.id,
          workspaceId,
          tenantId: updated.tenantId,
          assignedTo: updated.assignedTo,
          assignedBy: user.userId,
        };
        await this.eventEmitter.emitAsync(TaskEventName.Assigned, assignedPayload);
      }
    }
    if (previousStatus !== 'DONE' && updated.status === 'DONE') {
      const completedPayload: TaskCompletedEventPayload = {
        taskId: updated.id,
        workspaceId,
        tenantId: updated.tenantId,
        completedBy: user.userId,
      };
      await this.eventEmitter.emitAsync(TaskEventName.Completed, completedPayload);
    }

    return {
      success: true,
      message: 'Task updated',
      data: this.toTaskPublic(updated),
    };
  }

  async deleteTask(
    user: AuthenticatedRequestUser,
    workspaceId: string,
    taskId: string,
  ): Promise<ApiSuccessResponse<{ taskId: string; deleted: true }>> {
    if (this.isTenantMember(user)) {
      throw new ForbiddenException('Members cannot delete workspace tasks');
    }

    await this.assertWorkspaceBelongsToTenant(workspaceId, user.tenantId);

    const existing = await this.taskRepository.findActiveByIdAndWorkspace(
      taskId,
      workspaceId,
      user.tenantId,
    );
    if (!existing) {
      throw new NotFoundException('Task not found');
    }
    if (existing.status === 'DONE') {
      throw new BadRequestException('Completed tasks cannot be deleted');
    }

    const deleted = await this.taskRepository.softDeleteByIdAndWorkspace(
      taskId,
      workspaceId,
      user.tenantId,
    );
    if (!deleted) {
      throw new NotFoundException('Task not found');
    }

    return {
      success: true,
      message: 'Task deleted',
      data: { taskId, deleted: true },
    };
  }

  // ─── Cross-workspace member view ─────────────────────────────────────────

  async listMyTasks(
    user: AuthenticatedRequestUser,
    query: ListTasksQueryDto,
  ): Promise<
    ApiSuccessResponse<{
      items: TaskPublic[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      statusCounts: TaskStatusCounts;
    }>
  > {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const [listResult, statusCounts] = await Promise.all([
      this.taskRepository.findMyTasksPaginated({
        tenantId: user.tenantId,
        assignedTo: user.userId,
        status: query.status,
        search: query.search,
        skip,
        limit,
      }),
      this.taskRepository.countMyTasksByStatus({
        tenantId: user.tenantId,
        assignedTo: user.userId,
        search: query.search,
      }),
    ]);

    const { items, total } = listResult;

    return {
      success: true,
      message: 'My tasks fetched',
      data: {
        items: items.map((task) => this.toTaskPublic(task)),
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        statusCounts,
      },
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private isTenantMember(user: AuthenticatedRequestUser): boolean {
    return user.platformAdmin !== true && user.tenantRole === 'member';
  }

  /** Throws NotFoundException if workspace doesn't exist under tenantId. */
  private async assertWorkspaceBelongsToTenant(
    workspaceId: string,
    tenantId: string,
  ): Promise<void> {
    const workspace = await this.workspaceRepository.findByIdAndTenant(
      workspaceId,
      tenantId,
    );
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
  }

  private async assertAssignedUserInTenant(
    tenantId: string,
    assignedToUserId: string,
  ): Promise<void> {
    const user = await this.userRepository.findById(assignedToUserId);
    if (!user || user.tenantId !== tenantId) {
      throw new BadRequestException('Assigned user must belong to the tenant');
    }
  }

  private toWorkspacePublic(workspace: WorkspaceDocument): WorkspacePublic {
    return {
      id: workspace.id,
      tenantId: workspace.tenantId,
      name: workspace.name,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    };
  }

  private toTaskPublic(task: TaskDocument): TaskPublic {
    return {
      id: task.id,
      workspaceId: task.workspaceId,
      tenantId: task.tenantId,
      title: task.title,
      description: task.description ?? null,
      attachmentUrls: task.attachmentUrls ?? [],
      status: task.status,
      assignedTo: task.assignedTo ?? null,
      createdBy: task.createdBy,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  private mergeAttachmentUrls(
    baseAttachmentUrls: string[],
    appendedAttachmentUrls: string[],
  ): string[] {
    return Array.from(
      new Set([
        ...baseAttachmentUrls.map((url) => url.trim()).filter((url) => url.length > 0),
        ...appendedAttachmentUrls.map((url) => url.trim()).filter((url) => url.length > 0),
      ]),
    );
  }

  /**
   * Any status may move to any other except tasks already DONE (terminal state).
   * Target status is validated upstream by DTO enum.
   */
  private isStatusTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
    if (from === to) return true;
    return from !== 'DONE';
  }
}
