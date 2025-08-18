export interface Tank {
  x: number;
  y: number;
  dir: 0 | 1 | 2 | 3;
  hp: number; // 0..100
}

export interface Enemy extends Tank { }
