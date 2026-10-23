import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { DocumentData, FirestoreService } from '../common/firestore/firestore.service';
import { EventsGateway } from '../common/realtime/events.gateway';
import { CrmSecretGuard } from './crm-secret.guard';
import { CreateCrmTaskDto, UpdateCrmTaskDto } from './dto/crm-tasks.dto';

/**
 * Task operations for the Lyno CRM, the same create / move / list / delete the
 * Lulu board itself does, but reachable by another service.
 *
 * Two things keep it isolated from the rest of Lulu:
 *  - Auth is the `x-crm-secret` header, not a user session (CrmSecretGuard).
 *  - Every task the CRM writes is stamped with a `source` tag, and every read,
 *    update and delete is filtered by that same tag. So the CRM only ever sees
 *    and touches its own tasks, never the boards Lulu's own users created.
 *
 * The routes are versioned (`/v1/...`) so the CRM has a stable contract even as
 * Lulu's internal routes change.
 */
@ApiTags('CRM Integration')
@ApiSecurity('crm-secret')
@UseGuards(CrmSecretGuard)
@Controller({ path: 'integrations/crm/tasks', version: '1' })
export class CrmTasksController {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly events: EventsGateway,
    private readonly config: ConfigService,
  ) {}

  /** The tag that marks a task as belonging to the CRM. */
  private get source(): string {
    return (this.config.get<string>('CRM_TASK_SOURCE') || 'lyno').trim();
  }

  private view(task: DocumentData) {
    return {
      id: task.id,
      boardId: task.boardId,
      cardId: task.cardId,
      title: task.title,
      description: task.description,
      status: task.status,
      assignedMembers: task.assignedMembers || [],
      ownerId: task.ownerId,
      dueDate: task.dueDate ?? null,
      completedAt: task.completedAt ?? null,
      createdAt: task.createdAt,
      source: task.source,
    };
  }

  /** Loads a task and refuses it unless it carries this CRM's source tag. */
  private async loadOwnTask(taskId: string): Promise<DocumentData> {
    const task = await this.firestore.findById('tasks', taskId);
    if (!task || task.source !== this.source) {
      throw new NotFoundException('Task not found for this CRM');
    }
    return task;
  }

  @Get()
  @ApiOperation({ summary: 'List CRM tasks, optionally filtered by assignee, status or board' })
  async list(
    @Query('assignee') assignee?: string,
    @Query('status') status?: string,
    @Query('boardId') boardId?: string,
  ) {
    const src = this.source;
    const tasks = await this.firestore.find('tasks', (t) => {
      if (t.source !== src) return false;
      if (boardId && t.boardId !== boardId) return false;
      if (status && t.status !== status) return false;
      if (assignee && !(t.assignedMembers || []).includes(assignee)) return false;
      return true;
    });
    tasks.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    return tasks.map((t) => this.view(t));
  }

  @Post()
  @ApiOperation({ summary: 'Create a CRM task' })
  async create(@Body() dto: CreateCrmTaskDto) {
    const cardId = dto.cardId || this.config.get<string>('CRM_DEFAULT_CARD_ID') || '';
    if (!cardId) {
      throw new BadRequestException('cardId is required (or set CRM_DEFAULT_CARD_ID)');
    }

    // A task must live in a real column; derive its board from that column so the
    // two can never disagree.
    const card = await this.firestore.findById('cards', cardId);
    if (!card) {
      throw new BadRequestException('Target card does not exist');
    }
    const boardId = dto.boardId || this.config.get<string>('CRM_DEFAULT_BOARD_ID') || card.boardId;
    if (card.boardId !== boardId) {
      throw new BadRequestException('Target card does not belong to the given board');
    }

    const status = dto.status || 'Icebox';
    const created = await this.firestore.insert('tasks', {
      cardId,
      boardId,
      ownerId: dto.ownerId || `crm:${this.source}`,
      title: dto.title,
      description: dto.description || '',
      status,
      assignedMembers: dto.assignedMembers || [],
      dueDate: dto.dueDate || null,
      createdAt: new Date().toISOString(),
      completedAt: status === 'Done' ? new Date().toISOString() : null,
      // The isolation tag. Everything the CRM reads back is filtered on this.
      source: this.source,
    });

    this.events.emitToBoard(boardId, 'task_created', created);
    return this.view(created);
  }

  @Patch(':taskId')
  @ApiOperation({ summary: 'Update or move a CRM task (drag-and-drop = change status or card)' })
  async update(@Param('taskId') taskId: string, @Body() dto: UpdateCrmTaskDto) {
    const task = await this.loadOwnTask(taskId);
    const boardId = task.boardId as string;

    // Moving between columns: the destination must be in the same board.
    const targetCardId = dto.card_id || (task.cardId as string);
    if (targetCardId !== task.cardId) {
      const targetCard = await this.firestore.findById('cards', targetCardId);
      if (!targetCard || targetCard.boardId !== boardId) {
        throw new BadRequestException('Target card does not belong to this task’s board');
      }
    }

    const nextStatus = dto.status !== undefined ? dto.status : task.status;
    const wasDone = task.status === 'Done';
    const isDone = nextStatus === 'Done';

    const updated = await this.firestore.update('tasks', taskId, {
      title: dto.title !== undefined ? dto.title : task.title,
      description: dto.description !== undefined ? dto.description : task.description,
      status: nextStatus,
      completedAt: isDone ? (wasDone ? task.completedAt || null : new Date().toISOString()) : null,
      cardId: targetCardId,
      assignedMembers:
        dto.assignedMembers !== undefined ? dto.assignedMembers : task.assignedMembers || [],
      dueDate: dto.dueDate !== undefined ? dto.dueDate || null : task.dueDate || null,
    });

    this.events.emitToBoard(boardId, 'task_updated', updated);
    return this.view(updated);
  }

  @Delete(':taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a CRM task' })
  async remove(@Param('taskId') taskId: string) {
    const task = await this.loadOwnTask(taskId);
    await this.firestore.delete('tasks', taskId);
    this.events.emitToBoard(task.boardId as string, 'task_deleted', { id: taskId });
  }
}
