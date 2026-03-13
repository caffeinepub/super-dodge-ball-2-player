# Super Dodge Ball 2 Player

## Current State
New project.

## Requested Changes (Diff)

### Add
- 2-player dodgeball game on a canvas
- Player 1 (blue): W/S to move, F to throw ball
- Player 2 (red): Arrow Up/Down to move, L to throw ball
- Balls travel horizontally, 750ms cooldown between throws
- Score tracker: first to 3 hits loses
- Game over screen with winner announcement and restart (press 1)
- Green field background, white balls

### Modify
N/A

### Remove
N/A

## Implementation Plan
- Implement game entirely in React using Canvas API
- useRef for canvas, useEffect for game loop with requestAnimationFrame
- Track keys with keydown/keyup listeners
- Game state: players, balls, scores, gameOver
- Render loop: update then draw each frame
