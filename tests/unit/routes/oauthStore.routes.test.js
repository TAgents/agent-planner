// Internal OAuth store routes — secret guard + client/code persistence.
// Sets the internal secret BEFORE requiring the router (middleware reads it at
// module load), and mocks the DAL so no DB is needed.
process.env.MCP_INTERNAL_SECRET = 'test-secret';

jest.mock('../../../src/db/dal.cjs', () => ({
  oauthDal: {
    registerClient: jest.fn(),
    getClient: jest.fn(),
    createCode: jest.fn(),
    getCode: jest.fn(),
    consumeCode: jest.fn(),
  },
}));

const express = require('express');
const request = require('supertest');
const dal = require('../../../src/db/dal.cjs');
const oauthStoreRoutes = require('../../../src/routes/oauthStore.routes');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/internal/oauth', oauthStoreRoutes);
  return a;
}

const SECRET = { 'X-Internal-Token': 'test-secret' };

beforeEach(() => jest.clearAllMocks());

describe('internal-auth guard', () => {
  it('rejects a request with no token (403)', async () => {
    await request(app()).get('/internal/oauth/clients/x').expect(403);
  });
  it('rejects a wrong token (403)', async () => {
    await request(app()).get('/internal/oauth/clients/x').set('X-Internal-Token', 'nope').expect(403);
  });
});

describe('client registration (DCR)', () => {
  it('registers a public client without a secret', async () => {
    dal.oauthDal.registerClient.mockImplementation((c) => Promise.resolve({ ...c }));
    const res = await request(app())
      .post('/internal/oauth/clients')
      .set(SECRET)
      .send({ token_endpoint_auth_method: 'none', redirect_uris: ['https://claude.ai/cb'], client_name: 'Claude' })
      .expect(201);
    expect(res.body.clientId).toBeTruthy();
    expect(res.body.clientSecret).toBeNull();
    expect(dal.oauthDal.registerClient).toHaveBeenCalledWith(expect.objectContaining({
      tokenEndpointAuthMethod: 'none', redirectUris: ['https://claude.ai/cb'],
    }));
  });

  it('registers a confidential client with a generated secret', async () => {
    dal.oauthDal.registerClient.mockImplementation((c) => Promise.resolve({ ...c }));
    const res = await request(app())
      .post('/internal/oauth/clients')
      .set(SECRET)
      .send({ token_endpoint_auth_method: 'client_secret_basic', redirect_uris: ['https://x/cb'] })
      .expect(201);
    expect(res.body.clientSecret).toBeTruthy();
  });

  it('returns 404 for an unknown client', async () => {
    dal.oauthDal.getClient.mockResolvedValue(null);
    await request(app()).get('/internal/oauth/clients/ghost').set(SECRET).expect(404);
  });
});

describe('authorization codes', () => {
  it('creates a code with the bound AP credential and a TTL expiry', async () => {
    dal.oauthDal.createCode.mockImplementation((c) => Promise.resolve({ code: c.code }));
    const res = await request(app())
      .post('/internal/oauth/codes')
      .set(SECRET)
      .send({ client_id: 'c1', code_challenge: 'ch', redirect_uri: 'https://claude.ai/cb', scopes: ['agentplanner'], user_id: 'u1', ap_access_token: 'ap-jwt', ap_refresh_token: 'ap-ref' })
      .expect(201);
    expect(res.body.code).toBeTruthy();
    const arg = dal.oauthDal.createCode.mock.calls[0][0];
    expect(arg).toMatchObject({ clientId: 'c1', apAccessToken: 'ap-jwt', userId: 'u1' });
    expect(arg.expiresAt).toBeInstanceOf(Date);
  });

  it('peek (GET) returns the challenge but never the AP tokens', async () => {
    dal.oauthDal.getCode.mockResolvedValue({ clientId: 'c1', codeChallenge: 'CH', redirectUri: 'https://claude.ai/cb', apAccessToken: 'secret-jwt' });
    const res = await request(app()).get('/internal/oauth/codes/abc').set(SECRET).expect(200);
    expect(res.body.code_challenge).toBe('CH');
    expect(res.body.ap_access_token).toBeUndefined();
  });

  it('consume returns the AP credential and 404 once gone', async () => {
    dal.oauthDal.consumeCode.mockResolvedValueOnce({ clientId: 'c1', codeChallenge: 'CH', redirectUri: 'https://claude.ai/cb', scopes: [], userId: 'u1', apAccessToken: 'ap-jwt', apRefreshToken: 'ap-ref' });
    const ok = await request(app()).post('/internal/oauth/codes/abc/consume').set(SECRET).expect(200);
    expect(ok.body.ap_access_token).toBe('ap-jwt');

    dal.oauthDal.consumeCode.mockResolvedValueOnce(null);
    await request(app()).post('/internal/oauth/codes/abc/consume').set(SECRET).expect(404);
  });
});
