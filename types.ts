export interface CellState {
  r: number;
  g: number;
  b: number;
  active: boolean;
}

export interface Keyframe {
  id: number;
  time: number;
  name: string;
  grid: CellState[];
}

export interface PredefinedPatternKeyframe {
    time: number;
    name: string;
    grid: CellState[];
}

export interface PredefinedPattern {
  name: string;
  description: string;
  keyframes: PredefinedPatternKeyframe[] | ((gridSize: number) => PredefinedPatternKeyframe[]);
}

export interface PatternCategory {
  name: string;
  patterns: PredefinedPattern[];
  icon: string;
}
