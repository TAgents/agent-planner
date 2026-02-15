import { eq, and } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { slackIntegrations, webhookSettings } from '../schema/integrations.mjs';

export const slackDal = {
  async getIntegration(userId) {
    const [row] = await db.select().from(slackIntegrations)
      .where(and(eq(slackIntegrations.userId, userId), eq(slackIntegrations.isActive, true)))
      .limit(1);
    return row ?? null;
  },

  async upsert(data) {
    const [row] = await db.insert(slackIntegrations)
      .values(data)
      .onConflictDoUpdate({
        target: [slackIntegrations.userId, slackIntegrations.teamId],
        set: {
          teamName: data.teamName,
          botToken: data.botToken,
          channelId: data.channelId,
          channelName: data.channelName,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  },

  async updateChannel(userId, channelId, channelName) {
    const [row] = await db.update(slackIntegrations)
      .set({ channelId, channelName, updatedAt: new Date() })
      .where(and(eq(slackIntegrations.userId, userId), eq(slackIntegrations.isActive, true)))
      .returning();
    return row ?? null;
  },

  async disconnect(userId) {
    await db.update(slackIntegrations)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(slackIntegrations.userId, userId), eq(slackIntegrations.isActive, true)));
  },
};

export const webhooksDal = {
  async getSettings(userId) {
    const [row] = await db.select().from(webhookSettings)
      .where(eq(webhookSettings.userId, userId))
      .limit(1);
    return row ?? null;
  },

  async logDelivery(/* handled via raw insert for webhook_deliveries table */) {
    // webhook_deliveries isn't in schema yet — use raw SQL if needed
  },
};
