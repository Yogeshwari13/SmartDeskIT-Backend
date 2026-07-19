import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const storePath = path.join(dirname, '../../data/store.json');

export function readStore() {
  return JSON.parse(fs.readFileSync(storePath, 'utf8'));
}

export function writeStore(data) {
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
}

export function nextTicketId(tickets) {
  const highest = tickets.reduce((max, ticket) => Math.max(max, Number(ticket.id.replace('TKT-', '')) || 1000), 1000);
  return `TKT-${highest + 1}`;
}
