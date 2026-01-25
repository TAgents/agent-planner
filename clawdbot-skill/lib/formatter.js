/**
 * Message Formatter for Agent Planner Skill
 *
 * Formats API responses and notifications for display in messaging platforms.
 * Uses a consistent style that works well across Telegram, Discord, Slack, etc.
 */

export class Formatter {
  constructor(options = {}) {
    this.options = {
      maxLineLength: 80,
      progressBarLength: 20,
      ...options
    };
  }

  // ============================================
  // Status Icons
  // ============================================

  getStatusIcon(status) {
    const icons = {
      'not_started': '\u23F3', // hourglass
      'in_progress': '\uD83D\uDD04', // arrows counterclockwise
      'completed': '\u2705', // check mark
      'blocked': '\uD83D\uDEAB', // prohibited
      'draft': '\uD83D\uDCDD', // memo
      'active': '\u25B6\uFE0F', // play
      'archived': '\uD83D\uDCE6' // package
    };
    return icons[status] || '\u2753'; // question mark
  }

  getNodeTypeIcon(nodeType) {
    const icons = {
      'root': '\uD83C\uDFE0', // house
      'phase': '\uD83D\uDCC1', // folder
      'task': '\u2610', // ballot box
      'milestone': '\uD83C\uDFC1' // flag
    };
    return icons[nodeType] || '\u2022'; // bullet
  }

  // ============================================
  // Plan Responses
  // ============================================

  planCreated(plan) {
    return [
      `\u2705 **Created plan "${plan.title}"**`,
      '',
      `ID: \`#plan-${plan.id.slice(0, 8)}\``,
      `Status: ${this.getStatusIcon(plan.status)} ${plan.status}`,
      '',
      'Add tasks with:',
      `\`/task add "Task name" to #plan-${plan.id.slice(0, 8)}\``
    ].join('\n');
  }

  planDetails(plan, tree = null) {
    const lines = [
      `**${plan.title}**`,
      '',
      `ID: \`#plan-${plan.id.slice(0, 8)}\``,
      `Status: ${this.getStatusIcon(plan.status)} ${plan.status}`,
    ];

    if (plan.description) {
      lines.push(`Description: ${plan.description}`);
    }

    if (plan.progress !== undefined) {
      lines.push('');
      lines.push(this.progressBar(plan.progress));
    }

    if (tree && tree.children && tree.children.length > 0) {
      lines.push('');
      lines.push('**Structure:**');
      lines.push(this.formatTree(tree.children, 0, 2));
    }

    return lines.join('\n');
  }

  plansList(plans) {
    if (!plans || plans.length === 0) {
      return 'No plans found. Create one with `/plan create "Title"`';
    }

    const lines = [`**Your Plans** (${plans.length})`, ''];

    for (const plan of plans.slice(0, 10)) {
      const progress = plan.progress !== undefined ? ` (${Math.round(plan.progress)}%)` : '';
      lines.push(
        `${this.getStatusIcon(plan.status)} **${plan.title}**${progress}`,
        `  \`#plan-${plan.id.slice(0, 8)}\``,
        ''
      );
    }

    if (plans.length > 10) {
      lines.push(`_...and ${plans.length - 10} more_`);
    }

    return lines.join('\n');
  }

  planDeleted(plan) {
    return `\uD83D\uDDD1\uFE0F Deleted plan "${plan.title}"`;
  }

  // ============================================
  // Progress Display
  // ============================================

  planProgress(plan, stats) {
    const percentage = Math.round(stats.progress || 0);
    const lines = [
      `**${plan.title}** Progress`,
      '',
      this.progressBar(percentage),
      ''
    ];

    if (stats.by_status) {
      const statusOrder = ['completed', 'in_progress', 'not_started', 'blocked'];
      for (const status of statusOrder) {
        const count = stats.by_status[status] || 0;
        if (count > 0) {
          lines.push(`${this.getStatusIcon(status)} ${this.capitalize(status.replace('_', ' '))}: ${count}`);
        }
      }
    }

    return lines.join('\n');
  }

  progressBar(percentage) {
    const filled = Math.round((percentage / 100) * this.options.progressBarLength);
    const empty = this.options.progressBarLength - filled;
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
    return `${bar} ${percentage}%`;
  }

  // ============================================
  // Node Responses
  // ============================================

  nodeCreated(node, parentTitle = null) {
    const typeLabel = this.capitalize(node.node_type);
    const parentInfo = parentTitle ? ` to **${parentTitle}**` : '';

    return [
      `${this.getStatusIcon('completed')} Added ${typeLabel.toLowerCase()} "${node.title}"${parentInfo}`,
      '',
      `ID: \`#${node.node_type}-${node.id.slice(0, 8)}\``,
      `Status: ${this.getStatusIcon(node.status)} ${node.status}`
    ].join('\n');
  }

  nodeUpdated(node, changes) {
    const lines = [`\u270F\uFE0F Updated "${node.title}"`];

    if (changes.status) {
      lines.push(`Status: ${this.getStatusIcon(changes.status)} ${changes.status}`);
    }

    if (changes.title) {
      lines.push(`New title: ${changes.title}`);
    }

    return lines.join('\n');
  }

  nodesList(nodes, title = 'Nodes') {
    if (!nodes || nodes.length === 0) {
      return `No ${title.toLowerCase()} found.`;
    }

    const lines = [`**${title}** (${nodes.length})`, ''];

    for (const node of nodes) {
      lines.push(
        `${this.getStatusIcon(node.status)} ${this.getNodeTypeIcon(node.node_type)} ${node.title}`,
        `  \`#${node.node_type}-${node.id.slice(0, 8)}\``,
        ''
      );
    }

    return lines.join('\n');
  }

  // ============================================
  // Tree Formatting
  // ============================================

  formatTree(nodes, depth = 0, maxDepth = 3) {
    if (depth >= maxDepth || !nodes || nodes.length === 0) {
      return '';
    }

    const lines = [];
    const indent = '  '.repeat(depth);

    for (const node of nodes) {
      const icon = this.getStatusIcon(node.status);
      const typeIcon = this.getNodeTypeIcon(node.node_type);
      lines.push(`${indent}${icon} ${typeIcon} ${node.title}`);

      if (node.children && node.children.length > 0) {
        const childLines = this.formatTree(node.children, depth + 1, maxDepth);
        if (childLines) {
          lines.push(childLines);
        }
      }
    }

    return lines.join('\n');
  }

  // ============================================
  // Comments and Logs
  // ============================================

  commentAdded(nodeTitle) {
    return `\uD83D\uDCAC Added comment to "${nodeTitle}"`;
  }

  logAdded(nodeTitle, logType) {
    const typeIcon = {
      'progress': '\uD83D\uDCC8',
      'reasoning': '\uD83E\uDDE0',
      'challenge': '\u26A0\uFE0F',
      'decision': '\u2696\uFE0F'
    }[logType] || '\uD83D\uDCDD';

    return `${typeIcon} Added ${logType} log to "${nodeTitle}"`;
  }

  // ============================================
  // Assignments
  // ============================================

  userAssigned(nodeTitle, userName) {
    return `\uD83D\uDC64 Assigned **@${userName}** to "${nodeTitle}"`;
  }

  userUnassigned(nodeTitle, userName) {
    return `\u2796 Removed **@${userName}** from "${nodeTitle}"`;
  }

  // ============================================
  // Subscriptions
  // ============================================

  subscribed(plan) {
    return [
      `\uD83D\uDD14 **Subscribed to "${plan.title}"**`,
      '',
      "You'll receive notifications for:",
      '\u2022 New tasks and phases',
      '\u2022 Status changes',
      '\u2022 Comments and activity',
      '',
      `Unsubscribe: \`/plan unsubscribe #plan-${plan.id.slice(0, 8)}\``
    ].join('\n');
  }

  unsubscribed(plan) {
    return `\uD83D\uDD15 Unsubscribed from "${plan.title}"`;
  }

  // ============================================
  // Notifications
  // ============================================

  nodeCreatedNotification(data) {
    const { node, plan, user } = data;
    return [
      `\uD83D\uDD14 **[${plan.title}]**`,
      '',
      `${user.display_name || user.email} added ${node.node_type}:`,
      `${this.getNodeTypeIcon(node.node_type)} ${node.title}`
    ].join('\n');
  }

  statusChangeNotification(data) {
    const { node, plan, user, changes } = data;
    const newStatus = changes.status;
    return [
      `\uD83D\uDD14 **[${plan.title}]**`,
      '',
      `${user.display_name || user.email} updated "${node.title}"`,
      `Status: ${this.getStatusIcon(newStatus)} ${newStatus}`
    ].join('\n');
  }

  commentNotification(data) {
    const { node, plan, user, comment } = data;
    return [
      `\uD83D\uDCAC **[${plan.title}]**`,
      '',
      `${user.display_name || user.email} commented on "${node.title}":`,
      `> ${this.truncate(comment.content, 200)}`
    ].join('\n');
  }

  assignmentNotification(data) {
    const { node, plan, user, assignee } = data;
    return [
      `\uD83D\uDC64 **[${plan.title}]**`,
      '',
      `${user.display_name || user.email} assigned **@${assignee.display_name || assignee.email}** to:`,
      `${this.getNodeTypeIcon(node.node_type)} ${node.title}`
    ].join('\n');
  }

  planCompletedNotification(data) {
    const { plan } = data;
    return [
      `\uD83C\uDF89 **Plan Completed!**`,
      '',
      `"${plan.title}" is now complete!`,
      this.progressBar(100)
    ].join('\n');
  }

  // ============================================
  // Errors and Help
  // ============================================

  error(message) {
    return `\u274C **Error:** ${message}`;
  }

  notFound(type, id) {
    return `\u274C **Not Found:** Could not find ${type} with ID \`${id}\``;
  }

  unauthorized() {
    return '\u274C **Unauthorized:** Please check your API token configuration.';
  }

  multiplePlansFound(plans, prompt) {
    const lines = [
      `\u2753 **${prompt}**`,
      ''
    ];

    for (const plan of plans.slice(0, 5)) {
      lines.push(`\u2022 **${plan.title}** (\`#plan-${plan.id.slice(0, 8)}\`)`);
    }

    if (plans.length > 5) {
      lines.push(`_...and ${plans.length - 5} more_`);
    }

    return lines.join('\n');
  }

  planHelp() {
    return [
      '**Plan Commands**',
      '',
      '`/plan create "Title"` - Create a new plan',
      '`/plan list [status]` - List your plans',
      '`/plan show <id>` - Show plan details',
      '`/plan progress <id>` - Show plan progress',
      '`/plan delete <id>` - Delete a plan',
      '`/plan subscribe <id>` - Subscribe to updates',
      '`/plan unsubscribe <id>` - Unsubscribe from updates',
      '',
      'Also try: `/task`, `/phase`, `/milestone`'
    ].join('\n');
  }

  taskHelp() {
    return [
      '**Task Commands**',
      '',
      '`/task add "Title" to <parent>` - Add a task',
      '`/task status <id> <status>` - Update status',
      '`/task assign <id> @user` - Assign user',
      '`/task comment <id> "Message"` - Add comment',
      '`/task log <id> "Message"` - Add activity log',
      '',
      'Statuses: not_started, in_progress, completed, blocked'
    ].join('\n');
  }

  phaseHelp() {
    return [
      '**Phase Commands**',
      '',
      '`/phase add "Title" to <plan>` - Add a phase',
      '`/phase list <plan>` - List phases in plan'
    ].join('\n');
  }

  milestoneHelp() {
    return [
      '**Milestone Commands**',
      '',
      '`/milestone add "Title" to <parent>` - Add milestone',
      '`/milestone list <plan>` - List milestones in plan'
    ].join('\n');
  }

  // ============================================
  // Utilities
  // ============================================

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  truncate(str, maxLength) {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
  }
}
