import { Injectable } from '@nestjs/common';
import { defer, finalize, Subject, type Observable } from 'rxjs';
import type { TopicEvent } from '../common/extension-points';

/** 화면을 본 것으로 치는 시간 (REST 호출 후) */
const INTEREST_WINDOW_MS = 120_000;

/**
 * advisor 토픽 이벤트 버스. 구독자 수를 세어 "어드바이저 화면이 열려 있는 동안"만
 * 브리지 상태를 주기 확인하는 데 쓴다 (계약 A.3.1).
 */
@Injectable()
export class AdvisorEvents {
  private readonly subject = new Subject<TopicEvent>();
  private subscribers = 0;
  private lastTouchedAt = 0;

  /** 스트림 모듈이 구독하는 Observable (구독 수를 센다) */
  readonly events$: Observable<TopicEvent> = defer(() => {
    this.subscribers += 1;
    return this.subject.asObservable().pipe(
      finalize(() => {
        this.subscribers = Math.max(0, this.subscribers - 1);
      }),
    );
  });

  emit(event: string, data: unknown): void {
    this.subject.next({ event, data });
  }

  touch(now = Date.now()): void {
    this.lastTouchedAt = now;
  }

  hasInterest(now = Date.now()): boolean {
    return (
      this.subscribers > 0 || now - this.lastTouchedAt < INTEREST_WINDOW_MS
    );
  }

  get subscriberCount(): number {
    return this.subscribers;
  }
}
