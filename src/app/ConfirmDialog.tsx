import { useEffect, useId, useRef } from 'react'

interface Props {
  title: string
  text: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A modal question with two answers (a native <dialog>: the page behind is inert, Escape cancels,
 * focus returns where it was). The safe answer comes first and takes focus, so a stray Enter or
 * double tap never confirms. Shown while mounted.
 */
export function ConfirmDialog({ title, text, confirmLabel, cancelLabel, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const textId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    return () => dialog.close?.()
  }, [])

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <h2 id={titleId} className="dialog__title">
        {title}
      </h2>
      <p id={textId} className="dialog__text">
        {text}
      </p>
      <div className="dialog__actions">
        <button type="button" className="btn" autoFocus onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="btn btn--danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
