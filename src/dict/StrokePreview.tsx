import { useEffect, useRef, useState } from 'react'
import { StrokeAnimator } from '../strokes/StrokeAnimator'
import { StrokeOrderView } from '../strokes/StrokeOrderView'
import { useStrokeData } from '../strokes/useStrokeData'
import { prefersReducedMotion } from '../workspace/motion'

/**
 * A small stroke-order animation for a character card. It plays at the brisker pace, only while on
 * screen (so a long word does not run several loops out of sight); with reduced motion it rests on
 * the whole character. Tapping it plays the order again from the start (or, after a failed
 * download, tries again).
 */
export function StrokePreview({ char }: { char: string }) {
  const stroke = useStrokeData(char)
  const [animator] = useState(() => {
    const a = new StrokeAnimator()
    a.setPace('normal')
    return a
  })
  const box = useRef<HTMLButtonElement>(null)
  const data = stroke.status === 'ready' ? stroke.data : null

  useEffect(() => {
    animator.setData(data)
  }, [animator, data])

  useEffect(() => {
    const el = box.current
    if (!el || !data || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) animator.pause()
      else if (!prefersReducedMotion()) animator.play()
    })
    io.observe(el)
    return () => {
      io.disconnect()
      animator.pause()
    }
  }, [animator, data])

  if (stroke.status === 'none') return null
  return (
    <button
      ref={box}
      type="button"
      className="dict-stroke"
      aria-label={
        data
          ? `Xem lại thứ tự nét chữ ${char}`
          : stroke.status === 'error'
            ? `Tải lại nét viết chữ ${char}`
            : `Đang tải nét viết chữ ${char}`
      }
      aria-disabled={(!data && stroke.status !== 'error') || undefined}
      onClick={() => {
        if (data) animator.replay()
        else if (stroke.status === 'error') stroke.retry()
      }}
    >
      <svg className="dict-stroke__grid" viewBox="0 0 100 100" aria-hidden="true">
        <path d="M50 0V100M0 50H100" />
      </svg>
      {data ? (
        <StrokeOrderView data={data} variant="animate" animator={animator} className="dict-stroke__glyph" />
      ) : (
        <span className="dict-stroke__placeholder" lang="zh-Hans" aria-hidden="true">
          {char}
        </span>
      )}
      {stroke.status === 'error' && <span className="dict-stroke__error">Không tải được — chạm để thử lại</span>}
    </button>
  )
}
