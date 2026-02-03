/**
 * Email Service
 * 
 * Handles sending transactional emails for plan invitations.
 * Supports SMTP (nodemailer) with fallback logging for development.
 */

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// Create transporter based on environment
let transporter = null;

const initializeTransporter = () => {
  if (transporter) return transporter;

  // Check if SMTP is configured
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    logger.api('Email transporter initialized with SMTP');
  } else {
    // Development: log emails instead of sending
    transporter = {
      sendMail: async (options) => {
        await logger.api(`[DEV EMAIL] To: ${options.to}, Subject: ${options.subject}`);
        await logger.api(`[DEV EMAIL] Body: ${options.text || options.html}`);
        return { messageId: 'dev-' + Date.now() };
      }
    };
    logger.api('Email transporter initialized in development mode (logging only)');
  }

  return transporter;
};

/**
 * Send a plan invitation email
 */
const sendPlanInviteEmail = async ({ to, inviterName, planTitle, planId, role, token }) => {
  const transport = initializeTransporter();
  
  const appUrl = process.env.APP_URL || 'https://agentplanner.io';
  const inviteUrl = `${appUrl}/invite/${token}`;
  const planUrl = `${appUrl}/plans/${planId}`;

  const roleDescription = {
    viewer: 'view',
    editor: 'view and edit',
    admin: 'view, edit, and manage'
  }[role] || 'view';

  const subject = `${inviterName} invited you to collaborate on "${planTitle}"`;
  
  const text = `
Hi there!

${inviterName} has invited you to ${roleDescription} the plan "${planTitle}" on AgentPlanner.

Click here to accept the invitation:
${inviteUrl}

Or view the plan directly (if you already have an account):
${planUrl}

This invitation expires in 7 days.

---
AgentPlanner - AI-Powered Collaborative Planning
https://agentplanner.io
`.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">You're Invited! 🎉</h1>
  </div>
  
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
    <p style="font-size: 16px; margin-top: 0;">
      <strong>${inviterName}</strong> has invited you to <strong>${roleDescription}</strong> the plan:
    </p>
    
    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <h2 style="margin: 0 0 10px 0; color: #1f2937; font-size: 20px;">${planTitle}</h2>
      <span style="display: inline-block; background: #dbeafe; color: #1e40af; padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 500;">
        ${role.charAt(0).toUpperCase() + role.slice(1)} Access
      </span>
    </div>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${inviteUrl}" style="display: inline-block; background: #4f46e5; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Accept Invitation
      </a>
    </div>
    
    <p style="color: #6b7280; font-size: 14px; margin-bottom: 0;">
      This invitation expires in 7 days. If you already have an account, you can 
      <a href="${planUrl}" style="color: #4f46e5;">view the plan directly</a>.
    </p>
  </div>
  
  <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
    <p style="margin: 0;">
      <a href="${appUrl}" style="color: #9ca3af; text-decoration: none;">AgentPlanner</a> - AI-Powered Collaborative Planning
    </p>
  </div>
</body>
</html>
`.trim();

  try {
    const result = await transport.sendMail({
      from: process.env.SMTP_FROM || '"AgentPlanner" <noreply@agentplanner.io>',
      to,
      subject,
      text,
      html
    });
    
    await logger.api(`Invite email sent to ${to} for plan ${planId}: ${result.messageId}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    await logger.error(`Failed to send invite email to ${to}:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Send notification when someone accepts an invite
 */
const sendInviteAcceptedEmail = async ({ to, accepterName, planTitle, planId }) => {
  const transport = initializeTransporter();
  
  const appUrl = process.env.APP_URL || 'https://agentplanner.io';
  const planUrl = `${appUrl}/plans/${planId}`;

  const subject = `${accepterName} joined your plan "${planTitle}"`;
  
  const text = `
Good news!

${accepterName} has accepted your invitation and joined the plan "${planTitle}".

View the plan: ${planUrl}

---
AgentPlanner - AI-Powered Collaborative Planning
`.trim();

  try {
    const result = await transport.sendMail({
      from: process.env.SMTP_FROM || '"AgentPlanner" <noreply@agentplanner.io>',
      to,
      subject,
      text
    });
    
    await logger.api(`Invite accepted email sent to ${to}: ${result.messageId}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    await logger.error(`Failed to send invite accepted email:`, error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendPlanInviteEmail,
  sendInviteAcceptedEmail
};
