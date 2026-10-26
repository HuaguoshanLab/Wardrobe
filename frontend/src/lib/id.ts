export function operationId(): string {
  // randomUUID requires a secure context; LAN HTTP on phones still supports getRandomValues.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
