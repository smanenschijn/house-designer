/** Gedeelde, niet-reactieve invoer voor de rondloopmodus (joystick en kijkbewegingen op touch). */
export const walkInput = {
  /** joystick: -1..1, x = opzij, y = vooruit */
  moveX: 0,
  moveY: 0,
  /** opgespaarde kijkbeweging in pixels (wordt per frame verbruikt) */
  lookX: 0,
  lookY: 0,
};
