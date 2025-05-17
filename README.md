# MCP Client

A Node.js client for the Model Context Protocol (MCP) that randomly calls tools with random parameters.

## Installation

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

## Usage

Run the client with a server URL:

```bash
npm start <server_url>
```

The client will:

1. Connect to the specified MCP server
2. List all available tools
3. Make 5 random tool calls with randomly generated parameters
4. Wait 1 second between each call
5. Display the results of each call

## Features

- Automatically connects to MCP servers
- Lists all available tools
- Generates random parameters based on tool schemas
- Handles different parameter types (string, number, boolean, array, object)
- Error handling for failed tool calls
- Clean shutdown and resource cleanup

## Example Output

```
Connected to server with tools: [tool1, tool2, tool3]

Selected tool: tool1
Generated parameters: { param1: "abc123", param2: 42 }
Tool call result: { ... }

Selected tool: tool2
Generated parameters: { param1: true, param2: "xyz789" }
Tool call result: { ... }
...
```
