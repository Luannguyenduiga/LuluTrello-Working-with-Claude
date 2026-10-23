import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsISO8601, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

/** Same deadline rule as the main task DTO: ISO 8601, and `""` clears it. */
const IsOptionalDueDate = () => (target: object, key: string) => {
  ValidateIf((o: Record<string, unknown>) => o[key] != null && o[key] !== '')(target, key);
  IsISO8601({}, { message: 'dueDate must be an ISO 8601 date' })(target, key);
};

export class CreateCrmTaskDto {
  @ApiProperty({ example: 'Xử lý đơn trễ #10231' })
  @IsString()
  @IsNotEmpty({ message: 'Task title is required' })
  title!: string;

  @ApiPropertyOptional({ example: 'Khách chưa nhận, cần gọi lại' })
  @IsOptional()
  @IsString()
  description?: string;

  /** Free text; the board uses Icebox / Backlog / Ongoing / Waiting / Done. */
  @ApiPropertyOptional({ example: 'Icebox', default: 'Icebox' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Destination board id. Falls back to CRM_DEFAULT_BOARD_ID when omitted.',
  })
  @IsOptional()
  @IsString()
  boardId?: string;

  @ApiPropertyOptional({
    description: 'Destination card (column) id. Falls back to CRM_DEFAULT_CARD_ID when omitted.',
  })
  @IsOptional()
  @IsString()
  cardId?: string;

  @ApiPropertyOptional({
    description: 'Lulu account id to record as the task owner. Optional for a machine caller.',
  })
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Lulu account ids to assign' })
  @IsOptional()
  @IsArray()
  assignedMembers?: string[];

  @ApiPropertyOptional({ format: 'date-time', example: '2026-10-01T09:00:00.000Z' })
  @IsOptionalDueDate()
  dueDate?: string;
}

export class UpdateCrmTaskDto {
  @ApiPropertyOptional({ example: 'Xử lý đơn trễ #10231' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  /** Moving a task to `Done` stamps its completion time. */
  @ApiPropertyOptional({ example: 'Done' })
  @IsOptional()
  @IsString()
  status?: string;

  /** Set when moving the task to another column of the same board (drag-and-drop). */
  @ApiPropertyOptional({ description: 'Destination card id', example: 'c_1Ab2Cd3E' })
  @IsOptional()
  @IsString()
  card_id?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  assignedMembers?: string[];

  @ApiPropertyOptional({ format: 'date-time', example: '2026-10-01T09:00:00.000Z' })
  @IsOptionalDueDate()
  dueDate?: string;
}
