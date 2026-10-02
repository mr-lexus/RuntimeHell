export function primaryShortcut(key: string, platform: NodeJS.Platform = window.api?.platform): string {
  return `${platform === 'darwin' ? 'Cmd' : 'Ctrl'}+${key}`;
}

export function localExecutablePlaceholder(platform: NodeJS.Platform = window.api?.platform): string {
  return platform === 'win32' ? 'C:\\path\\to\\executable-or-folder' : '/path/to/executable-or-folder';
}
