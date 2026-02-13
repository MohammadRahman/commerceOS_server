import * as crypto from 'crypto';

export function verifyMetaSignature(params: {
  rawBody: Buffer;
  appSecret: string;
  headerValue?: string;
}): boolean {
  const { rawBody, appSecret, headerValue } = params;

  // header format: "sha256=<hex>"
  if (!headerValue) return false;
  const [algo, signatureHex] = headerValue.split('=');
  if (algo !== 'sha256' || !signatureHex) return false;

  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  // timing safe compare
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signatureHex, 'hex');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
