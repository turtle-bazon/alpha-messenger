// Indicators over the avatar (#27): presence dot at bottom-right and
// a "typing" ring around the whole avatar. Placed inside the avatar element
// (which must have position: relative). Not the same as "typing" in the
// conversation header — these are visual marks on the avatar itself.
//
// online: true/false — show the dot (green/gray); undefined — don't show it
//   (e.g., groups don't reflect presence on the avatar).
// away: true — yellow dot (online > 5 min).
// typing: outline the avatar with a ring.
export function AvatarBadges({
  online,
  away,
  typing,
}: {
  online?: boolean;
  away?: boolean;
  typing?: boolean;
}): JSX.Element {
  const statusClass = away ? 'is-away' : online ? 'is-online' : 'is-offline';
  const statusLabel = away ? 'away' : online ? 'online' : 'offline';
  return (
    <>
      {typing && (
        <span
          className="avatar-typing-ring"
          data-testid="avatar-typing"
          aria-hidden="true"
        />
      )}
      {online !== undefined && (
        <span
          className={'avatar-status-dot ' + statusClass}
          data-testid="avatar-status"
          data-status={statusLabel}
        />
      )}
    </>
  );
}
