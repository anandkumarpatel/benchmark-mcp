import { FunctionCallingConfigMode, GoogleGenAI, mcpToTool } from '@google/genai'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { logger } from '../logger.js'

/**
 * @typedef {Object} GeminiConfig
 * @property {string} key - Gemini API key
 */

/**
 * Run AI prompt using Gemini with MCP server integration
 * @param {string} prompt - The prompt to send to Gemini
 * @param {Client} mcpClient - MCP client
 * @param {GeminiConfig} config - Gemini configuration
 * @returns {Promise<string>} The AI response
 */
async function runGeminiWithMCP(prompt, mcpClient, config) {
  if (!config.key) {
    throw new Error('key is required')
  }
  try {
    const ai = new GoogleGenAI({ vertexai: false, apiKey: config.key })
    const mcpTool = mcpToTool(mcpClient)

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [mcpTool],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          },
        },
      },
    })
    return result.candidates?.[0]?.content?.parts?.[0]?.text || ''
  } catch (error) {
    logger.error({ error: error.message }, 'Error running Gemini with MCP')
    throw error
  }
}

export default runGeminiWithMCP
