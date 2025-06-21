import { Faker, en } from '@faker-js/faker'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import dotenv from 'dotenv'
import metrics from './metrics.js'
import jq from 'node-jq'
import pino from 'pino'
import pretty from 'pino-pretty'

dotenv.config()

const logger = pino(pretty())

/**
 * @typedef {Object} ToolSequenceStep
 * @property {string} toolName - Name of the tool to call
 * @property {Object<string, string|Object>} [inputMapping] - For tool calls, maps input parameters to previous step outputs using jq expressions or nested objects. All mapping strings must be valid jq expressions.
 * @property {Object} [staticInputs] - Static input values
 * @property {Object<string, string>} [outputMapping] - Object mapping output keys to jq expressions (e.g., { bar: '.foo', b: '.a.b' }). All mapping strings must be valid jq expressions.
 * @property {('json'|'text')} [outputType] - Output type: 'json' (default) or 'text'
 */

/**
 * @typedef {Object} MockDataConfig
 * @property {string} [locale] - Faker locale (e.g., 'en', 'fr')
 * @property {Object} [fieldGenerators] - Custom field generators for specific fields
 * @property {Object} [fieldFormats] - Format specifications for fields (e.g., { email: 'company' })
 */

/**
 * @typedef {Object} LoadTestConfig
 * @property {string} serverUrl - URL of the MCP server
 * @property {number} [numCalls] - Number of tool calls to make (default: 1)
 * @property {number} [delayBetweenCalls] - Delay in milliseconds between calls
 * @property {string[]} [toolNames] - Optional list of specific tool names to call
 * @property {Record<string, Record<string, unknown>>} [paramOverrides] - Optional parameter overrides for specific tools
 * @property {boolean} [randomizeParams] - Whether to randomize parameters (default: true)
 * @property {MockDataConfig} [mockData] - Configuration for mock data generation
 * @property {ToolSequenceStep[]} [sequence] - Optional sequence of tool calls with data dependencies
 * @property {boolean} [runAll] - Optional run all tools
 * @property {import('@faker-js/faker').FakerOptions} [fakerConfig] - Configuration for Faker instance
 */

async function assignInputMapping({ target, mapping, context }) {
  for (const [inputKey, jqExprOrObj] of Object.entries(mapping)) {
    if (typeof jqExprOrObj === 'string') {
      if (!jqExprOrObj.trim().length) {
        throw new Error(`inputMapping for key '${inputKey}' must be a valid jq expression. Got: '${jqExprOrObj}'`)
      }
      const result = await jq.run(jqExprOrObj, context, { input: 'json', output: 'json' })
      target[inputKey] = result
    } else if (typeof jqExprOrObj === 'object' && jqExprOrObj !== null) {
      target[inputKey] = {}
      await assignInputMapping({ target: target[inputKey], mapping: jqExprOrObj, context })
    } else {
      throw new Error(`inputMapping for key '${inputKey}' must be a jq expression or nested object. Got: ${jqExprOrObj}`)
    }
  }
}

class MCPClient {
  /**
   * Creates a new MCPClient instance
   * @param {Object} params - Constructor parameters
   * @param {Faker} params.fakerInstance - Faker instance for generating mock data
   * @param {string} params.serverUrl - URL of the MCP server to connect to
   * @param {LoadTestConfig} params.config - Optional configuration for load testing
   */
  constructor({ fakerInstance, serverUrl, config }) {
    this.mcp = new Client({ name: 'mcp-client', version: '1.0.0' })
    this.tools = []
    this.faker = fakerInstance
    this.sequenceContext = {}
    this.transport = new StreamableHTTPClientTransport(new URL(serverUrl))
    /** @type {LoadTestConfig} */
    this.config = config
  }

  async connectToServer() {
    logger.info({ serverUrl: this.config.serverUrl }, 'Connecting to MCP server')
    try {
      // Initialize transport and connect to server
      await this.mcp.connect(this.transport)

      // List available tools
      const toolsResult = await this.mcp.listTools()
      // Set tools to all tools initially
      this.tools = toolsResult.tools
      logger.info({ tools: this.tools.map(({ name }) => name) }, 'Connected to server with tools')
      if (this.config.toolNames) {
        this.tools = this.tools.filter((tool) => this.config?.toolNames?.includes(tool.name))
        logger.info({ filteredTools: this.tools.map((t) => t.name) }, 'Filtered tools')
      }
    } catch (e) {
      logger.error({ error: e.message }, 'Failed to connect to MCP server')
      throw e
    }
    if (this.tools.length === 0) {
      throw new Error('No matching tools found')
    }
  }

  generateValueForField(fieldName, prop, mockConfig = {}) {
    const { fieldGenerators = {}, fieldFormats = {}, fakerEnabled = true } = mockConfig
    if (fakerEnabled) {
      // Check for custom generator first
      if (fieldGenerators[fieldName]) {
        return fieldGenerators[fieldName](this.faker)
      }

      // Check for format specification
      const format = fieldFormats[fieldName]

      // Generate based on field name and type
      if (fieldName.toLowerCase().includes('email')) {
        return format ? this.faker.internet.email(format) : this.faker.internet.email()
      }
      if (fieldName.toLowerCase().includes('url')) {
        return this.faker.internet.url()
      }
      if (fieldName.toLowerCase().includes('name')) {
        return this.faker.person.fullName()
      }
      if (fieldName.toLowerCase().includes('phone')) {
        return this.faker.phone.number()
      }
      if (fieldName.toLowerCase().includes('address')) {
        return this.faker.location.streetAddress()
      }
      if (fieldName.toLowerCase().includes('city')) {
        return this.faker.location.city()
      }
      if (fieldName.toLowerCase().includes('country')) {
        return this.faker.location.country()
      }
      if (fieldName.toLowerCase().includes('date')) {
        return this.faker.date.recent().toISOString()
      }
    }

    // Fallback to type-based generation
    switch (prop.type) {
      case 'string':
        return this.faker.lorem.word()
      case 'number':
        return this.faker.number.int({ min: 0, max: 1000 })
      case 'boolean':
        return this.faker.datatype.boolean()
      case 'array':
        return []
      case 'object':
        return this.generateRandomParams(prop, mockConfig)
      default:
        return null
    }
  }

  generateRandomParams(schema, mockConfig = {}) {
    const params = {}
    if (!schema || !schema.properties) return params

    for (const [key, prop] of Object.entries(schema.properties)) {
      params[key] = this.generateValueForField(key, prop, mockConfig)
    }
    return params
  }

  async callTool(tool, params) {
    const l = logger.child({ tool: tool.name })
    l.info({ tool: tool.name, params }, 'start tool call')

    const callStart = Date.now()
    let success = false
    let error = null
    let duration = 0
    try {
      const result = await this.mcp.callTool({
        name: tool.name,
        arguments: params,
      })
      if (result.isError) {
        throw new Error(result?.content?.[0].text)
      }
      l.info({ result }, 'finish tool call:')
      success = true
      return result
    } catch (err) {
      error = err
      l.error({ error: error.message }, 'error tool call')
    } finally {
      duration = Date.now() - callStart
      metrics.record(tool.name, success, duration, error)
      if (this.config.delayBetweenCalls) {
        await new Promise((resolve) => setTimeout(resolve, this.config.delayBetweenCalls))
      }
    }
  }

  async executeSequence(sequence) {
    logger.info('Executing tool sequence...')

    for (const step of sequence) {
      const tool = this.tools.find((t) => t.name === step.toolName)
      if (!tool) {
        const errMsg = `Tool ${step.toolName} not found`
        logger.error({ error: errMsg })
        metrics.record(step.toolName, false, 0, errMsg)
        continue
      }

      // Build input parameters
      /** @type {Record<string, unknown>} */
      const params = {}

      // Add static inputs (shallow merge)
      if (step.staticInputs) {
        Object.assign(params, step.staticInputs)
      }

      // Map input
      if (step.inputMapping) {
        await assignInputMapping({ target: params, mapping: step.inputMapping, context: this.sequenceContext })
      }

      // Generate random params for remaining required fields (shallow only)
      const schema = tool.inputSchema
      if (schema?.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          // TODO, add setting that randoms all fields or a set of fields
          if (params[key] === undefined && prop.required) {
            params[key] = this.generateValueForField(key, prop)
          }
        }
      }

      try {
        const result = await this.callTool(tool, params)

        if (typeof step.outputMapping === 'object' && step.outputMapping !== null) {
          const outputType = step.outputType || 'json'
          let outputToStore = result?.content?.[0]?.text
          if (outputType === 'json' && outputToStore) {
            try {
              outputToStore = JSON.parse(outputToStore)
            } catch (e) {
              logger.error({ msg: 'Failed to parse JSON output for step', tool: tool.name, error: e.message })
              throw e
            }
          }
          await assignInputMapping({ target: this.sequenceContext, mapping: step.outputMapping, context: outputToStore })
          logger.info({ msg: `Mapped result to keys`, tool: tool.name, sequenceContext: this.sequenceContext })
        }
      } catch (error) {
        logger.error({ msg: 'Error in sequence step', tool: tool.name, error: error.message })
        throw error
      }
    }
  }

  async runAll() {
    for (const tool of this.tools) {
      let params = {}
      if (this.config.randomizeParams !== false) {
        params = this.generateRandomParams(tool.inputSchema, this.config.mockData)
      }
      if (this.config.paramOverrides?.[tool.name]) {
        params = { ...params, ...this.config.paramOverrides[tool.name] }
      }

      await this.callTool(tool, params)
    }
  }
  async runRandomToolCall() {
    const randomTool = this.tools[Math.floor(Math.random() * this.tools.length)]
    let params = {}
    if (this.config.randomizeParams !== false) {
      params = this.generateRandomParams(randomTool.inputSchema, this.config.mockData)
    }
    // Apply any parameter overrides
    if (this.config.paramOverrides?.[randomTool.name]) {
      params = { ...params, ...this.config.paramOverrides[randomTool.name] }
    }

    await this.callTool(randomTool, params)
  }

  async runLoadTest() {
    if (this.tools.length === 0) {
      logger.info('No tools available')
      return
    }

    const numCalls = this.config.numCalls || 1
    logger.info(`Starting load test with ${numCalls} calls`)
    for (let i = 0; i < numCalls; i++) {
      try {
        // If sequence is defined, execute it
        if (this.config.sequence) {
          // For sequence, use the first tool name for per-tool stats
          await this.executeSequence(this.config.sequence)
        } else if (this.config.runAll) {
          await this.runAll()
        } else {
          await this.runRandomToolCall()
        }
      } catch (err) {
        logger.error(`Failed call ${i + 1}/${this.config.numCalls}:`, err)
      }
    }

    metrics.printSummary()
  }

  async cleanup() {
    await this.mcp.close()
  }
}
/**
 * Main entry point for running the MCP load test
 * @param {LoadTestConfig} config - Configuration options for the load test
 * @returns {Promise<void>}
 */
async function run(config) {
  if (!config.serverUrl) {
    logger.info('Usage: main({ serverUrl: "http://server-url", ...config })')
    return
  }

  /** @type {Partial<LoadTestConfig>} */
  const defaultConfig = {
    numCalls: 1,
    delayBetweenCalls: 10,
    randomizeParams: true,
    mockData: {
      locale: 'en',
      fieldFormats: {
        email: 'company',
        name: 'fullName',
      },
    },
    fakerConfig: { locale: [en] },
  }

  // Merge provided config with defaults
  const mergedConfig = { ...defaultConfig, ...config }

  const fakerInstance = new Faker(/** @type {import('@faker-js/faker').FakerOptions} */ (mergedConfig.fakerConfig))
  const mcpClient = new MCPClient({ fakerInstance, serverUrl: mergedConfig.serverUrl, config: mergedConfig })

  try {
    await mcpClient.connectToServer()
    await mcpClient.runLoadTest()
  } finally {
    await mcpClient.cleanup()
  }
}

// Export run function for programmatic usage
export { run }
