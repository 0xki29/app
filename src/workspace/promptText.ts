import type { TestChar } from '../data/testChars'

/**
 * Recall's instruction under the prompt. Pinyin and meaning do not say which script is wanted
 * (学 or 學 for "xué · học"), so the instruction does — unless the character is the same in both.
 * After the answer has been shown, the learner is reminded that this is no longer from memory.
 */
export function recallInstruction(item: Pick<TestChar, 'script'>, peeked: boolean): string {
  const what = item.script === 'simplified' ? 'chữ giản thể' : item.script === 'traditional' ? 'chữ phồn thể' : 'chữ này'
  return `Viết ${what} từ trí nhớ${peeked ? ' · bạn vừa xem mẫu' : ''}`
}

/** The writing box's accessible name: it must not give the answer away while it is hidden. */
export function boxLabel(char: string, hidden: boolean): string {
  return hidden ? 'Ô viết chữ' : `Ô viết chữ ${char}`
}
