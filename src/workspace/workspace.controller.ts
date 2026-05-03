import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { AuthenticatedRequestUser } from '../auth/types/auth-request-user.types';
import { CreateTaskDto } from './dto/create-task.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { WorkspaceService } from './workspace.service';

@ApiTags('Workspace')
@Controller('workspaces')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get('status')
  @ApiOperation({ summary: 'Workspace module health' })
  status() {
    return this.workspaceService.getModuleStatus();
  }

  // ─── Workspace CRUD ───────────────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create workspace (tenant admin only)' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  @ApiResponse({ status: 403, description: 'Subscription workspace limit reached or insufficient role' })
  createWorkspace(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: CreateWorkspaceDto,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.workspaceService.createWorkspace(user, body);
  }

  @Get()
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List all workspaces for the tenant' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  listWorkspaces(@CurrentUser() user: AuthenticatedRequestUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.workspaceService.listWorkspaces(user);
  }

  @Delete(':workspaceId')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'workspaceId', description: 'Workspace id' })
  @ApiOperation({ summary: 'Delete workspace and all its tasks (tenant admin only)' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  deleteWorkspace(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('workspaceId') workspaceId: string,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.workspaceService.deleteWorkspace(user, workspaceId);
  }

  // ─── Task CRUD (workspace-scoped) ─────────────────────────────────────────

  /**
   * Must be registered before `GET :workspaceId/tasks` so Express doesn't
   * capture the literal "me" segment as a workspaceId param.
   */
  @Get('me/tasks')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get tasks assigned to the current user across all workspaces' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Token has no tenant context' })
  getMyTasks(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Query() query: ListTasksQueryDto,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.workspaceService.listMyTasks(user, query);
  }

  @Post(':workspaceId/tasks')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'workspaceId', description: 'Workspace id' })
  @ApiOperation({ summary: 'Create task inside a workspace (tenant admin only)' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Insufficient role or token has no tenant context' })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  createTask(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateTaskDto,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.workspaceService.createTask(user, workspaceId, body);
  }

  @Get(':workspaceId/tasks')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'workspaceId', description: 'Workspace id' })
  @ApiOperation({ summary: 'List tasks in a workspace with pagination, filters, and search' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Token has no tenant context' })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  listTasks(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('workspaceId') workspaceId: string,
    @Query() query: ListTasksQueryDto,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.workspaceService.listTasks(user, workspaceId, query);
  }

  @Get(':workspaceId/tasks/:taskId')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'workspaceId', description: 'Workspace id' })
  @ApiParam({ name: 'taskId', description: 'Task id' })
  @ApiOperation({ summary: 'Get task details' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Token has no tenant context' })
  @ApiResponse({ status: 404, description: 'Workspace or task not found' })
  getTaskDetails(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.workspaceService.getTaskDetails(user, workspaceId, taskId);
  }

  @Patch(':workspaceId/tasks/:taskId')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'workspaceId', description: 'Workspace id' })
  @ApiParam({ name: 'taskId', description: 'Task id' })
  @ApiOperation({ summary: 'Update task' })
  @ApiResponse({ status: 400, description: 'Invalid payload or transition' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Insufficient role or token has no tenant context' })
  @ApiResponse({ status: 404, description: 'Workspace or task not found' })
  updateTask(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Body() body: UpdateTaskDto,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.workspaceService.updateTask(user, workspaceId, taskId, body);
  }

  @Delete(':workspaceId/tasks/:taskId')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'workspaceId', description: 'Workspace id' })
  @ApiParam({ name: 'taskId', description: 'Task id' })
  @ApiOperation({ summary: 'Soft delete task' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Insufficient role or token has no tenant context' })
  @ApiResponse({ status: 404, description: 'Workspace or task not found' })
  deleteTask(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.workspaceService.deleteTask(user, workspaceId, taskId);
  }
}
