import type { Connection } from 'mongoose';
import { ConnectionStates } from 'mongoose';

export function isMongooseConnectionReady(connection: Connection): boolean {
  return connection.readyState === ConnectionStates.connected;
}
