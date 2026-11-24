/** Public interface of the chat module. Other modules import only from here. */
import type { AgentConfig } from '../../config.js';
import type { Db } from '../../core/db.js';
import type { Router } from '../../core/http.js';
import { AgentClient, type FetchLike } from './agent.js';
import { chatRoutes } from './routes.js';
import { ChatService, type ChatContextProvider } from './service.js';

export type { ChatContextProvider, ChatMessage, ChatThread } from './service.js';
export { ChatService } from './service.js';
export { AgentClient } from './agent.js';

export interface ChatModule {
  service: ChatService;
  agent: AgentClient;
  routes: Router;
}

export function createChatModule(db: Db, config: AgentConfig, context: ChatContextProvider, fetchImpl?: FetchLike): ChatModule {
  const agent = new AgentClient(config, fetchImpl);
  const service = new ChatService(db, agent, config, context);
  return { service, agent, routes: chatRoutes(service, agent) };
}
