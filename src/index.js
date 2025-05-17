import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import dotenv from 'dotenv'

dotenv.config()

class MCPClient {
  constructor() {
    this.mcp = new Client({ name: 'mcp-client', version: '1.0.0' })
    this.tools = []
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

  generateRandomParams(schema) {
    const params = {}
    if (!schema || !schema.properties) return params

    for (const [key, prop] of Object.entries(schema.properties)) {
      switch (prop.type) {
        case 'string':
          params[key] = Math.random().toString(36).substring(7)
          break
        case 'number':
          params[key] = Math.floor(Math.random() * 100)
          break
        case 'boolean':
          params[key] = Math.random() > 0.5
          break
        case 'array':
          params[key] = []
          break
        case 'object':
          params[key] = this.generateRandomParams(prop)
          break
      }
    }
    return params
  }

  async callRandomTool() {
    if (this.tools.length === 0) {
      console.log('No tools available')
      return
    }

    // Select a random tool
    const randomTool = this.tools[Math.floor(Math.random() * this.tools.length)]
    console.log(`\nSelected tool: ${randomTool.name}`)

    // Generate random parameters based on the tool's schema
    const randomParams = this.generateRandomParams(randomTool.inputSchema)
    console.log('Generated parameters:', randomParams)

    try {
      // Call the tool with random parameters
      const result = await this.mcp.callTool({
        name: randomTool.name,
        arguments: randomParams,
      })
      console.log('Tool call result:', result)
    } catch (error) {
      console.error(`Error calling tool ${randomTool.name}:`, error)
    }
  }

  async cleanup() {
    await this.mcp.close()
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log('Usage: node src/index.js <server_url>')
    return
  }

  const serverUrl = process.argv[2]
  const mcpClient = new MCPClient()

  try {
    await mcpClient.connectToServer(serverUrl)

    // Call random tools 5 times
    for (let i = 0; i < 50; i++) {
      await mcpClient.callRandomTool()
      // Wait for 1 second between calls
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  } finally {
    await mcpClient.cleanup()
    process.exit(0)
  }
}

main()
