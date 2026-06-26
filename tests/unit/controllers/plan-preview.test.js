// Unfurl OG-meta controller — visibility-safety is the critical case: a private
// or missing plan must NEVER leak its title/description into the meta.
jest.mock('../../../src/domains/plan/services/plan.service', () => {
  class ServiceError extends Error {
    constructor(message, statusCode) { super(message); this.statusCode = statusCode; }
  }
  return { ServiceError, getPlanForUnfurl: jest.fn() };
});

const planService = require('../../../src/domains/plan/services/plan.service');
const planController = require('../../../src/controllers/plan.controller.v2');

const PLAN_ID = '11111111-1111-1111-1111-111111111111';

function run(user) {
  const sent = {};
  const res = {
    set: jest.fn().mockReturnThis(),
    send: jest.fn((html) => { sent.html = html; return res; }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return planController.getPlanPreviewMeta({ params: { id: PLAN_ID }, user }, res).then(() => sent.html);
}

beforeEach(() => jest.clearAllMocks());

describe('GET /plans/:id/preview — unfurl meta', () => {
  it('public plan → rich meta with title + image (summary_large_image)', async () => {
    planService.getPlanForUnfurl.mockResolvedValue({
      id: PLAN_ID, title: 'Secret Launch Plan', description: 'Ship the thing', visibility: 'public',
      owner: { name: 'Ada' }, node_count: 12,
    });
    const html = await run();
    expect(html).toContain('<meta property="og:title" content="Secret Launch Plan">');
    expect(html).toContain('<meta property="og:description" content="Ship the thing">');
    expect(html).toContain(`/api/plans/public/${PLAN_ID}/og.svg`);
    expect(html).toContain('content="summary_large_image"');
  });

  it('unlisted plan → title shown but text-only (no image)', async () => {
    planService.getPlanForUnfurl.mockResolvedValue({
      id: PLAN_ID, title: 'Unlisted Plan', description: '', visibility: 'unlisted',
      owner: { name: 'Ada' }, node_count: 1,
    });
    const html = await run();
    expect(html).toContain('og:title" content="Unlisted Plan"');
    expect(html).not.toContain('og:image');
    expect(html).toContain('content="summary"');
    // Falls back to a stats-based description when none is set.
    expect(html).toContain('1 node · by Ada on AgentPlanner');
  });

  it('SECURITY: anonymous + private/missing plan → generic meta, NO leak', async () => {
    planService.getPlanForUnfurl.mockRejectedValue(new planService.ServiceError('Plan not found', 404));
    const html = await run(); // no user → anonymous
    expect(planService.getPlanForUnfurl).toHaveBeenCalledWith(PLAN_ID, { userId: undefined });
    expect(html).toContain('og:title" content="AgentPlanner"');
    expect(html).not.toMatch(/Secret|Launch|Unlisted/i); // no plan content leaks
    expect(html).not.toContain('og:image');
  });

  it('authorized viewer (token) → real preview even for a PRIVATE plan', async () => {
    // getPlanForUnfurl resolves because the user can access the plan.
    planService.getPlanForUnfurl.mockResolvedValue({
      id: PLAN_ID, title: 'Private Roadmap', description: 'internal only', visibility: 'private',
      owner: { name: 'Ada' }, node_count: 3,
    });
    const html = await run({ id: 'user-1' });
    expect(planService.getPlanForUnfurl).toHaveBeenCalledWith(PLAN_ID, { userId: 'user-1' });
    expect(html).toContain('og:title" content="Private Roadmap"');
    expect(html).not.toContain('og:image'); // private → still no public og.svg image
  });

  it('escapes HTML in the title (no meta-tag injection)', async () => {
    planService.getPlanForUnfurl.mockResolvedValue({
      id: PLAN_ID, title: 'Evil "><script>x</script>', description: 'd', visibility: 'public',
      owner: { name: 'x' }, node_count: 2,
    });
    const html = await run();
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
