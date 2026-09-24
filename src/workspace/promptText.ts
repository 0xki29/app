import type { PracticeItem, Script } from './practiceItem'

/**
 * Recall's instruction under the prompt. Pinyin and meaning do not say which script is wanted
 * (学 or 學 for "xué · học"), so the instruction does — unless the character is the same in both.
 * After the answer has been shown, the learner is reminded that this is no longer from memory.
 */
export function recallInstruction(item: { script: Script }, peeked: boolean): string {
  const what = item.script === 'simplified' ? 'chữ giản thể' : item.script === 'traditional' ? 'chữ phồn thể' : 'chữ này'
  return `Viết ${what} từ trí nhớ${peeked ? ' · bạn vừa xem mẫu' : ''}`
}

/** The writing box's accessible name: it must not give the answer away while it is hidden. */
export function boxLabel(char: string, hidden: boolean): string {
  return hidden ? 'Ô viết chữ' : `Ô viết chữ ${char}`
}

/** BCP 47 tag so CJK fonts pick the right regional glyphs. */
export function langOf(script: Script): string {
  return script === 'traditional' ? 'zh-Hant' : 'zh-Hans'
}

/** "Giản thể · phồn thể 學" — which script this is, and the other form; null when they are the same. */
export function scriptLabel(script: Script, counterpart: string | null): string | null {
  if (!counterpart || script === 'both') return null
  return script === 'traditional' ? `Phồn thể · giản thể ${counterpart}` : `Giản thể · phồn thể ${counterpart}`
}

/** Stands for the character in Recall's prompt: "＿生 · học sinh". */
export const MASK = '＿'

/** `text` with every one of `chars` masked. */
export function maskChars(text: string, chars: readonly string[]): string {
  let out = text
  for (const c of chars) if (c) out = out.split(c).join(MASK)
  return out
}

export interface PromptView {
  /** Numbered pinyin, shown with tone marks; null when unknown. */
  pinyin: string | null
  /** The heading when there is no pinyin. */
  fallback: string
  /** Âm Hán Việt (hidden in Recall until the answer is shown: it names the character). */
  hanViet: string | null
  meaning: string
  /** The word the character was learned in, the character masked in Recall. */
  context: string | null
  /** Recall: what to write; otherwise the script and its counterpart. */
  extra: string | null
}

/**
 * What the prompt says for an item. `hidden`: Recall before the answer is shown — nothing then
 * names the character: it is masked wherever the dictionary's text or the context word has it
 * (in either script).
 */
export function promptView(item: PracticeItem, hidden: boolean, peeked: boolean): PromptView {
  const { info, context } = item
  const masked = hidden ? [item.char, info?.counterpart ?? ''] : []
  const meaning = info?.meanings.length
    ? maskChars(info.meanings.join('; '), masked)
    : item.infoStatus === 'none' && !context
      ? 'Chưa có nghĩa trong từ điển'
      : ''
  const word = context ? maskChars(context.simp, masked) : null
  const gloss = context?.vi ? maskChars(context.vi, masked) : ''
  const script = info?.script ?? 'both'
  return {
    pinyin: info?.pinyin || null,
    fallback: item.infoStatus === 'loading' ? '…' : hidden ? 'Nhớ lại chữ' : item.char,
    hanViet: hidden ? null : info?.hanViet || null,
    meaning,
    context: word ? (gloss ? `${word} · ${gloss}` : word) : null,
    extra: hidden ? recallInstruction({ script }, peeked) : scriptLabel(script, info?.counterpart ?? null),
  }
}
