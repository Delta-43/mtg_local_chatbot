import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createConfiguredServer } from './server.js';
import { mcpLogger } from './services/logger.js';

async function main() {
  const { sdkServer, appServer } = await createConfiguredServer();

  const transport = new StdioServerTransport();
  await sdkServer.connect(transport);

  mcpLogger.info({ operation: 'startup' }, 'scryfall-mcp server started');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    try {
      mcpLogger.info({ operation: 'shutdown', signal }, 'Shutting down server');
      await appServer.destroy();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  mcpLogger.fatal({ operation: 'startup', error: err }, 'Unhandled startup error');
  process.exit(1);
});
