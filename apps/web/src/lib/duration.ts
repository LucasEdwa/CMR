// "3 d 4 h", "5 h", "12 min": compact durations for stage history (same in Swedish and English).
export function formatDuration(ms: number) {
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`
  if (hours > 0) return `${hours} h`
  return `${Math.max(1, minutes)} min`
}
