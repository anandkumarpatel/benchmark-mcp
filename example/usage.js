import { MCPClient, run } from 'mcp-client'
import { Faker, en } from '@faker-js/faker'

// Example 1: Using the run function (simplest way)
async function example1() {
  console.log('Example 1: Using the run function')

  await run({
    serverUrl: 'http://localhost:8080',
    numCalls: 3,
    delayBetweenCalls: 100,
    randomizeParams: true,
  })
}

// Example 2: Using the MCPClient class directly (more control)
async function example2() {
  console.log('Example 2: Using the MCPClient class directly')

  const fakerInstance = new Faker({ locale: [en] })
  const config = {
    serverUrl: 'http://localhost:8080',
    numCalls: 2,
    delayBetweenCalls: 50,
    randomizeParams: true,
    mockData: {
      locale: 'en',
      fieldFormats: {
        email: 'company',
        name: 'fullName',
      },
    },
  }

  const client = new MCPClient({
    fakerInstance,
    serverUrl: config.serverUrl,
    config,
  })

  try {
    await client.connectToServer()
    await client.runLoadTest()
  } finally {
    await client.cleanup()
  }
}

// Example 3: Using sequence mode
async function example3() {
  console.log('Example 3: Using sequence mode')

  await run({
    serverUrl: 'http://localhost:8080',
    sequence: [
      {
        toolName: 'list-specs',
        outputMapping: { specs: '.' },
        outputType: 'json',
      },
      {
        toolName: 'list-endpoints',
        inputMapping: {
          title: '.specs[0].title',
        },
        outputMapping: {
          path: 'keys_unsorted[0]',
          method: '.[keys_unsorted[0]] | keys_unsorted[0]',
        },
        outputType: 'json',
      },
    ],
  })
}

// Example 4: Using AI client mode
async function example4() {
  console.log('Example 4: Using AI client mode')

  await run({
    serverUrl: 'http://localhost:8080',
    aiClient: {
      prompt: 'List all available API specifications',
      client: 'gemini',
      config: {
        apiKey: process.env.GEMINI_API_KEY,
      },
    },
  })
}

// Run examples
async function main() {
  try {
    // Uncomment the example you want to run:
    // await example1()
    // await example2()
    // await example3()
    // await example4()

    console.log('No examples selected. Uncomment one of the example calls above.')
  } catch (error) {
    console.error('Error running example:', error)
  }
}

main()
