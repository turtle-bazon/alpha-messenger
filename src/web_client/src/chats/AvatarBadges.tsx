// Индикаторы поверх аватара (задача #27): кружок присутствия снизу-справа и
// окантовка «печатает» вокруг всего аватара. Кладётся внутрь элемента-аватара
// (у того должен быть position: relative). Это не то же, что «печатает» в
// заголовке переписки — здесь именно визуальные метки на самом аватаре.
//
// online: true/false — показать кружок (зелёный/серый); undefined — не показывать
//   (например, для групп присутствие на аватаре не отражаем).
// typing: обвести аватар окантовкой.
export function AvatarBadges({
  online,
  typing,
}: {
  online?: boolean;
  typing?: boolean;
}): JSX.Element {
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
          className={'avatar-status-dot ' + (online ? 'is-online' : 'is-offline')}
          data-testid="avatar-status"
          data-status={online ? 'online' : 'offline'}
        />
      )}
    </>
  );
}
