import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type {
  ClusterInfoRaw,
  KubeResource,
  RawEvent,
  RawHpa,
  RawIngress,
  RawNode,
  RawPdb,
  RawPod,
  RawPvc,
  RawService,
  RawWorkload,
} from '../model';
import { podKey, workloadKey } from '../model';

/** 파드별 재시작·OOM 이력 (최근 24시간, 명세·어드바이저 R-RESTART/R-OOM) */
interface PodHistoryEntry {
  firstSeenAt: number;
  /** 관측 기준점: 이 시각 이전의 재시작은 모른다 */
  baselineAt: number;
  baselineTotal: number;
  /** total이 바뀐 시점들 (오래된 순) */
  samples: { at: number; total: number }[];
  /** OOMKilled 종료 시각 (중복 제거, ms) */
  ooms: Set<number>;
  lastOwnerWorkloadKey: string | null;
  deletedAt: number | null;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export class PodHistory {
  private readonly map = new Map<string, PodHistoryEntry>();

  constructor(private readonly startedAt: number) {}

  observe(pod: RawPod, now: number, ownerWorkloadKey: string | null): void {
    const key = podKey(pod.namespace, pod.name);
    const total = restartTotal(pod);
    let e = this.map.get(key);
    const created = Date.parse(pod.createdAt);
    if (!e || e.deletedAt !== null) {
      // API 시작 이후 생성된 파드는 생성 시각부터 전부 관측한 것으로 본다
      const newSinceStart =
        Number.isFinite(created) && created >= this.startedAt;
      e = {
        firstSeenAt: now,
        baselineAt: newSinceStart ? created : now,
        baselineTotal: newSinceStart ? 0 : total,
        samples: [],
        ooms: new Set(),
        lastOwnerWorkloadKey: ownerWorkloadKey,
        deletedAt: null,
      };
      this.map.set(key, e);
    }
    e.lastOwnerWorkloadKey = ownerWorkloadKey ?? e.lastOwnerWorkloadKey;
    const last = e.samples.length
      ? e.samples[e.samples.length - 1].total
      : e.baselineTotal;
    if (total !== last) {
      if (total < last) {
        // 파드 재생성 등으로 카운터가 줄었으면 기준점을 다시 잡는다
        e.baselineAt = now;
        e.baselineTotal = total;
        e.samples = [];
      } else {
        e.samples.push({ at: now, total });
      }
    }
    for (const c of [...pod.containers, ...pod.initContainers]) {
      const lt = c.status?.lastTermination;
      if (lt?.reason === 'OOMKilled' && lt.finishedAt) {
        const at = Date.parse(lt.finishedAt);
        if (Number.isFinite(at)) e.ooms.add(at);
      }
      const st = c.status?.state;
      if (st?.type === 'terminated' && st.reason === 'OOMKilled' && st.since) {
        const at = Date.parse(st.since);
        if (Number.isFinite(at)) e.ooms.add(at);
      }
    }
  }

  /**
   * mock 전용: 과거 이력을 미리 넣는다 (재시작 N회·OOM이 "최근 1시간"에 보이도록).
   * restartAt은 오래된 순. currentTotal은 지금 재시작 누적.
   */
  seed(
    key: string,
    opts: {
      baselineAt: number;
      currentTotal: number;
      restartAt: number[];
      oomAt: number[];
    },
  ): void {
    const n = opts.restartAt.length;
    const base = Math.max(0, opts.currentTotal - n);
    this.map.set(key, {
      firstSeenAt: opts.baselineAt,
      baselineAt: opts.baselineAt,
      baselineTotal: base,
      samples: opts.restartAt.map((at, i) => ({ at, total: base + i + 1 })),
      ooms: new Set(opts.oomAt),
      lastOwnerWorkloadKey: null,
      deletedAt: null,
    });
  }

  markDeleted(namespace: string, name: string, now: number): void {
    const e = this.map.get(podKey(namespace, name));
    if (e) e.deletedAt = now;
  }

  /**
   * 최근 삭제 시각 (모르면 null). `prune()`이 1시간 뒤 지우므로 "최근 삭제 캐시"다.
   * `logs`의 `pod.deletedAt`과 `alerts`의 `logTarget.gone`이 **같은 캐시**를 읽는다
   * (docs/api/logs.md 2.1.2, docs/api/alerts.md 2.2.1). 쿠버네티스를 새로 부르지 않는다.
   */
  deletedAtOf(namespace: string, name: string): number | null {
    return this.map.get(podKey(namespace, name))?.deletedAt ?? null;
  }

  /** 기간 안 재시작 증가분과 실제 관측 구간(초) */
  restartsWithin(
    key: string,
    windowMs: number,
    now: number,
    currentTotal: number,
  ): { count: number; observedSec: number } {
    const e = this.map.get(key);
    if (!e) return { count: 0, observedSec: 0 };
    const from = now - windowMs;
    let totalAtFrom = e.baselineTotal;
    for (const s of e.samples) {
      if (s.at <= from) totalAtFrom = s.total;
      else break;
    }
    const observedFrom = Math.max(from, e.baselineAt);
    return {
      count: Math.max(0, currentTotal - totalAtFrom),
      observedSec: Math.max(0, Math.floor((now - observedFrom) / 1000)),
    };
  }

  oomsWithin(key: string, windowMs: number, now: number): number {
    const e = this.map.get(key);
    if (!e) return 0;
    let n = 0;
    for (const at of e.ooms) if (at >= now - windowMs) n += 1;
    return n;
  }

  lastOwner(key: string): string | null {
    return this.map.get(key)?.lastOwnerWorkloadKey ?? null;
  }

  /**
   * 이 워크로드 소속이었다가 **최근 삭제된** 파드 (최근 삭제 캐시, 1시간). 새것 먼저.
   * `logs`의 워크로드 합쳐보기(stack)가 "사라진 파드"까지 넣을 때 쓴다 — 쿠버네티스를 새로 부르지 않는다.
   */
  deletedPodsOf(
    workloadKey: string,
  ): { namespace: string; name: string; deletedAt: number }[] {
    const out: { namespace: string; name: string; deletedAt: number }[] = [];
    for (const [key, e] of this.map) {
      if (e.deletedAt === null || e.lastOwnerWorkloadKey !== workloadKey)
        continue;
      const slash = key.indexOf('/');
      out.push({
        namespace: key.slice(0, slash),
        name: key.slice(slash + 1),
        deletedAt: e.deletedAt,
      });
    }
    return out.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  /** 24시간 지난 표본·삭제된 파드 정리 */
  prune(now: number): void {
    for (const [key, e] of this.map) {
      if (e.deletedAt !== null && now - e.deletedAt > HOUR_MS) {
        this.map.delete(key);
        continue;
      }
      const cutoff = now - DAY_MS;
      while (e.samples.length > 1 && e.samples[1].at <= cutoff) {
        const dropped = e.samples.shift()!;
        e.baselineTotal = dropped.total;
        e.baselineAt = Math.max(e.baselineAt, dropped.at);
      }
      for (const at of e.ooms) if (at < cutoff) e.ooms.delete(at);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

export function restartTotal(pod: RawPod): number {
  let n = 0;
  for (const c of pod.containers) n += c.status?.restartCount ?? 0;
  for (const c of pod.initContainers) n += c.status?.restartCount ?? 0;
  return n;
}

export interface StoreChange {
  resource: KubeResource | 'info' | 'all';
}

/**
 * 쿠버네티스 상태의 메모리 캐시 (live: informer, mock: 시뮬레이터가 채운다).
 * 요청마다 쿠버네티스 API를 부르지 않고 여기서 읽는다.
 */
@Injectable()
export class ClusterStore {
  readonly startedAt = Date.now();
  readonly nodes = new Map<string, RawNode>();
  readonly pods = new Map<string, RawPod>();
  readonly workloads = new Map<string, RawWorkload>();
  readonly events = new Map<string, RawEvent>();
  readonly pvcs = new Map<string, RawPvc>();
  readonly services = new Map<string, RawService>();
  readonly ingresses = new Map<string, RawIngress>();
  readonly pdbs = new Map<string, RawPdb>();
  readonly hpas = new Map<string, RawHpa>();
  readonly namespaces = new Set<string>();
  readonly history = new PodHistory(this.startedAt);

  info: ClusterInfoRaw = { name: null, version: null, region: null };
  /** 최초 목록 동기화 완료 여부 */
  initialSyncDone = false;
  lastSyncAt: string | null = null;

  private readonly changesSubject = new Subject<StoreChange>();
  readonly changes$: Observable<StoreChange> =
    this.changesSubject.asObservable();

  notify(resource: StoreChange['resource']): void {
    this.changesSubject.next({ resource });
  }

  upsertNode(n: RawNode): void {
    this.nodes.set(n.name, n);
    this.notify('nodes');
  }
  deleteNode(name: string): void {
    if (this.nodes.delete(name)) this.notify('nodes');
  }

  upsertPod(p: RawPod): void {
    this.pods.set(podKey(p.namespace, p.name), p);
    this.notify('pods');
  }
  deletePod(namespace: string, name: string): void {
    if (this.pods.delete(podKey(namespace, name))) {
      this.history.markDeleted(namespace, name, Date.now());
      this.notify('pods');
    }
  }

  upsertWorkload(w: RawWorkload): void {
    this.workloads.set(workloadKey(w.kind, w.namespace, w.name), w);
    this.notify('workloads');
  }
  deleteWorkload(kind: string, namespace: string, name: string): void {
    if (this.workloads.delete(workloadKey(kind, namespace, name)))
      this.notify('workloads');
  }

  upsertEvent(e: RawEvent): void {
    this.events.set(e.uid, e);
    this.notify('events');
  }
  deleteEvent(uid: string): void {
    if (this.events.delete(uid)) this.notify('events');
  }

  upsertPvc(p: RawPvc): void {
    this.pvcs.set(podKey(p.namespace, p.name), p);
    this.notify('pvcs');
  }
  deletePvc(namespace: string, name: string): void {
    if (this.pvcs.delete(podKey(namespace, name))) this.notify('pvcs');
  }

  upsertKeyed<T extends { namespace: string; name: string }>(
    resource: 'services' | 'ingresses' | 'pdbs' | 'hpas',
    obj: T,
  ): void {
    (this[resource] as unknown as Map<string, T>).set(
      podKey(obj.namespace, obj.name),
      obj,
    );
    this.notify(resource);
  }
  deleteKeyed(
    resource: 'services' | 'ingresses' | 'pdbs' | 'hpas',
    namespace: string,
    name: string,
  ): void {
    if (this[resource].delete(podKey(namespace, name))) this.notify(resource);
  }

  upsertNamespace(name: string): void {
    this.namespaces.add(name);
    this.notify('namespaces');
  }
  deleteNamespace(name: string): void {
    if (this.namespaces.delete(name)) this.notify('namespaces');
  }

  /** 모두 비운다 (mock 시나리오 전환, live 재구성) */
  clearAll(): void {
    this.nodes.clear();
    this.pods.clear();
    this.workloads.clear();
    this.events.clear();
    this.pvcs.clear();
    this.services.clear();
    this.ingresses.clear();
    this.pdbs.clear();
    this.hpas.clear();
    this.namespaces.clear();
    this.history.clear();
  }
}
