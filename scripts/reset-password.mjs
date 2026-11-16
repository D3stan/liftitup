#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  PasswordResetError,
  resetUserPasswordInTx,
} from '../src/lib/admin/passwordResetCore.mjs';

const { Pool } = pg;

export function parseResetCliArgs(argv) {
  const positionals = [];
  let byId = false;
  let reason = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (
      arg === '-p' ||
      arg === '--password' ||
      arg === '--pass' ||
      arg.startsWith('--password=') ||
      arg.startsWith('--pass=')
    ) {
      throw new Error(
        'Do not provide a password on the command line. A high-entropy temporary password is generated automatically.',
      );
    }
    if (arg === '--id') {
      byId = true;
      continue;
    }
    if (arg === '--reason') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        throw new Error('--reason requires a value');
      }
      reason = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--reason=')) {
      reason = arg.slice('--reason='.length);
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      return { help: true };
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    positionals.push(arg);
  }

  if (positionals.length === 0) {
    throw new Error('Missing target username (or pass --id <userId>).');
  }
  if (positionals.length > 1) {
    throw new Error(
      'Too many arguments. Do not pass a password on the command line — pass only <username> (or --id <userId>).',
    );
  }

  return {
    help: false,
    identifier: positionals[0],
    lookupBy: byId ? 'id' : 'username',
    reason,
  };
}

function printUsage() {
  console.log(
    [
      'Usage: node scripts/reset-password.mjs <username> [--reason "..."]',
      '       node scripts/reset-password.mjs --id <userId> [--reason "..."]',
      '',
      'Generates a high-entropy one-time temporary password, hashes it with scrypt,',
      'revokes all active sessions, requires a password change at next login, and',
      'writes an audit_log entry. Never accepts a password on the command line.',
    ].join('\n'),
  );
}

async function main() {
  let parsed;
  try {
    parsed = parseResetCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  if (parsed.help) {
    printUsage();
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable is required.');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const client = await pool.connect();
  let committed = false;

  try {
    await client.query('BEGIN');
    const result = await resetUserPasswordInTx(client, {
      identifier: parsed.identifier,
      lookupBy: parsed.lookupBy,
      source: 'cli',
      actorLabel: 'cli',
      reason: parsed.reason,
    });
    await client.query('COMMIT');
    committed = true;

    console.log(
      [
        `Password reset for @${result.username} (${result.userId})`,
        `Sessions revoked: ${result.revokedSessions}`,
        `Audit log ID: ${result.auditId}`,
        '',
        'Temporary password (shown once; user must set a new password at next login):',
        result.temporaryPassword,
      ].join('\n'),
    );
  } catch (err) {
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error
      }
    }
    if (err instanceof PasswordResetError) {
      console.error(`Error (${err.code}): ${err.message}`);
    } else {
      console.error(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

const isMainEntry =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  void main();
}
