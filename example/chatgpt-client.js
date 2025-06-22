import { run } from '../src/index.js'

run({
  serverUrl: 'https://gitmcp.io/anandkumarpatel/benchmark-mcp',
  aiClient: {
    client: 'chatgpt',
    prompt: 'How do I get started using this?',
    config: {
      key: process.env.README_OPENAI,
    },
  },
}).then(() => process.exit(0))
