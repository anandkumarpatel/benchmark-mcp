import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Faker, en } from '@faker-js/faker'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config()

/**
 * @typedef {Object} ToolSequenceStep
 * @property {string} toolName - Name of the tool to call
 * @property {Object} [inputMapping] - Map of input parameters to previous step outputs
 * @property {Object} [staticInputs] - Static input values
 * @property {string} [outputMapping] - Variable name to store the output
 */

/**
 * @typedef {Object} MockDataConfig
 * @property {string} [locale] - Faker locale (e.g., 'en', 'fr')
 * @property {Object} [fieldGenerators] - Custom field generators for specific fields
 * @property {Object} [fieldFormats] - Format specifications for fields (e.g., { email: 'company' })
 */

/**
 * @typedef {Object} LoadTestConfig
 * @property {number} numCalls - Number of tool calls to make
 * @property {number} delayBetweenCalls - Delay in milliseconds between calls
 * @property {string[]} [toolNames] - Optional list of specific tool names to call
 * @property {Object} [paramOverrides] - Optional parameter overrides for specific tools
 * @property {boolean} [randomizeParams] - Whether to randomize parameters (default: true)
 * @property {MockDataConfig} [mockData] - Configuration for mock data generation
 * @property {ToolSequenceStep[]} [sequence] - Optional sequence of tool calls with data dependencies
 */

class MCPClient {
  constructor(fakerInstance) {
    this.mcp = new Client({ name: 'mcp-client', version: '1.0.0' })
    this.tools = []
    this.faker = fakerInstance
    this.sequenceState = new Map()
  }

  async connectToServer(serverUrl) {
    try {
      // Initialize transport and connect to server
      this.transport = new StreamableHTTPClientTransport(new URL(serverUrl))
      this.mcp.connect(this.transport)

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
    const { fieldGenerators = {}, fieldFormats = {} } = mockConfig

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
      const params = {}

      // Add static inputs
      if (step.staticInputs) {
        Object.assign(params, step.staticInputs)
      }

      // Map previous outputs to inputs
      if (step.inputMapping) {
        for (const [inputKey, outputRef] of Object.entries(step.inputMapping)) {
          const [stepName, outputPath] = outputRef.split('.')
          const previousOutput = this.sequenceState.get(stepName)
          if (previousOutput) {
            const value = outputPath.split('.').reduce((obj, key) => obj?.[key], previousOutput)
            if (value !== undefined) {
              params[inputKey] = value
            }
          }
        }
      }

      // Generate random params for remaining required fields
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

        // Store output if mapping is specified
        if (step.outputMapping) {
          this.sequenceState.set(step.outputMapping, result)
        }

        console.log(`Tool call result:`, result)
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

    console.log(`Starting load test with ${config.numCalls} calls`)
    console.log(`Available tools: ${availableTools.map((t) => t.name).join(', ')}`)

    for (let i = 0; i < config.numCalls; i++) {
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

async function main() {
  if (process.argv.length < 3) {
    console.log('Usage: node src/index.js <server_url> [config_file]')
    return
  }

  const serverUrl = process.argv[2]
  const configFile = process.argv[3]

  // Example sequence configuration
  const defaultConfig = {
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
    // sequence: [
    //   {
    //     toolName: 'createUser',
    //     staticInputs: { role: 'customer' },
    //     outputMapping: 'user',
    //   },
    //   {
    //     toolName: 'createOrder',
    //     inputMapping: {
    //       userId: 'user.id',
    //       customerName: 'user.name',
    //     },
    //     outputMapping: 'order',
    //   },
    //   {
    //     toolName: 'sendNotification',
    //     inputMapping: {
    //       email: 'user.email',
    //       orderId: 'order.id',
    //     },
    //   },
    // ],
  }

  // Load custom config if provided
  let config = defaultConfig
  if (configFile) {
    try {
      const customConfig = JSON.parse(await fs.promises.readFile(configFile, 'utf8'))
      config = { ...defaultConfig, ...customConfig }
    } catch (error) {
      console.error('Failed to load config file:', error)
      process.exit(1)
    }
  }

  // Initialize faker with locale if specified
  const fakerInstance = new Faker({ locale: [en] })
  const mcpClient = new MCPClient(fakerInstance)

  try {
    await mcpClient.connectToServer(serverUrl)
    await mcpClient.runLoadTest(config)
  } finally {
    await mcpClient.cleanup()
    process.exit(0)
  }
}

main()
