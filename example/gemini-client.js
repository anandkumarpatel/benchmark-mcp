import { run } from '../src/index.js'

run({
  serverUrl: 'https://gitmcp.io/anandkumarpatel/benchmark-mcp',
  aiClient: {
    client: 'gemini',
    prompt: 'How do I get started using this?',
    config: {
      key: process.env.GEMINI_API_KEY,
    },
  },
}).then(() => process.exit(0))
