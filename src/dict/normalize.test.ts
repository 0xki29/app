import { describe, expect, it } from 'vitest'
import { fold, foldIY, foldKey, hasDiacritics, isPinyinOnly, isVietnameseOnly, toneKey } from './normalize'

describe('fold / foldKey', () => {
  it('removes every diacritic, đ → d, lowercase', () => {
    expect(fold('Học sinh ĐẸP')).toBe('hoc sinh dep')
    expect(fold('xuéshēng nǚ')).toBe('xuesheng nu')
    expect(fold('ưởng ợ ắ')).toBe('uong o a')
    // NFD input folds the same
    expect(fold('Học'.normalize('NFD'))).toBe('hoc')
  })

  it('makes a key of words only', () => {
    expect(foldKey('  Học   sinh! ')).toBe('hoc sinh')
    expect(foldKey('(văn học) học-sinh')).toBe('van hoc hoc sinh')
    expect(foldKey('学生')).toBe('')
  })

  it('folds i/y when the syllable is consonant + y', () => {
    expect(foldKey('kỳ lý mỹ quý sỹ y')).toBe('ki li mi qui si i')
    expect(foldKey('kì lí mĩ quí sĩ')).toBe('ki li mi qui si')
    // not uy, not y inside a syllable
    expect(foldKey('thuỷ huy yêu quyết khuya')).toBe('thuy huy yeu quyet khuya')
    expect(foldIY('ngy')).toBe('ngi')
  })
})

describe('toneKey', () => {
  it('ignores where the tone mark sits and the i/y spelling', () => {
    expect(toneKey('hoà')).toBe(toneKey('hòa'))
    expect(toneKey('thuỷ')).toBe(toneKey('thủy'))
    expect(toneKey('kỳ')).toBe(toneKey('kì'))
    expect(toneKey('Hoà bình')).toBe('hoa2 binh2')
  })

  it('keeps the letters\u2019 own marks and tells tones apart', () => {
    expect(toneKey('ăn')).toBe('ăn1')
    expect(toneKey('an')).not.toBe(toneKey('ăn'))
    expect(toneKey('án')).not.toBe(toneKey('an'))
    expect(toneKey('đi')).toBe('đi1')
  })
})

describe('script guesses', () => {
  it('knows marks only Vietnamese uses', () => {
    expect(isVietnameseOnly('ăn')).toBe(true)
    expect(isVietnameseOnly('học')).toBe(true)
    expect(isVietnameseOnly('đi')).toBe(true)
    expect(isVietnameseOnly('án')).toBe(false) // could be pinyin àn / án
    expect(isVietnameseOnly('xuéshēng')).toBe(false)
  })

  it('knows marks only pinyin uses', () => {
    expect(isPinyinOnly('xuéshēng')).toBe(true)
    expect(isPinyinOnly('nǚ')).toBe(true)
    expect(isPinyinOnly('xue2')).toBe(true)
    expect(isPinyinOnly('lu:')).toBe(true)
    expect(isPinyinOnly('án')).toBe(false)
    expect(isPinyinOnly('hoc sinh')).toBe(false)
  })

  it('detects typed diacritics', () => {
    expect(hasDiacritics('an')).toBe(false)
    expect(hasDiacritics('ăn')).toBe(true)
    expect(hasDiacritics('đi')).toBe(true)
  })
})
