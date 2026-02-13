export type JwtAccessPayload = {
  sub: string; // userId
  orgId: string;
  role: string;
  jti: string; // token id (for tracing)
  typ: 'access';
};

export type JwtRefreshPayload = {
  sub: string; // userId
  orgId: string;
  sid: string; // session id
  jti: string;
  typ: 'refresh';
};
