import { deckErrorText, needsReload } from './hooks'

/** A deck failure as a notice: what went wrong for the learner, and "Tải lại trang" when only a reload helps. */
export function DeckErrorNotice({ error }: { error: unknown }) {
  return (
    <div className="notice notice--error" role="alert">
      <p>{deckErrorText(error)}</p>
      {needsReload(error) && (
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Tải lại trang
        </button>
      )}
    </div>
  )
}
