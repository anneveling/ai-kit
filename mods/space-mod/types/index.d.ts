export type RobotMood =
  | 'content'
  | 'focused'
  | 'proud'
  | 'frustrated'
  | 'sulky'
  | 'waiting'
  | 'bored'
  | 'sleepy'
  | 'asleep'
  | 'startled'
  | 'celebrating'

export type HumanMood =
  | 'neutral'
  | 'happy'
  | 'amused'
  | 'curious'
  | 'steering'
  | 'impatient'
  | 'annoyed'
  | 'tired'
  | 'asleep'
  | 'celebrating'

/** One balloon. A new `id` is what makes the scene show it. */
export type Line = {
  id: number
  text: string
  /** Talking to itself (thought bubble) rather than to the other one. */
  isMumble: boolean
  /** Shown a beat after the human's line, as a comeback. */
  isReply: boolean
  /** When it was said (ms since the epoch): how long it still shows. */
  at: number
}

export type Beat = {
  id: number
  kind: 'celebrate' | 'esc' | 'coffee'
  at: number
}

/** The red-alert lights and the view out of the window. */
export type Sky = 'calm' | 'tense' | 'alert'

export type Scene = {
  robot: { mood: RobotMood; line: Line | null }
  human: { mood: HumanMood; line: Line | null }
  sky: Sky
  isNight: boolean
  score: number
  beat: Beat | null
  isOff: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'space-mod': { scene: Scene }
  }
}
