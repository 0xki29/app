/**
 * The dictionary's screens, for the app shell to route (see README "Dictionary"):
 *   #/tra-cuu[?q=…]                    DictionarySearchScreen
 *   #/tu/<encodeURIComponent(key)>     EntryScreen, entryKey = the decoded key ("學生|学生[xue2 sheng5]")
 *   #/pinyin                           PinyinGuideScreen
 *   #/nguon-du-lieu                    CreditsScreen
 * Each imports dict.css itself; none needs props other than EntryScreen's key.
 */
export { CreditsScreen } from './CreditsScreen'
export { EntryScreen } from './EntryScreen'
export { PinyinGuideScreen } from './PinyinGuideScreen'
export { DictionarySearchScreen } from './SearchScreen'
