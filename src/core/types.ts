export type Command = 'NEXT_SLIDE' | 'PREVIOUS_SLIDE' | 'BLACK_SCREEN' | 'TOGGLE_CONTROL';
export const COMMANDS: Command[] = [
  'NEXT_SLIDE',
  'PREVIOUS_SLIDE',
  'BLACK_SCREEN',
  'TOGGLE_CONTROL',
];
export const COMMAND_LABELS: Record<Command, string> = {
  NEXT_SLIDE: 'Next slide',
  PREVIOUS_SLIDE: 'Previous slide',
  BLACK_SCREEN: 'Black screen / restore',
  TOGGLE_CONTROL: 'Pause control',
};
export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}
export interface PoseFrame {
  t: number;
  values: number[];
}
export type PoseSequence = PoseFrame[];

export type GestureMode = 'pose' | 'motion';

export interface GestureTemplate {
  id: string;
  name: string;
  command: Command;
  mode?: GestureMode;
  samples: [PoseSequence, PoseSequence];
  threshold: number;
  cooldownMs: number;
  createdAt: string;
  enabled: boolean;
}
export interface PosePacket {
  time: number;
  landmarks: Landmark[];
  frame: PoseFrame | null;
  quality: number;
  message: string;
  fps: number;
  width: number;
  height: number;
}
export interface Match {
  gesture: GestureTemplate;
  distance: number;
  score: number;
  margin: number;
}
export interface RecognitionEvent {
  command: Command;
  name: string;
  score: number;
  time: number;
}
export type RecognitionState = 'PAUSED' | 'READY' | 'MATCHING' | 'COOLDOWN' | 'RELEASE' | 'NO_POSE';
export interface RecognitionStatus {
  state: RecognitionState;
  candidate: string;
  score: number;
  progress: number;
}
export type Platform = 'google' | 'canva';
