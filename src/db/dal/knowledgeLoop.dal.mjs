import { eq, and, desc } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { knowledgeLoopRuns } from '../schema/knowledgeLoop.mjs';

export const knowledgeLoopDal = {
  async create(data) {
    const [run] = await db.insert(knowledgeLoopRuns).values(data).returning();
    return run;
  },

  async findById(id) {
    const [run] = await db.select().from(knowledgeLoopRuns)
      .where(eq(knowledgeLoopRuns.id, id)).limit(1);
    return run ?? null;
  },

  async findRunningByPlan(planId) {
    const [run] = await db.select().from(knowledgeLoopRuns)
      .where(and(
        eq(knowledgeLoopRuns.planId, planId),
        eq(knowledgeLoopRuns.status, 'running'),
      ))
      .limit(1);
    return run ?? null;
  },

  async findLatestByPlan(planId) {
    const [run] = await db.select().from(knowledgeLoopRuns)
      .where(eq(knowledgeLoopRuns.planId, planId))
      .orderBy(desc(knowledgeLoopRuns.startedAt))
      .limit(1);
    return run ?? null;
  },

  async listByPlan(planId) {
    return db.select().from(knowledgeLoopRuns)
      .where(eq(knowledgeLoopRuns.planId, planId))
      .orderBy(desc(knowledgeLoopRuns.startedAt));
  },

  async update(id, data) {
    const [run] = await db.update(knowledgeLoopRuns)
      .set(data)
      .where(eq(knowledgeLoopRuns.id, id))
      .returning();
    return run ?? null;
  },

  async addIteration(id, iteration) {
    const run = await this.findById(id);
    if (!run) return null;
    const iterations = [...(run.iterations || []), iteration];
    return this.update(id, {
      iterations,
      qualityAfter: iteration.quality_score,
    });
  },

  async complete(id, status = 'converged') {
    return this.update(id, {
      status,
      completedAt: new Date(),
    });
  },
};
