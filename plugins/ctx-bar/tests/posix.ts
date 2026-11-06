/** The harness hands file hooks native paths (`C:\home\ubuntu\x` on Windows); the fixtures key on POSIX strings. On Linux a Windows-style `C:/...` home resolves under the working directory, so everything up to the drive goes too. */
export const posix = (p: string): string => p.replace(/\\/g, '/').replace(/^(?:.*\/)?[A-Za-z]:\//, '/')
