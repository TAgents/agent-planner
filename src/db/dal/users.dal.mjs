import { eq, ilike } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { users } from '../schema/users.mjs';

export const usersDal = {
  async findById(id) {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  },

  async findByEmail(email) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user ?? null;
  },

  async findByGithubId(githubId) {
    const [user] = await db.select().from(users).where(eq(users.githubId, githubId)).limit(1);
    return user ?? null;
  },

  async create(data) {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  },

  async update(id, data) {
    const [user] = await db.update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user ?? null;
  },

  async delete(id) {
    const [user] = await db.delete(users).where(eq(users.id, id)).returning();
    return user ?? null;
  },

  async list({ limit = 50, offset = 0 } = {}) {
    return db.select().from(users).limit(limit).offset(offset);
  },
};
