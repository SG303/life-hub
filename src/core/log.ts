type Fields = Record<string, unknown>;

function write(level: string, message: string, fields?: Fields): void {
  if (process.env.LOG_LEVEL === 'silent') return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

/** Minimal JSON-lines logger. Never pass secrets or full request bodies. */
export const log = {
  info: (message: string, fields?: Fields) => write('info', message, fields),
  warn: (message: string, fields?: Fields) => write('warn', message, fields),
  error: (message: string, fields?: Fields) => write('error', message, fields),
};
