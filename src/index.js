import { Faker, en } from '@faker-js/faker'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import dotenv from 'dotenv'

dotenv.config()

/**
 * @typedef {Object} ToolSequenceStep
 * @property {string} toolName - Name of the tool to call
 * @property {Object} [inputMapping] - Map of input parameters to previous step outputs
 * @property {Object} [staticInputs] - Static input values
 * @property {string} [outputMapping] - Variable name to store the output
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
 * @property {number} [numCalls] - Number of tool calls to make
 * @property {number} [delayBetweenCalls] - Delay in milliseconds between calls
 * @property {string[]} [toolNames] - Optional list of specific tool names to call
 * @property {Object.<string, unknown>} [paramOverrides] - Optional parameter overrides for specific tools
 * @property {boolean} [randomizeParams] - Whether to randomize parameters (default: true)
 * @property {MockDataConfig} [mockData] - Configuration for mock data generation
 * @property {ToolSequenceStep[]} [sequence] - Optional sequence of tool calls with data dependencies
 */

// --- Helpers for deep get/set by path ---
/**
 * Get value from object by dot/bracket path (e.g., 'a.b[0].c')
 * @param {object} obj
 * @param {string} path
 * @returns {any}
 */
function getValueByPath(obj, path) {
  if (!obj || typeof path !== 'string') return undefined
  // Split on dots, but also handle [index] for arrays
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  return parts.reduce((acc, key) => (acc !== undefined ? acc[key] : undefined), obj)
}

/**
 * Set value in object by dot/bracket path (e.g., 'a.b[0].c'), creating intermediate objects/arrays as needed
 * @param {object} obj
 * @param {string} path
 * @param {any} value
 */
function setValueByPath(obj, path, value) {
  if (!obj || typeof path !== 'string') return
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let curr = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    const nextKey = parts[i + 1]
    if (!(key in curr) || typeof curr[key] !== 'object') {
      // If nextKey is a number, create array, else object
      curr[key] = /^\d+$/.test(nextKey) ? [] : {}
    }
    curr = curr[key]
  }
  curr[parts[parts.length - 1]] = value
}

class MCPClient {
  constructor({ fakerInstance, serverUrl }) {
    this.mcp = new Client({ name: 'mcp-client', version: '1.0.0' })
    this.tools = []
    this.faker = fakerInstance
    this.sequenceState = new Map()
    this.transport = new StreamableHTTPClientTransport(new URL(serverUrl))
  }

  async connectToServer() {
    try {
      // Initialize transport and connect to server
      await this.mcp.connect(this.transport)

      // List available tools
      const toolsResult = await this.mcp.listTools()
      this.tools = toolsResult.tools
      console.log(
        'Connected to server with tools:',
        this.tools.map(({ name }) => name)
      )
    } catch (e) {
      console.log('Failed to connect to MCP server: ', e)
      throw e
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

  async callTool(tool, config) {
    console.log(`\nCalling tool: ${tool.name}`)

    let params = {}
    if (config.randomizeParams !== false) {
      params = this.generateRandomParams(tool.inputSchema, config.mockData)
    }

    // Apply any parameter overrides
    if (config.paramOverrides?.[tool.name]) {
      params = { ...params, ...config.paramOverrides[tool.name] }
    }

    console.log('Parameters:', params)

    try {
      const result = await this.mcp.callTool({
        name: tool.name,
        arguments: params,
      })
      console.log('Tool call result:', result)
      return result
    } catch (error) {
      console.error(`Error calling tool ${tool.name}:`, error)
      throw error
    }
  }

  async executeSequence(sequence) {
    console.log('Executing tool sequence...')

    for (const step of sequence) {
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
        for (const [inputPath, outputRef] of Object.entries(step.inputMapping)) {
          // outputRef: 'stepName.some.deep.key'
          const dotIdx = outputRef.indexOf('.')
          let stepName, outputPath
          if (dotIdx === -1) {
            stepName = outputRef
            outputPath = ''
          } else {
            stepName = outputRef.slice(0, dotIdx)
            outputPath = outputRef.slice(dotIdx + 1)
          }
          const previousOutput = this.sequenceState.get(stepName)
          let value
          if (previousOutput !== undefined) {
            if (outputPath) {
              value = getValueByPath(previousOutput, outputPath)
            } else {
              value = previousOutput
            }
            if (value !== undefined) {
              setValueByPath(params, inputPath, value)
            }
          }
        }
      }

      // Generate random params for remaining required fields (shallow only)
      const schema = tool.inputSchema
      if (schema?.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          if (params[key] === undefined && prop.required) {
            params[key] = this.generateValueForField(key, prop)
          }
        }
      }

      console.log(`Executing ${step.toolName} with params:`, params)

      try {
        const result = await this.mcp.callTool({
          name: step.toolName,
          arguments: params,
        })

        // Determine output type (default to 'json')
        const outputType = step.outputType || 'json'
        let outputToStore = result.content[0].text
        if (outputType === 'json') {
          try {
            outputToStore = JSON.parse(outputToStore)
          } catch (e) {
            console.error(`Failed to parse JSON output for step ${step.toolName}:`, e)
          }
        }
        // Store output if mapping is specified
        if (step.outputMapping) {
          this.sequenceState.set(step.outputMapping, outputToStore)
        }

        console.log(`Tool call result:`, outputToStore)
      } catch (error) {
        console.error(`Error in sequence step ${step.toolName}:`, error)
        throw error
      }
    }
  }

  async runLoadTest(config) {
    if (this.tools.length === 0) {
      console.log('No tools available')
      return
    }

    console.log(`Starting load test with ${config.numCalls} calls`)
    for (let i = 0; i < config.numCalls; i++) {
      // If sequence is defined, execute it
      if (config.sequence) {
        await this.executeSequence(config.sequence)
        return
      }

      // Otherwise, run random tool calls
      const availableTools = config.toolNames ? this.tools.filter((tool) => config.toolNames.includes(tool.name)) : this.tools

      if (availableTools.length === 0) {
        console.log('No matching tools found')
        return
      }

      console.log(`Available tools: ${availableTools.map((t) => t.name).join(', ')}`)

      const randomTool = availableTools[Math.floor(Math.random() * availableTools.length)]

      try {
        await this.callTool(randomTool, config)
      } catch (error) {
        console.error(`Failed call ${i + 1}/${config.numCalls}:`, error)
      }

      if (i < config.numCalls - 1) {
        await new Promise((resolve) => setTimeout(resolve, config.delayBetweenCalls))
      }
    }
  }

  async cleanup() {
    await this.mcp.close()
  }
}

async function main(config = /** @type {LoadTestConfig} */ (/** @type {Object.<string, unknown>} */ ({}))) {
  if (!config.serverUrl) {
    console.log('Usage: main({ serverUrl: "http://server-url", ...config })')
    return
  }

  // Example sequence configuration
  const defaultConfig = /** @type {LoadTestConfig} */ {
    numCalls: 50,
    delayBetweenCalls: 1000,
    randomizeParams: true,
    mockData: {
      locale: 'en',
      fieldFormats: {
        email: 'company',
        name: 'fullName',
      },
    },
    sequence: [
      {
        toolName: 'list-endpoints',
        outputMapping: 'endpoints',
        outputType: 'json',
      },
      {
        toolName: 'get-endpoint',
        staticInputs: {
          path: '/dog',
          method: 'put',
        },
        outputMapping: 'endpoint',
        outputType: 'json',
      },
    ],
  }

  // Merge provided config with defaults
  const mergedConfig = { ...defaultConfig, ...config }

  // Initialize faker with locale if specified
  const fakerInstance = new Faker({ locale: [en] })
  const mcpClient = new MCPClient({ fakerInstance, serverUrl: mergedConfig.serverUrl })

  try {
    await mcpClient.connectToServer()
    await mcpClient.runLoadTest(mergedConfig)
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
