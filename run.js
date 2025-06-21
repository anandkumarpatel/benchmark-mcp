import { run } from './src/index.js'
import fs from 'fs'
// If running directly from command line, parse config from arguments
if (import.meta.url === `file://${process.argv[1]}`) {
  const serverUrl = process.argv[2]
  if (!serverUrl) {
    console.log('Usage: node run.js <server_url> <config_file>')
    process.exit(1)
  }
  let config = {}
  const configFilePath = process.argv[3]
  if (configFilePath) {
    if (!fs.existsSync(configFilePath)) {
      console.error(`Config file not found: ${configFilePath}`)
      process.exit(1)
    }
    try {
      config = JSON.parse(fs.readFileSync(configFilePath, 'utf8'))
    } catch (error) {
      console.error(`Error parsing config file: ${error}`)
      process.exit(1)
    }
  }

  run({ serverUrl, ...config }).then(() => process.exit(0))
}
