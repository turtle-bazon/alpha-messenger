// Индикаторы поверх аватара (задача #27): кружок присутствия снизу-справа и
// окантовка «печатает» вокруг всего аватара. Кладётся внутрь элемента-аватара
// (у того должен быть position: relative). Это не то же, что «печатает» в
// заголовке переписки — здесь именно визуальные метки на самом аватаре.
//
// online: true/false — показать кружок (зелёный/серый); undefined — не показывать
//   (например, для групп присутствие на аватаре не отражаем).
// away: true — жёлтый кружок (online > 5 мин).
// typing: обвести аватар окантовкой.
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
