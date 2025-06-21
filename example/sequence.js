import { run } from '../src/index.js'
/**
 * This script demonstrates a sequence of MCP tool calls against the ReadMe documentation server
 *
 *  The sequence performs the following steps:
 *  1. list-specs: Retrieves available API specifications and stores them in the sequence context
 *  2. list-endpoints: Gets endpoints for the first spec, extracting the first path and method
 *  3. get-endpoint: Fetches details for the specific endpoint using the path/method from step 2
 *  4. search-documentation: Performs a search with a static query "hello"
 *
 *  Each step uses jq expressions to map outputs to inputs for subsequent steps,
 *  creating a data-dependent workflow that demonstrates the sequence capabilities
 *  of the MCP load testing tool.
 */

run({
  serverUrl: 'https://docs.readme.com/mcp',
  sequence: [
    {
      toolName: 'list-specs',
      outputMapping: { specs: '.' },
      outputType: 'json',
    },
    {
      toolName: 'list-endpoints',
      outputMapping: { path: 'keys_unsorted[0]', method: '.[keys_unsorted[0]] | keys_unsorted[0]' },
      outputType: 'json',
      inputMapping: {
        title: '.specs[0].title',
      },
    },
    {
      toolName: 'get-endpoint',
      inputMapping: {
        path: '.path',
        method: '.method',
        title: '.specs[0].title',
      },
      outputMapping: { endpoint: '.' },
      outputType: 'json',
    },
    {
      toolName: 'search-documentation',
      staticInputs: {
        query: 'hello',
      },
    },
  ],
}).then(() => process.exit(0))

/** Detailed breakdown of the sequence
 *  {
 *    toolName: 'list-specs',
 *    outputMapping: { specs: '.' },
 *    outputType: 'json',
 *  },
 * ================================================
 *  Output of the tool call:
 *  {
 *    "specs": [{
 *      "title": "API Reference",
 *      "description": "API Reference",
 *      "url": "https://docs.readme.com/mcp/api-reference"
 *    }]
 *  }
 *  State after this step:
 *  {
 *      "specs": [
 *        {
 *          "title": "API Reference",
 *          "description": "API Reference",
 *          "url": "https://docs.readme.com/mcp/api-reference"
 *        }
 *      ]
 *  }
 * ================================================
 *  {
 *    toolName: 'list-endpoints',
 *    outputMapping: { path: 'keys_unsorted[0]', method: '.[keys_unsorted[0]] | keys_unsorted[0]' },
 *    outputType: 'json',
 *    inputMapping: {
 *      title: '.specs[0].title',
 *    },
 *  },
 * ================================================
 *  Input to this tool after mapping: {
 *    "title": "API Reference"
 *  }
 *  Output of this tool: {
 *    "/api/v1/docs": {
 *      "GET": {...},
 *      "POST ": {...}
 *    }
 *  }
 *  State after this step:
 *  {
 *    "path": "/api/v1/docs",
 *    "method": "GET",
 *    "specs": [
 *      {
 *        "title": "API Reference",
 *        "description": "API Reference",
 *        "url": "https://docs.readme.com/mcp/api-reference"
 *      }
 *    ]
 *  }
 * ================================================
 *  {
 *    toolName: 'get-endpoint',
 *    inputMapping: {
 *      path: '.path',
 *      method: '.method',
 *      title: '.specs[0].title',
 *    },
 *    outputMapping: { endpoint: '.' },
 *    outputType: 'json',
 *  },
 * ================================================
 *  Input to this tool after mapping: {
 *    "path": "/api/v1/docs",
 *    "method": "GET",
 *    "title": "API Reference"
 *  }
 *  Output of this tool: {
 *    "endpoint": {...}
 *  }
 *  State after this step:
 *  {
 *    "endpoint": {...},
 *    "path": "/api/v1/docs",
 *    "method": "GET",
 *    "specs": [
 *      {
 *        "title": "API Reference",
 *        "description": "API Reference",
 *        "url": "https://docs.readme.com/mcp/api-reference"
 *      }
 *    ]
 *  }
 * ================================================
 *  {
 *    toolName: 'search-documentation',
 *    staticInputs: {
 *      query: 'hello',
 *    },
 *  },
 * ================================================
 *  Input to this tool after mapping: {
 *    "query": "hello",
 *  }
 *  Output of this tool:
 *    text: "Hi, I'm a search result!"
 *  State after this step:
 *  {
 *    "endpoint": {...},
 *    "path": "/api/v1/docs",
 *    "method": "GET",
 *    "specs": [
 *      {
 *        "title": "API Reference",
 *        "description": "API Reference",
 *        "url": "https://docs.readme.com/mcp/api-reference"
 *      }
 *    ]
 *  }
 * ================================================
 */
