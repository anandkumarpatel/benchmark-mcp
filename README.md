# MCP Load Testing Tool

A Node.js client for running load tests against a Model Context Protocol (MCP) server. It supports various modes of operation, including running sequences of tool calls, calling random tools, or calling all available tools.

## Installation

### As an npm package

```bash
npm install mcp-client
```

### From source

1.  Clone this repository.
2.  Install dependencies:

    ```bash
    npm install
    ```

## Usage

### As an npm package

```javascript
import { run, MCPClient } from 'mcp-client'

// Simple usage with the run function
await run({
  serverUrl: 'http://localhost:8080',
  numCalls: 3,
  delayBetweenCalls: 100,
})

// Advanced usage with the MCPClient class
import { Faker, en } from '@faker-js/faker'

const fakerInstance = new Faker({ locale: [en] })
const client = new MCPClient({
  fakerInstance,
  serverUrl: 'http://localhost:8080',
  config: { numCalls: 2 },
})

try {
  await client.connectToServer()
  await client.runLoadTest()
} finally {
  await client.cleanup()
}
```

See `example/usage.js` for more detailed examples.

## Quick Start

To run a load test against your MCP server, use the following command:

```bash
node src/run.js <server_url>
```

For example:

```bash
node src/run.js http://localhost:8080
```

By default, this runs a pre-configured sequence of tool calls once. To customize the load test, you can modify the `defaultConfig` object within `src/run.js` or pass a configuration object when calling the `main` function programmatically.

## Configuration

The load test is configured via a `LoadTestConfig` object. You can either modify the `defaultConfig` in `src/index.js` for command-line runs or import and call `main(config)` from your own script for more programmatic control.

### Configuration Options

| Option              | Type                                      | Description                                                                                               | Default                                 |
| ------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `serverUrl`         | `string`                                  | **Required.** The URL of the MCP server.                                                                  | `undefined`                             |
| `numCalls`          | `number`                                  | The number of times to run the test loop.                                                                 | `1`                                     |
| `delayBetweenCalls` | `number`                                  | Delay in milliseconds between each tool call.                                                             | `10`                                    |
| `toolNames`         | `string[]`                                | An optional list of tool names to use. If provided, the client will only operate on this subset of tools. | `undefined` (use all tools from server) |
| `paramOverrides`    | `Record<string, Record<string, unknown>>` | A map to override generated parameters for specific tools.                                                | `{}`                                    |
| `randomizeParams`   | `boolean`                                 | Whether to generate random parameters for tool calls.                                                     | `true`                                  |
| `mockData`          | `MockDataConfig`                          | Configuration for mock data generation using `@faker-js/faker`.                                           | See `mockData` section below.           |
| `sequence`          | `ToolSequenceStep[]`                      | An array defining a sequence of tool calls. This enables Sequence Mode.                                   | `undefined`                             |
| `runAll`            | `boolean`                                 | If `true` and `sequence` is not set, runs all available tools once per `numCalls` iteration.              | `false`                                 |

### `mockData` Configuration

You can customize the random data generation with the `mockData` object.

| Option            | Type                       | Description                                                      |
| ----------------- | -------------------------- | ---------------------------------------------------------------- |
| `locale`          | `string`                   | A `faker.js` locale (e.g., `'en'`, `'fr'`).                      |
| `fieldGenerators` | `Record<string, Function>` | Custom functions to generate data for specific field names.      |
| `fieldFormats`    | `Record<string, string>`   | Format specifications for fields (e.g., `{ email: 'company' }`). |

**Example `mockData` config:**

```javascript
{
  locale: 'en',
  fieldFormats: {
    email: 'company',
    name: 'fullName'
  },
  fieldGenerators: {
    // Custom generator for a field named 'userId'
    userId: (faker) => `user-${faker.string.uuid()}`
  }
}
```

## Run Modes

The tool supports three main run modes.

### 1. Sequence Mode

This mode allows you to define a chain of tool calls where the output of one step can be used as input for a subsequent step. To enable this mode, provide a `sequence` array in the configuration.

Each step in the sequence is an object with the following properties:

- `toolName`: The name of the tool to call.
- `staticInputs`: An object of parameter values that will be passed directly to the tool.
- `inputMapping`: Maps keys in the `sequenceContext` (which holds outputs from previous steps) to input parameters for the current tool call. Mappings are defined using **jq expressions**.
- `outputMapping`: Maps the output of the current tool call to keys in the `sequenceContext` for use in later steps. Mappings are defined using **jq expressions**.
- `outputType`: The expected output type from the tool call. Can be `'json'` (default) or `'text'`.

**Example Sequence:**

This sequence first lists available API specifications, then lists the endpoints for the first spec, and finally gets the details for the first endpoint.

```javascript
const config = {
  // ... other config
  sequence: [
    {
      toolName: 'list-specs',
      outputMapping: { specs: '.' }, // Store the entire output in context.specs
      outputType: 'json',
    },
    {
      toolName: 'list-endpoints',
      inputMapping: {
        title: '.specs[0].title', // Use the title from the first spec
      },
      outputMapping: {
        path: 'keys_unsorted[0]', // Store first path in context.path
        method: '.[keys_unsorted[0]] | keys_unsorted[0]', // Store first method in context.method
      },
      outputType: 'json',
    },
    {
      toolName: 'get-endpoint',
      inputMapping: {
        path: '.path', // Use path from context
        method: '.method', // Use method from context
        title: '.specs[0].title',
      },
    },
  ],
}
```

### 2. Random Tool Mode

This is the default mode if `sequence` and `runAll` are not specified. In each iteration of the load test, the client will:

1.  Select a random tool from the list of available tools.
2.  Generate random parameters for it (unless `randomizeParams` is `false` or overrides are provided).
3.  Execute the tool call.

### 3. Run All Tools Mode

To enable this mode, set `runAll: true` in your configuration. The client will iterate through all available tools and execute a call for each one. This cycle repeats for the number of times specified by `numCalls`.

## Parameter Generation

In all modes, you can control how tool parameters are generated.

- **Random (Default)**: If `randomizeParams` is `true` (the default), the client generates random values for required parameters based on their schema type. You can customize this with the `mockData` config.
- **Fixed**: Use the `paramOverrides` config to provide static values for specific tools and parameters. This is useful for testing with known inputs. `paramOverrides` will be merged over any randomly generated parameters.

**Example `paramOverrides`:**

```javascript
const config = {
  // ... other config
  paramOverrides: {
    'search-documentation': {
      query: 'how to use sequences',
    },
  },
}
```

## Output

After the load test completes, a summary of the results is printed to the console.

**Example Output:**

```
--- Load Test Summary ---
Total requests: 10
Success: 9
Failure: 1
Avg response time: 152.30 ms
Median response time: 145.00 ms
95th percentile response time: 250.00 ms
Throughput: 6.57 req/sec
Errors: { 'Tool execution failed': 1 }
Per-tool stats:
  list-specs: total=5, success=5, failure=0, avg=120.50 ms
  list-endpoints: total=5, success=4, failure=1, avg=184.10 ms
```

## Roadmap

- CLI management tool
- oauth2 client support
- pass-in auth / headers
- Output assertions
- Support for one-shot tool calls without a persistent connection.
- support env vars for config
