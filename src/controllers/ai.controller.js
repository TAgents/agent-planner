const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Analyze a prompt and generate relevant clarifying questions
 * POST /ai/analyze-prompt
 */
const analyzePrompt = async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required and must be a non-empty string'
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'AI service not configured'
      });
    }

    await logger.api(`Analyzing prompt for clarifying questions (length: ${prompt.length})`);

    const systemPrompt = `You are an expert project planning assistant. Your task is to analyze a user's project description and generate clarifying questions that will help create a better, more detailed plan.

Generate 3-5 relevant questions based on the prompt. Each question should fall into one of these categories:
- scope: Questions about project goals, deliverables, or features
- constraints: Questions about timeline, team size, budget, or technical constraints
- context: Questions about dependencies, stakeholders, or existing systems

Return your response as a JSON array with this exact format:
[
  {
    "id": "q1",
    "category": "scope|constraints|context",
    "question": "The question text",
    "placeholder": "Hint for the answer input"
  }
]

Only return the JSON array, no other text.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Analyze this project prompt and generate clarifying questions:\n\n"${prompt}"`
        }
      ],
      system: systemPrompt
    });

    // Extract the text content from the response
    const responseText = message.content[0].type === 'text'
      ? message.content[0].text
      : '';

    // Parse the JSON response
    let questions;
    try {
      // Try to find JSON array in the response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[0]);
      } else {
        questions = JSON.parse(responseText);
      }
    } catch (parseError) {
      await logger.error('Failed to parse AI response as JSON', { responseText, error: parseError.message });
      // Return default questions if parsing fails
      questions = [
        {
          id: 'q1',
          category: 'scope',
          question: 'What are the main features or deliverables you want to achieve?',
          placeholder: 'e.g., User authentication, dashboard, API integration...'
        },
        {
          id: 'q2',
          category: 'constraints',
          question: 'What is your expected timeline for this project?',
          placeholder: 'e.g., 2 weeks, 1 month, 3 months...'
        },
        {
          id: 'q3',
          category: 'context',
          question: 'Are there any existing systems or technologies this needs to integrate with?',
          placeholder: 'e.g., Existing database, third-party APIs, legacy systems...'
        }
      ];
    }

    await logger.api(`Generated ${questions.length} clarifying questions`);

    res.json({
      success: true,
      questions,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens
      }
    });

  } catch (error) {
    await logger.error('Error analyzing prompt', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to analyze prompt',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  analyzePrompt
};
