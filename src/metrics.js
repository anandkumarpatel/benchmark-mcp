// Metrics class for load testing
export class Metrics {
  constructor() {
    /** @type {number} */
    this.total = 0
    /** @type {number} */
    this.success = 0
    /** @type {number} */
    this.failure = 0
    /** @type {number[]} */
    this.responseTimes = []
    /** @type {Record<string, number>} */
    this.errors = {}
    /** @type {Record<string, { total: number, success: number, failure: number, responseTimes: number[] }>} */
    this.perTool = {}
    /** @type {number} */
    this.startTime = Date.now()
    /** @type {{args: Record<string, unknown>, result: unknown | null, error: Error | null}[]} */
    this.details = []
  }

  /**
   /**
    * Record the result of a tool call
    * @param {{
    *   toolName: string,
    *   success: boolean,
    *   duration: number,
    *   error?: Error|null,
    *   result?: string | null,
    *   args?: Record<string, unknown>
    * }} params
    */
  record({ toolName, success, duration, error = null, result = null, args = {} }) {
    this.total++
    this.details.push({ args, result, error })
    if (!this.perTool[toolName]) {
      this.perTool[toolName] = { total: 0, success: 0, failure: 0, responseTimes: [] }
    }
    this.perTool[toolName].total++
    this.perTool[toolName].responseTimes.push(duration)
    if (success) {
      this.success++
      this.perTool[toolName].success = (this.perTool[toolName].success || 0) + 1
    } else {
      this.failure++
      this.perTool[toolName].failure = (this.perTool[toolName].failure || 0) + 1
      if (error) {
        const errMsg = typeof error === 'object' && error !== null && 'message' in error ? error.message : String(error)
        this.errors[errMsg] = (this.errors[errMsg] || 0) + 1
      }
    }
  }

  /**
   * Get a summary of the collected metrics
   * @returns {object}
   */
  getSummary() {
    const totalTime = (Date.now() - this.startTime) / 1000
    const avg = this.responseTimes.length > 0 ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length : 0
    const sorted = [...this.responseTimes].sort((a, b) => a - b)
    const median = sorted.length > 0 ? (sorted.length % 2 === 0 ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : sorted[Math.floor(sorted.length / 2)]) : 0
    const p95 = sorted.length > 0 ? sorted[Math.ceil(sorted.length * 0.95) - 1] : 0
    const perToolStats = {}
    for (const [tool, statRawOrig = {}] of Object.entries(this.perTool)) {
      const { total = 0, success = 0, failure = 0, responseTimes = [] } = statRawOrig
      const toolAvg = responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0
      perToolStats[tool] = {
        total,
        success,
        failure,
        avg: toolAvg,
      }
    }
    return {
      total: this.total,
      success: this.success,
      failure: this.failure,
      avg,
      median,
      p95,
      throughput: totalTime > 0 ? this.total / totalTime : 0,
      errors: this.errors,
      perTool: perToolStats,
      totalTime,
      details: this.details,
    }
  }

  /**
   * Print a human-readable summary to the console
   */
  printSummary() {
    const summary = this.getSummary()
    console.log('\n--- Load Test Summary ---')
    console.log(`Total requests: ${summary.total}`)
    console.log(`Success: ${summary.success}`)
    console.log(`Failure: ${summary.failure}`)
    console.log(`Avg response time: ${summary.avg.toFixed(2)} ms`)
    console.log(`Median response time: ${summary.median.toFixed(2)} ms`)
    console.log(`95th percentile response time: ${summary.p95.toFixed(2)} ms`)
    console.log(`Throughput: ${summary.throughput.toFixed(2)} req/sec`)
    console.log('Errors:', summary.errors)
    console.log('Per-tool stats:')
    for (const [tool, statRawOrig = {}] of Object.entries(summary.perTool)) {
      const { total = 0, success = 0, failure = 0, avg = 0 } = statRawOrig
      console.log(`  ${tool}: total=${total}, success=${success}, failure=${failure}, avg=${avg.toFixed(2)} ms`)
    }
  }
}
