import type { House } from '../../shared/house';
import { useApp } from '../store';
import { Icon } from './Icon';

/** Toont op welke kamer de focus ligt, met een knop om terug te gaan naar het hele huis. */
export function FocusChip({ house }: { house: House }) {
  const roomFocus = useApp((s) => s.roomFocus);
  const setRoomFocus = useApp((s) => s.setRoomFocus);
  if (!roomFocus) return null;
  const room = house.levels.flatMap((l) => l.rooms).find((r) => r.id === roomFocus);
  if (!room) return null;
  return (
    <div className="focus-chip glass">
      <Icon name="target" size={16} />
      <span>
        <small>Focus</small> {room.name}
      </span>
      <button className="ghost close" onClick={() => setRoomFocus(null)} aria-label="Focus opheffen" title="Terug naar het hele huis">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
