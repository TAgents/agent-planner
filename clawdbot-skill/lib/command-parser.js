/**
 * Command Parser for Agent Planner Skill
 *
 * Parses slash commands and natural language into structured commands.
 */

export class CommandParser {
  constructor() {
    // Define intents for natural language matching
    this.intents = [
      {
        name: 'create_plan',
        patterns: [
          /create (?:a )?plan (?:for |to |called |named )?["']?(.+?)["']?$/i,
          /start (?:a )?new plan (?:for |to |called |named )?["']?(.+?)["']?$/i,
          /make (?:a )?plan (?:for |to |called |named )?["']?(.+?)["']?$/i,
          /i need to plan ["']?(.+?)["']?$/i,
          /plan (?:for |to )?["']?(.+?)["']?$/i
        ]
      },
      {
        name: 'check_progress',
        patterns: [
          /(?:what(?:'s| is) the )?progress (?:on |of )?["']?(.+?)["']?\??$/i,
          /how (?:is |are )["']?(.+?)["']? going\??$/i,
          /status (?:of |on )?["']?(.+?)["']?\??$/i,
          /(?:check |show )?progress (?:on |for )?["']?(.+?)["']?$/i
        ]
      },
      {
        name: 'add_task',
        patterns: [
          /add (?:a )?task ["']?(.+?)["']?$/i,
          /create (?:a )?task ["']?(.+?)["']?$/i,
          /new task ["']?(.+?)["']?$/i,
          /add ["']?(.+?)["']? to (?:the )?plan$/i
        ]
      },
      {
        name: 'complete_task',
        patterns: [
          /mark ["']?(.+?)["']? (?:as )?complete(?:d)?$/i,
          /complete ["']?(.+?)["']?$/i,
          /finish ["']?(.+?)["']?$/i,
          /done (?:with )?["']?(.+?)["']?$/i,
          /["']?(.+?)["']? is (?:done|complete|finished)$/i
        ]
      },
      {
        name: 'list_plans',
        patterns: [
          /(?:show |list |get )?(?:my |all )?plans$/i,
          /what plans do i have\??$/i,
          /my plans$/i
        ]
      }
    ];
  }

  /**
   * Parse a slash command
   */
  parse(text, commandType) {
    const parts = text.trim().split(/\s+/);
    const result = {
      command: commandType,
      subcommand: null,
      args: {},
      raw: text
    };

    // Remove the command prefix (/plan, /task, etc.)
    parts.shift();

    if (parts.length === 0) {
      result.subcommand = 'help';
      return result;
    }

    // Get subcommand
    result.subcommand = parts.shift().toLowerCase();

    // Parse remaining arguments based on command type and subcommand
    switch (commandType) {
      case 'plan':
        this.parsePlanArgs(result, parts);
        break;
      case 'task':
        this.parseTaskArgs(result, parts);
        break;
      case 'phase':
        this.parsePhaseArgs(result, parts);
        break;
      case 'milestone':
        this.parseMilestoneArgs(result, parts);
        break;
    }

    return result;
  }

  /**
   * Parse plan command arguments
   */
  parsePlanArgs(result, parts) {
    const text = parts.join(' ');

    switch (result.subcommand) {
      case 'create':
        // /plan create "Title" or /plan create Title
        result.args.title = this.extractQuotedOrRest(text);
        break;

      case 'list':
        // /plan list [status]
        if (parts[0]) {
          result.args.status = parts[0].toLowerCase();
        }
        break;

      case 'show':
      case 'delete':
      case 'progress':
      case 'subscribe':
      case 'unsubscribe':
        // /plan show #plan-id or /plan show plan-id
        result.args.id = this.extractId(text);
        break;
    }
  }

  /**
   * Parse task command arguments
   */
  parseTaskArgs(result, parts) {
    const text = parts.join(' ');

    switch (result.subcommand) {
      case 'add':
        // /task add "Title" to #parent-id
        const addMatch = text.match(/["']?(.+?)["']?\s+to\s+(.+)$/i);
        if (addMatch) {
          result.args.title = addMatch[1].trim();
          result.args.parent_id = this.extractId(addMatch[2]);
        } else {
          result.args.title = this.extractQuotedOrRest(text);
        }
        break;

      case 'status':
        // /task status #task-id completed
        const statusMatch = text.match(/(.+?)\s+(not_started|in_progress|completed|blocked)$/i);
        if (statusMatch) {
          result.args.id = this.extractId(statusMatch[1]);
          result.args.status = statusMatch[2].toLowerCase();
        }
        break;

      case 'assign':
        // /task assign #task-id @user
        const assignMatch = text.match(/(.+?)\s+@(\w+)$/);
        if (assignMatch) {
          result.args.id = this.extractId(assignMatch[1]);
          result.args.user = assignMatch[2];
        }
        break;

      case 'comment':
      case 'log':
        // /task comment #task-id "Message"
        const commentMatch = text.match(/(.+?)\s+["']?(.+)["']?$/);
        if (commentMatch) {
          result.args.id = this.extractId(commentMatch[1]);
          result.args.content = commentMatch[2].trim();
        }
        break;
    }
  }

  /**
   * Parse phase command arguments
   */
  parsePhaseArgs(result, parts) {
    const text = parts.join(' ');

    switch (result.subcommand) {
      case 'add':
        // /phase add "Title" to #plan-id
        const addMatch = text.match(/["']?(.+?)["']?\s+to\s+(.+)$/i);
        if (addMatch) {
          result.args.title = addMatch[1].trim();
          result.args.plan_id = this.extractId(addMatch[2]);
        }
        break;

      case 'list':
        // /phase list #plan-id
        result.args.plan_id = this.extractId(text);
        break;
    }
  }

  /**
   * Parse milestone command arguments
   */
  parseMilestoneArgs(result, parts) {
    const text = parts.join(' ');

    switch (result.subcommand) {
      case 'add':
        // /milestone add "Title" to #parent-id
        const addMatch = text.match(/["']?(.+?)["']?\s+to\s+(.+)$/i);
        if (addMatch) {
          result.args.title = addMatch[1].trim();
          result.args.parent_id = this.extractId(addMatch[2]);
        }
        break;

      case 'list':
        // /milestone list #plan-id
        result.args.plan_id = this.extractId(text);
        break;
    }
  }

  /**
   * Extract a quoted string or the rest of the text
   */
  extractQuotedOrRest(text) {
    const quotedMatch = text.match(/["'](.+?)["']/);
    if (quotedMatch) {
      return quotedMatch[1];
    }
    return text.trim();
  }

  /**
   * Extract an ID from text (handles #id format or plain id)
   */
  extractId(text) {
    const trimmed = text.trim();

    // Handle #plan-xxx or #task-xxx format
    const hashMatch = trimmed.match(/#([\w-]+)/);
    if (hashMatch) {
      return hashMatch[1];
    }

    // Handle plain ID (UUID or prefixed)
    const idMatch = trimmed.match(/([\w-]+)/);
    if (idMatch) {
      return idMatch[1];
    }

    return trimmed;
  }

  /**
   * Match text against natural language intents
   */
  matchIntent(text) {
    for (const intent of this.intents) {
      for (const pattern of intent.patterns) {
        const match = text.match(pattern);
        if (match) {
          return {
            name: intent.name,
            extracted: match[1]?.trim() || null,
            fullMatch: match[0]
          };
        }
      }
    }
    return null;
  }

  /**
   * Check if text looks like a plan-related message
   */
  isPlanRelated(text) {
    const planKeywords = [
      'plan', 'task', 'phase', 'milestone',
      'progress', 'status', 'complete', 'assign',
      'create', 'add', 'update', 'delete'
    ];

    const lowerText = text.toLowerCase();
    return planKeywords.some(keyword => lowerText.includes(keyword));
  }
}
