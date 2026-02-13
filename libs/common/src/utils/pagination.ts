export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export function encodeCursor(d: Date, id: string) {
  return Buffer.from(`${d.toISOString()}::${id}`, 'utf8').toString('base64');
}

export function decodeCursor(cursor: string): { occurredAt: Date; id: string } {
  const raw = Buffer.from(cursor, 'base64').toString('utf8');
  const [iso, id] = raw.split('::');
  return { occurredAt: new Date(iso), id };
}
