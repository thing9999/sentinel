import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isLoopbackAddress } from '../config.js';

export const TOKEN_HEADER = 'x-bridge-token';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * - 토큰이 설정되어 있으면: x-bridge-token 헤더가 일치해야 한다.
 * - 토큰이 없으면(로컬 전용 모드): 루프백 주소에서 온 요청만 받는다.
 */
export function createAuthHook(token: string | undefined) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (token) {
      const header = req.headers[TOKEN_HEADER];
      const given = Array.isArray(header) ? header[0] : header;
      if (!given || !safeEqual(given, token)) {
        await reply.code(401).send({
          code: 'unauthorized',
          error: 'unauthorized',
          message: '브리지 토큰이 맞지 않습니다.',
        });
      }
      return;
    }
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      await reply.code(403).send({
        code: 'forbidden',
        error: 'local_only',
        message: '토큰 미설정 브리지는 루프백 요청만 받습니다.',
      });
    }
  };
}
