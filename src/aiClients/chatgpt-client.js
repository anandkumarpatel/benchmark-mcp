import { Agent, hostedMcpTool, run, setDefaultOpenAIKey } from '@openai/agents'
import { logger } from '../logger.js'

/**
 * @typedef {Object} OpenAIConfig
 * @property {string} key - OpenAI API key
 */

/**
 * Run AI prompt using OpenAI with MCP server integration
 * @param {string} prompt - The prompt to send to OpenAI
 * @param {string} serverUrl - MCP server URL
 * @param {OpenAIConfig} config - OpenAI configuration
 * @returns {Promise<string>} The AI response
 */
async function runOpenAIWithMCP(prompt, serverUrl, config) {
  const apiKey = config.key
  if (!apiKey) {
    throw new Error('key is required')
  }
  setDefaultOpenAIKey(apiKey)
  try {
    const agent = new Agent({
      name: 'MCP Assistant',
      instructions: 'You must always use the MCP tools to answer questions.',
      tools: [
        hostedMcpTool({
          serverLabel: 'tool',
          serverUrl: serverUrl,
        }),
      ],
    })

    const res = await run(agent, prompt)
    return res.finalOutput || ''
  } catch (error) {
    logger.error({ error: error.message }, 'Error running OpenAI with MCP')
    throw error
  }
}

export default runOpenAIWithMCP
