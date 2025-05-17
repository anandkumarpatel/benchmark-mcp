import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Faker, en } from '@faker-js/faker'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config()

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
 */

class MCPClient {
  constructor(fakerInstance) {
    this.mcp = new Client({ name: 'mcp-client', version: '1.0.0' })
    this.tools = []
    this.faker = fakerInstance
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

  async runLoadTest(config) {
    if (this.tools.length === 0) {
      console.log('No tools available')
      return
    }

    // Filter tools if specific names are provided
    const availableTools = config.toolNames ? this.tools.filter((tool) => config.toolNames.includes(tool.name)) : this.tools

    if (availableTools.length === 0) {
      console.log('No matching tools found')
      return
    }

    console.log(`Starting load test with ${config.numCalls} calls`)
    console.log(`Available tools: ${availableTools.map((t) => t.name).join(', ')}`)

    for (let i = 0; i < config.numCalls; i++) {
      // Select a random tool from available tools
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

  // Default configuration
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
      fieldGenerators: {
        // Example custom generator
        customField: (faker) => faker.helpers.arrayElement(['option1', 'option2', 'option3']),
      },
    },
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
