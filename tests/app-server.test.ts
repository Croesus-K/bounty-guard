import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appJwt, readPullRequestEvent, verifyWebhookSignature } from '../src/app/server.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('appJwt', () => {
  it('生成可用 RSA-SHA256 公钥验证的 JWT（iss=appId）', () => {
    const token = appJwt('12345', PEM, 1_700_000_000);
    const [header, payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims.iss).toBe('12345');
    expect(claims.exp - claims.iat).toBe(600);
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature, 'base64url'));
    expect(verified).toBe(true);
  });
});

describe('verifyWebhookSignature', () => {
  const body = '{"action":"opened"}';
  const good = 'sha256=' + createHmac('sha256', 'sec').update(body).digest('hex');

  it('正确签名通过；篡改、错密钥、缺前缀、缺失头均失败', () => {
    expect(verifyWebhookSignature('sec', body, good)).toBe(true);
    expect(verifyWebhookSignature('sec', body + 'x', good)).toBe(false);
    expect(verifyWebhookSignature('sec2', body, good)).toBe(false);
    expect(verifyWebhookSignature('sec', body, 'no-prefix')).toBe(false);
    expect(verifyWebhookSignature('sec', body, undefined)).toBe(false);
  });
});

describe('readPullRequestEvent', () => {
  const payload = {
    action: 'opened',
    pull_request: { number: 7 },
    repository: { full_name: 'o/r' },
    installation: { id: 42 }
  };

  it('opened / synchronize / reopened 解析为 PR 事件', () => {
    for (const action of ['opened', 'synchronize', 'reopened']) {
      expect(readPullRequestEvent({ ...payload, action })).toEqual({
        repo: 'o/r',
        pr: 7,
        installationId: 42,
        action
      });
    }
  });

  it('其它动作或缺字段返回 null', () => {
    expect(readPullRequestEvent({ ...payload, action: 'closed' })).toBeNull();
    expect(readPullRequestEvent({ action: 'opened' })).toBeNull();
    expect(readPullRequestEvent({})).toBeNull();
  });
});
