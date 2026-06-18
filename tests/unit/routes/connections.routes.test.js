// Connected-apps routes — list + disconnect over the OAuth refresh-token store.
// Mocks the DAL (no DB) and the auth middleware (injects a fixed user).
jest.mock('../../../src/db/dal.cjs', () => ({
  oauthDal: {
    listActiveConnectionsForUser: jest.fn(),
    revokeRefreshTokensForUser: jest.fn(),
  },
}));
jest.mock('../../../src/middleware/auth.middleware.v2', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
}));

const express = require('express');
const request = require('supertest');
const dal = require('../../../src/db/dal.cjs');
const connectionsRoutes = require('../../../src/routes/connections.routes');

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/connections', connectionsRoutes);
  return a;
};

beforeEach(() => jest.clearAllMocks());

describe('GET /connections/apps', () => {
  it('maps connections to plain-language capabilities and a connector type', async () => {
    dal.oauthDal.listActiveConnectionsForUser.mockResolvedValue([
      { clientId: 'c1', clientName: 'Claude', scopes: ['agentplanner'], connectedAt: '2026-06-01T00:00:00Z', expiresAt: '2026-07-01T00:00:00Z' },
      { clientId: 'c2', clientName: 'ChatGPT', scopes: [], connectedAt: '2026-06-10T00:00:00Z', expiresAt: '2026-07-10T00:00:00Z' },
    ]);
    const res = await request(app()).get('/connections/apps').expect(200);
    expect(dal.oauthDal.listActiveConnectionsForUser).toHaveBeenCalledWith('u1');
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ client_id: 'c1', name: 'Claude', type: 'Claude', status: 'connected', connected_at: '2026-06-01T00:00:00Z' });
    expect(res.body[0].capabilities.write).toContain('plans');
    expect(res.body[0].capabilities.summary).toMatch(/read and update/i);
    expect(res.body[1].type).toBe('ChatGPT'); // empty scopes still → full access
    expect(res.body[1].capabilities.read).toContain('decisions');
  });

  it('returns an empty array when nothing is connected', async () => {
    dal.oauthDal.listActiveConnectionsForUser.mockResolvedValue([]);
    const res = await request(app()).get('/connections/apps').expect(200);
    expect(res.body).toEqual([]);
  });
});

describe('DELETE /connections/apps/:clientId', () => {
  it('revokes all tokens for that client+user and returns 204', async () => {
    dal.oauthDal.revokeRefreshTokensForUser.mockResolvedValue(2);
    await request(app()).delete('/connections/apps/c1').expect(204);
    expect(dal.oauthDal.revokeRefreshTokensForUser).toHaveBeenCalledWith('u1', 'c1');
  });

  it('is idempotent — 204 even when nothing was active', async () => {
    dal.oauthDal.revokeRefreshTokensForUser.mockResolvedValue(0);
    await request(app()).delete('/connections/apps/unknown').expect(204);
  });
});
