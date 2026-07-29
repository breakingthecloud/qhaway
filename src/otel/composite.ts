import type { QhawaySpan, QhawayStorage } from '../trace/index.js';

export class CompositeStorage implements QhawayStorage {
  constructor(private storages: QhawayStorage[]) {}

  async write(span: QhawaySpan): Promise<void> {
    await Promise.allSettled(this.storages.map(s => s.write(span)));
  }

  add(storage: QhawayStorage): void {
    this.storages.push(storage);
  }
}
