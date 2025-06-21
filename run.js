import { run } from './src/index.js'
// If running directly from command line, parse config from arguments
if (import.meta.url === `file://${process.argv[1]}`) {
  const serverUrl = process.argv[2]
  if (!serverUrl) {
    console.log('Usage: node run.js <server_url>')
    process.exit(1)
  }

  run({ serverUrl }).then(() => process.exit(0))
}
