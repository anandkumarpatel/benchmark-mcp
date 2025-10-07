import { Faker } from '@faker-js/faker'

export interface ToolSequenceStep {
  toolName: string
  inputMapping?: Record<string, string | object>
  staticInputs?: Record<string, unknown>
  outputMapping?: Record<string, string>
  outputType?: 'json' | 'text'
}

export interface MockDataConfig {
  locale?: string
  fieldGenerators?: Record<string, (faker: Faker) => unknown>
  fieldFormats?: Record<string, string>
}

export interface LoadTestConfig {
  serverUrl: string
  headers?: Record<string, string> // headers for when we connect to serverUrl 
  numCalls?: number
  delayBetweenCalls?: number
  toolNames?: string[]
  paramOverrides?: Record<string, Record<string, unknown>>
  randomizeParams?: boolean
  mockData?: MockDataConfig
  sequence?: ToolSequenceStep[]
  runAll?: boolean
  fakerConfig?: import('@faker-js/faker').FakerOptions
  aiClient?: {
    prompt: string
    client: 'gemini' | 'chatgpt'
    config: import('./src/aiClients/gemini-client.js').GeminiConfig | import('./src/aiClients/chatgpt-client.js').ChatGPTConfig
  }
}

export interface ToolCallDetail {
  args: Record<string, unknown>
  result: unknown | null
  error: Error | null
}

export interface PerToolStats {
  total: number
  success: number
  failure: number
  avg: number
}

export interface MetricsSummary {
  total: number
  success: number
  failure: number
  avg: number
  median: number
  p95: number
  throughput: number
  errors: Record<string, number>
  perTool: Record<string, PerToolStats>
  totalTime: number
  details: ToolCallDetail[]
}

export declare class MCPClient {
  constructor(params: { fakerInstance: Faker; serverUrl: string; config: LoadTestConfig })

  connectToServer(): Promise<void>
  callTool(tool: any, params: Record<string, unknown>): Promise<any>
  executeSequence(sequence: ToolSequenceStep[]): Promise<void>
  runAll(): Promise<void>
  runRandomToolCall(): Promise<void>
  runAIClient(): Promise<void>
  runLoadTest(): Promise<MetricsSummary>
  cleanup(): Promise<void>
}

export declare function run(config: LoadTestConfig): Promise<MetricsSummary>
