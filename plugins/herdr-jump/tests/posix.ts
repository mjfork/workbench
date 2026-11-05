/** The harness hands file hooks native paths (`C:\home\ubuntu\x` on Windows); the fixtures key on POSIX strings. */
export const posix = (p: string): string => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
