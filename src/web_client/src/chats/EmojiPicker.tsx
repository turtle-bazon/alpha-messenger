import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMyStickerPacks, getStickerPackItems } from '../api/rest';
import type { StickerItem, StickerPack } from '../api/types';
import { blobObjectUrl } from '../util/blobUrl';

// Keywords for emoji search
const EMOJI_KEYWORDS: Record<string, string> = {};

function kw(emoji: string, words: string): void {
  EMOJI_KEYWORDS[emoji] = words.toLowerCase();
}

// Smileys
kw('😀','смех улыбка весело радость');
kw('😃','улыбка радость');
kw('😄','смех радость весело');
kw('😁','улыбка зубы радость');
kw('😆','смех весело');
kw('😅','облегчение пот смех');
kw('🤣','смех слёзы весело');
kw('😂','смех слёзы');
kw('🙂','улыбка');
kw('🙃','сарказм перевёрнутый');
kw('😉','подмигивание');
kw('😊','улыбка румянец');
kw('😇','ангел невинность');
kw('🥰','обожание любовь');
kw('😍','влюблённость глаза сердечки');
kw('🤩','восторг звёзды');
kw('😘','поцелуй');
kw('😗','поцелуй');
kw('😚','поцелуй закрытые глаза');
kw('😙','поцелуй улыбка');
kw('🥲','улыбка слеза');
kw('😋','вкусно еда');
kw('😛','язык');
kw('😜','язык безумный');
kw('🤪','безумный');
kw('😝','язык.closePath');
kw('🤑','деньги');
kw('🤗','объятие');
kw('🤭','улыбка рука');
kw('🤫','тишина');
kw('🤔','задумался');
kw('🤐','молчание');
kw('🤨','подозрение');
kw('😐','нейтрально');
kw('😑','без выражения');
kw('😶','молчун');
kw('😏','ухмылка');
kw('😒','недовольство');
kw('🙄','.roll eyes');
kw('😬','скривился');
kw('🤥','лживый');
kw('😌','облегчение');
kw('😔','грусть');
kw('😪','сонливость');
kw('🤤','слюни');
kw('😴','спит');
kw('😷','маска болезнь');
kw('🤒','температура');
kw('🤕','боль голова');
kw('🤢','тошнота');
kw('🤮','рвота');
kw('🥵','жарко');
kw('🥶','холодно');
kw('🥴','головокружение');
kw('😵','голова кружится');
kw('🤯','взрыв головы шок');
kw('🤠','ковбой');
kw('🥳','праздник');
kw('🥸','маска');
kw('😎','солнцезащитные очки');
kw('🤓','ботан очки');
kw('🧐','монокль');
kw('😕','растерянность');
kw('😟','печаль');
kw('🙁','грусть');
kw('😮','удивление рот');
kw('😯','тихое удивление');
kw('😲','шок');
kw('😳','покраснение');
kw('🥺','умоляю глаза');
kw('😦','открытый рот');
kw('😧','тревога');
kw('😨','страх');
kw('😰','тревога пот');
kw('😥','печаль');
kw('😢','слеза грусть');
kw('😭','плачет слёзы');
kw('😱','крик страх');
kw('😖','лицо кривое');
kw('😣','терпение');
kw('😞','разочарование');
kw('😓','пот');
kw('😩','усталость');
kw('😫','истощение');

// Gestures
kw('👋','привет waving');
kw('🤚','ладонь');
kw('✋','стоп ладонь');
kw('🖖','спок');
kw('👌','окей');
kw('✌️','победа мир');
kw('🤞','палец скрещен');
kw('🤟','люблю');
kw('🤘','рок');
kw('🤙','позвони');
kw('👈','указываю влево');
kw('👉','указываю вправо');
kw('👆','показываю вверх');
kw('👇','показываю вниз');
kw('👍','лайк одобряю');
kw('👎','дизлайк не нравится');
kw('✊','кулак');
kw('👊','удар кулаком');
kw('🤛','кулак левый');
kw('🤜','кулак правый');
kw('👏','хлопки аплодисменты');
kw('🙌','ура руки вверх');
kw('👐','раскрытые ладони');
kw('🤲','ладони вместе');
kw('🤝','рукопожатие');
kw('🙏','мольба благодарность');

// Hearts and love
kw('❤️','сердце любовь');
kw('🧡','оранжевое сердце');
kw('💛','жёлтое сердце');
kw('💚','зелёное сердце');
kw('💙','синее сердце');
kw('💜','фиолетовое сердце');
kw('🖤','чёрное сердце');
kw('🤍','белое сердце');
kw('🤎','коричневое сердце');
kw('💔','разбитое сердце');
kw('❣️','восклицательное сердце');
kw('💕','два сердца');
kw('💞','сердца вращаются');
kw('💓','сердце бьётся');
kw('💗','сердце растёт');
kw('💖','блестящее сердце');
kw('💘','сердце стрела');
kw('💝','сердце с бантом');

// Nature
kw('⭐','звезда');
kw('🌟','звезда сияющая');
kw('✨','блеск искры');
kw('💫','звезда падающая');
kw('🔥','огонь жар');
kw('💥','взрыв');
kw('❄️','снежинка холод');
kw('🌈','радуга');
kw('☀️','солнце');
kw('🌙','луна');
kw('⭐','звезда');

// Animals
kw('🐶','собака');
kw('🐱','кошка');
kw('🐭','мышь');
kw('🐹','хомяк');
kw('🐰','кролик');
kw('🦊','лиса');
kw('🐻','медведь');
kw('🐼','панда');
kw('🐨','коала');
kw('🐯','тигр');
kw('🦁','лев');
kw('🐮','корова');
kw('🐷','свинья');
kw('🐸','лягушка');
kw('🐵','обезьяна');
kw('🙈','обезьяна не вижу');
kw('🙉','обезьяна не слышу');
kw('🙊','обезьяна не говорит');
kw('🐔','курица');
kw('🐧','пингвин');
kw('🐦','птица');
kw('🐤','цыплёнок');
kw('🦆','утка');
kw('🦅','орёл');
kw('🦉','сова');
kw('🦇','нетопырь');
kw('🐺','волк');
kw('🐴','лошадь');
kw('🦄','единорог');
kw('🐝','пчела');
kw('🐛','гусеница');
kw('🦋','бабочка');
kw('🐌','улитка');

// Food
kw('🍏','яблоко зелёное');
kw('🍎','яблоко красное');
kw('🍐','груша');
kw('🍊','апельсин');
kw('🍋','лимон');
kw('🍌','банан');
kw('🍉','арбуз');
kw('🍇','виноград');
kw('🍓','клубника');
kw('🍒','вишня');
kw('🥭','манго');
kw('🍍','ананас');
kw('🥝','киви');
kw('🍅','помидор');
kw('🥑','авокадо');
kw('🍔','бургер');
kw('🍟','картошка фри');
kw('🍕','пицца');
kw('🌭','хот-дог');
kw('🥪','бутерброд');
kw('🌮','тако');
kw('🌯','буррито');
kw('🍝','паста');
kw('🍜','рамен');
kw('🍣','суши');
kw('🍰','торт');
kw('🎂','день рождения торт');
kw('🍩','пончик');
kw('🍪','печенье');
kw('🍫','шоколад');
kw('🍬','конфета');
kw('☕','кофе чай');
kw('🍵','чай');
kw('🍺','пиво');
kw('🍷','вино');
kw('🥤','напиток');

// Activities
kw('⚽','футбол');
kw('🏀','баскетбол');
kw('🏈','американский футбол');
kw('⚾','бейсбол');
kw('🎾','теннис');
kw('🏐','волейбол');
kw('🏉','регби');
kw('🎱','бильярд');
kw('🏓','пинг-понг');
kw('🏸','бадминтон');
kw('🏒','хоккей');
kw('🏏','крикет');
kw('⛳','гольф');
kw('🎯','мишень');
kw('🎮','игры контроллер');
kw('🕹️','джойстик');
kw('🎲','кубики');
kw('🧩','пазл');
kw('🎭','театр');
kw('🎨','палитра');
kw('🎬','кино');
kw('🎤','микрофон');
kw('🎧','наушники');
kw('🎵','нота');
kw('🎶','музыка');
kw('🎸','гитара');
kw('🎹','пианино');
kw('🥁','барабан');
kw('🎺','труба');
kw('🎻','скрипка');

// Objects
kw('📱','телефон');
kw('💻','компьютер');
kw('⌨️','клавиатура');
kw('🖥️','монитор');
kw('🖨️','принтер');
kw('🖱️','мышь');
kw('📷','фотоаппарат');
kw('📹','видеокамера');
kw('🎥','кинокамера');
kw('📞','телефон');
kw('☎️','телефон');
kw('📺','телевизор');
kw('📻','радио');
kw('💡','лампочка идея');
kw('🔦','фонарик');
kw('🔑','ключ');
kw('🔒','замок');
kw('🔓','открытый замок');
kw('📝','заметка');
kw('✏️','карандаш');
kw('📖','книга');
kw('📚','книги');
kw('🎒','рюкзак');
kw('✏️','карандаш');
kw('📁','папка');
kw('📅','календарь');
kw('⏰','будильник');
kw('🧭','компас');
kw('🗑️','мусорка');

// Transport
kw('🚗','машина');
kw('🚕','такси');
kw('🚌','автобус');
kw('🏍️','мотоцикл');
kw('🚲','велосипед');
kw('✈️','самолёт');
kw('🚀','ракета');
kw('🛸','НЛО');
kw('🚂','поезд');
kw('🚢','корабль');

// Common categories
kw('👍','лайк одобрение');
kw('👎','дизлайк');
kw('💯','сто баллов');
kw('🎉','праздник');
kw('🎊','конфетти');
kw('🎈','шар');
kw('🎄','ёлка');
kw('🎁','подарок');
kw('🎀','бантик');
kw('🏆','кубок');
kw('🥇','золото первый');
kw('🥈','серебро');
kw('🥉','бронза');
kw('🏅','медаль');
kw('🎗️','лента');
kw('炸弹','бомба');
kw('💎','алмаз');
kw('🧲','магнит');
const CATEGORIES = [
  { nameKey: 'emoji.catFrequent', icon: '🕐', emojis: [] as string[] },
  { nameKey: 'emoji.catSmileys', icon: '😊', emojis: [
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
  { nameKey: 'emoji.catGestures', icon: '👋', emojis: [
    '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌',
    '🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉',
    '👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛',
    '🤜','👏','🙌','🫶','👐','🤲','🤝','🙏',
  ]},
  { nameKey: 'emoji.catAnimals', icon: '🐶', emojis: [
    '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨',
    '🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊',
    '🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉',
    '🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌',
  ]},
  { nameKey: 'emoji.catFood', icon: '🍔', emojis: [
    '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐',
    '🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑',
    '🧅','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄',
    '🥔','🍠','🫘','🥐','🍞','🥖','🥨','🧀','🥚','🍳',
    '🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔',
  ]},
  { nameKey: 'emoji.catActivities', icon: '⚽', emojis: [
    '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱',
    '🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳',
    '🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷',
    '⛸️','🥌','🎿','🎯','🪀','🪁','🎮','🕹️',
  ]},
  { nameKey: 'emoji.catObjects', icon: '💡', emojis: [
    '⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️',
    '🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥',
    '📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️',
    '🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋',
  ]},
  { nameKey: 'emoji.catSymbols', icon: '❤️', emojis: [
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
    '❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝',
    '⭐','🌟','✨','💫','🔥','💥','❄️','🌈','☀️','🌤️',
  ]},
];

// Recent emojis storage
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
  textareaRef?: React.RefObject<HTMLDivElement>;
  /** If false — doesn't register its own close handler (the parent panel handles closing). */
  standalone?: boolean;
  /**
   * Image emoji sets (#62): when provided, the picker shows the user's
   * installed image packs as additional tabs; picking a tile reports its
   * blobId (sent as a compact sticker by the caller). Without the callback
   * the picker is native-only (e.g. the reaction picker).
   */
  onPickImage?: (blobId: string) => void;
}

export function EmojiPicker({ onSelect, onClose, textareaRef, standalone = true, onPickImage }: EmojiPickerProps): JSX.Element {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState(0);
  const [search, setSearch] = useState('');
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [activePack, setActivePack] = useState<string | null>(null);
  const [packItems, setPackItems] = useState<StickerItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Installed image emoji packs (#62). Loaded only when the caller can
  // handle image picks.
  useEffect(() => {
    if (!onPickImage) return;
    let alive = true;
    getMyStickerPacks()
      .then((res) => alive && setPacks(res.packs))
      .catch(() => undefined);
    return () => { alive = false; };
  }, [onPickImage]);

  // Items of the selected pack.
  useEffect(() => {
    if (!activePack) {
      setPackItems([]);
      return;
    }
    let alive = true;
    getStickerPackItems(activePack)
      .then((res) => alive && setPackItems(res.items))
      .catch(() => undefined);
    return () => { alive = false; };
  }, [activePack]);

  // Close on outside click + return focus to the textarea
  useEffect(() => {
    if (!standalone) return;
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
        textareaRef?.current?.focus();
      }
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
        textareaRef?.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose, textareaRef]);

  const recent = getRecent();

  // Search filtering
  const filtered = search
    ? CATEGORIES.flatMap((c) => c.emojis).filter((emoji) => {
        const kw = EMOJI_KEYWORDS[emoji];
        return kw && kw.includes(search.toLowerCase());
      })
    : null;

  const currentEmojis = activePack
    ? []
    : search
      ? filtered ?? []
      : activeCategory === 0
        ? recent
        : CATEGORIES[activeCategory].emojis;

  function handleSelect(emoji: string): void {
    saveRecent(emoji);
    onSelect(emoji);
  }

  function openPack(packId: string | null): void {
    setActivePack(packId);
    setSearch('');
  }

  return (
    <div className="emoji-picker" ref={ref} data-testid="emoji-picker">
      {!activePack && (
        <div className="emoji-picker-search">
          <input
            type="text"
            placeholder={t('emoji.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
      )}
      <div className="emoji-picker-categories">
        {!activePack && CATEGORIES.map((cat, i) => (
          <button
            key={cat.nameKey}
            type="button"
            className={'emoji-cat-btn' + (activeCategory === i && !search ? ' active' : '')}
            title={t(cat.nameKey)}
            onClick={() => { setActiveCategory(i); setSearch(''); }}
          >
            {cat.icon}
          </button>
        ))}
        {/* Image emoji packs (#62): native chip first, then installed packs. */}
        {onPickImage && packs.length > 0 && (
          <>
            <button
              type="button"
              className={'emoji-cat-btn' + (!activePack ? ' active' : '')}
              title={t('emoji.native')}
              onClick={() => openPack(null)}
            >
              😀
            </button>
            {packs.map((p) => (
              <button
                key={p.packId}
                type="button"
                data-testid="emoji-pack-chip"
                className={'emoji-pack-chip' + (activePack === p.packId ? ' active' : '')}
                title={p.title}
                onClick={() => openPack(p.packId)}
              >
                {p.coverBlobId
                  ? <PackChipImg blobId={p.coverBlobId} />
                  : '📦'}
              </button>
            ))}
          </>
        )}
      </div>
      <div className="emoji-picker-grid">
        {activePack ? (
          packItems.length === 0 ? (
            <div className="emoji-picker-empty">{t('chatlist.notFound')}</div>
          ) : (
            packItems.map((item) => (
              <button
                key={item.itemId}
                type="button"
                data-testid="emoji-img-tile"
                className="emoji-img-btn"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onPickImage?.(item.blobId);
                }}
              >
                <PackItemImg blobId={item.blobId} />
              </button>
            ))
          )
        ) : (
          <>
            {currentEmojis.length === 0 && (
              <div className="emoji-picker-empty">
                {search ? t('chatlist.notFound') : t('emoji.noRecent')}
              </div>
            )}
            {currentEmojis.map((emoji, i) => (
              <button
                key={`${emoji}-${i}`}
                type="button"
                className="emoji-btn"
                onPointerDown={(e) => {
                  e.preventDefault();
                  handleSelect(emoji);
                }}
              >
                {emoji}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// Pack cover / item image with the shared object-URL cache.
function PackChipImg({ blobId }: { blobId: string }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    blobObjectUrl(blobId).then((u) => !cancelled && setUrl(u)).catch(() => {});
    return () => { cancelled = true; };
  }, [blobId]);
  if (!url) return <span className="emoji-pack-chip-loading" />;
  return <img src={url} alt="" />;
}

function PackItemImg({ blobId }: { blobId: string }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    blobObjectUrl(blobId).then((u) => !cancelled && setUrl(u)).catch(() => {});
    return () => { cancelled = true; };
  }, [blobId]);
  if (!url) return <span className="emoji-img-loading" />;
  return <img src={url} alt="" />;
}
