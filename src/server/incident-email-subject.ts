// RFC 2047 transport encoding for the Gmail proxy. Keep draft subjects as
// readable Unicode; encode only at the provider boundary. This works around
// observed subject mojibake without modifying previously reviewed content.
export function encodeEmailSubject(subject: string): string {
  if (/[\r\n]/.test(subject)) throw new Error('Subject must be one line')
  if (/^[\x20-\x7e]*$/.test(subject) && !subject.includes('=?')) return subject
  const encoder = new TextEncoder()
  const words: string[] = []
  let bytes: number[] = []
  const flush = () => {
    if (!bytes.length) return
    words.push(`=?UTF-8?B?${btoa(String.fromCharCode(...bytes))}?=`)
    bytes = []
  }
  for (const character of subject) {
    const encoded = encoder.encode(character)
    // 39 bytes => 52 Base64 characters + 12 framing characters. The
    // mail composer can fold between words within header line limits.
    // Never split a Unicode code point between encoded words.
    if (bytes.length + encoded.length > 39) flush()
    bytes.push(...encoded)
  }
  flush()
  // This is an API field, not a raw MIME header. Never put CR/LF into it;
  // leave actual header folding to the provider's mail composer.
  return words.join(' ')
}
