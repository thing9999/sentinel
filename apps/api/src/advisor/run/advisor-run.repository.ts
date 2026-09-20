import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { closeInterruptedAdvisorRuns } from '../../database/retention';
import type { RunStatus } from '../advisor.types';
import type { AdvisorSnapshotV1 } from '../snapshot/snapshot.types';
import type { RunRecord } from './run-model';
import {
  MemoryRunStore,
  PrismaRunStore,
  type CreateResult,
  type RunListQuery,
  type RunListResult,
} from './run-store';

/**
 * 이력 저장 창구. 대시보드 DB가 있으면 DB에, 없거나 쓰기가 실패하면 메모리에 둔다.
 * 저장 실패는 경고만 남기고 분석 자체를 막지 않는다 (계약 영향 없음, persistence 필드로만 표시).
 */
@Injectable()
export class AdvisorRunRepository implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdvisorRunRepository.name);
  readonly memory = new MemoryRunStore(50);
  /** DB에 없는(메모리 전용) 실행: 시드, DB 저장 실패분 */
  private readonly memoryOnly = new Set<string>();
  private readonly db: PrismaRunStore;

  constructor(private readonly prisma: PrismaService) {
    this.db = new PrismaRunStore(prisma);
  }

  get persistence(): 'database' | 'memory' {
    return this.prisma.isConnected ? 'database' : 'memory';
  }

  private get useDb(): boolean {
    return this.prisma.isConnected;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.useDb) {
      this.logger.warn(
        '대시보드 DB 없음: 어드바이저 이력을 메모리에 보관합니다 (재시작하면 사라짐).',
      );
      return;
    }
    try {
      const n = await closeInterruptedAdvisorRuns(this.prisma);
      if (n > 0)
        this.logger.warn(
          `이전 프로세스에서 중단된 분석 ${n}건을 interrupted로 닫았습니다.`,
        );
    } catch (err) {
      this.logger.warn(`중단된 분석 정리 실패: ${describe(err)}`);
    }
  }

  /** mock 예시 이력 등 DB에 넣지 않는 실행 */
  putMemoryOnly(r: RunRecord): void {
    this.memoryOnly.add(r.id);
    this.memory.put(r);
  }

  removeMemoryOnly(predicate: (r: RunRecord) => boolean): void {
    void this.memory
      .list({ limit: 1000, offset: 0, statuses: null })
      .then((res) => {
        for (const r of res.items) {
          if (this.memoryOnly.has(r.id) && predicate(r)) {
            this.memory.delete(r.id);
            this.memoryOnly.delete(r.id);
          }
        }
      });
  }

  async createActive(r: RunRecord): Promise<CreateResult> {
    const mem = await this.memory.createActive(r);
    if (!mem.created) return mem;
    if (!this.useDb) {
      this.memoryOnly.add(r.id);
      return mem;
    }
    try {
      const res = await this.db.createActive(r);
      if (!res.created) this.memory.delete(r.id);
      return res;
    } catch (err) {
      this.logger.warn(`분석 이력 저장 실패 (메모리로 계속): ${describe(err)}`);
      this.memoryOnly.add(r.id);
      return mem;
    }
  }

  async saveProgress(r: RunRecord): Promise<void> {
    this.memory.put(r);
    if (!this.useDb || this.memoryOnly.has(r.id)) return;
    try {
      await this.db.saveProgress(r);
    } catch (err) {
      this.logger.warn(`분석 진행 저장 실패: ${describe(err)}`);
    }
  }

  async finish(r: RunRecord): Promise<void> {
    this.memory.put(r);
    if (!this.useDb || this.memoryOnly.has(r.id)) {
      this.memoryOnly.add(r.id);
      return;
    }
    try {
      await this.db.finish(r);
      this.memory.delete(r.id);
    } catch (err) {
      this.logger.warn(`분석 결과 저장 실패 (메모리에 보관): ${describe(err)}`);
      this.memoryOnly.add(r.id);
    }
  }

  async get(id: string): Promise<RunRecord | null> {
    const mem = await this.memory.get(id);
    if (mem) return mem;
    if (!this.useDb) return null;
    try {
      return await this.db.get(id);
    } catch (err) {
      this.logger.warn(`분석 이력 조회 실패: ${describe(err)}`);
      return null;
    }
  }

  async getSnapshot(id: string): Promise<AdvisorSnapshotV1 | null> {
    const mem = await this.memory.get(id);
    if (mem) return mem.snapshot;
    if (!this.useDb) return null;
    try {
      return await this.db.getSnapshot(id);
    } catch {
      return null;
    }
  }

  async getRaw(id: string): Promise<string | null> {
    const mem = await this.memory.get(id);
    if (mem) return mem.rawResponse;
    if (!this.useDb) return null;
    try {
      return await this.db.getRaw(id);
    } catch {
      return null;
    }
  }

  private async memoryOnlyList(
    statuses: RunStatus[] | null,
  ): Promise<RunRecord[]> {
    const all = await this.memory.list({ limit: 10_000, offset: 0, statuses });
    return all.items.filter((r) => this.memoryOnly.has(r.id));
  }

  async list(q: RunListQuery): Promise<RunListResult> {
    if (!this.useDb) return this.memory.list(q);
    try {
      const db = await this.db.list({
        limit: q.offset + q.limit,
        offset: 0,
        statuses: q.statuses,
      });
      const memFiltered = await this.memoryOnlyList(q.statuses);
      const memAll = await this.memoryOnlyList(null);
      const merged = [...db.items, ...memFiltered].sort(
        (a, b) => b.requestedAt.getTime() - a.requestedAt.getTime(),
      );
      return {
        items: merged.slice(q.offset, q.offset + q.limit),
        total: db.total + memAll.length,
        filteredTotal: db.filteredTotal + memFiltered.length,
      };
    } catch (err) {
      this.logger.warn(
        `분석 이력 목록 조회 실패 (메모리 이력만 표시): ${describe(err)}`,
      );
      return this.memory.list(q);
    }
  }

  async latest(status?: RunStatus): Promise<RunRecord | null> {
    const mem =
      (await this.memoryOnlyList(status ? [status] : null))[0] ?? null;
    if (!this.useDb) return (await this.memory.latest(status)) ?? null;
    try {
      const db = await this.db.latest(status);
      if (!db) return mem;
      if (!mem) return db;
      return db.requestedAt >= mem.requestedAt ? db : mem;
    } catch (err) {
      this.logger.warn(`최근 분석 조회 실패: ${describe(err)}`);
      return mem;
    }
  }

  async count(): Promise<number> {
    if (!this.useDb) return this.memory.count();
    try {
      return (await this.db.count()) + (await this.memoryOnlyList(null)).length;
    } catch {
      return this.memory.count();
    }
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return `${err.name}${typeof code === 'string' ? ` ${code}` : ''}: ${err.message.split('\n')[0]}`;
  }
  return String(err);
}
