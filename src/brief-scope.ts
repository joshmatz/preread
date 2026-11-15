// Brief routes act on the collection's own brief unless the request names a review.
export const briefScope = (collection: string, review?: string): Record<string, string> =>
  review ? { collection, review } : { collection };
