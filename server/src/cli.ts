#!/usr/bin/env node

/**
 * Standalone CLI entry point: `npx pixel-agents`
 *
 * Thin wrapper around startStandaloneServer (server/src/standalone.ts).
 */

import { startStandaloneServer, stopStandalone } from './standalone.js';

interface CliArgs {
  port: number;
  host: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { port: 3100, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--port' || argv[i] === '-p') && argv[i + 1]) {
      args.port = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      args.host = argv[i + 1];
      i++;
    } else if (argv[i] === '--help') {
      console.log(`Usage: pixel-agents [options]

Options:
  --port, -p <number>   Port to listen on (default: 3100)
  --host <string>       Host to bind to (default: 127.0.0.1)
  --help                Show this help message`);
      process.exit(0);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const handle = await startStandaloneServer({
    distRoot: __dirname,
    host: args.host,
    port: args.port,
    namespace: 'standalone',
  });

  console.log(`\n  Pixel Agents server running at http://${args.host}:${handle.config.port}\n`);

  function shutdown(): void {
    console.log('\nShutting down...');
    stopStandalone(handle);
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
