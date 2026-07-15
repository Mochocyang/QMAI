export function estimateContextTokens(text: string): number {
  let nonAscii = 0
  let ascii = 0
  for (const character of text) {
    if (character.charCodeAt(0) <= 0x7f) ascii += 1
    else nonAscii += 1
  }
  return nonAscii + Math.ceil(ascii / 4)
}
