import { useEffect, useState } from 'react'
import { dictionary } from './client'
import './dict.css'
import { lastPageHref, REPO_URL } from './links'
import type { DictMeta } from './types'
import { formatMB, SourceChip, sourceInfo, TopBar } from './ui'

type Loaded = { meta: DictMeta | null; error?: string }

/**
 * "Giới thiệu & nguồn dữ liệu": the app's license, how far to trust the Vietnamese meanings, how
 * to report a mistake, and every data source with its license — generated from the manifest the
 * data build writes (manifest.sources), so it always matches the data being shipped.
 */
export function CreditsScreen() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let alive = true
    dictionary.meta().then(
      (meta) => {
        if (alive) setLoaded({ meta })
      },
      (e: unknown) => {
        if (alive) setLoaded({ meta: null, error: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const meta = loaded?.meta ?? null
  // Relative to the page (index.html) when the manifest is not there to say where.
  const licenses = meta?.licensesUrl ?? 'licenses/'
  const site = licenses.replace(/licenses\/$/, '')

  return (
    <main className="dict dict-credits">
      <TopBar back={lastPageHref()} backLabel="Quay lại" title="Giới thiệu & nguồn dữ liệu" />

      <section className="dict-sec" aria-labelledby="cr-app">
        <h2 id="cr-app" className="dict-sec__title">
          Chinese Notebook
        </h2>
        <p>Sổ tay luyện viết chữ Hán cho người Việt: tra từ, xem thứ tự nét, tập viết và ôn tập.</p>
        <p>
          Mã nguồn theo giấy phép <strong>MIT</strong>: <a href={REPO_URL}>github.com/0xki29/app</a>. Dữ liệu đi kèm giữ giấy
          phép của từng nguồn bên dưới; phần lớn dữ liệu từ điển theo giấy phép CC BY-SA 4.0.
        </p>
      </section>

      <section className="dict-sec" aria-labelledby="cr-trust">
        <h2 id="cr-trust" className="dict-sec__title">
          Nghĩa tiếng Việt tin được đến đâu
        </h2>
        <ul className="dict-trust">
          {(['mt', 'cur-ai', 'cur', 'en'] as const).map((flag) => {
            const info = sourceInfo([flag])!
            return (
              <li key={flag}>
                <SourceChip info={info} /> {info.explain}
              </li>
            )
          })}
        </ul>
        <p>
          <strong>Phần lớn nghĩa tiếng Việt là bản dịch máy</strong>: dự án CVDICT dùng mô hình ngôn ngữ dịch từ điển Trung–Anh
          CC-CEDICT, tác giả có rà soát, nhưng vẫn có chỗ sai hoặc chưa tự nhiên — nhất là với từ thông dụng có nhiều nghĩa.
          Các từ HSK 1–2 đã được viết lại cho dễ hiểu và đang chờ người duyệt.
        </p>
        <p>
          Âm Hán Việt ghép theo từng chữ phồn thể và cách đọc của chữ trong từ; đúng khoảng 96% số từ. Âm có đường gạch chấm
          là âm <em>chưa chắc chắn</em>: mượn cách đọc khác của chữ, hoặc lấy từ nguồn dự phòng (khi đó ghi{' '}
          <em>có thể là âm Nôm</em>). Âm ghi “AI đề xuất, chờ duyệt” đã được AI sửa (như 冷 lãnh, 受 thụ, 睡觉 thuỵ giác),
          chưa có người duyệt. Từ phiên âm tiếng nước ngoài (như 巧克力 sô-cô-la, 咖啡 cà phê) không có âm Hán Việt có nghĩa.
        </p>
        <p>
          <strong>Thấy sai?</strong> Mở mục từ đó và bấm “Báo lỗi”: trang GitHub mở ra với tiêu đề đã điền sẵn (cần tài khoản
          GitHub). Hoặc <a href={`${REPO_URL}/issues`}>xem các báo lỗi đã có</a>.
        </p>
      </section>

      <section className="dict-sec" aria-labelledby="cr-src">
        <h2 id="cr-src" className="dict-sec__title">
          Nguồn dữ liệu
        </h2>
        {!loaded ? (
          <p aria-busy="true">Đang tải danh sách nguồn…</p>
        ) : !meta ? (
          <p className="dict-notice dict-notice--quiet">{loaded.error ?? 'Chưa có dữ liệu từ điển.'}</p>
        ) : (
          <ul className="dict-sources">
            {meta.sources.map((s) => (
              <li key={s.id} className="dict-source-item">
                <h3 className="dict-source-item__name">
                  <a href={s.url}>{s.name}</a> <span className="dict-source-item__ver">{s.version}</span>
                </h3>
                <p>
                  Giấy phép: <a href={s.licenseUrl}>{s.license}</a>
                  {s.licenseFiles?.map((f) => (
                    <span key={f}>
                      {' · '}
                      <a href={new URL(f, site || document.baseURI).href}>{f.replace(/^.*\//, '')}</a>
                    </span>
                  ))}
                </p>
                <p className="dict-source-item__attr" lang="en">
                  {s.attribution}
                </p>
                {s.notes && <p>{s.notes}</p>}
                {s.changes && (
                  <p className="dict-source-item__changes">
                    <span className="dict-label">Đã thay đổi</span> <span lang="en">{s.changes}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p>
          Toàn văn giấy phép và ghi công: <a href={`${licenses}THIRD_PARTY_NOTICES.md`}>THIRD_PARTY_NOTICES.md</a> · thư viện
          trong mã ứng dụng: <a href={`${licenses}third-party.md`}>third-party.md</a> · dữ liệu nét chữ:{' '}
          <a href={`${licenses}ARPHICPL.TXT`}>ARPHICPL.TXT</a>.
        </p>
      </section>

      {meta && (
        <section className="dict-sec" aria-labelledby="cr-files">
          <h2 id="cr-files" className="dict-sec__title">
            Tải dữ liệu từ điển
          </h2>
          <p>
            Dữ liệu từ điển là các tệp văn bản thường (TSV, UTF-8), theo giấy phép CC BY-SA 4.0: bạn được tải về, dùng lại và
            chia sẻ, kể cả bản đã sửa, với điều kiện ghi nguồn như trên và giữ cùng giấy phép.
          </p>
          <ul className="dict-files">
            {meta.files.map((f) => (
              <li key={f.name}>
                <a href={f.url} download>
                  {f.name}
                </a>{' '}
                <span className="dict-files__size">({formatMB(f.bytes)})</span>
              </li>
            ))}
          </ul>
          <p className="dict-foot">Phiên bản dữ liệu: {meta.dataVersion}</p>
        </section>
      )}
    </main>
  )
}
