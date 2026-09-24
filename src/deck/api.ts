import { hasStrokeData, loadSiteData } from '../strokes/strokeData'
import { createDeck, type Deck } from './deck'
import { openProgressStore } from './store'

export type { AddCardInput, AddResult, Deck, DeckExport, ImportResult, ReviewDetails, StudyItem, Today } from './deck'
export type { CardContext, CardRecord, DeckSettings, SelfRating } from './types'

const CHANNEL = 'chinese-notebook-deck'

/** Other tabs of the app hear about every change (a card added from the dictionary in another tab). */
function tabs(): { post(): void; listen(onChange: () => void): () => void } | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined
  const channel = new BroadcastChannel(CHANNEL)
  return {
    post: () => channel.postMessage('changed'),
    listen(onChange) {
      channel.onmessage = () => onChange()
      return () => {
        channel.onmessage = null
      }
    },
  }
}

/**
 * The app's review deck (see deck.ts): IndexedDB "chinese-notebook", stroke availability from the
 * data manifest, and one request to keep the data (navigator.storage.persist) on the first card.
 * Nothing is opened until the deck is first used.
 */
export const deck: Deck = createDeck({
  open: (onClose) => openProgressStore(undefined, onClose),
  now: () => Date.now(),
  strokes: { has: hasStrokeData, siteData: loadSiteData },
  persist: async () => navigator.storage?.persist?.(),
  broadcast: tabs(),
})
