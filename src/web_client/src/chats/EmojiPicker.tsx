import { useEffect, useRef, useState } from 'react';

// Категории эмодзи
const CATEGORIES = [
  { name: 'Частые', icon: '🕐', emojis: [] as string[] },
  { name: 'Смайлики', icon: '😊', emojis: [
    '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃',
    '😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
    '🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢',
    '🫣','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥',
    '😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴',
    '😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯',
    '🤠','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁',
    '😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰',
    '😥','😢','😭','😱','😖','😣','😞','😓','😩','😫',
  ]},
  { name: 'Жесты', icon: '👋', emojis: [
    '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌',
    '🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉',
    '👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛',
    '🤜','👏','🙌','🫶','👐','🤲','🤝','🙏',
  ]},
  { name: 'Животные', icon: '🐶', emojis: [
    '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨',
    '🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊',
    '🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉',
    '🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌',
  ]},
  { name: 'Еда', icon: '🍔', emojis: [
    '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐',
    '🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑',
    '🧅','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄',
    '🥔','🍠','🫘','🥐','🍞','🥖','🥨','🧀','🥚','🍳',
    '🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔',
  ]},
  { name: 'Активности', icon: '⚽', emojis: [
    '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱',
    '🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳',
    '🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷',
    '⛸️','🥌','🎿','🎯','🪀','🪁','🎮','🕹️',
  ]},
  { name: 'Объекты', icon: '💡', emojis: [
    '⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️',
    '🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥',
    '📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️',
    '🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋',
  ]},
  { name: 'Символы', icon: '❤️', emojis: [
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
    '❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝',
    '⭐','🌟','✨','💫','🔥','💥','❄️','🌈','☀️','🌤️',
  ]},
];

// Хранение недавних эмодзи
const RECENT_KEY = 'alpha_recent_emojis';
const MAX_RECENT = 24;

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveRecent(emoji: string): void {
  const recent = getRecent().filter((e) => e !== emoji);
  recent.unshift(emoji);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps): JSX.Element {
  const [activeCategory, setActiveCategory] = useState(0);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Закрытие при клике вне
  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const recent = getRecent();

  // Фильтрация по поиску
  const filtered = search
    ? CATEGORIES.flatMap((c) => c.emojis).filter(() => true) // эмодзи не имеют текстового поиска, просто показываем все
    : null;

  const currentEmojis = search
    ? filtered ?? []
    : activeCategory === 0
      ? recent
      : CATEGORIES[activeCategory].emojis;

  function handleSelect(emoji: string): void {
    saveRecent(emoji);
    onSelect(emoji);
  }

  return (
    <div className="emoji-picker" ref={ref} data-testid="emoji-picker">
      <div className="emoji-picker-search">
        <input
          type="text"
          placeholder="Поиск…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      <div className="emoji-picker-categories">
        {CATEGORIES.map((cat, i) => (
          <button
            key={cat.name}
            type="button"
            className={'emoji-cat-btn' + (activeCategory === i && !search ? ' active' : '')}
            title={cat.name}
            onClick={() => { setActiveCategory(i); setSearch(''); }}
          >
            {cat.icon}
          </button>
        ))}
      </div>
      <div className="emoji-picker-grid">
        {currentEmojis.length === 0 && (
          <div className="emoji-picker-empty">
            {search ? 'Ничего не найдено' : 'Нет недавних'}
          </div>
        )}
        {currentEmojis.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            type="button"
            className="emoji-btn"
            onClick={() => handleSelect(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
