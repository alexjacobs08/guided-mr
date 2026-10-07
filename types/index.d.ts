export type Hunk = {
  id: string
  path: string
  // A unified-diff hunk: the @@ header and its lines. Empty for a file with no hunks.
  source: string
  // Set for a file with no hunks (binary, pure rename, mode change).
  note?: string
  added: number
  removed: number
}

export type Step = {
  title: string
  summary: string
  watch: string
  hunkIds: string[]
}

export type Guide = {
  title: string
  context: string
  source: string
  // A Mermaid flowchart of the parts the change touches, or ''.
  diagram: string
  steps: Step[]
  hunks: Hunk[]
}

export type BuildStatus = {
  kind: 'idle' | 'loading' | 'error'
  message: string
}

declare module 'claude-code' {
  interface PluginState {
    'guided-mr': {
      guide: Guide | null
      // -1 is the overview; 0..n-1 are steps.
      view: number
      status: BuildStatus
      isSplit: boolean
      lastArgs: string
      // Step indexes.
      reviewed: number[]
      visited: number[]
      // Hunk ids drawn in full instead of cut.
      expanded: string[]
    }
  }
}
