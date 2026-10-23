import { Module } from '@nestjs/common';
import { CrmTasksController } from './crm-tasks.controller';
import { CrmSecretGuard } from './crm-secret.guard';

/**
 * External-service integration surface. Today it holds the CRM task routes; any
 * future machine-to-machine API for another product would live here too.
 *
 * FirestoreService and EventsGateway come from their @Global() modules, so this
 * module only declares its own controller and guard.
 */
@Module({
  controllers: [CrmTasksController],
  providers: [CrmSecretGuard],
})
export class IntegrationModule {}
