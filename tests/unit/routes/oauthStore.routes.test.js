// Internal OAuth store routes — secret guard, DCR, code lifecycle, and the
// opaque/revocable token flow (consume → mint, refresh → rotate, revoke).
// Sets the internal secret before requiring the router (read at module load),
// and mocks the DAL so no DB is needed. generateAccessToken signs a real JWT
// with the dev JWT_SECRET.
process.env.MCP_INTERNAL_SECRET = 'test-secret';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret'; // generateAccessToken signs with this

jest.mock('../../../src/db/dal.cjs', () => ({
  oauthDal: {
    registerClient: jest.fn(),
    getClient: jest.fn(),
    createCode: jest.fn(),
    getCode: jest.fn(),
    consumeCode: jest.fn(),
    createRefreshToken: jest.fn(),
    findValidRefreshToken: jest.fn(),
    revokeRefreshToken: jest.fn(),
  },
  usersDal: { findById: jest.fn() },
}));

const express = require('express');
const request = require('supertest');
const dal = require('../../../src/db/dal.cjs');
const oauthStoreRoutes = require('../../../src/routes/oauthStore.routes');

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/internal/oauth', oauthStoreRoutes);
  return a;
};
const SECRET = { 'X-Internal-Token': 'test-secret' };
const USER = { id: 'u1', email: 'a@b.co', name: 'A' };

beforeEach(() => {
  jest.clearAllMocks();
  dal.usersDal.findById.mockResolvedValue(USER);
  dal.oauthDal.createRefreshToken.mockResolvedValue({});
});

describe('internal-auth guard', () => {
  it('rejects missing/wrong token (403)', async () => {
    await request(app()).get('/internal/oauth/clients/x').expect(403);
    await request(app()).get('/internal/oauth/clients/x').set('X-Internal-Token', 'nope').expect(403);
  });
});

describe('DCR', () => {
  it('public client gets no secret; confidential gets one', async () => {
    dal.oauthDal.registerClient.mockImplementation((c) => Promise.resolve({ ...c }));
    const pub = await request(app()).post('/internal/oauth/clients').set(SECRET)
      .send({ token_endpoint_auth_method: 'none', redirect_uris: ['https://claude.ai/cb'] }).expect(201);
    expect(pub.body.clientSecret).toBeNull();
    const conf = await request(app()).post('/internal/oauth/clients').set(SECRET)
      .send({ token_endpoint_auth_method: 'client_secret_basic', redirect_uris: ['https://x/cb'] }).expect(201);
    expect(conf.body.clientSecret).toBeTruthy();
  });
});

describe('codes', () => {
  it('creates a code bound to user_id (no AP creds stored)', async () => {
    dal.oauthDal.createCode.mockImplementation((c) => Promise.resolve({ code: c.code }));
    await request(app()).post('/internal/oauth/codes').set(SECRET)
      .send({ client_id: 'c1', code_challenge: 'ch', redirect_uri: 'https://claude.ai/cb', scopes: ['agentplanner'], user_id: 'u1' })
      .expect(201);
    const arg = dal.oauthDal.createCode.mock.calls[0][0];
    expect(arg).toMatchObject({ clientId: 'c1', userId: 'u1' });
    expect(arg.apAccessToken).toBeUndefined();
  });
});

describe('consume → mint token set', () => {
  const code = { clientId: 'c1', redirectUri: 'https://claude.ai/cb', scopes: ['agentplanner'], userId: 'u1' };

  it('mints an access JWT + opaque refresh token', async () => {
    dal.oauthDal.consumeCode.mockResolvedValue(code);
    const res = await request(app()).post('/internal/oauth/codes/abc/consume').set(SECRET)
      .send({ client_id: 'c1', redirect_uri: 'https://claude.ai/cb' }).expect(200);
    expect(res.body.access_token.split('.')).toHaveLength(3); // a JWT
    // bound to the MCP resource (RFC 8707) so connectors that enforce
    // resource indicators (e.g. ChatGPT Apps SDK) accept it
    const claims = JSON.parse(Buffer.from(res.body.access_token.split('.')[1], 'base64url').toString());
    expect(claims.aud).toBe('https://agentplanner.io/mcp');
    expect(res.body.refresh_token).toMatch(/^apop_r_/);
    expect(res.body.expires_in).toBe(3600);
    expect(dal.oauthDal.createRefreshToken).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'c1', userId: 'u1' }));
    // the stored refresh token is hashed, never raw
    expect(dal.oauthDal.createRefreshToken.mock.calls[0][0].tokenHash).not.toMatch(/^apop_r_/);
  });

  it('rejects client_id / redirect_uri mismatch', async () => {
    dal.oauthDal.consumeCode.mockResolvedValue(code);
    await request(app()).post('/internal/oauth/codes/abc/consume').set(SECRET)
      .send({ client_id: 'other', redirect_uri: 'https://claude.ai/cb' }).expect(400);
    dal.oauthDal.consumeCode.mockResolvedValue(code);
    await request(app()).post('/internal/oauth/codes/abc/consume').set(SECRET)
      .send({ client_id: 'c1', redirect_uri: 'https://evil/cb' }).expect(400);
  });

  it('404 when the code is gone', async () => {
    dal.oauthDal.consumeCode.mockResolvedValue(null);
    await request(app()).post('/internal/oauth/codes/abc/consume').set(SECRET).send({}).expect(404);
  });
});

describe('refresh (rotate)', () => {
  it('validates + rotates a refresh token bound to the client', async () => {
    dal.oauthDal.findValidRefreshToken.mockResolvedValue({ tokenHash: 'h', clientId: 'c1', userId: 'u1', scopes: [] });
    dal.oauthDal.revokeRefreshToken.mockResolvedValue({});
    const res = await request(app()).post('/internal/oauth/refresh').set(SECRET)
      .send({ refresh_token: 'apop_r_old', client_id: 'c1' }).expect(200);
    expect(dal.oauthDal.revokeRefreshToken).toHaveBeenCalledWith('h'); // old one rotated out
    expect(res.body.refresh_token).toMatch(/^apop_r_/);
  });

  it('rejects an invalid/revoked refresh token', async () => {
    dal.oauthDal.findValidRefreshToken.mockResolvedValue(null);
    await request(app()).post('/internal/oauth/refresh').set(SECRET).send({ refresh_token: 'bad' }).expect(400);
  });

  it('rejects a client_id mismatch (token bound to another client)', async () => {
    dal.oauthDal.findValidRefreshToken.mockResolvedValue({ tokenHash: 'h', clientId: 'c1', userId: 'u1', scopes: [] });
    await request(app()).post('/internal/oauth/refresh').set(SECRET).send({ refresh_token: 'x', client_id: 'other' }).expect(400);
  });
});

describe('revoke', () => {
  it('revokes the refresh token and returns 200', async () => {
    dal.oauthDal.revokeRefreshToken.mockResolvedValue({});
    await request(app()).post('/internal/oauth/revoke').set(SECRET).send({ token: 'apop_r_xyz' }).expect(200);
    expect(dal.oauthDal.revokeRefreshToken).toHaveBeenCalled();
  });
});
