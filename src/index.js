import { Faker, en } from '@faker-js/faker'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import dotenv from 'dotenv'
import metrics from './metrics.js'
import { JSONPath } from 'jsonpath-plus'

dotenv.config()

/**
 * @typedef {Object} ToolSequenceStep
 * @property {string} [type] - Step type: 'tool-call' (default) or 'context-transform'.
 * @property {string} toolName - Name of the tool to call (for 'tool-call' steps)
 * @property {Object<string, string|Object>} [inputMapping] - For 'tool-call', maps input parameters to previous step outputs using JSONPath strings or nested objects. For 'context-transform', maps context keys to JSONPath strings to extract from the current context. Only valid JSONPath strings (starting with '$') are supported.
 * @property {Object} [staticInputs] - Static input values
 * @property {Object<string, string>} [outputMapping] - Object mapping output keys to JSONPath strings (e.g., { bar: '$.foo', b: '$.a.b' }). Only valid JSONPath strings (starting with '$') are supported.
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
 * @property {number} numCalls - Number of tool calls to make
 * @property {number} [delayBetweenCalls] - Delay in milliseconds between calls
 * @property {string[]} [toolNames] - Optional list of specific tool names to call
 * @property {Record<string, Record<string, unknown>>} [paramOverrides] - Optional parameter overrides for specific tools
 * @property {boolean} [randomizeParams] - Whether to randomize parameters (default: true)
 * @property {MockDataConfig} [mockData] - Configuration for mock data generation
 * @property {ToolSequenceStep[]} [sequence] - Optional sequence of tool calls with data dependencies
 * @property {boolean} [runAll] - Optional run all tools
 */

function assignInputMapping(target, mapping, outputs, args = {}) {
  for (const [inputKey, jsonPathOrObj] of Object.entries(mapping)) {
    if (typeof jsonPathOrObj === 'string') {
      if (!jsonPathOrObj.trim().startsWith('$')) {
        throw new Error(`inputMapping for key '${inputKey}' must be a valid JSONPath string starting with '$'. Got: '${jsonPathOrObj}'`)
      }
      const result = JSONPath({ path: jsonPathOrObj, json: outputs, ...args })
      target[inputKey] = result
    } else if (typeof jsonPathOrObj === 'object' && jsonPathOrObj !== null) {
      target[inputKey] = {}
      assignInputMapping(target[inputKey], jsonPathOrObj, outputs)
    } else {
      throw new Error(`inputMapping for key '${inputKey}' must be a JSONPath string or nested object. Got: ${jsonPathOrObj}`)
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
    try {
      // Initialize transport and connect to server
      await this.mcp.connect(this.transport)

      // List available tools
      const toolsResult = await this.mcp.listTools()
      // Set tools to all tools initially
      this.tools = toolsResult.tools
      console.log(
        'Connected to server with tools:',
        this.tools.map(({ name }) => name)
      )
      if (this.config.toolNames) {
        this.tools = this.tools.filter((tool) => this.config?.toolNames?.includes(tool.name))
        console.log(`Filtered tools: ${this.tools.map((t) => t.name).join(', ')}`)
      }
    } catch (e) {
      console.log('Failed to connect to MCP server: ', e.message)
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
    console.log(`\nCalling tool: ${tool.name}`)
    console.log('Parameters:', params)

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
      console.log('Tool call result:', result)
      success = true
      return result
    } catch (err) {
      error = err
      console.error(`Error calling tool ${tool.name}:`, error.message)
    } finally {
      duration = Date.now() - callStart
      metrics.record(tool.name, success, duration, error)
      if (this.config.delayBetweenCalls) {
        await new Promise((resolve) => setTimeout(resolve, this.config.delayBetweenCalls))
      }
    }
  }

  async executeSequence(sequence) {
    console.log('Executing tool sequence...')

    for (const step of sequence) {
      const stepType = step.type || 'tool-call'
      if (stepType === 'context-transform') {
        assignInputMapping(this.sequenceContext, step.inputMapping, this.sequenceContext, step.jsonPathArgs)
        console.log('Context after transform:', this.sequenceContext)
        continue
      }
      // Default: tool-call
      const tool = this.tools.find((t) => t.name === step.toolName)
      if (!tool) {
        console.error(`Tool ${step.toolName} not found`)
        continue
      }

      // Build input parameters
      /** @type {Record<string, unknown>} */
      const params = {}

      // Add static inputs (shallow merge)
      if (step.staticInputs) {
        Object.assign(params, step.staticInputs)
      }

      // Map previous outputs to (possibly nested) inputs
      if (step.inputMapping) {
        assignInputMapping(params, step.inputMapping, this.sequenceContext)
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

        // Determine output type (default to 'json')
        const outputType = step.outputType || 'json'
        let outputToStore = result?.content?.[0]?.text
        if (outputType === 'json' && outputToStore) {
          try {
            outputToStore = JSON.parse(outputToStore)
          } catch (e) {
            console.error(`Failed to parse JSON output for step ${step.toolName}:`, e)
          }
        }
        // Store output if mapping is specified
        if (step.outputMapping) {
          if (typeof step.outputMapping === 'object' && step.outputMapping !== null) {
            // Only support JSONPath strings (must start with $)
            for (const [key, path] of Object.entries(step.outputMapping)) {
              if (!path || typeof path !== 'string' || !path.trim().startsWith('$')) {
                throw new Error(`outputMapping for key '${key}' must be a valid JSONPath string starting with '$'. Got: '${path}'`)
              }
              const result = JSONPath({ path, json: outputToStore })
              this.sequenceContext[key] = result
            }
            console.log(`Mapped result to keys`, this.sequenceContext)
          }
        }
      } catch (error) {
        console.error(`Error in sequence step ${step.toolName}:`, error)
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
      console.log('No tools available')
      return
    }

    console.log(`Starting load test with ${this.config.numCalls} calls`)
    for (let i = 0; i < this.config.numCalls; i++) {
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
        console.error(`Failed call ${i + 1}/${this.config.numCalls}:`, err)
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
 * @param {Partial<LoadTestConfig>} config - Configuration options for the load test
 * @returns {Promise<void>}
 */
async function main(config = {}) {
  if (!config.serverUrl) {
    console.log('Usage: main({ serverUrl: "http://server-url", ...config })')
    return
  }

  // Example sequence configuration
  const defaultConfig = /** @type {LoadTestConfig} */ {
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

    // runAll: true,

    sequence: [
      {
        toolName: 'list-specs',
        outputMapping: { specs: '$' },
        outputType: 'json',
      },
      {
        toolName: 'list-endpoints',
        outputMapping: { endpoints: '$.*~' },
        outputType: 'json',
        inputMapping: {
          title: '$.specs.0.title',
        },
      },
      {
        type: 'context-transform',
        jsonPathArgs: {
          wrap: false,
        },
        inputMapping: {
          endpoint: '$.endpoints[0]',
        },
      },
      {
        toolName: 'get-endpoint',
        staticInputs: {
          path: '/ffff',
          method: 'put',
        },
        inputMapping: {
          title: '$.specs.0.title',
        },
        outputMapping: { endpoint: '$' },
        outputType: 'json',
      },
    ],
  }

  // Merge provided config with defaults
  /** @type {LoadTestConfig} */
  // @ts-ignore
  const mergedConfig = { ...defaultConfig, ...config }

  // Initialize faker with locale if specified
  const fakerInstance = new Faker({ locale: [en] })
  const mcpClient = new MCPClient({ fakerInstance, serverUrl: mergedConfig.serverUrl, config: mergedConfig })

  try {
    await mcpClient.connectToServer()
    await mcpClient.runLoadTest()
  } finally {
    await mcpClient.cleanup()
  }
}

// Export main function for programmatic usage
export { MCPClient, main }

// If running directly from command line, parse config from arguments
if (import.meta.url === `file://${process.argv[1]}`) {
  const serverUrl = process.argv[2]
  if (!serverUrl) {
    console.log('Usage: node src/index.js <server_url>')
    process.exit(1)
  }
  main({ serverUrl }).then(() => process.exit(0))
}
