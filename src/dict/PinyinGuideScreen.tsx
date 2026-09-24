import type { ReactNode } from 'react'
import { useEntryState } from '../app/history'
import './dict.css'
import { lastPageHref } from './links'
import { useVoiceStatus } from './speech'
import { ListenButton, PinyinText, TopBar } from './ui'

/**
 * "Pinyin cho người Việt": a hand-written guide to reading pinyin, with honest comparisons to
 * Vietnamese sounds and tones — where they are close and where they are not. No Vietnamese-letter
 * respellings of Mandarin ("phiên âm bồi"): an initial is compared with a Vietnamese consonant, a
 * final with a Vietnamese vần, a tone with a Vietnamese tone or intonation, never a whole syllable
 * with a Vietnamese one; every example can be listened to. The five parts fold (phones): the tones
 * are open at first, and which parts are open is kept for Back.
 */

type Ex = readonly [hanzi: string, pinyin: string, vi: string]

/** An example word: hanzi, tone-colored pinyin, its meaning, a listen button. */
function Example({ ex }: { ex: Ex }) {
  const [hanzi, py, vi] = ex
  return (
    <li className="dict-ex">
      <span className="dict-ex__han" lang="zh-Hans">
        {hanzi}
      </span>
      <PinyinText numbered={py} className="dict-ex__py" />
      <span className="dict-ex__vi">{vi}</span>
      <ListenButton text={hanzi} label={`Nghe ${hanzi}`} showHint={false} />
    </li>
  )
}

function Examples({ items }: { items: readonly Ex[] }) {
  return (
    <ul className="dict-exs">
      {items.map((ex) => (
        <Example key={ex[0] + ex[1]} ex={ex} />
      ))}
    </ul>
  )
}

/** A sound: its letters, what to do, and examples. */
function Sound({ name, children, ex, level = 4 }: { name: string; children: ReactNode; ex?: readonly Ex[]; level?: 3 | 4 }) {
  const H = level === 3 ? 'h3' : 'h4'
  return (
    <div className="dict-sound">
      <H className="dict-sound__name" lang="zh-Latn-pinyin">
        {name}
      </H>
      <p className="dict-sound__text">{children}</p>
      {ex && <Examples items={ex} />}
    </div>
  )
}

/** Pitch on the 5-level scale (1 lowest, 5 highest), drawn left to right. */
function Contour({ points, label }: { points: readonly number[]; label: string }) {
  const x = (i: number) => 8 + (i * 48) / Math.max(1, points.length - 1)
  const y = (level: number) => 36 - (level - 1) * 7
  const d = points.length === 1 ? `M26 ${y(points[0])}h4` : points.map((p, i) => `${i ? 'L' : 'M'}${x(i)} ${y(p)}`).join('')
  return (
    <svg className="dict-contour" viewBox="0 0 64 42" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((l) => (
        <line key={l} x1="4" x2="60" y1={y(l)} y2={y(l)} className="dict-contour__grid" />
      ))}
      <path d={d} className="dict-contour__line" />
    </svg>
  )
}

const TONES: readonly { n: 1 | 2 | 3 | 4 | 5; name: string; points: number[]; pitch: string; how: ReactNode; ex: Ex }[] = [
  {
    n: 1,
    name: 'Thanh 1 (ā)',
    points: [5, 5],
    pitch: 'cao và bằng (5 → 5)',
    how: (
      <>
        Giữ giọng ở mức cao của bạn, đều và hơi dài, như ngân một nốt nhạc. Hình dạng giống thanh ngang của tiếng Việt
        (bằng phẳng) nhưng <strong>cao hơn hẳn</strong>: thanh ngang nằm ở giữa giọng, thanh 1 nằm ở đỉnh giọng. Đọc
        thấp như thanh ngang là lỗi hay gặp nhất.
      </>
    ),
    ex: ['妈', 'ma1', 'mẹ'],
  },
  {
    n: 2,
    name: 'Thanh 2 (á)',
    points: [3, 5],
    pitch: 'đi lên (3 → 5)',
    how: (
      <>
        Từ giữa giọng đi lên cao, như giọng ngạc nhiên khi hỏi lại một từ không dấu: “Sao?”, “Ai?”. Khá gần thanh sắc,
        nhưng lên đều và thong thả hơn. Đừng đọc gắt và cụt như thanh sắc trong “mát”, “hết”. Cũng đừng để giọng chùng
        xuống trước khi lên: đó là thanh 3.
      </>
    ),
    ex: ['麻', 'ma2', 'cây gai; tê'],
  },
  {
    n: 3,
    name: 'Thanh 3 (ǎ)',
    points: [2, 1, 4],
    pitch: 'trầm: xuống thấp rồi lên (2 → 1 → 4)',
    how: (
      <>
        Phần quan trọng là <strong>độ trầm</strong>. Đọc riêng một chữ hoặc ở cuối câu thì xuống sâu rồi lên; trong câu,
        trước một chữ khác, thường chỉ còn nửa đầu: thấp và trầm, không lên (xem phần Biến điệu). Hình dạng gần thanh hỏi
        nhưng trầm và dài hơn. Không giống thanh ngã: không ngắt giọng giữa chừng.
      </>
    ),
    ex: ['马', 'ma3', 'con ngựa'],
  },
  {
    n: 4,
    name: 'Thanh 4 (à)',
    points: [5, 1],
    pitch: 'từ cao rơi mạnh xuống (5 → 1)',
    how: (
      <>
        Bắt đầu cao như thanh 1 rồi rơi hẳn xuống, ngắn và dứt khoát, như khi ra lệnh. Tiếng Việt không có thanh giống
        vậy: thanh huyền cũng đi xuống nhưng bắt đầu thấp và nhẹ; thanh nặng thì ngắn và bị tắc ở họng. Người Việt hay đọc
        thanh 4 thành thanh huyền — hãy bắt đầu cao hơn nhiều.
      </>
    ),
    ex: ['骂', 'ma4', 'mắng, chửi'],
  },
  {
    n: 5,
    name: 'Thanh nhẹ (a, không dấu)',
    points: [2],
    pitch: 'ngắn, nhẹ, không có đường nét riêng',
    how: (
      <>
        Đọc lướt, ngắn và nhẹ; độ cao tuỳ chữ đứng trước: sau thanh 3 thì hơi cao, sau các thanh khác thì thấp hơn.
        Thường là âm tiết sau của từ: 妈妈 <em>māma</em>, 谢谢 <em>xièxie</em>, 学生 <em>xuésheng</em>. Từ điển này không
        ghi dấu cho thanh nhẹ.
      </>
    ),
    ex: ['吗', 'ma5', 'trợ từ để hỏi'],
  },
]

const PARTS = [
  { id: 'py-thanh', toc: 'Thanh điệu', title: '1. Thanh điệu' },
  { id: 'py-dau', toc: 'Phụ âm đầu', title: '2. Phụ âm đầu' },
  { id: 'py-van', toc: 'Vần', title: '3. Vần' },
  { id: 'py-viet', toc: 'Quy tắc viết', title: '4. Quy tắc viết (để đọc cho đúng)' },
  { id: 'py-bien', toc: 'Biến điệu', title: '5. Biến điệu' },
] as const

type PartId = (typeof PARTS)[number]['id']

/**
 * One part of the guide that folds: its heading holds the button that opens and closes it (the
 * heading stays a heading for screen readers), and the part's text follows.
 */
function Part({ id, title, open, onToggle, children }: { id: PartId; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="dict-sec dict-part" aria-labelledby={id}>
      <h2 id={id} className="dict-sec__title dict-part__title" tabIndex={-1}>
        <button type="button" className="dict-part__toggle" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle}>
          <span>{title}</span>
          <svg className="dict-part__chevron" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      <div id={`${id}-body`} className="dict-part__body" hidden={!open}>
        {children}
      </div>
    </section>
  )
}

export function PinyinGuideScreen() {
  const voice = useVoiceStatus()
  const [open, setOpen] = useEntryState<string[]>('guide-open', ['py-thanh'])
  const isOpen = (id: PartId) => open.includes(id)
  const toggle = (id: PartId) => setOpen(isOpen(id) ? open.filter((o) => o !== id) : [...open, id])
  const allOpen = PARTS.every((p) => isOpen(p.id))

  /** In-page links without touching the hash (the hash is the route): open the part, then go to it. */
  const jump = (id: PartId) => (e: { preventDefault(): void }) => {
    e.preventDefault()
    if (!isOpen(id)) setOpen([...open, id])
    requestAnimationFrame(() => {
      const el = document.getElementById(id)
      el?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      el?.focus({ preventScroll: true })
    })
  }

  const part = (id: PartId, children: ReactNode) => {
    const p = PARTS.find((x) => x.id === id)!
    return (
      <Part id={id} title={p.title} open={isOpen(id)} onToggle={() => toggle(id)}>
        {children}
      </Part>
    )
  }

  return (
    <main className="dict dict-guide">
      <TopBar back={lastPageHref()} backLabel="Quay lại" title="Pinyin cho người Việt" />

      <p className="dict-lead">
        Pinyin (拼音) viết âm tiếng Phổ thông bằng chữ Latin. Chữ cái trông quen, nhưng nhiều chữ đọc{' '}
        <strong>khác hẳn</strong> tiếng Việt: đừng đọc pinyin như đọc chữ quốc ngữ. Mỗi âm tiết gồm phụ âm đầu, vần và
        thanh điệu (dấu trên nguyên âm). Tiếng Việt chỉ là điểm tựa ban đầu; hãy nghe và bắt chước.
      </p>
      {(voice === 'none' || voice === 'unsupported') && (
        <p className="dict-notice dict-notice--quiet">
          Máy chưa có giọng đọc tiếng Trung nên các nút nghe chưa phát được. Cài thêm giọng “Tiếng Trung (Trung Quốc)”
          trong cài đặt ngôn ngữ của máy rồi mở lại trang.
        </p>
      )}
      <nav className="dict-toc" aria-label="Mục lục">
        {PARTS.map((p) => (
          <a key={p.id} href={`#${p.id}`} onClick={jump(p.id)}>
            {p.toc}
          </a>
        ))}
      </nav>
      <p className="dict-guide__all">
        <button type="button" className="dict-link-btn" onClick={() => setOpen(allOpen ? [] : PARTS.map((p) => p.id))}>
          {allOpen ? 'Thu gọn tất cả' : 'Mở tất cả các phần'}
        </button>
      </p>

      {part(
        'py-thanh',
        <>
          <p>
            Tiếng Phổ thông có 4 thanh và thanh nhẹ; cùng âm <em>ma</em>, đổi thanh là đổi nghĩa. Trong từ điển, mỗi thanh
            có một màu: <span className="dict-t1">thanh 1</span>, <span className="dict-t2">thanh 2</span>,{' '}
            <span className="dict-t3">thanh 3</span>, <span className="dict-t4">thanh 4</span>,{' '}
            <span className="dict-t5">thanh nhẹ</span>. Hình vẽ cho độ cao của giọng, từ 1 (thấp nhất) đến 5 (cao nhất).
          </p>
          <ul className="dict-tones">
            {TONES.map((t) => (
              <li key={t.n} className="dict-tone">
                <div className="dict-tone__head">
                  <Contour points={t.points} label={`${t.name}: ${t.pitch}`} />
                  <h3 className={`dict-tone__name dict-t${t.n}`}>{t.name}</h3>
                </div>
                <p className="dict-tone__pitch">{t.pitch}</p>
                <p>{t.how}</p>
                <Examples items={[t.ex]} />
              </li>
            ))}
          </ul>
          <p className="dict-tip">
            Tiếng Việt có 6 thanh, tiếng Phổ thông có 4 thanh và thanh nhẹ, nên không có bảng “thanh này = thanh kia”. Hai
            điểm hay sai nhất: thanh 1 đọc chưa đủ cao, và thanh 4 đọc thành thanh huyền. Thanh 2 và thanh 3 cũng hay lẫn:
            thanh 2 đi thẳng lên, thanh 3 xuống thấp trước.
          </p>
        </>,
      )}

      {part(
        'py-dau',
        <>
          <p className="dict-tip">
            <strong>Điều quan trọng nhất:</strong> pinyin phân biệt <strong>bật hơi</strong> và không bật hơi, chứ không
            phân biệt có hay không rung dây thanh như <em>b/p</em>, <em>đ/t</em> của tiếng Việt. <em>b, d, g</em> không rung
            dây thanh và không bật hơi; <em>p, t, k</em> có một luồng hơi bật mạnh. Đặt bàn tay trước miệng: đọc{' '}
            <em>p, t, k</em> thấy hơi phả vào tay, đọc <em>b, d, g</em> thì gần như không.
          </p>

          <h3 className="dict-sub">b – p, d – t, g – k</h3>
          <Sound name="b" ex={[['爸爸', 'ba4 ba5', 'bố'], ['不', 'bu4', 'không']]}>
            Như <em>p</em> trong “pin” của tiếng Việt: không bật hơi, không rung. Không phải <em>b</em> tiếng Việt (có rung
            dây thanh).
          </Sound>
          <Sound name="p" ex={[['怕', 'pa4', 'sợ'], ['朋友', 'peng2 you5', 'bạn bè']]}>
            <em>p</em> kèm luồng hơi bật mạnh. Tiếng Việt không có âm này.
          </Sound>
          <Sound name="d" ex={[['大', 'da4', 'to, lớn'], ['对', 'dui4', 'đúng']]}>
            Như <em>t</em> tiếng Việt (“tai”), không phải <em>đ</em>.
          </Sound>
          <Sound name="t" ex={[['他', 'ta1', 'anh ấy'], ['天', 'tian1', 'trời, ngày']]}>
            Như <em>th</em> tiếng Việt (“tha”): chính là <em>t</em> bật hơi.
          </Sound>
          <Sound name="g" ex={[['哥哥', 'ge1 ge5', 'anh trai'], ['高', 'gao1', 'cao']]}>
            Như <em>c/k</em> tiếng Việt (“ca”), không phải <em>g</em> tiếng Việt.
          </Sound>
          <Sound name="k" ex={[['看', 'kan4', 'nhìn, xem'], ['口', 'kou3', 'miệng']]}>
            <em>c/k</em> kèm luồng hơi bật mạnh. Khác <em>kh</em> tiếng Việt: <em>kh</em> là âm xát (gần <em>h</em> pinyin
            bên dưới), còn <em>k</em> là âm tắc bật hơi.
          </Sound>

          <h3 className="dict-sub">m, n, l, f, h</h3>
          <Sound name="m · n · l" ex={[['妈', 'ma1', 'mẹ'], ['你', 'ni3', 'bạn'], ['老', 'lao3', 'già, cũ']]}>
            Như tiếng Việt. Nếu giọng quê bạn lẫn <em>n</em> và <em>l</em>, hãy tách rõ: 男 <em>nán</em> (nam) khác 蓝{' '}
            <em>lán</em> (xanh lam).
          </Sound>
          <Sound name="f" ex={[['饭', 'fan4', 'cơm'], ['飞', 'fei1', 'bay']]}>
            Như <em>ph</em> tiếng Việt.
          </Sound>
          <Sound name="h" ex={[['好', 'hao3', 'tốt'], ['喝', 'he1', 'uống']]}>
            Gần <em>kh</em> tiếng Việt: hơi cọ xát ở cuống lưỡi. Không phải <em>h</em> nhẹ của tiếng Việt.
          </Sound>

          <h3 className="dict-sub">j, q, x — chỉ đứng trước i và ü</h3>
          <p>
            Mặt lưỡi áp rộng lên vòm miệng, đầu lưỡi tì sau răng dưới. Trước <em>i</em> môi dẹt như đang cười; trước{' '}
            <em>ü</em> (viết là <em>u</em>: <em>ju, qu, xu, jue, quan…</em>) môi chu tròn ngay từ đầu.
          </p>
          <Sound name="j" ex={[['鸡', 'ji1', 'con gà'], ['家', 'jia1', 'nhà']]}>
            Gần <em>ch</em> giọng Bắc (“cha”) nhưng mềm hơn; không bật hơi.
          </Sound>
          <Sound name="q" ex={[['七', 'qi1', 'bảy'], ['去', 'qu4', 'đi']]}>
            Như <em>j</em> nhưng bật hơi mạnh. Không liên quan đến <em>qu</em> tiếng Việt: trong 去 <em>qù</em>, <em>u</em>{' '}
            là ü (xem phần Vần), môi chu tròn.
          </Sound>
          <Sound name="x" ex={[['谢谢', 'xie4 xie5', 'cảm ơn'], ['学', 'xue2', 'học']]}>
            Gần <em>x</em> tiếng Việt, nhưng mặt lưỡi áp rộng lên vòm miệng, nghe “mềm” hơn.
          </Sound>

          <h3 className="dict-sub">zh, ch, sh, r — uốn lưỡi</h3>
          <p>Đầu lưỡi cong lên, chạm hoặc gần chạm phần vòm cứng phía sau lợi trên.</p>
          <Sound name="zh" ex={[['中国', 'Zhong1 guo2', 'Trung Quốc'], ['这', 'zhe4', 'này']]}>
            Gần <em>tr</em> uốn lưỡi của giọng miền Trung, miền Nam; không bật hơi.
          </Sound>
          <Sound name="ch" ex={[['吃', 'chi1', 'ăn'], ['茶', 'cha2', 'trà']]}>
            Như <em>zh</em> nhưng bật hơi mạnh. Không đọc như <em>ch</em> tiếng Việt.
          </Sound>
          <Sound name="sh" ex={[['是', 'shi4', 'là'], ['书', 'shu1', 'sách']]}>
            Gần <em>s</em> uốn lưỡi (như <em>s</em> trong “sông” theo giọng miền Trung, miền Nam).
          </Sound>
          <Sound name="r" ex={[['人', 'ren2', 'người'], ['热', 're4', 'nóng']]}>
            Uốn lưỡi như <em>sh</em> nhưng có rung dây thanh, nghe gần <em>r</em> uốn lưỡi nhẹ. Không rung đầu lưỡi, không
            đọc thành <em>d/gi</em> kiểu giọng Bắc hay <em>l</em>.
          </Sound>

          <h3 className="dict-sub">z, c, s — đầu lưỡi thẳng</h3>
          <p>Đầu lưỡi thẳng, tì vào mặt sau răng cửa trên.</p>
          <Sound name="z" ex={[['在', 'zai4', 'ở'], ['字', 'zi4', 'chữ']]}>
            Như <em>t</em> và <em>x</em> tiếng Việt đọc liền một hơi (“ts”), không bật hơi. Tiếng Việt không có âm này.
          </Sound>
          <Sound name="c" ex={[['菜', 'cai4', 'món ăn, rau'], ['从', 'cong2', 'từ (nơi nào)']]}>
            Như <em>z</em> nhưng bật hơi mạnh. <strong>Bẫy lớn:</strong> <em>c</em> trong pinyin không bao giờ đọc như{' '}
            <em>c</em> tiếng Việt.
          </Sound>
          <Sound name="s" ex={[['三', 'san1', 'ba'], ['四', 'si4', 'bốn']]}>
            Như <em>x</em> tiếng Việt.
          </Sound>

          <h3 className="dict-sub">y, w</h3>
          <Sound name="y · w" ex={[['一', 'yi1', 'một'], ['五', 'wu3', 'năm'], ['鱼', 'yu2', 'cá']]}>
            Là cách viết của <em>i, u, ü</em> khi đứng đầu âm tiết: <em>yi</em> đọc là i, <em>wu</em> là u, <em>yu</em> là ü
            (xem Quy tắc viết).
          </Sound>
        </>,
      )}

      {part(
        'py-van',
        <>
          <Sound level={3} name="ü" ex={[['女', 'nu:3', 'nữ, con gái'], ['绿', 'lu:4', 'xanh lá'], ['去', 'qu4', 'đi']]}>
            Tiếng Việt không có âm này. Đọc <em>i</em>, giữ nguyên lưỡi, rồi chu môi tròn như khi đọc <em>u</em>. Sau{' '}
            <em>j, q, x, y</em> nó được viết là <em>u</em> nhưng vẫn đọc là ü.
          </Sound>
          <Sound level={3} name="e" ex={[['喝', 'he1', 'uống'], ['饿', 'e4', 'đói'], ['哥哥', 'ge1 ge5', 'anh trai']]}>
            Không phải <em>e</em> tiếng Việt. Gần <em>ơ</em> nhưng lưỡi lùi về sau, môi không tròn (có sách tả là nghe hơi
            như <em>ơ</em> trượt từ <em>ư</em>). Riêng trong <em>ie, üe</em> (<em>ye, yue</em>) thì đọc gần <em>ê</em>: 谢{' '}
            <em>xiè</em>, 月 <em>yuè</em>.
          </Sound>
          <Sound level={3} name="i sau z, c, s" ex={[['字', 'zi4', 'chữ'], ['四', 'si4', 'bốn'], ['次', 'ci4', 'lần']]}>
            Không đọc là <em>i</em>: giữ lưỡi ở chỗ của phụ âm và kéo dài, nghe gần <em>ư</em>.
          </Sound>
          <Sound level={3} name="i sau zh, ch, sh, r" ex={[['是', 'shi4', 'là'], ['吃', 'chi1', 'ăn'], ['日', 'ri4', 'ngày, mặt trời']]}>
            Cũng không phải <em>i</em>: giữ lưỡi uốn, nghe gần <em>ư</em> uốn lưỡi.
          </Sound>
          <Sound level={3} name="ian · yan" ex={[['天', 'tian1', 'trời'], ['钱', 'qian2', 'tiền'], ['烟', 'yan1', 'khói']]}>
            Vần đọc gần <em>iên</em>, không đọc từng chữ <em>i-a-n</em>.
          </Sound>
          <Sound level={3} name="üan · üe · ün" ex={[['远', 'yuan3', 'xa'], ['学', 'xue2', 'học'], ['云', 'yun2', 'mây']]}>
            Sau <em>j, q, x, y</em> chúng được viết <em>uan, ue, un</em> nhưng vẫn là ü: môi chu tròn ngay từ đầu. Vần{' '}
            <em>üan</em> nghe gần <em>uyên</em>, không đọc như vần <em>oan</em> hay <em>uan</em> của tiếng Việt.
          </Sound>
          <Sound level={3} name="ei · ou" ex={[['美', 'mei3', 'đẹp'], ['狗', 'gou3', 'con chó']]}>
            <em>ei</em> gần vần <em>ây</em>; <em>ou</em> gần vần <em>âu</em>.
          </Sound>
          <Sound level={3} name="en · eng · ong" ex={[['人', 'ren2', 'người'], ['冷', 'leng3', 'lạnh'], ['东', 'dong1', 'phía đông']]}>
            <em>en</em> gần vần <em>ân</em>, <em>eng</em> gần vần <em>âng</em>, <em>ong</em> gần vần <em>ung</em> (không đọc
            như vần <em>ong</em> tiếng Việt).
          </Sound>
          <Sound level={3} name="uo · o" ex={[['国', 'guo2', 'nước'], ['我', 'wo3', 'tôi'], ['波', 'bo1', 'sóng']]}>
            <em>uo</em> gần vần <em>uô</em>. <em>o</em> sau <em>b, p, m, f</em> là <em>uo</em> viết gọn: <em>bo</em> là{' '}
            <em>b</em> + <em>uo</em>, có một <em>u</em> lướt rất nhẹ trước <em>o</em>.
          </Sound>
          <Sound level={3} name="-n và -ng" ex={[['安', 'an1', 'yên'], ['昂', 'ang2', 'ngẩng'], ['心', 'xin1', 'tim'], ['星', 'xing1', 'sao']]}>
            <em>-n</em>: đầu lưỡi chạm lợi trên; <em>-ng</em>: cuống lưỡi nâng lên. Tiếng Trung phân biệt rõ{' '}
            <em>an/ang, en/eng, in/ing</em>; giọng miền Nam hay nhập hai âm cuối này, cần chú ý. <em>ing</em> gần vần{' '}
            <em>inh</em>.
          </Sound>
          <Sound level={3} name="er và -r (儿化)" ex={[['二', 'er4', 'hai'], ['哪儿', 'na3 r5', 'ở đâu'], ['一点儿', 'yi1 dian3 r5', 'một chút']]}>
            <em>er</em>: đọc <em>ơ</em> rồi cong lưỡi lên. Chữ 儿 ghép vào cuối âm tiết trước (giọng Bắc Kinh) làm cả vần đó
            uốn lưỡi: <em>nǎr</em>, <em>yìdiǎnr</em>.
          </Sound>
        </>,
      )}

      {part(
        'py-viet',
        <ul className="dict-rules">
          <li>
            <strong>ju, qu, xu, yu</strong> đều là ü: sau <em>j, q, x, y</em> không bao giờ có <em>u</em> thường, nên dấu
            hai chấm được bỏ. Sau <em>n, l</em> thì phải giữ: <em>nǚ</em> 女 (nữ) khác <em>nù</em> 怒 (giận); <em>lǜ</em>{' '}
            绿 (xanh lá) khác <em>lù</em> 路 (đường). Khi gõ trên máy, ü gõ bằng <em>v</em>: <em>lv4</em> = lǜ.
          </li>
          <li>
            <strong>iu, ui, un</strong> là cách viết gọn của <em>iou, uei, uen</em>, đọc đủ cả nguyên âm giữa: 六{' '}
            <em>liù</em> có vần gần <em>iêu</em>, 对 <em>duì</em> có vần gần <em>uây</em>, 春 <em>chūn</em> có vần gần{' '}
            <em>uân</em>. Riêng sau <em>j, q, x, y</em>: <em>jun, qun, xun, yun</em> là <em>ü</em> + <em>n</em> (军{' '}
            <em>jūn</em>, 云 <em>yún</em>), không phải <em>uen</em>.
          </li>
          <li>
            <strong>y, w</strong> đứng thay khi âm tiết bắt đầu bằng <em>i, u, ü</em>: i → yi, in → yin, ing → ying, ia →
            ya, ie → ye, iao → yao, iou → you, ian → yan, iang → yang, iong → yong; u → wu, ua → wa, uo → wo, uai → wai, uei
            → wei, uan → wan, uen → wen, uang → wang, ueng → weng; ü → yu, üe → yue, üan → yuan, ün → yun.
          </li>
          <li>
            <strong>Dấu thanh</strong> đặt trên <em>a</em>; không có a thì trên <em>e</em>; trong <em>ou</em> thì trên{' '}
            <em>o</em>; còn lại trên nguyên âm cuối (<em>liù, duì</em>).
          </li>
          <li>
            <strong>Dấu '</strong> tách âm tiết khi âm sau bắt đầu bằng <em>a, o, e</em>: 西安 <em>Xī'ān</em> (hai âm) khác
            先 <em>xiān</em> (một âm). Trong từ điển này, âm tiết được viết cách nhau nên không cần dấu '.
          </li>
        </ul>,
      )}

      {part(
        'py-bien',
        <>
          <p>
            Từ điển ghi thanh gốc của từng chữ (như CC-CEDICT); khi nói, vài thanh đổi theo chữ đứng sau. Giọng đọc của máy
            đã đọc theo biến điệu.
          </p>
          <Sound level={3} name="3 + 3 → 2 + 3" ex={[['你好', 'ni3 hao3', 'xin chào — đọc: ní hǎo'], ['可以', 'ke3 yi3', 'được, có thể — đọc: kéyǐ']]}>
            Hai thanh 3 liền nhau: chữ đầu đọc thành thanh 2.
          </Sound>
          <Sound level={3} name="Nửa thanh 3" ex={[['老师', 'lao3 shi1', 'thầy cô giáo'], ['很忙', 'hen3 mang2', 'rất bận']]}>
            Thanh 3 đứng trước thanh 1, 2, 4 hoặc thanh nhẹ chỉ đọc phần đầu: thấp, trầm, không lên.
          </Sound>
          <Sound
            level={3}
            name="一 yī"
            ex={[
              ['第一', 'di4 yi1', 'thứ nhất — đọc: dìyī (không đổi)'],
              ['一个', 'yi1 ge5', 'một cái — đọc: yí ge'],
              ['一样', 'yi1 yang4', 'giống nhau — đọc: yíyàng'],
              ['一起', 'yi1 qi3', 'cùng nhau — đọc: yìqǐ'],
            ]}
          >
            Đọc <em>yī</em> khi đứng một mình, khi đếm, là số thứ tự hoặc ở cuối từ. Trước thanh 4 (và trước 个) đọc{' '}
            <em>yí</em>; trước thanh 1, 2, 3 đọc <em>yì</em>. Giữa hai động từ lặp lại (看一看) thì đọc nhẹ: <em>yi</em>.
          </Sound>
          <Sound
            level={3}
            name="不 bù"
            ex={[
              ['不是', 'bu4 shi4', 'không phải — đọc: búshì'],
              ['不好', 'bu4 hao3', 'không tốt — đọc: bùhǎo (không đổi)'],
            ]}
          >
            Trước thanh 4 đọc <em>bú</em>. Đứng giữa hai chữ (是不是, 对不起, 差不多) thường đọc nhẹ: <em>bu</em> — từ
            điển ghi các từ này với thanh nhẹ. Còn lại giữ <em>bù</em>.
          </Sound>
        </>,
      )}
    </main>
  )
}
