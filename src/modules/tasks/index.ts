/** Public interface of the tasks module. Other modules import only from here. */
import type { Db } from '../../core/db.js';
import type { Router } from '../../core/http.js';
import { taskRoutes } from './routes.js';
import { TaskService } from './service.js';

export type { Task, TaskFilter, TaskInput, TaskSummary } from './service.js';
export { TaskService } from './service.js';

export interface TasksModule {
  service: TaskService;
  routes: Router;
  /** Summary for the `Heute` cockpit. */
  cockpit: { id: string; summary(now: Date): unknown };
}

export function createTasksModule(db: Db, timeZone: string): TasksModule {
  const service = new TaskService(db, timeZone);
  return { service, routes: taskRoutes(service), cockpit: { id: 'tasks', summary: (now) => service.summary(now) } };
}
